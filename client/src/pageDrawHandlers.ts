import { capturePageRegion } from "./copyRegion";
import {
  canvasRectFromDrag,
  clampRect,
  getPagePoint,
} from "./overlayCanvas";
import type { PageRenderResult } from "./pdf";
import { boxDimensionsPt, fitFontSizeInBox } from "./textStyle";
import type { CopiedTextClip, FormField, RedactRegion, TextEdit } from "./types";
import {
  createRedactId,
  createTextEditId,
  pixelsToField,
} from "./types";
import {
  textEditAtPoint,
  textEditFromSelection,
  textEditsFromSelection,
  pixelRectToNormalized,
  type PageTextItem,
} from "./textExtract";

const MIN_BOX_PX = 8;
const MIN_SELECT_PX = 4;
const FALLBACK_BOX = { width: 200, height: 36 };

function lastBoxPixels(fields: FormField[], info: { width: number; height: number }) {
  if (fields.length === 0) return { ...FALLBACK_BOX };
  const last = fields[fields.length - 1];
  return {
    width: Math.max(MIN_BOX_PX, last.width * info.width),
    height: Math.max(MIN_BOX_PX, last.height * info.height),
  };
}

export type DragState = {
  kind: "draw" | "select" | "copy" | "paste" | "redact";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type FinishDragContext = {
  drag: DragState;
  nativeEvent: MouseEvent;
  pageEl: HTMLElement;
  overlay: HTMLCanvasElement;
  pdfCanvas: HTMLCanvasElement | null;
  info: PageRenderResult;
  scale: number;
  page: number;
  fields: FormField[];
  textEdits: TextEdit[];
  textItems: PageTextItem[];
  copiedClip: CopiedTextClip | null;
  defaultFieldCover: boolean;
  onFieldsChange: (fields: FormField[]) => void;
  onTextEditsChange: (edits: TextEdit[]) => void;
  onActiveFieldChange: (id: string | null) => void;
  onEditingFieldChange: (id: string | null) => void;
  onActiveTextEditChange: (id: string | null) => void;
  onEditingTextEditChange: (id: string | null) => void;
  onTextCopied: (clip: CopiedTextClip) => void;
  onRedactionAdd: (region: RedactRegion) => void;
};

/** Returns true when the drag did something, so the tool can switch itself off. */
export function finishPageDrag(ctx: FinishDragContext): boolean {
  const pt = getPagePoint(
    ctx.pageEl,
    ctx.info.width,
    ctx.info.height,
    ctx.nativeEvent
  );
  let rect = canvasRectFromDrag(
    ctx.drag.startX,
    ctx.drag.startY,
    pt.x,
    pt.y
  );

  const info = ctx.info;

  const extractBlocksFromRect = () => {
    if (rect.width < MIN_SELECT_PX && rect.height < MIN_SELECT_PX) {
      const normPoint = pixelRectToNormalized(
        { x: pt.x, y: pt.y, width: 1, height: 1 },
        info
      );
      const one = textEditAtPoint(ctx.textItems, normPoint.x, normPoint.y);
      return one ? [one] : [];
    }
    const clamped = clampRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      info.width,
      info.height
    );
    rect = clamped;
    return textEditsFromSelection(
      ctx.textItems,
      pixelRectToNormalized(clamped, info)
    );
  };

  if (ctx.drag.kind === "redact") {
    if (rect.width < MIN_BOX_PX || rect.height < MIN_BOX_PX) return false;
    rect = clampRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      info.width,
      info.height
    );
    ctx.onRedactionAdd({
      id: createRedactId(),
      page: ctx.page,
      x: rect.x / info.width,
      y: rect.y / info.height,
      width: rect.width / info.width,
      height: rect.height / info.height,
    });
    return true;
  }

  if (ctx.drag.kind === "select") {
    const blocks = extractBlocksFromRect();
    if (blocks.length === 0) return false;

    const sameSpot = (t: TextEdit, b: { x: number; y: number }) =>
      t.page === ctx.page &&
      Math.abs((t.origin?.x ?? t.x) - b.x) < 0.01 &&
      Math.abs((t.origin?.y ?? t.y) - b.y) < 0.01;

    const added: TextEdit[] = blocks
      .filter((b) => !ctx.textEdits.some((t) => sameSpot(t, b)))
      .map((b) => ({
        id: createTextEditId(),
        page: ctx.page,
        ...b,
        fontFamily: b.fontFamily ?? "Helvetica",
        fontSizeLocked: b.fontSizeLocked ?? true,
      }));

    if (added.length === 0) {
      // Already being edited: just select that box.
      const existing = ctx.textEdits.find((t) => sameSpot(t, blocks[0]));
      if (existing) ctx.onActiveTextEditChange(existing.id);
      return true;
    }

    ctx.onTextEditsChange([...ctx.textEdits, ...added]);
    // Start typing in the first new box right away.
    ctx.onActiveTextEditChange(added[0].id);
    ctx.onEditingTextEditChange(added[0].id);
    return true;
  }

  if (ctx.drag.kind === "copy") {
    if (rect.width < MIN_BOX_PX || rect.height < MIN_BOX_PX) return false;

    rect = clampRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      info.width,
      info.height
    );

    const pdfCanvas = ctx.pdfCanvas;
    if (!pdfCanvas) return false;

    const pageHeightPt = info.height / ctx.scale;
    const norm = pixelRectToNormalized(rect, info);
    const merged = textEditFromSelection(ctx.textItems, norm);

    void capturePageRegion(
      pdfCanvas,
      rect,
      ctx.page,
      ctx.fields,
      ctx.textEdits,
      info,
      pageHeightPt
    ).then((imageDataUrl) => {
      if (!imageDataUrl) return;
      ctx.onTextCopied({
        imageDataUrl,
        width: norm.width,
        height: norm.height,
        coverUnderlying: true,
        text: merged?.text,
      });
    });
    return true;
  }

  if (ctx.drag.kind === "paste") {
    const clip = ctx.copiedClip;
    if (!clip) return false;

    if (rect.width < MIN_BOX_PX && rect.height < MIN_BOX_PX) {
      const w = Math.max(MIN_BOX_PX, clip.width * info.width);
      const h = Math.max(MIN_BOX_PX, clip.height * info.height);
      rect = clampRect(
        pt.x - w / 2,
        pt.y - h / 2,
        w,
        h,
        info.width,
        info.height
      );
    } else {
      rect = clampRect(
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        info.width,
        info.height
      );
    }

    if (rect.width < MIN_BOX_PX || rect.height < MIN_BOX_PX) return false;

    const field = pixelsToField(
      ctx.page,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      info,
      {
        imageDataUrl: clip.imageDataUrl,
        coverUnderlying: true,
        scaleFontWithBox: true,
        fontSizeLocked: true,
      }
    );
    ctx.onFieldsChange([...ctx.fields, field]);
    ctx.onActiveFieldChange(field.id);
    ctx.onEditingFieldChange(null);
    return true;
  }

  if (ctx.drag.kind === "draw") {
    if (rect.width < MIN_BOX_PX && rect.height < MIN_BOX_PX) {
      const boxSize = lastBoxPixels(ctx.fields, info);
      rect = clampRect(
        ctx.drag.startX - boxSize.width / 2,
        ctx.drag.startY - boxSize.height / 2,
        boxSize.width,
        boxSize.height,
        info.width,
        info.height
      );
    } else {
      rect = clampRect(
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        info.width,
        info.height
      );
    }

    if (rect.width < MIN_BOX_PX || rect.height < MIN_BOX_PX) return false;

    const pageHeightPt = info.height / ctx.scale;
    const pageWidthPt = info.width / ctx.scale;
    const widthNorm = rect.width / info.width;
    const heightNorm = rect.height / info.height;
    const { widthPt, heightPt } = boxDimensionsPt(
      widthNorm,
      heightNorm,
      pageWidthPt,
      pageHeightPt
    );
    const fontSize = fitFontSizeInBox("", widthPt, heightPt, "Helvetica");
    const lastField = ctx.fields[ctx.fields.length - 1];

    const field = pixelsToField(
      ctx.page,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      info,
      {
        fontSize,
        coverUnderlying:
          lastField?.coverUnderlying ?? ctx.defaultFieldCover,
      }
    );
    ctx.onFieldsChange([...ctx.fields, field]);
    ctx.onActiveFieldChange(field.id);
    ctx.onEditingFieldChange(null);
    return true;
  }

  return false;
}
