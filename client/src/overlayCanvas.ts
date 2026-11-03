import type { PageViewport } from "pdfjs-dist";

export function getCanvasPoint(
  canvas: HTMLCanvasElement,
  event: MouseEvent
): { x: number; y: number } {
  return getPagePoint(canvas, canvas.width, canvas.height, event);
}

/** Map screen coords to page space using the on-screen box size (works for div or canvas). */
export function getPagePoint(
  pageEl: HTMLElement,
  pageWidth: number,
  pageHeight: number,
  event: MouseEvent
): { x: number; y: number } {
  const rect = pageEl.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    pageWidth <= 0 ||
    pageHeight <= 0
  ) {
    return { x: 0, y: 0 };
  }
  const scaleX = pageWidth / rect.width;
  const scaleY = pageHeight / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

export function clampRect(
  x: number,
  y: number,
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
) {
  const left = Math.max(0, Math.min(x, maxWidth - width));
  const top = Math.max(0, Math.min(y, maxHeight - height));
  return {
    x: left,
    y: top,
    width: Math.min(width, maxWidth - left),
    height: Math.min(height, maxHeight - top),
  };
}

export type CanvasRect = { x: number; y: number; width: number; height: number };

export function normalizeRect(
  rect: CanvasRect,
  viewport: PageViewport
): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x / viewport.width,
    y: rect.y / viewport.height,
    width: rect.width / viewport.width,
    height: rect.height / viewport.height,
  };
}

export function canvasRectFromDrag(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number
): CanvasRect {
  return {
    x: Math.min(startX, currentX),
    y: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

export function drawCopyRect(ctx: CanvasRenderingContext2D, rect: CanvasRect) {
  ctx.fillStyle = "rgba(168, 85, 247, 0.2)";
  ctx.strokeStyle = "#9333ea";
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
}

export function drawPasteRect(ctx: CanvasRenderingContext2D, rect: CanvasRect) {
  ctx.fillStyle = "rgba(34, 197, 94, 0.18)";
  ctx.strokeStyle = "#16a34a";
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
}

export function drawRedactRect(ctx: CanvasRenderingContext2D, rect: CanvasRect) {
  ctx.fillStyle = "rgba(220, 38, 38, 0.3)";
  ctx.strokeStyle = "#dc2626";
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
}

export function drawPreviewRect(
  ctx: CanvasRenderingContext2D,
  rect: CanvasRect,
  color = "#2563eb"
) {
  ctx.fillStyle = "rgba(37, 99, 235, 0.15)";
  ctx.strokeStyle = color;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([]);
}

export function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  rect: CanvasRect,
  color = "#eab308"
) {
  ctx.fillStyle = "rgba(234, 179, 8, 0.25)";
  ctx.strokeStyle = color;
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

export function drawPlusCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
) {
  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x, y + 14);
  ctx.moveTo(x - 14, y);
  ctx.lineTo(x + 14, y);
  ctx.stroke();
  ctx.restore();
}

export function clearOverlay(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
