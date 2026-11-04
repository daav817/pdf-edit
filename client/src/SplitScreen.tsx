import { useEffect, useMemo, useState } from "react";
import type { PdfDocument } from "./pdf";
import { PageThumb } from "./PageThumb";
import { describePages, safeStem, splitPdf, type SplitOutput } from "./pages";
import { pickSaveTarget, saveToComputer, saveToTarget, type SaveTarget } from "./saveLocal";
import { uploadToDrive, type DriveFolderRef } from "./drive";
import { DrivePicker } from "./DrivePicker";
import { NameFilesDialog, type NamedFile } from "./NameFilesDialog";
import { useBuiltDoc } from "./useBuiltDoc";
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
  /** The Name window: the file it opens on, or null when closed. */
  const [naming, setNaming] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<PdfDocument>(doc);
  const builtDoc = useBuiltDoc(buildBytes);

  const stem = fileName.replace(/\.pdf$/i, "");
  const zipDefault = `${stem}_split`;
  const [zipName, setZipName] = useState(zipDefault);
  const [separate, setSeparate] = useState(false);

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

  const standardName = (index: number) =>
    groups.length > 1 ? `${stem}_part${index + 1}` : `${stem}_pages`;
  const nameFor = (g: Group, index: number) => names[g.start] ?? standardName(index);

  /** The standard name isn't stored, so it keeps up when splits change the numbering. */
  const setName = (key: number, name: string) => {
    const index = groups.findIndex((g) => g.start === key);
    setNames((n) => {
      const { [key]: _old, ...rest } = n;
      return name === standardName(index) ? rest : { ...n, [key]: name };
    });
  };

  const outputs: SplitOutput[] = groups
    .map((g, i) => ({ name: safeStem(nameFor(g, i), standardName(i)), pages: g.included }))
    .filter((o) => o.pages.length > 0);

  const namedFiles: NamedFile[] = groups.flatMap((g, i) =>
    g.included.length === 0
      ? []
      : [
          {
            key: g.start,
            title: `File ${i + 1} · page${g.included.length !== 1 ? "s" : ""} ${describePages(g.included)}`,
            name: nameFor(g, i),
            defaultName: standardName(i),
            pages: g.included.map((page) => ({ doc: previewDoc, page })),
          },
        ]
  );

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

  /** Open the Name window; with edits, it shows the file as it will be saved. */
  const openNaming = async (key: number) => {
    setError(null);
    if (!hasEdits) {
      setNaming(key);
      return;
    }
    setBusy(true);
    setStatus("Preparing the preview…");
    try {
      setPreviewDoc(await builtDoc());
      setStatus(null);
      setNaming(key);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Could not prepare the preview.");
    } finally {
      setBusy(false);
    }
  };

  /** One PDF, or a ZIP of all of them, saved where the user picks. */
  const saveToThisComputer = () => {
    setNaming(null);
    return run(async () => {
      const built = await splitPdf(await buildBytes(), fileName, outputs);
      const blob = built.blob;
      const name =
        outputs.length > 1 ? `${safeStem(zipName, zipDefault, ".zip")}.zip` : built.name;
      setStatus("Choose where to save…");
      const saved = await saveToComputer(blob, name);
      if (!saved) return "Not saved.";
      return `Saved ${saved}${outputs.length > 1 ? ` (${outputs.length} PDFs inside)` : ""}. The open file is unchanged.`;
    });
  };

  /** Each output becomes its own PDF in a chosen folder, or in Downloads. */
  const saveSeparately = async () => {
    setNaming(null);
    let target: SaveTarget | null;
    try {
      target = await pickSaveTarget();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that folder.");
      return;
    }
    if (!target) {
      setError(null);
      setStatus("Not saved.");
      return;
    }
    const chosen = target;
    await run(async () => {
      const bytes = await buildBytes();
      let renamed = 0;
      for (const [i, o] of outputs.entries()) {
        setStatus(`Saving ${i + 1} of ${outputs.length}…`);
        const { blob } = await splitPdf(bytes, fileName, [o]);
        const wanted = `${o.name}.pdf`;
        if ((await saveToTarget(chosen, blob, wanted)) !== wanted) renamed++;
      }
      if (chosen === "downloads") {
        return `Sent ${outputs.length} PDFs to your downloads. If the browser asks, allow this site to download several files, then save again if any are missing. The open file is unchanged.`;
      }
      return `Saved ${outputs.length} PDFs in ${chosen.name}.${
        renamed ? ` ${renamed} got a number added because that name was already in the folder.` : ""
      } The open file is unchanged.`;
    });
  };

  /** Each output becomes its own PDF in the chosen Drive folder. */
  const saveToDrive = (folder: DriveFolderRef) => {
    setDriveOpen(false);
    setNaming(null);
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
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy || namedFiles.length === 0}
          title="See each file, name it, and choose where to save"
          onClick={() => void openNaming(namedFiles[0].key)}
        >
          {busy ? "Working…" : outputs.length > 1 ? `Save ${outputs.length} files…` : "Save PDF…"}
        </button>
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
                    onChange={(e) => setName(g.start, e.target.value)}
                    aria-label={`Name of file ${gi + 1}`}
                    spellCheck={false}
                  />
                  <span className="split-part-ext">.pdf</span>
                  <span className="split-part-pages">
                    {g.included.length === 0
                      ? "All pages skipped. This file will not be saved."
                      : `${g.included.length} page${g.included.length !== 1 ? "s" : ""}: ${describePages(g.included)}`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy || g.included.length === 0}
                    title="Read this file's pages and name it"
                    onClick={() => void openNaming(g.start)}
                  >
                    View &amp; name
                  </button>
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
      {naming !== null && !driveOpen && namedFiles.length > 0 && (
        <NameFilesDialog
          files={namedFiles}
          startKey={naming}
          onName={setName}
          zip={
            namedFiles.length > 1
              ? {
                  name: zipName,
                  defaultName: zipDefault,
                  onName: setZipName,
                  separate,
                  onSeparate: setSeparate,
                }
              : undefined
          }
          onClose={() => setNaming(null)}
          onComputer={() =>
            void (separate && outputs.length > 1 ? saveSeparately() : saveToThisComputer())
          }
          onDrive={() => setDriveOpen(true)}
        />
      )}
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
