import { useEffect, useRef, useState } from "react";
import { renderPageToCanvas, type PdfDocument, type RenderHandle } from "./pdf";

/** Thumbnails render one at a time so a long PDF doesn't eat memory. */
let queue: Promise<void> = Promise.resolve();
function enqueue(job: () => Promise<void>) {
  queue = queue.then(job).catch(() => {});
}

/** Drawn thumbnails, so splitting or joining doesn't redraw pages. */
const cache = new WeakMap<PdfDocument, Map<string, HTMLCanvasElement>>();

function cached(doc: PdfDocument, key: string) {
  return cache.get(doc)?.get(key);
}

function remember(doc: PdfDocument, key: string, from: HTMLCanvasElement) {
  const copy = document.createElement("canvas");
  copy.width = from.width;
  copy.height = from.height;
  copy.getContext("2d")?.drawImage(from, 0, 0);
  let m = cache.get(doc);
  if (!m) cache.set(doc, (m = new Map()));
  m.set(key, copy);
}

type Props = {
  doc: PdfDocument;
  page: number;
  /** CSS width in px. */
  width: number;
};

/** A small picture of one page, drawn when it scrolls into view. */
export function PageThumb({ doc, page, width }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(11 / 8.5);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const dpr = window.devicePixelRatio || 1;
    const key = `${page}:${width}:${dpr}`;
    const hit = cached(doc, key);
    const canvas = canvasRef.current;
    if (hit && canvas) {
      canvas.width = hit.width;
      canvas.height = hit.height;
      canvas.getContext("2d")?.drawImage(hit, 0, 0);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${hit.height / dpr}px`;
      setDrawn(true);
      return;
    }
    const handle: RenderHandle = { cancelled: false, task: null };
    enqueue(async () => {
      if (handle.cancelled || !canvasRef.current) return;
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      if (handle.cancelled || !canvasRef.current) return;
      setAspect(base.height / base.width);
      const res = await renderPageToCanvas(
        doc,
        page,
        canvasRef.current,
        (width / base.width) * dpr,
        handle
      );
      if (res && canvasRef.current && !handle.cancelled) {
        canvasRef.current.style.width = `${width}px`;
        canvasRef.current.style.height = `${res.height / dpr}px`;
        remember(doc, key, canvasRef.current);
        setDrawn(true);
      }
    });
    return () => {
      handle.cancelled = true;
      handle.task?.cancel();
    };
  }, [visible, doc, page, width]);

  return (
    <div
      ref={wrapRef}
      className={`page-thumb${drawn ? " page-thumb-drawn" : ""}`}
      style={{ width, height: drawn ? undefined : Math.round(width * aspect) }}
    >
      <canvas ref={canvasRef} aria-hidden />
    </div>
  );
}
