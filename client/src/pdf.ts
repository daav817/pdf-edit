import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PdfDocument = pdfjs.PDFDocumentProxy;
export type PageViewport = pdfjs.PageViewport;

export async function loadPdfFromFile(file: File): Promise<PdfDocument> {
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

export type PageRenderResult = {
  width: number;
  height: number;
  viewport: PageViewport;
};

/** Lets the caller cancel an in-flight render so the canvas is freed for the next one. */
export type RenderHandle = {
  cancelled: boolean;
  task: pdfjs.RenderTask | null;
};

export async function renderPageToCanvas(
  doc: PdfDocument,
  pageNum: number,
  canvas: HTMLCanvasElement,
  scale: number,
  handle?: RenderHandle
): Promise<PageRenderResult | undefined> {
  const page = await doc.getPage(pageNum);
  if (handle?.cancelled) return;
  let useScale = scale;
  let viewport = page.getViewport({ scale: useScale });

  const maxDim = 8192;
  const largest = Math.max(viewport.width, viewport.height);
  if (largest > maxDim) {
    useScale = scale * (maxDim / largest);
    viewport = page.getViewport({ scale: useScale });
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const task = page.render({ canvasContext: ctx, viewport });
  if (handle) handle.task = task;
  await task.promise;
  if (handle?.cancelled) return;
  return { width: viewport.width, height: viewport.height, viewport };
}

/** Invisible, selectable words over a page drawn at this CSS scale. */
export async function addTextLayer(
  page: pdfjs.PDFPageProxy,
  container: HTMLElement,
  scale: number
): Promise<void> {
  container.style.setProperty("--scale-factor", String(scale));
  await new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport: page.getViewport({ scale }),
  }).render();
}

export function syncOverlayCanvas(
  overlay: HTMLCanvasElement,
  viewport: PageRenderResult
) {
  overlay.width = Math.floor(viewport.width);
  overlay.height = Math.floor(viewport.height);
  overlay.style.width = `${viewport.width}px`;
  overlay.style.height = `${viewport.height}px`;
}
