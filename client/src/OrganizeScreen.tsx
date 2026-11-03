import { useEffect, useMemo, useState } from "react";
import type { PdfDocument } from "./pdf";
import { PageThumb } from "./PageThumb";
import { organizePdf, type OrganizePage } from "./pages";
import { saveToComputer } from "./saveLocal";
import { uploadToDrive, type DriveFolderRef } from "./drive";
import { DrivePicker } from "./DrivePicker";
import { SaveChoice } from "./SaveChoice";
import { StatusBanner } from "./StatusBanner";

type Props = {
  doc: PdfDocument;
  pageCount: number;
  fileName: string;
  /** The bytes Save would write (edits included). */
  buildBytes: () => Promise<Uint8Array>;
  hasEdits: boolean;
  pendingRedactions: number;
  onBack: () => void;
  /** Replace the open file with the organized one (undoable in the editor). */
  onApply: (file: File) => void;
  onDropFile: (file: File) => void;
};

type Tile = { key: number; source: number; rotate: number; removed: boolean };

/** Thumbnails are this wide; the frame is square so a turned page still fits. */
const THUMB_WIDTH = 116;
const FRAME = 156;

const initialTiles = (n: number): Tile[] =>
  Array.from({ length: n }, (_, i) => ({ key: i + 1, source: i + 1, rotate: 0, removed: false }));

const turn = (deg: number, by: number) => (((deg + by) % 360) + 360) % 360;

/** Reorder, turn and remove pages of the open file. */
export function OrganizeScreen({
  doc,
  pageCount,
  fileName,
  buildBytes,
  hasEdits,
  pendingRedactions,
  onBack,
  onApply,
  onDropFile,
}: Props) {
  const [tiles, setTiles] = useState<Tile[]>(() => initialTiles(pageCount));
  const [dragKey, setDragKey] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ key: number; after: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveDriveOpen, setSaveDriveOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (saveDriveOpen) return; // Esc closes the Drive window first
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, saveDriveOpen]);

  const kept = tiles.filter((t) => !t.removed);
  const removedCount = tiles.length - kept.length;
  const rotatedCount = kept.filter((t) => t.rotate).length;
  const reordered = useMemo(() => {
    const order = kept.map((t) => t.source);
    return order.some((s, i) => i > 0 && s < order[i - 1]);
  }, [kept]);
  const changed = removedCount > 0 || rotatedCount > 0 || reordered;

  const update = (key: number, patch: (t: Tile) => Partial<Tile>) =>
    setTiles((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch(t) } : t)));

  const rotateAll = (by: number) =>
    setTiles((prev) => prev.map((t) => (t.removed ? t : { ...t, rotate: turn(t.rotate, by) })));

  const dropOn = (targetKey: number, after: boolean) => {
    if (dragKey === null || dragKey === targetKey) return;
    setTiles((prev) => {
      const moving = prev.find((t) => t.key === dragKey);
      if (!moving) return prev;
      const rest = prev.filter((t) => t.key !== dragKey);
      const i = rest.findIndex((t) => t.key === targetKey);
      rest.splice(after ? i + 1 : i, 0, moving);
      return rest;
    });
  };

  const moveBy = (index: number, delta: number) =>
    setTiles((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const stem = fileName.replace(/\.pdf$/i, "").replace(/-organized$/i, "");
  const outName = `${stem}-organized.pdf`;
  const spec: OrganizePage[] = kept.map((t) => ({ source: t.source, rotate: t.rotate }));

  const run = async (then: (blob: Blob) => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus("Building the file…");
    try {
      await then(await organizePdf(await buildBytes(), fileName, spec));
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Organize failed.");
    } finally {
      setBusy(false);
    }
  };

  const parts: string[] = [];
  if (reordered) parts.push("order changed");
  if (rotatedCount) parts.push(`${rotatedCount} turned`);
  if (removedCount) parts.push(`${removedCount} removed`);
  const summary =
    kept.length === 0
      ? "Every page is removed. Restore at least one."
      : `${kept.length} page${kept.length !== 1 ? "s" : ""}` +
        (parts.length ? ` · ${parts.join(" · ")}` : " · no changes yet");

  const applyBlocked = pendingRedactions > 0;

  return (
    <>
      <div className="context-bar" role="toolbar" aria-label="Organize options">
        <button type="button" className="btn btn-sm" onClick={onBack} title="Back without changing anything (Esc)">
          ‹ Back
        </button>
        <span className="context-bar-divider" aria-hidden />
        <button type="button" className="btn btn-sm" onClick={() => rotateAll(-90)} title="Turn every page left">
          ↺ Turn all
        </button>
        <button type="button" className="btn btn-sm" onClick={() => rotateAll(90)} title="Turn every page right">
          ↻ Turn all
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setTiles(initialTiles(pageCount))}
          disabled={!changed}
          title="Back to the original order, no turns, nothing removed"
        >
          Reset
        </button>
        <span className="context-bar-divider" aria-hidden />
        <span className="split-summary" title={summary}>
          {summary}
        </span>
        <SaveChoice
          label="Save as new PDF"
          primary={false}
          disabled={busy || kept.length === 0}
          title="Save the organized file as a new PDF; the open file stays as it is"
          onComputer={() =>
            void run(async (blob) => {
              setStatus("Choose where to save…");
              const saved = await saveToComputer(blob, outName);
              setStatus(saved ? `Saved ${saved}. The open file is unchanged.` : "Not saved.");
            })
          }
          onDrive={() => setSaveDriveOpen(true)}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy || kept.length === 0 || !changed || applyBlocked}
          title={
            applyBlocked
              ? "Apply or clear the redaction marks first"
              : "Use the new page order in the editor (Undo brings the old one back)"
          }
          onClick={() =>
            run((blob) => onApply(new File([blob], outName, { type: "application/pdf" })))
          }
        >
          {busy ? "Working…" : "Apply"}
        </button>
      </div>

      <main
        className="workspace"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragKey !== null) return;
          const f = e.dataTransfer.files?.[0];
          if (f) onDropFile(f);
        }}
      >
        <StatusBanner
          error={error}
          status={status}
          onDismiss={() => {
            setError(null);
            setStatus(null);
          }}
        />
        <div className="split-scroll">
          <p className="split-help">
            Drag pages to change the order. Use the buttons under a page to turn it or remove it.
            {hasEdits && " Your text edits and fields are kept in the pages."}
            {applyBlocked &&
              ` ${pendingRedactions} redaction mark${pendingRedactions !== 1 ? "s are" : " is"} not applied yet: apply or clear ${pendingRedactions !== 1 ? "them" : "it"} before using Apply.`}
          </p>
          <div className="organize-grid">
            {tiles.map((t, i) => (
              <div
                key={t.key}
                className={`organize-tile${t.removed ? " is-removed" : ""}${
                  dragKey === t.key ? " is-dragging" : ""
                }${dropAt?.key === t.key ? (dropAt.after ? " drop-after" : " drop-before") : ""}`}
                draggable
                onDragStart={(e) => {
                  setDragKey(t.key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(t.key));
                }}
                onDragEnd={() => {
                  setDragKey(null);
                  setDropAt(null);
                }}
                onDragOver={(e) => {
                  if (dragKey === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt({ key: t.key, after: e.clientX > r.left + r.width / 2 });
                }}
                onDrop={(e) => {
                  if (dragKey === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (dropAt) dropOn(dropAt.key, dropAt.after);
                  setDragKey(null);
                  setDropAt(null);
                }}
              >
                <div className="organize-frame" style={{ width: FRAME, height: FRAME }}>
                  <div className="organize-turn" style={{ transform: `rotate(${t.rotate}deg)` }}>
                    <PageThumb doc={doc} page={t.source} width={THUMB_WIDTH} />
                  </div>
                  {t.removed && <span className="split-page-badge">Removed</span>}
                </div>
                <span className="split-page-num">
                  Page {t.source}
                  {t.rotate ? ` · ${t.rotate}°` : ""}
                </span>
                <span className="organize-actions">
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    onClick={() => moveBy(i, -1)}
                    disabled={i === 0}
                    title="Move earlier"
                    aria-label={`Move page ${t.source} earlier`}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    onClick={() => update(t.key, (x) => ({ rotate: turn(x.rotate, -90) }))}
                    disabled={t.removed}
                    title="Turn left"
                    aria-label={`Turn page ${t.source} left`}
                  >
                    ↺
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    onClick={() => update(t.key, (x) => ({ rotate: turn(x.rotate, 90) }))}
                    disabled={t.removed}
                    title="Turn right"
                    aria-label={`Turn page ${t.source} right`}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    className={`btn btn-icon btn-sm${t.removed ? " btn-primary" : ""}`}
                    onClick={() => update(t.key, (x) => ({ removed: !x.removed }))}
                    title={t.removed ? "Put this page back" : "Remove this page"}
                    aria-label={t.removed ? `Restore page ${t.source}` : `Remove page ${t.source}`}
                  >
                    {t.removed ? "↩" : "✕"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    onClick={() => moveBy(i, 1)}
                    disabled={i === tiles.length - 1}
                    title="Move later"
                    aria-label={`Move page ${t.source} later`}
                  >
                    ›
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
      {saveDriveOpen && (
        <DrivePicker
          mode="folder"
          saveNote={outName}
          onClose={() => setSaveDriveOpen(false)}
          onPickFolder={(folder: DriveFolderRef) => {
            setSaveDriveOpen(false);
            void run(async (blob) => {
              setStatus("Saving to Google Drive…");
              const res = await uploadToDrive(blob, outName, folder.id);
              setStatus(`Saved ${res.name} to Google Drive › ${folder.name}. The open file is unchanged.`);
            });
          }}
        />
      )}
    </>
  );
}
