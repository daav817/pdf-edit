import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FieldDomLayer } from "./FieldDomLayer";
import {
  canvasRectFromDrag,
  clearOverlay,
  drawCopyRect,
  drawPasteRect,
  drawPreviewRect,
  drawRedactRect,
  drawSelectionRect,
} from "./overlayCanvas";
import { finishPageDrag, type DragState } from "./pageDrawHandlers";
import { usePagePointerDrag } from "./usePagePointerDrag";
import type { PageRenderResult, PdfDocument, RenderHandle } from "./pdf";
import { renderPageToCanvas, syncOverlayCanvas } from "./pdf";
import { RedactionLayer } from "./RedactionLayer";
import type { CopiedTextClip, FormField, RedactRegion, TextEdit } from "./types";
import {
  extractPageTextItems,
  type PageTextItem,
} from "./textExtract";

type Props = {
  doc: PdfDocument;
  page: number;
  scale: number;
  fields: FormField[];
  textEdits: TextEdit[];
  drawMode: boolean;
  editTextMode: boolean;
  copyTextMode: boolean;
  pasteTextMode: boolean;
  redactMode: boolean;
  redactions: RedactRegion[];
  onRedactionsChange: (regions: RedactRegion[]) => void;
  copiedClip: CopiedTextClip | null;
  activeFieldId: string | null;
  editingFieldId: string | null;
  activeTextEditId: string | null;
  editingTextEditId: string | null;
  onFieldsChange: (fields: FormField[]) => void;
  onTextEditsChange: (edits: TextEdit[]) => void;
  onActiveFieldChange: (id: string | null) => void;
  onEditingFieldChange: (id: string | null) => void;
  onActiveTextEditChange: (id: string | null) => void;
  onEditingTextEditChange: (id: string | null) => void;
  onTextCopied: (clip: CopiedTextClip) => void;
  /** A drawing tool finished its job; the app switches it off. */
  onToolUsed: () => void;
  /** New draw fields use cover mode when true (e.g. image imported for redaction). */
  defaultFieldCover?: boolean;
  onPageLayout?: (layout: { pageWidthPt: number; pageHeightPt: number }) => void;
  onPageReady?: (ready: boolean) => void;
};

export function PdfViewer({
  doc,
  page,
  scale,
  fields,
  textEdits,
  drawMode,
  editTextMode,
  copyTextMode,
  pasteTextMode,
  redactMode,
  redactions,
  onRedactionsChange,
  copiedClip,
  activeFieldId,
  editingFieldId,
  activeTextEditId,
  editingTextEditId,
  onFieldsChange,
  onTextEditsChange,
  onActiveFieldChange,
  onEditingFieldChange,
  onActiveTextEditChange,
  onEditingTextEditChange,
  onTextCopied,
  onToolUsed,
  defaultFieldCover = false,
  onPageLayout,
  onPageReady,
}: Props) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<PageRenderResult | null>(null);
  const textItemsRef = useRef<PageTextItem[]>([]);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const textEditsRef = useRef(textEdits);
  textEditsRef.current = textEdits;
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;
  const editTextModeRef = useRef(editTextMode);
  editTextModeRef.current = editTextMode;
  const copyTextModeRef = useRef(copyTextMode);
  copyTextModeRef.current = copyTextMode;
  const pasteTextModeRef = useRef(pasteTextMode);
  pasteTextModeRef.current = pasteTextMode;
  const redactModeRef = useRef(redactMode);
  redactModeRef.current = redactMode;
  const redactionsRef = useRef(redactions);
  redactionsRef.current = redactions;
  const copiedClipRef = useRef(copiedClip);
  copiedClipRef.current = copiedClip;
  const defaultFieldCoverRef = useRef(defaultFieldCover);
  defaultFieldCoverRef.current = defaultFieldCover;
  const dragRef = useRef<DragState | null>(null);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  const previewDomRef = useRef<HTMLDivElement>(null);
  const pageWidthRef = useRef(0);
  const pageHeightRef = useRef(0);
  const pageReadyRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0, valid: false });
  const pageRef = useRef(page);
  pageRef.current = page;
  const callbacksRef = useRef({
    onFieldsChange,
    onTextEditsChange,
    onActiveFieldChange,
    onEditingFieldChange,
    onActiveTextEditChange,
    onEditingTextEditChange,
    onTextCopied,
    onToolUsed,
    onRedactionsChange,
  });
  callbacksRef.current = {
    onFieldsChange,
    onTextEditsChange,
    onActiveFieldChange,
    onEditingFieldChange,
    onActiveTextEditChange,
    onEditingTextEditChange,
    onTextCopied,
    onToolUsed,
    onRedactionsChange,
  };

  const [renderInfo, setRenderInfo] = useState<PageRenderResult | null>(null);

  const toolModeActive =
    drawMode || editTextMode || copyTextMode || pasteTextMode || redactMode;

  const syncPreviewDom = useCallback(
    (preview: DragState | null, rect: ReturnType<typeof canvasRectFromDrag> | null) => {
      const el = previewDomRef.current;
      if (!el) return;
      if (!preview || !rect || (rect.width <= 0 && rect.height <= 0)) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      el.style.left = `${rect.x}px`;
      el.style.top = `${rect.y}px`;
      el.style.width = `${Math.max(rect.width, 1)}px`;
      el.style.height = `${Math.max(rect.height, 1)}px`;
      el.className = `drag-preview drag-preview--${preview.kind}`;
    },
    []
  );

  const redrawOverlay = useCallback((preview: DragState | null = null) => {
    const canvas = overlayCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        clearOverlay(canvas);
        if (preview) {
          const rect = canvasRectFromDrag(
            preview.startX,
            preview.startY,
            preview.currentX,
            preview.currentY
          );
          if (rect.width > 0 || rect.height > 0) {
            if (preview.kind === "select") {
              drawSelectionRect(ctx, rect);
            } else if (preview.kind === "copy") {
              drawCopyRect(ctx, rect);
            } else if (preview.kind === "paste") {
              drawPasteRect(ctx, rect);
            } else if (preview.kind === "redact") {
              drawRedactRect(ctx, rect);
            } else {
              drawPreviewRect(ctx, rect);
            }
            syncPreviewDom(preview, rect);
            return;
          }
        }
      }
    }
    syncPreviewDom(preview, null);
  }, [syncPreviewDom]);

  const updatePlusCursor = useCallback((clientX: number, clientY: number) => {
    const plus = plusRef.current;
    const viewer = viewerRef.current;
    if (!plus || !viewer) {
      if (plus) plus.style.display = "none";
      return;
    }
    const usePlus =
      drawModeRef.current ||
      pasteTextModeRef.current ||
      editTextModeRef.current ||
      copyTextModeRef.current ||
      redactModeRef.current;
    if (!usePlus) {
      plus.style.display = "none";
      return;
    }
    const under = document.elementFromPoint(clientX, clientY);
    if (under?.closest("[data-tool-passthrough]")) {
      plus.style.display = "none";
      return;
    }
    const rect = viewer.getBoundingClientRect();
    const inside =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    if (inside) {
      plus.style.display = "flex";
      plus.style.left = `${clientX - rect.left}px`;
      plus.style.top = `${clientY - rect.top}px`;
    } else {
      plus.style.display = "none";
    }
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY, valid: true };
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    if (!toolModeActive) return;
    const p = lastPointerRef.current;
    if (p.valid) updatePlusCursor(p.x, p.y);
  }, [toolModeActive, updatePlusCursor, renderInfo]);

  useEffect(() => {
    const handle: RenderHandle = { cancelled: false, task: null };
    onPageReady?.(false);
    setRenderInfo(null);
    renderRef.current = null;
    pageReadyRef.current = false;
    pageWidthRef.current = 0;
    pageHeightRef.current = 0;

    const startRender = () => {
      const canvas = pdfCanvasRef.current;
      const overlay = overlayCanvasRef.current;
      if (!canvas || !overlay) {
        if (!handle.cancelled) requestAnimationFrame(startRender);
        return;
      }

      // pdf.js rejects a second render() on a canvas that is still rendering
      // (e.g. StrictMode's double effect run, or quick zoom/page changes), so
      // wait for the previous render to settle before starting this one.
      const job = renderChainRef.current.then(() =>
        handle.cancelled
          ? undefined
          : renderPageToCanvas(doc, page, canvas, scale, handle)
      );
      renderChainRef.current = job.then(
        () => undefined,
        () => undefined
      );

      void job
        .then((result) => {
          if (handle.cancelled || !result) return;
          renderRef.current = result;
          pageWidthRef.current = result.width;
          pageHeightRef.current = result.height;
          pageReadyRef.current = true;
          syncOverlayCanvas(overlay, result);
          clearOverlay(overlay);
          setRenderInfo(result);
          onPageReady?.(true);
        })
        .catch((err) => {
          if (!handle.cancelled) {
            console.error(err);
            setRenderInfo(null);
            renderRef.current = null;
            pageReadyRef.current = false;
            pageWidthRef.current = 0;
            pageHeightRef.current = 0;
            onPageReady?.(false);
          }
        });
    };

    startRender();

    return () => {
      handle.cancelled = true;
      handle.task?.cancel();
    };
  }, [doc, page, scale, onPageReady]);

  useEffect(() => {
    if (!editTextMode && !copyTextMode) {
      textItemsRef.current = [];
      return;
    }
    let cancelled = false;
    extractPageTextItems(doc, page).then((items) => {
      if (!cancelled) textItemsRef.current = items;
    });
    return () => {
      cancelled = true;
    };
  }, [doc, page, editTextMode, copyTextMode]);

  useEffect(() => {
    if (!renderInfo) return;
    const overlay = overlayCanvasRef.current;
    if (overlay) syncOverlayCanvas(overlay, renderInfo);
  }, [renderInfo]);

  useEffect(() => {
    if (!drawMode && !copyTextMode && !editTextMode && !pasteTextMode && !redactMode) {
      dragRef.current = null;
      redrawOverlay(null);
      if (plusRef.current) plusRef.current.style.display = "none";
    }
  }, [drawMode, copyTextMode, editTextMode, pasteTextMode, redactMode, redrawOverlay]);

  useEffect(() => {
    if (!toolModeActive) return;

    const onMove = (e: PointerEvent) => {
      updatePlusCursor(e.clientX, e.clientY);
    };

    const viewer = viewerRef.current;
    document.addEventListener("pointermove", onMove, { passive: true });
    viewer?.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      viewer?.removeEventListener("pointermove", onMove);
      if (plusRef.current) plusRef.current.style.display = "none";
    };
  }, [toolModeActive, updatePlusCursor, renderInfo]);

  const finishDragFromEvent = useCallback(
    (nativeEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const overlay = overlayCanvasRef.current;
      const pageEl = viewerRef.current;
      const info = renderRef.current;
      dragRef.current = null;
      redrawOverlay(null);

      if (!overlay || !pageEl || !info) return;

      const cbs = callbacksRef.current;
      const used = finishPageDrag({
        drag,
        nativeEvent,
        pageEl,
        overlay,
        pdfCanvas: pdfCanvasRef.current,
        info,
        scale,
        page: pageRef.current,
        fields: fieldsRef.current,
        textEdits: textEditsRef.current,
        textItems: textItemsRef.current,
        copiedClip: copiedClipRef.current,
        defaultFieldCover: defaultFieldCoverRef.current,
        onFieldsChange: cbs.onFieldsChange,
        onTextEditsChange: cbs.onTextEditsChange,
        onActiveFieldChange: cbs.onActiveFieldChange,
        onEditingFieldChange: cbs.onEditingFieldChange,
        onActiveTextEditChange: cbs.onActiveTextEditChange,
        onEditingTextEditChange: cbs.onEditingTextEditChange,
        onTextCopied: cbs.onTextCopied,
        onRedactionAdd: (region) =>
          cbs.onRedactionsChange([...redactionsRef.current, region]),
      });
      if (used) cbs.onToolUsed();
    },
    [scale, redrawOverlay]
  );


  const { onPagePointerDownCapture, onPagePointerUpCapture } =
    usePagePointerDrag({
      pageElRef: viewerRef,
      pageWidthRef,
      pageHeightRef,
      pageReadyRef,
      dragRef,
      drawModeRef,
      editTextModeRef,
      copyTextModeRef,
      pasteTextModeRef,
      redactModeRef,
      redrawOverlay,
      finishDragFromEvent,
      toolModeActive: toolModeActive && !!renderInfo,
    });

  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (drawMode || editTextMode || copyTextMode || pasteTextMode || redactMode) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest(".form-field, .text-edit, button, .handle")) return;

      const cbs = callbacksRef.current;
      cbs.onActiveFieldChange(null);
      cbs.onEditingFieldChange(null);
      cbs.onActiveTextEditChange(null);
      cbs.onEditingTextEditChange(null);
    };

    viewer.addEventListener("mousedown", onMouseDown);
    return () => viewer.removeEventListener("mousedown", onMouseDown);
  }, [drawMode, editTextMode, copyTextMode, pasteTextMode, redactMode, doc, page]);

  const pageHeightPt = renderInfo ? renderInfo.height / scale : 0;

  useEffect(() => {
    if (!renderInfo || !onPageLayout) return;
    onPageLayout({
      pageWidthPt: renderInfo.width / scale,
      pageHeightPt: renderInfo.height / scale,
    });
  }, [renderInfo, scale, onPageLayout]);

  const viewerClass = [
    "pdf-viewer",
    drawMode ? "draw-mode" : "",
    pasteTextMode ? "paste-mode" : "",
    copyTextMode ? "copy-mode" : "",
    editTextMode ? "edit-mode" : "",
    redactMode ? "redact-mode" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="pdf-page-wrap">
        <div
          ref={viewerRef}
          className={viewerClass}
          style={
            renderInfo
              ? { width: renderInfo.width, height: renderInfo.height }
              : undefined
          }
          onPointerDownCapture={
            toolModeActive && renderInfo
              ? onPagePointerDownCapture
              : undefined
          }
          onPointerUpCapture={
            toolModeActive && renderInfo ? onPagePointerUpCapture : undefined
          }
        >
          <canvas ref={pdfCanvasRef} className="pdf-canvas" />
          <FieldDomLayer
            page={page}
            viewport={renderInfo ?? { width: 0, height: 0 }}
            pageHeightPt={pageHeightPt}
            fields={fields}
            textEdits={textEdits}
            editTextMode={editTextMode}
            activeFieldId={activeFieldId}
            editingFieldId={editingFieldId}
            activeTextEditId={activeTextEditId}
            editingTextEditId={editingTextEditId}
            onFieldsChange={onFieldsChange}
            onTextEditsChange={onTextEditsChange}
            onActiveFieldChange={onActiveFieldChange}
            onEditingFieldChange={onEditingFieldChange}
            onActiveTextEditChange={onActiveTextEditChange}
            onEditingTextEditChange={onEditingTextEditChange}
            visible={!!renderInfo}
          />
          {renderInfo && (
            <RedactionLayer
              regions={redactions.filter((r) => r.page === page)}
              viewport={renderInfo}
              onRemove={(id) =>
                onRedactionsChange(redactions.filter((r) => r.id !== id))
              }
            />
          )}
          <canvas
            ref={overlayCanvasRef}
            className={`overlay-canvas${toolModeActive ? " tool-active" : ""}`}
            aria-hidden
            style={
              renderInfo
                ? { width: renderInfo.width, height: renderInfo.height }
                : undefined
            }
          />
          <div ref={previewDomRef} className="drag-preview" aria-hidden />
          {toolModeActive && (
            <div
              ref={plusRef}
              className="draw-cursor-plus"
              style={{ display: "none" }}
              aria-hidden
            >
              <svg width="22" height="22" viewBox="0 0 22 22">
                <path
                  d="M11 1v20M1 11h20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
