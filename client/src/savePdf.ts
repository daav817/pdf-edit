import { PDFDocument, rgb } from "pdf-lib";
import type { FormField, TextEdit, TextFontFamily } from "./types";
import { isTextModified, hasUnsavedChanges } from "./types";
import { FIRST_BASELINE_EM, fitFontSizeInBox, standardFont } from "./textStyle";
import { removeOriginalText } from "./redact";

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function embedFamilyFont(
  pdfDoc: PDFDocument,
  family: TextFontFamily
) {
  return pdfDoc.embedFont(standardFont(family));
}

function drawLockedTextInBox(
  page: ReturnType<PDFDocument["getPages"]>[number],
  opts: {
    xNorm: number;
    yNorm: number;
    widthNorm: number;
    heightNorm: number;
    text: string;
    fontSize: number;
    fontFamily: TextFontFamily;
    fontSizeLocked: boolean;
    font: Awaited<ReturnType<typeof embedFamilyFont>>;
    /** Draw a white rectangle before text (always true for text edits). */
    coverUnderlying: boolean;
    /** Text edits: keep the original line breaks and spacing, first line at the top. */
    lineHeight?: number;
  }
) {
  const { width: pw, height: ph } = page.getSize();
  const x = opts.xNorm * pw;
  const y = ph - (opts.yNorm + opts.heightNorm) * ph;
  const w = opts.widthNorm * pw;
  const h = opts.heightNorm * ph;

  if (opts.coverUnderlying) {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
  }

  if (opts.lineHeight) {
    const lines = opts.text.replace(/\s+$/, "").split("\n");
    if (!lines.some((l) => l.trim())) return;
    const size = opts.fontSize;
    // The box starts where the original text started, so draw from its exact left edge.
    let baseline = y + h - size * FIRST_BASELINE_EM;
    for (const line of lines) {
      if (line.trim()) {
        page.drawText(line, {
          x,
          y: baseline,
          size,
          font: opts.font,
          color: rgb(0, 0, 0),
        });
      }
      baseline -= size * opts.lineHeight;
    }
    return;
  }

  const trimmed = opts.text.trim();
  if (!trimmed) return;

  const fontSize = opts.fontSizeLocked
    ? Math.min(opts.fontSize, h - 2)
    : Math.min(
        fitFontSizeInBox(trimmed, w, h, opts.fontFamily),
        h - 2
      );

  if (fontSize <= 0) return;

  page.drawText(trimmed, {
    x: x + 2,
    y: y + Math.max(2, (h - fontSize) / 2),
    size: fontSize,
    font: opts.font,
    color: rgb(0, 0, 0),
    maxWidth: w - 4,
    lineHeight: fontSize * 1.2,
  });
}

/** Text edits that change the file (new words, deleted words or a moved box). */
function editsToDraw(textEdits: TextEdit[]): TextEdit[] {
  return textEdits.filter((edit) =>
    edit.originalText ? isTextModified(edit) : edit.text.trim().length > 0
  );
}

export async function buildAnnotatedPdf(
  file: File,
  fields: FormField[],
  textEdits: TextEdit[] = []
): Promise<Uint8Array> {
  const changed = editsToDraw(textEdits);
  // The old words are deleted from the file, not just covered: under each
  // edited box, and where a moved box used to be.
  const bytes =
    changed.length > 0
      ? await removeOriginalText(
          file,
          changed.flatMap((e) => {
            const box = { page: e.page, x: e.x, y: e.y, width: e.width, height: e.height };
            return e.origin ? [box, { page: e.page, ...e.origin }] : [box];
          })
        )
      : await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();
  const fontCache = new Map<TextFontFamily, Awaited<ReturnType<typeof embedFamilyFont>>>();

  const getFont = async (family: TextFontFamily) => {
    let font = fontCache.get(family);
    if (!font) {
      font = await embedFamilyFont(pdfDoc, family);
      fontCache.set(family, font);
    }
    return font;
  };

  for (const edit of changed) {
    const page = pages[edit.page - 1];
    if (!page) continue;

    if (edit.origin) {
      // A moved box: keep the original text hidden where it used to be.
      const { width: pw, height: ph } = page.getSize();
      page.drawRectangle({
        x: edit.origin.x * pw,
        y: ph - (edit.origin.y + edit.origin.height) * ph,
        width: edit.origin.width * pw,
        height: edit.origin.height * ph,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }

    const font = await getFont(edit.fontFamily ?? "Helvetica");
    drawLockedTextInBox(page, {
      xNorm: edit.x,
      yNorm: edit.y,
      widthNorm: edit.width,
      heightNorm: edit.height,
      text: edit.text,
      fontSize: edit.fontSize,
      fontFamily: edit.fontFamily ?? "Helvetica",
      fontSizeLocked: edit.fontSizeLocked ?? false,
      coverUnderlying: true,
      font,
      lineHeight: edit.lineHeight ?? 1.15,
    });
  }

  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue;

    if (field.imageDataUrl) {
      const pngBytes = dataUrlToBytes(field.imageDataUrl);
      const pngImage = await pdfDoc.embedPng(pngBytes);
      const { width: pw, height: ph } = page.getSize();
      const x = field.x * pw;
      const y = ph - (field.y + field.height) * ph;
      const w = field.width * pw;
      const h = field.height * ph;
      page.drawImage(pngImage, { x, y, width: w, height: h });
      continue;
    }

    const hasText = field.text.trim().length > 0;
    const covers = field.coverUnderlying ?? false;
    if (!hasText && !covers) continue;

    const font = await getFont(field.fontFamily ?? "Helvetica");
    drawLockedTextInBox(page, {
      xNorm: field.x,
      yNorm: field.y,
      widthNorm: field.width,
      heightNorm: field.height,
      text: field.text,
      fontSize: field.fontSize,
      fontFamily: field.fontFamily ?? "Helvetica",
      fontSizeLocked: field.fontSizeLocked ?? false,
      coverUnderlying: covers,
      font,
    });
  }

  return pdfDoc.save();
}

/**
 * Show what Save would produce in the built-in viewer (viewer.html), without
 * saving anything. The viewer reads the file from a blob URL in its hash.
 */
let previewUrl: string | null = null;

export async function previewAnnotatedPdf(
  win: Window,
  file: File,
  fields: FormField[],
  textEdits: TextEdit[] = []
): Promise<void> {
  const pdfBytes = await buildAnnotatedPdf(file, fields, textEdits);
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  const name = `${file.name.replace(/\.pdf$/i, "")}-edited.pdf`;
  const params = new URLSearchParams({ src: previewUrl, name });
  // Same page, new hash: an already-loaded viewer picks it up without reloading.
  win.location.href = new URL(`/viewer.html#${params}`, window.location.origin).href;
}

export async function downloadAnnotatedPdf(
  file: File,
  fields: FormField[],
  textEdits: TextEdit[] = []
): Promise<string> {
  const pdfBytes = await buildAnnotatedPdf(file, fields, textEdits);
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
  const baseName = file.name.replace(/\.pdf$/i, "");
  const hasChanges = hasUnsavedChanges(fields, textEdits);
  const filename = hasChanges ? `${baseName}-edited.pdf` : `${baseName}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  return filename;
}
