import { useRef, useState, useEffect } from "react";
import {
  boxDimensionsPt,
  cssFontFamily,
  fitFontSizeInBox,
  fontSizeCssPx,
} from "./textStyle";
import type { FormField, ViewportSize } from "./types";
import { fieldToPixels } from "./types";

type Props = {
  field: FormField;
  viewport: ViewportSize;
  pageHeightPt: number;
  active: boolean;
  editing: boolean;
  onUpdate: (field: FormField) => void;
  onDelete: () => void;
  onActivate: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
};

type DragKind = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_PX = 8;

type PixelRect = { left: number; top: number; width: number; height: number };

function applyAutoFontSize(
  field: FormField,
  pageWidthPt: number,
  pageHeightPt: number
): FormField {
  if (field.fontSizeLocked) return field;
  const { widthPt, heightPt } = boxDimensionsPt(
    field.width,
    field.height,
    pageWidthPt,
    pageHeightPt
  );
  return {
    ...field,
    fontSize: fitFontSizeInBox(field.text, widthPt, heightPt, field.fontFamily),
  };
}

export function ResizableField({
  field,
  viewport,
  pageHeightPt,
  active,
  editing,
  onUpdate,
  onDelete,
  onActivate,
  onStartEdit,
  onStopEdit,
}: Props) {
  const [liveRect, setLiveRect] = useState<PixelRect | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{
    kind: DragKind;
    startX: number;
    startY: number;
    orig: PixelRect;
  } | null>(null);

  const pageWidthPt =
    pageHeightPt > 0
      ? (viewport.width / viewport.height) * pageHeightPt
      : viewport.width;

  const baseRect = fieldToPixels(field, viewport);
  const rect = liveRect ?? baseRect;
  const displayFontSize = fontSizeCssPx(
    field.fontSize,
    viewport.height,
    pageHeightPt
  );

  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const toNormalized = (left: number, top: number, width: number, height: number) => ({
    x: left / viewport.width,
    y: top / viewport.height,
    width: width / viewport.width,
    height: height / viewport.height,
  });

  const applyRect = (left: number, top: number, width: number, height: number) => {
    const next = {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.max(MIN_PX, width),
      height: Math.max(MIN_PX, height),
    };
    next.width = Math.min(next.width, viewport.width - next.left);
    next.height = Math.min(next.height, viewport.height - next.top);
    return next;
  };

  const commitField = (nextRect: PixelRect) => {
    const normalized = {
      ...field,
      ...toNormalized(nextRect.left, nextRect.top, nextRect.width, nextRect.height),
    };
    if (field.scaleFontWithBox) {
      const ratio = Math.min(
        normalized.width / field.width,
        normalized.height / field.height
      );
      onUpdate({
        ...normalized,
        fontSize: Math.max(4, field.fontSize * ratio),
        fontSizeLocked: true,
      });
      return;
    }
    onUpdate(applyAutoFontSize(normalized, pageWidthPt, pageHeightPt));
  };

  const startDrag = (e: React.MouseEvent, kind: DragKind) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onStopEdit();
    onActivate();
    beginDrag(e.clientX, e.clientY, kind);
  };

  const beginDrag = (clientX: number, clientY: number, kind: DragKind) => {
    const orig = liveRect ?? baseRect;
    dragRef.current = {
      kind,
      startX: clientX,
      startY: clientY,
      orig: { ...orig },
    };

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      let { left, top, width, height } = drag.orig;

      if (drag.kind === "move") {
        left += dx;
        top += dy;
      } else {
        if (drag.kind.includes("e")) width += dx;
        if (drag.kind.includes("w")) {
          width -= dx;
          left = drag.orig.left + drag.orig.width - width;
        }
        if (drag.kind.includes("s")) height += dy;
        if (drag.kind.includes("n")) {
          height -= dy;
          top = drag.orig.top + drag.orig.height - height;
        }
      }

      setLiveRect(applyRect(left, top, width, height));
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setLiveRect((current) => {
        if (current) commitField(current);
        return null;
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startMoveWithThreshold = (e: React.MouseEvent) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    onStopEdit();
    onActivate();

    const startX = e.clientX;
    const startY = e.clientY;
    const orig = liveRect ?? baseRect;
    let dragging = false;

    const onMove = (ev: MouseEvent) => {
      if (!dragging) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.hypot(dx, dy) < 4) return;
        dragging = true;
        dragRef.current = {
          kind: "move",
          startX,
          startY,
          orig: { ...orig },
        };
      }
      const drag = dragRef.current;
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      setLiveRect(
        applyRect(
          drag.orig.left + dx,
          drag.orig.top + dy,
          drag.orig.width,
          drag.orig.height
        )
      );
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragging) {
        dragRef.current = null;
        setLiveRect((current) => {
          if (current) commitField(current);
          return null;
        });
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handles: { kind: DragKind; className: string }[] = [
    { kind: "nw", className: "handle-nw" },
    { kind: "n", className: "handle-n" },
    { kind: "ne", className: "handle-ne" },
    { kind: "w", className: "handle-w" },
    { kind: "e", className: "handle-e" },
    { kind: "sw", className: "handle-sw" },
    { kind: "s", className: "handle-s" },
    { kind: "se", className: "handle-se" },
  ];

  return (
    <div
      data-field-id={field.id}
      className={`form-field${active ? " active" : ""}${editing ? " editing" : ""}${field.imageDataUrl ? " image-field" : ""}${field.coverUnderlying ? " cover-underlying" : " show-through"}${!field.imageDataUrl && !field.text.trim() && !editing ? " empty" : ""}`}
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest(".handle, button")) return;
        if (editing) return;
        if (e.detail > 1) return;
        startMoveWithThreshold(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onActivate();
        if (!field.imageDataUrl) onStartEdit();
      }}
    >
      {field.imageDataUrl ? (
        <img
          src={field.imageDataUrl}
          alt=""
          className="form-field-image"
          draggable={false}
        />
      ) : (
      <textarea
        ref={inputRef}
        className="form-field-input"
        value={field.text}
        placeholder={editing ? "Type here…" : undefined}
        readOnly={!editing}
        style={{
          fontFamily: cssFontFamily(field.fontFamily),
          fontSize: `${displayFontSize}px`,
          lineHeight: 1.25,
        }}
        onChange={(e) => {
          const next = { ...field, text: e.target.value };
          onUpdate(applyAutoFontSize(next, pageWidthPt, pageHeightPt));
        }}
        onFocus={() => {
          onActivate();
          onStartEdit();
        }}
        onBlur={onStopEdit}
        onMouseDown={(e) => {
          if (editing) {
            e.stopPropagation();
            return;
          }
          e.preventDefault();
        }}
      />
      )}
      {active && (
        <>
          {handles.map(({ kind, className }) => (
            <div
              key={kind}
              className={`handle ${className}`}
              onMouseDown={(e) => startDrag(e, kind)}
            />
          ))}
          <button
            type="button"
            className="form-field-delete"
            aria-label="Delete field"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
