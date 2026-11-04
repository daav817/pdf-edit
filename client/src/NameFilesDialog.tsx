import { useCallback, useEffect, useRef, useState } from "react";
import { addTextLayer, renderPageToCanvas, type PdfDocument, type RenderHandle } from "./pdf";
import { safeStem } from "./pages";

export type PreviewPage = {
  doc: PdfDocument;
  /** 1-based page in `doc`. */
  page: number;
};

export type NamedFile = {
  key: number;
  /** "File 2 · pages 3–5" */
  title: string;
  /** What is in the name box; empty means the standard name. */
  name: string;
  defaultName: string;
  pages: PreviewPage[];
};

type Props = {
  files: NamedFile[];
  /** The file shown first. */
  startKey: number;
  onName: (key: number, name: string) => void;
  /** Several files: one ZIP on this computer, or separate PDFs. */
  zip?: {
    name: string;
    defaultName: string;
    onName: (name: string) => void;
    separate: boolean;
    onSeparate: (separate: boolean) => void;
  };
  onClose: () => void;
  onComputer: () => void;
  onDrive: () => void;
};

const ZOOMS = [1, 1.5, 2, 3];

/** One page, big enough to read, with words that can be selected. */
function PagePreview({ doc, page, width }: PreviewPage & { width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || width <= 0) return;
    const handle: RenderHandle = { cancelled: false, task: null };
    setFailed(false);
    // Its own div each time: a page turn must not mix in words still arriving
    // for the last page.
    const text = document.createElement("div");
    text.className = "name-preview-text";
    wrap.appendChild(text);
    void (async () => {
      const p = await doc.getPage(page);
      if (handle.cancelled) return;
      const scale = width / p.getViewport({ scale: 1 }).width;
      const dpr = window.devicePixelRatio || 1;
      const res = await renderPageToCanvas(doc, page, canvas, scale * dpr, handle);
      if (!res || handle.cancelled) return;
      canvas.style.width = `${res.width / dpr}px`;
      canvas.style.height = `${res.height / dpr}px`;
      await addTextLayer(p, text, scale);
    })().catch(() => {
      if (!handle.cancelled) setFailed(true);
    });
    return () => {
      handle.cancelled = true;
      handle.task?.cancel();
      text.remove();
    };
  }, [doc, page, width]);

  return (
    <div className="name-preview-page" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label={`Page ${page}`} />
      {failed && <p className="name-preview-failed">This page could not be shown.</p>}
    </div>
  );
}

/**
 * The last step before saving Split or Merge output: read each file's pages,
 * then keep the standard name or give the file its own.
 */
export function NameFilesDialog({ files, startKey, onName, zip, onClose, onComputer, onDrive }: Props) {
  const [key, setKey] = useState(startKey);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [paneWidth, setPaneWidth] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const current = files.find((f) => f.key === key) ?? files[0];
  const shownIndex = Math.min(pageIndex, current.pages.length - 1);
  const shown = current.pages[shownIndex];

  const finalName = (f: NamedFile) => safeStem(f.name, f.defaultName);
  const taken = new Map<string, number>();
  for (const f of files) {
    const k = finalName(f).toLowerCase();
    taken.set(k, (taken.get(k) ?? 0) + 1);
  }
  const isDuplicate = (f: NamedFile) => (taken.get(finalName(f).toLowerCase()) ?? 0) > 1;
  const hasDuplicates = files.some(isDuplicate);

  const select = (next: number) => {
    if (next === current.key) return;
    setKey(next);
    setPageIndex(0);
    paneRef.current?.scrollTo(0, 0);
  };

  const turnPage = (delta: number) => {
    setPageIndex(Math.max(0, Math.min(current.pages.length - 1, shownIndex + delta)));
    paneRef.current?.scrollTo(0, 0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Fit the page to the pane, whatever size the window is.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => {
      const style = getComputedStyle(pane);
      setPaneWidth(pane.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, []);

  const selectedWords = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !paneRef.current?.contains(sel.anchorNode)) return "";
    return sel.toString().replace(/\s+/g, " ").trim();
  }, []);

  useEffect(() => {
    const onChange = () => setHasSelection(selectedWords() !== "");
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [selectedWords]);

  /** The first pick replaces the standard name; later picks add to it. */
  const addSelection = () => {
    const words = selectedWords();
    if (!words) return;
    const typed = current.name.trim();
    const standard = typed === "" || typed === current.defaultName;
    onName(current.key, standard ? words : `${typed} ${words}`);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog name-dialog" role="dialog" aria-modal="true" aria-labelledby="name-files-title">
        <h2 id="name-files-title" className="dialog-title">
          Name {files.length > 1 ? `${files.length} files` : "the file"}
        </h2>

        <div className="name-dialog-main">
          <div className="name-list">
            {files.map((f) => {
              const final = finalName(f);
              const typed = f.name.trim().replace(/\.pdf$/i, "");
              return (
                <div
                  key={f.key}
                  className={`name-row${f.key === current.key ? " is-current" : ""}`}
                  onClick={() => select(f.key)}
                >
                  <div className="name-row-title">{f.title}</div>
                  <div className="name-row-input">
                    <input
                      className="split-part-name"
                      value={f.name}
                      placeholder={f.defaultName}
                      onChange={(e) => onName(f.key, e.target.value)}
                      onFocus={() => select(f.key)}
                      aria-label={`Name of ${f.title}`}
                      spellCheck={false}
                    />
                    <span className="split-part-ext">.pdf</span>
                  </div>
                  <div className="name-row-foot">
                    {isDuplicate(f) ? (
                      <span className="name-row-error" role="alert">
                        Another file has this name.
                      </span>
                    ) : typed !== "" && typed !== final ? (
                      <span className="name-row-note">Saves as {final}.pdf</span>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className="name-reset"
                      disabled={f.name === f.defaultName}
                      title={`Go back to ${f.defaultName}.pdf`}
                      onClick={() => onName(f.key, f.defaultName)}
                    >
                      Use standard name
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="name-preview">
            <div className="name-preview-bar">
              <button
                type="button"
                className="btn btn-sm"
                disabled={shownIndex === 0}
                onClick={() => turnPage(-1)}
                aria-label="Previous page"
                title="Previous page"
              >
                ‹
              </button>
              <span className="name-preview-count">
                Page {shownIndex + 1} of {current.pages.length}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={shownIndex >= current.pages.length - 1}
                onClick={() => turnPage(1)}
                aria-label="Next page"
                title="Next page"
              >
                ›
              </button>
              <span className="context-bar-divider" aria-hidden />
              <button
                type="button"
                className="btn btn-sm"
                disabled={zoom === ZOOMS[0]}
                onClick={() => setZoom(ZOOMS[ZOOMS.indexOf(zoom) - 1])}
                aria-label="Zoom out"
                title="Zoom out"
              >
                −
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                onClick={() => setZoom(ZOOMS[ZOOMS.indexOf(zoom) + 1])}
                aria-label="Zoom in"
                title="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary name-add"
                disabled={!hasSelection}
                // Keeps the words selected when the button is pressed.
                onMouseDown={(e) => e.preventDefault()}
                onClick={addSelection}
                title="Drag across words on the page, then click here to put them in the name"
              >
                Add selected words to name
              </button>
            </div>
            <div className="name-preview-pane" ref={paneRef}>
              <PagePreview doc={shown.doc} page={shown.page} width={paneWidth * zoom} />
            </div>
          </div>
        </div>

        <div className="name-dialog-foot">
          {zip && (
            <div
              className="name-zip"
              role="group"
              aria-label="How to save on this computer"
              title="This choice is for saving to this computer. Google Drive always gets separate PDFs."
            >
              <span>On this computer:</span>
              <label>
                <input
                  type="radio"
                  name="name-save-as"
                  checked={!zip.separate}
                  onChange={() => zip.onSeparate(false)}
                />
                One ZIP
              </label>
              <label>
                <input
                  type="radio"
                  name="name-save-as"
                  checked={zip.separate}
                  onChange={() => zip.onSeparate(true)}
                />
                Separate PDFs
              </label>
              {!zip.separate && (
                <>
                  <input
                    className="split-part-name"
                    value={zip.name}
                    placeholder={zip.defaultName}
                    onChange={(e) => zip.onName(e.target.value)}
                    aria-label="Name of the ZIP file"
                    spellCheck={false}
                  />
                  <span className="split-part-ext">.zip</span>
                </>
              )}
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={hasDuplicates} onClick={onComputer}>
              Save to this computer…
            </button>
            <button type="button" className="btn btn-primary" disabled={hasDuplicates} onClick={onDrive}>
              Save to Google Drive…
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
