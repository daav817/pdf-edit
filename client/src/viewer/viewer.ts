/**
 * Stand-alone preview page for "View edited file". The editor opens this page
 * in a new tab, then puts the built PDF's blob URL in the address hash:
 *   /viewer.html#src=<blob url>&name=<file name>
 * so previews open here instead of whatever app handles .pdf files.
 */
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const PAGE_GAP_PX = 16;

const host = document.getElementById("pv-pages-host") as HTMLElement;
const statusEl = document.getElementById("pv-status") as HTMLElement;
const nameEl = document.getElementById("pv-name") as HTMLElement;
const pagesEl = document.getElementById("pv-pages") as HTMLElement;
const zoomEl = document.getElementById("pv-zoom") as HTMLElement;
const download = document.getElementById("pv-download") as HTMLAnchorElement;

let doc: pdfjs.PDFDocumentProxy | null = null;
let zoom = 1;
let fitWidth = true;
let renderToken = 0;
let loadedSrc = "";

function showStatus(text: string) {
  host.replaceChildren(statusEl);
  statusEl.textContent = text;
}

function readHash(): { src: string; name: string } {
  const params = new URLSearchParams(location.hash.slice(1));
  return { src: params.get("src") ?? "", name: params.get("name") ?? "" };
}

/** Width-fitting zoom for the widest page, leaving a margin on each side. */
async function fitZoom(): Promise<number> {
  if (!doc) return 1;
  const first = await doc.getPage(1);
  const width = first.getViewport({ scale: 1 }).width;
  const available = Math.max(200, host.clientWidth - 48);
  return Math.min(3, Math.max(0.25, available / width));
}

async function renderAll() {
  if (!doc) return;
  const token = ++renderToken;
  if (fitWidth) zoom = await fitZoom();
  zoomEl.textContent = `${Math.round(zoom * 100)}%`;

  const ratio = window.devicePixelRatio || 1;
  const frag = document.createDocumentFragment();
  const jobs: { page: pdfjs.PDFPageProxy; canvas: HTMLCanvasElement; vp: pdfjs.PageViewport }[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    if (token !== renderToken) return;
    const vp = page.getViewport({ scale: zoom });
    const canvas = document.createElement("canvas");
    canvas.className = "pv-page";
    canvas.width = Math.floor(vp.width * ratio);
    canvas.height = Math.floor(vp.height * ratio);
    canvas.style.width = `${Math.floor(vp.width)}px`;
    canvas.style.height = `${Math.floor(vp.height)}px`;
    canvas.style.marginBottom = `${PAGE_GAP_PX}px`;
    canvas.setAttribute("aria-label", `Page ${n}`);
    frag.appendChild(canvas);
    jobs.push({ page, canvas, vp: page.getViewport({ scale: zoom * ratio }) });
  }
  host.replaceChildren(frag);

  for (const { page, canvas, vp } of jobs) {
    if (token !== renderToken) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  }
}

function updatePageIndicator() {
  if (!doc) return;
  const canvases = host.querySelectorAll<HTMLCanvasElement>("canvas.pv-page");
  const mid = window.innerHeight / 2;
  let current = 1;
  canvases.forEach((c, i) => {
    if (c.getBoundingClientRect().top < mid) current = i + 1;
  });
  pagesEl.textContent = `Page ${current} of ${doc.numPages}`;
}

async function load() {
  const { src, name } = readHash();
  if (!src || src === loadedSrc) return;
  loadedSrc = src;
  const label = name || "Edited file";
  nameEl.textContent = label;
  document.title = `${label} – Preview`;
  showStatus("Opening…");

  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    download.href = src;
    download.download = name || "edited.pdf";
    doc?.destroy();
    doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    await renderAll();
    updatePageIndicator();
  } catch {
    doc = null;
    showStatus(
      "This preview is no longer available. Go back to the editor and click View edited file again."
    );
  }
}

function setZoom(next: number) {
  fitWidth = false;
  zoom = next;
  void renderAll();
}

document.getElementById("pv-zoom-in")!.addEventListener("click", () => {
  setZoom(ZOOM_STEPS.find((z) => z > zoom + 0.001) ?? zoom);
});
document.getElementById("pv-zoom-out")!.addEventListener("click", () => {
  setZoom([...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001) ?? zoom);
});
document.getElementById("pv-fit")!.addEventListener("click", () => {
  fitWidth = true;
  void renderAll();
});
document.getElementById("pv-print")!.addEventListener("click", () => window.print());

let resizeTimer = 0;
window.addEventListener("resize", () => {
  if (!fitWidth) return;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => void renderAll(), 150);
});
window.addEventListener("scroll", updatePageIndicator, { passive: true });
window.addEventListener("hashchange", () => void load());

if (readHash().src) void load();
