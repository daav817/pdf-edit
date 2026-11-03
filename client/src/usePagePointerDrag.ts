import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { getPagePoint } from "./overlayCanvas";
import type { DragState } from "./pageDrawHandlers";

type Options = {
  pageElRef: React.RefObject<HTMLElement | null>;
  pageWidthRef: React.MutableRefObject<number>;
  pageHeightRef: React.MutableRefObject<number>;
  pageReadyRef: React.MutableRefObject<boolean>;
  dragRef: React.MutableRefObject<DragState | null>;
  drawModeRef: React.MutableRefObject<boolean>;
  editTextModeRef: React.MutableRefObject<boolean>;
  copyTextModeRef: React.MutableRefObject<boolean>;
  pasteTextModeRef: React.MutableRefObject<boolean>;
  redactModeRef: React.MutableRefObject<boolean>;
  redrawOverlay: (preview: DragState | null) => void;
  finishDragFromEvent: (nativeEvent: PointerEvent) => void;
  toolModeActive: boolean;
};

/** Reliable draw/select drag using capture + window pointer listeners. */
export function usePagePointerDrag({
  pageElRef,
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
  toolModeActive,
}: Options) {
  const draggingRef = useRef(false);
  const redrawRef = useRef(redrawOverlay);
  redrawRef.current = redrawOverlay;
  const finishRef = useRef(finishDragFromEvent);
  finishRef.current = finishDragFromEvent;
  const toolActiveRef = useRef(toolModeActive);
  toolActiveRef.current = toolModeActive;

  function onWindowMove(e: PointerEvent) {
    if (!draggingRef.current) return;
    const drag = dragRef.current;
    const pageEl = pageElRef.current;
    if (!drag || !pageEl) return;
    const pt = getPagePoint(
      pageEl,
      pageWidthRef.current,
      pageHeightRef.current,
      e
    );
    dragRef.current = { ...drag, currentX: pt.x, currentY: pt.y };
    redrawRef.current(dragRef.current);
  }

  function onWindowUp(e: PointerEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", onWindowUp);
    window.removeEventListener("pointercancel", onWindowUp);
    finishRef.current(e);
  }

  useEffect(() => {
    return () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
    };
  }, []);

  const onPagePointerDownCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!toolActiveRef.current || !pageReadyRef.current) return;
      if (e.button !== 0) return;

      const pageEl = pageElRef.current;
      if (!pageEl) return;

      const isDraw = drawModeRef.current;
      const isEdit = editTextModeRef.current;
      const isCopy = copyTextModeRef.current;
      const isPaste = pasteTextModeRef.current;
      const isRedact = redactModeRef.current;
      if (!isDraw && !isEdit && !isCopy && !isPaste && !isRedact) return;
      // Controls on the page (e.g. a redaction's remove button) stay clickable.
      if ((e.target as Element).closest("[data-tool-passthrough]")) return;

      e.preventDefault();
      e.stopPropagation();

      const pt = getPagePoint(
        pageEl,
        pageWidthRef.current,
        pageHeightRef.current,
        e.nativeEvent
      );
      const kind: DragState["kind"] = isRedact
        ? "redact"
        : isCopy
        ? "copy"
        : isPaste
          ? "paste"
          : isEdit
            ? "select"
            : "draw";

      dragRef.current = {
        kind,
        startX: pt.x,
        startY: pt.y,
        currentX: pt.x,
        currentY: pt.y,
      };
      redrawRef.current(dragRef.current);

      if (e.currentTarget.setPointerCapture) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      draggingRef.current = true;
      window.addEventListener("pointermove", onWindowMove);
      window.addEventListener("pointerup", onWindowUp);
      window.addEventListener("pointercancel", onWindowUp);
    },
    [
      pageElRef,
      pageWidthRef,
      pageHeightRef,
      pageReadyRef,
      dragRef,
      drawModeRef,
      editTextModeRef,
      copyTextModeRef,
      pasteTextModeRef,
      redactModeRef,
    ]
  );

  const onPagePointerUpCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  return { onPagePointerDownCapture, onPagePointerUpCapture };
}
