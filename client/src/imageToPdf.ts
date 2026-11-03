import { PDFDocument } from "pdf-lib";

const JPEG_TYPES = new Set(["image/jpeg", "image/jpg"]);
const PNG_TYPES = new Set(["image/png"]);

/** Keep PDF page size browser-friendly (canvas / PDF.js limits). */
const MAX_IMAGE_PX = 2400;

export function isImageImportFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (JPEG_TYPES.has(file.type) || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return true;
  }
  if (PNG_TYPES.has(file.type) || lower.endsWith(".png")) {
    return true;
  }
  return false;
}

export function isPdfImportFile(file: File): boolean {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

function isJpegFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return JPEG_TYPES.has(file.type) || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
}

async function rasterForPdf(
  file: File
): Promise<{ bytes: Uint8Array; isJpeg: boolean }> {
  const isJpeg = isJpegFile(file);
  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;

  if (width <= 0 || height <= 0) {
    bitmap.close();
    throw new Error("Invalid image dimensions.");
  }

  if (width > MAX_IMAGE_PX || height > MAX_IMAGE_PX) {
    const ratio = MAX_IMAGE_PX / Math.max(width, height);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not prepare image canvas.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mime = isJpeg ? "image/jpeg" : "image/png";
  const quality = isJpeg ? 0.92 : undefined;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image."))),
      mime,
      quality
    );
  });

  return { bytes: new Uint8Array(await blob.arrayBuffer()), isJpeg };
}

/** Wrap a JPEG or PNG in a single-page PDF for viewing and redaction. */
export async function pdfFileFromImage(file: File): Promise<File> {
  const lower = file.name.toLowerCase();
  const isPng = PNG_TYPES.has(file.type) || lower.endsWith(".png");
  const isJpeg = isJpegFile(file);

  if (!isJpeg && !isPng) {
    throw new Error("Only JPG and PNG images are supported.");
  }

  const { bytes, isJpeg: encodedJpeg } = await rasterForPdf(file);

  const pdfDoc = await PDFDocument.create();
  const image = encodedJpeg
    ? await pdfDoc.embedJpg(bytes)
    : await pdfDoc.embedPng(bytes);

  const width = image.width;
  const height = image.height;
  const page = pdfDoc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });

  const pdfBytes = await pdfDoc.save();
  const baseName = file.name.replace(/\.[^.]+$/i, "") || "image";
  return new File([new Uint8Array(pdfBytes)], `${baseName}.pdf`, {
    type: "application/pdf",
  });
}
