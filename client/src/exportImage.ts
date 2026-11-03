import { drawPageAnnotationsOnCanvas } from "./copyRegion";
import type { PdfDocument } from "./pdf";
import { renderPageToCanvas } from "./pdf";
import type { FormField, TextEdit } from "./types";

export type RasterImageFormat = "png" | "jpeg";

/** The current page with its edits as a PNG/JPEG. Not saved yet. */
export async function buildAnnotatedPageImage(
  doc: PdfDocument,
  pageNum: number,
  scale: number,
  fields: FormField[],
  textEdits: TextEdit[],
  format: RasterImageFormat,
  sourceFileName: string
): Promise<{ blob: Blob; filename: string }> {
  const canvas = document.createElement("canvas");
  const info = await renderPageToCanvas(doc, pageNum, canvas, scale);
  if (!info) {
    throw new Error("Could not render the page for export.");
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not prepare image export.");
  }

  const pageHeightPt = info.height / scale;
  const viewport = { width: info.width, height: info.height };
  await drawPageAnnotationsOnCanvas(
    ctx,
    pageNum,
    fields,
    textEdits,
    viewport,
    pageHeightPt
  );

  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const ext = format === "jpeg" ? "jpg" : "png";
  const base =
    sourceFileName.replace(/\.(pdf|png|jpe?g)$/i, "") || "page";
  const filename = `${base}-page-${pageNum}.${ext}`;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Could not encode image.")),
      mime,
      format === "jpeg" ? 0.92 : undefined
    );
  });

  return { blob, filename };
}
