import { useEffect, useMemo, useState } from "react";
import type { PdfDocument } from "./pdf";
import { PageThumb } from "./PageThumb";
import { describePages, splitPdf, type SplitOutput } from "./pages";
import { saveToComputer } from "./saveLocal";
import { uploadToDrive, type DriveFolderRef } from "./drive";
import { DrivePicker } from "./DrivePicker";
import { SaveChoice } from "./SaveChoice";
import { ScissorsIcon } from "./ToolButton";

type Props = {
  doc: PdfDocument;
  pageCount: number;
  fileName: string;
  /** The bytes Save would write (edits included). */
  buildBytes: () => Promise<Uint8Array>;
  hasEdits: boolean;
  pendingRedactions: number;
  onBack: () => void;
  /** A file dropped on the screen opens in the editor instead. */
  onDropFile: (file: File) => void;
};

const THUMB_WIDTH = 140;

type Group = { start: number; pages: number[]; included: number[] };

/**
 * Split the open file into new PDFs. Pages sit in cards, one card per output
 * file; clicking the space between two pages splits there, clicking a page
 * leaves it out of its file.
 */
export function SplitScreen({
  doc,
  pageCount,
  fileName,
  buildBytes,
  hasEdits,
  pendingRedactions,
  onBack,
  onDropFile,
}: Props) {
  const [cuts, setCuts] = useState<Set<number>>(() => new Set());
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [names, setNames] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driveOpen, setDriveOpen] = useState(false);

  const stem = fileName.replace(/\.pdf$/i, "");

  const groups = useMemo(() => {
    const out: Group[] = [];
    let cur: Group | null = null;
    for (let p = 1; p <= pageCount; p++) {
      if (!cur) {
        cur = { start: p, pages: [], included: [] };
        out.push(cur);
      }
      cur.pages.push(p);
      if (!skipped.has(p)) cur.included.push(p);
      if (cuts.has(p)) cur = null;
    }
    return out;
  }, [pageCount, cuts, skipped]);

  const nameFor = (g: Group, index: number) =>
    names[g.start] ??
    (groups.length > 1 ? `${stem}_part${index + 1}` : `${stem}_pages`);

  const outputs: SplitOutput[] = groups
    .map((g, i) => ({ name: nameFor(g, i), pages: g.included }))
    .filter((o) => o.pages.length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (driveOpen) return;
      if (e.key === "Escape" && (e.target as HTMLElement).tagName !== "INPUT") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, driveOpen]);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const everyPage = () => {
    const all = new Set<number>();
    for (let p = 1; p < pageCount; p++) all.add(p);
    setCuts(all);
  };

  const allSkipped = new Set(Array.from({ length: pageCount }, (_, i) => i + 1));

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setStatus("Building files…");
    try {
      const done = await work();
      setStatus(done);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Split failed.");
    } finally {
      setBusy(false);
    }
  };

  /** One PDF, or a ZIP of all of them, saved where the user picks. */
  const saveToThisComputer = () =>
    run(async () => {
      const { blob, name } = await splitPdf(await buildBytes(), fileName, outputs);
      setStatus("Choose where to save…");
      const saved = await saveToComputer(blob, name);
      if (!saved) return "Not saved.";
      return `Saved ${saved}${outputs.length > 1 ? ` (${outputs.length} PDFs inside)` : ""}. The open file is unchanged.`;
    });

  /** Each output becomes its own PDF in the chosen Drive folder. */
  const saveToDrive = (folder: DriveFolderRef) => {
    setDriveOpen(false);
    return run(async () => {
      const bytes = await buildBytes();
      const saved: string[] = [];
      for (const [i, o] of outputs.entries()) {
        setStatus(`Saving ${i + 1} of ${outputs.length} to Google Drive…`);
        const { blob } = await splitPdf(bytes, fileName, [o]);
        const res = await uploadToDrive(blob, `${o.name}.pdf`, folder.id);
        saved.push(res.name);
      }
      return `Saved ${saved.length === 1 ? saved[0] : `${saved.length} PDFs`} to Google Drive › ${folder.name}. The open file is unchanged.`;
    });
  };

  const summary =
    outputs.length === 0
      ? "No pages chosen. Click pages to include them."
      : `${outputs.length} file${outputs.length !== 1 ? "s" : ""}: ` +
        outputs.map((o) => describePages(o.pages)).join("  ·  ");

  return (
    <>
      <div className="context-bar" role="toolbar" aria-label="Split options">
        <button type="button" className="btn btn-sm" onClick={onBack} title="Back to the editor (Esc)">
          ‹ Back
        </button>
        <span className="context-bar-divider" aria-hidden />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setSkipped(new Set())}
          disabled={skipped.size === 0}
          title="Put every page back in"
        >
          Include all
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setSkipped(allSkipped)}
          disabled={skipped.size === pageCount}
          title="Leave every page out, then click the pages you want"
        >
          Skip all
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={everyPage}
          disabled={pageCount < 2 || cuts.size === pageCount - 1}
          title="One file per page"
        >
          Split every page
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setCuts(new Set())}
          disabled={cuts.size === 0}
          title="Remove all split lines"
        >
          Remove splits
        </button>
        <span className="context-bar-divider" aria-hidden />
        <span className="split-summary" title={summary}>
          {summary}
        </span>
        <SaveChoice
          label={busy ? "Working…" : outputs.length > 1 ? `Save ${outputs.length} files` : "Save PDF"}
          disabled={busy || outputs.length === 0}
          onComputer={() => void saveToThisComputer()}
          onDrive={() => setDriveOpen(true)}
        />
      </div>

      <main
        className="workspace"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) onDropFile(f);
        }}
      >
        {(error || status) && (
          <div className="banner-stack">
            <div
              className={`banner ${error ? "banner-error" : "banner-info"}`}
              role={error ? "alert" : "status"}
            >
              {error ?? status}
              <button
                type="button"
                className="banner-close"
                aria-label="Dismiss"
                onClick={() => {
                  setError(null);
                  setStatus(null);
                }}
              >
                ×
              </button>
            </div>
          </div>
        )}
        <div className="split-scroll">
          <p className="split-help">
            Click a page to leave it out. Click the gap between two pages to split there.
            {hasEdits && " Your text edits and fields are included."}
            {pendingRedactions > 0 &&
              ` ${pendingRedactions} redaction mark${pendingRedactions !== 1 ? "s are" : " is"} not applied yet and will not be in these files.`}
          </p>

          {groups.map((g, gi) => (
            <div key={g.start} className="split-group">
              {gi > 0 && (
                <div className="split-seam">
                  <span className="split-seam-line" aria-hidden />
                  <span className="split-seam-label">
                    <ScissorsIcon /> Split after page {g.start - 1}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setCuts((c) => toggle(c, g.start - 1))}
                    title="Join this file with the one above"
                  >
                    Remove split
                  </button>
                  <span className="split-seam-line" aria-hidden />
                </div>
              )}
              <section
                className={`split-part${g.included.length === 0 ? " split-part-empty" : ""}`}
                aria-label={`File ${gi + 1}`}
              >
                <header className="split-part-header">
                  <span className="split-part-title">File {gi + 1}</span>
                  <input
                    className="split-part-name"
                    value={nameFor(g, gi)}
                    onChange={(e) => setNames((n) => ({ ...n, [g.start]: e.target.value }))}
                    aria-label={`Name of file ${gi + 1}`}
                    spellCheck={false}
                  />
                  <span className="split-part-ext">.pdf</span>
                  <span className="split-part-pages">
                    {g.included.length === 0
                      ? "All pages skipped. This file will not be saved."
                      : `${g.included.length} page${g.included.length !== 1 ? "s" : ""}: ${describePages(g.included)}`}
                  </span>
                </header>
                <div className="split-pages">
                  {g.pages.map((p, pi) => {
                    const isSkipped = skipped.has(p);
                    return (
                      <div key={p} className="split-cell">
                        <button
                          type="button"
                          className={`split-page${isSkipped ? " is-skipped" : ""}`}
                          aria-pressed={!isSkipped}
                          title={isSkipped ? `Include page ${p}` : `Leave page ${p} out`}
                          onClick={() => setSkipped((s) => toggle(s, p))}
                        >
                          <PageThumb doc={doc} page={p} width={THUMB_WIDTH} />
                          {isSkipped && <span className="split-page-badge">Skipped</span>}
                          <span className="split-page-num">Page {p}</span>
                        </button>
                        {pi < g.pages.length - 1 && (
                          <button
                            type="button"
                            className="split-gutter"
                            title={`Split after page ${p}`}
                            aria-label={`Split after page ${p}`}
                            onClick={() => setCuts((c) => toggle(c, p))}
                          >
                            <span className="split-gutter-line" aria-hidden />
                            <span className="split-gutter-icon" aria-hidden>
                              <ScissorsIcon />
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          ))}
        </div>
      </main>
      {driveOpen && (
        <DrivePicker
          mode="folder"
          saveNote={
            outputs.length === 1
              ? `${outputs[0].name}.pdf`
              : `${outputs.length} PDFs: ${outputs.map((o) => `${o.name}.pdf`).join(", ")}`
          }
          onPickFolder={(f) => void saveToDrive(f)}
          onClose={() => setDriveOpen(false)}
        />
      )}
    </>
  );
}
