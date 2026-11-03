import { cssFontFamily, fontSizeCssPx } from "./textStyle";
import type { FormField, TextEdit, ViewportSize } from "./types";
import { fieldToPixels, isTextModified } from "./types";

type PixelRect = { x: number; y: number; width: number; height: number };

function boxToPixelRect(box: {
  left: number;
  top: number;
  width: number;
  height: number;
}): PixelRect {
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function rectsIntersect(a: PixelRect, b: PixelRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  let line = "";
  let cy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy);
      line = word;
      cy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

async function drawFieldOverlay(
  ctx: CanvasRenderingContext2D,
  field: FormField,
  originX: number,
  originY: number,
  viewport: ViewportSize,
  pageHeightPt: number
) {
  const rect = fieldToPixels(field, viewport);
  const rx = rect.left - originX;
  const ry = rect.top - originY;

  if (field.imageDataUrl) {
    const img = await loadImage(field.imageDataUrl);
    ctx.drawImage(img, rx, ry, rect.width, rect.height);
    return;
  }

  if (field.coverUnderlying) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(rx, ry, rect.width, rect.height);
  }

  const trimmed = field.text.trim();
  if (!trimmed) return;

  const fontSize = fontSizeCssPx(field.fontSize, viewport.height, pageHeightPt);
  ctx.font = `${fontSize}px ${cssFontFamily(field.fontFamily ?? "Helvetica")}`;
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "top";
  drawWrappedText(ctx, trimmed, rx + 4, ry + 4, rect.width - 8, fontSize * 1.25);
}

async function drawTextEditOverlay(
  ctx: CanvasRenderingContext2D,
  edit: TextEdit,
  originX: number,
  originY: number,
  viewport: ViewportSize,
  pageHeightPt: number
) {
  if (!isTextModified(edit) && !edit.text.trim()) return;

  const rect = fieldToPixels(edit, viewport);
  const rx = rect.left - originX;
  const ry = rect.top - originY;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(rx, ry, rect.width, rect.height);

  const trimmed = edit.text.trim();
  if (!trimmed) return;

  const fontSize = fontSizeCssPx(edit.fontSize, viewport.height, pageHeightPt);
  ctx.font = `${fontSize}px ${cssFontFamily(edit.fontFamily ?? "Helvetica")}`;
  ctx.fillStyle = "#111111";
  ctx.textBaseline = "top";
  drawWrappedText(ctx, trimmed, rx + 4, ry + 4, rect.width - 8, fontSize * 1.25);
}

/** Capture everything visible in a page region (PDF canvas + overlapping annotations). */
export async function capturePageRegion(
  pdfCanvas: HTMLCanvasElement,
  pixelRect: PixelRect,
  page: number,
  fields: FormField[],
  textEdits: TextEdit[],
  viewport: ViewportSize,
  pageHeightPt: number
): Promise<string | null> {
  const x = Math.round(Math.max(0, pixelRect.x));
  const y = Math.round(Math.max(0, pixelRect.y));
  const w = Math.round(Math.min(pixelRect.width, pdfCanvas.width - x));
  const h = Math.round(Math.min(pixelRect.height, pdfCanvas.height - y));
  if (w < 4 || h < 4) return null;

  const captureRect: PixelRect = { x, y, width: w, height: h };
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(pdfCanvas, x, y, w, h, 0, 0, w, h);

  for (const edit of textEdits) {
    if (edit.page !== page) continue;
    const rect = boxToPixelRect(fieldToPixels(edit, viewport));
    if (!rectsIntersect(rect, captureRect)) continue;
    await drawTextEditOverlay(ctx, edit, x, y, viewport, pageHeightPt);
  }

  for (const field of fields) {
    if (field.page !== page) continue;
    const rect = boxToPixelRect(fieldToPixels(field, viewport));
    if (!rectsIntersect(rect, captureRect)) continue;
    await drawFieldOverlay(ctx, field, x, y, viewport, pageHeightPt);
  }

  return out.toDataURL("image/png");
}

/** Draw all annotations for one page onto an existing canvas (full page, origin 0,0). */
export async function drawPageAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  page: number,
  fields: FormField[],
  textEdits: TextEdit[],
  viewport: ViewportSize,
  pageHeightPt: number
): Promise<void> {
  for (const edit of textEdits) {
    if (edit.page !== page) continue;
    await drawTextEditOverlay(ctx, edit, 0, 0, viewport, pageHeightPt);
  }
  for (const field of fields) {
    if (field.page !== page) continue;
    await drawFieldOverlay(ctx, field, 0, 0, viewport, pageHeightPt);
  }
}
