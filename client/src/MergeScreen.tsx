import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { loadPdfFromFile, type PdfDocument } from "./pdf";
import { PageThumb } from "./PageThumb";
import { mergePdfs, safeStem } from "./pages";
import { saveToComputer } from "./saveLocal";
import { uploadToDrive, type DriveFolderRef } from "./drive";
import { NameFilesDialog, type PreviewPage } from "./NameFilesDialog";
import { useBuiltDoc } from "./useBuiltDoc";
import { isImageImportFile, isPdfImportFile, pdfFileFromImage } from "./imageToPdf";
import { StatusBanner } from "./StatusBanner";
import { DrivePicker } from "./DrivePicker";

type Props = {
  /** The file open in the editor, if any; it starts the list. */
  currentFile: File | null;
  currentDoc: PdfDocument | null;
  /** The bytes Save would write for the open file (edits included). */
  buildCurrentBytes: () => Promise<Uint8Array>;
  hasEdits: boolean;
  pendingRedactions: number;
  onBack: () => void;
  /** Open the merged file in the editor. */
  onOpenResult: (file: File) => void;
};

type Item = {
  id: string;
  name: string;
  /** null for the open file, whose bytes come from buildCurrentBytes. */
  file: File | null;
  doc: PdfDocument;
  pages: number;
  /** Loaded here, so this screen destroys it. */
  owned: boolean;
};

let nextId = 1;

const THUMB_WIDTH = 64;

/** Join several PDFs (and JPG/PNG images) into one, in an order you set. */
export function MergeScreen({
  currentFile,
  currentDoc,
  buildCurrentBytes,
  hasEdits,
  pendingRedactions,
  onBack,
  onOpenResult,
}: Props) {
  const [items, setItems] = useState<Item[]>(() =>
    currentFile && currentDoc
      ? [
          {
            id: `m${nextId++}`,
            name: currentFile.name,
            file: null,
            doc: currentDoc,
            pages: currentDoc.numPages,
            owned: false,
          },
        ]
      : []
  );
  const standardName = currentFile ? `${currentFile.name.replace(/\.pdf$/i, "")}-merged` : "merged";
  const [outName, setOutName] = useState(standardName);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [saveDriveOpen, setSaveDriveOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  /** The open file with its edits, for the Name window; null means `doc` as it is. */
  const [editedDoc, setEditedDoc] = useState<PdfDocument | null>(null);
  const builtDoc = useBuiltDoc(buildCurrentBytes);

  // Destroy the documents this screen opened when it closes.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(
    () => () => {
      for (const it of itemsRef.current) if (it.owned) void it.doc.destroy();
    },
    []
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (driveOpen || saveDriveOpen) return; // Esc closes the Drive window first
      if (e.key === "Escape" && (e.target as HTMLElement).tagName !== "INPUT") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, driveOpen, saveDriveOpen]);

  const addFiles = async (files: File[]) => {
    setError(null);
    setAdding(true);
    const failed: string[] = [];
    for (const f of files) {
      if (!isPdfImportFile(f) && !isImageImportFile(f)) {
        failed.push(f.name);
        continue;
      }
      try {
        const pdf = isImageImportFile(f) ? await pdfFileFromImage(f) : f;
        const doc = await loadPdfFromFile(pdf);
        setItems((prev) => [
          ...prev,
          { id: `m${nextId++}`, name: f.name, file: pdf, doc, pages: doc.numPages, owned: true },
        ]);
      } catch {
        failed.push(f.name);
      }
    }
    setAdding(false);
    if (failed.length) setError(`Could not open ${failed.join(", ")}. Only PDF, JPG and PNG files can be merged.`);
  };

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void addFiles(files);
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const it = prev.find((i) => i.id === id);
      if (it?.owned) void it.doc.destroy();
      return prev.filter((i) => i.id !== id);
    });
  };

  const move = (index: number, delta: number) => {
    setItems((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const dropOn = (targetId: string, after: boolean) => {
    if (!dragId || dragId === targetId) return;
    setItems((prev) => {
      const moving = prev.find((i) => i.id === dragId);
      if (!moving) return prev;
      const rest = prev.filter((i) => i.id !== dragId);
      const t = rest.findIndex((i) => i.id === targetId);
      rest.splice(after ? t + 1 : t, 0, moving);
      return rest;
    });
  };

  const totalPages = items.reduce((n, i) => n + i.pages, 0);
  const fileName = `${safeStem(outName, standardName)}.pdf`;
  const previewPages: PreviewPage[] = items.flatMap((it) =>
    Array.from({ length: it.pages }, (_, i) => ({
      doc: !it.file && editedDoc ? editedDoc : it.doc,
      page: i + 1,
    }))
  );

  const build = async () => {
    const inputs = await Promise.all(
      items.map(async (it) => ({
        name: it.name.replace(/\.(jpe?g|png)$/i, ".pdf"),
        bytes: it.file ? new Uint8Array(await it.file.arrayBuffer()) : await buildCurrentBytes(),
      }))
    );
    return mergePdfs(inputs);
  };

  const run = async (then: (blob: Blob) => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus("Merging…");
    try {
      await then(await build());
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Merge failed.");
    } finally {
      setBusy(false);
    }
  };

  const canMerge = items.length >= 2 && !busy && !adding;
  const hasCurrent = items.some((i) => !i.file);

  /** Open the Name window; with edits, it shows the open file as it will be saved. */
  const openNaming = async () => {
    setError(null);
    if (!hasCurrent || !hasEdits) {
      setNaming(true);
      return;
    }
    setBusy(true);
    setStatus("Preparing the preview…");
    try {
      setEditedDoc(await builtDoc());
      setStatus(null);
      setNaming(true);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Could not prepare the preview.");
    } finally {
      setBusy(false);
    }
  };

  const saveToThisComputer = () => {
    setNaming(false);
    void run(async (blob) => {
      setStatus("Choose where to save…");
      const saved = await saveToComputer(blob, fileName);
      setStatus(saved ? `Saved ${saved}.` : "Not saved.");
    });
  };

  return (
    <>
      <div className="context-bar" role="toolbar" aria-label="Merge options">
        <button type="button" className="btn btn-sm" onClick={onBack} title="Back (Esc)">
          ‹ Back
        </button>
        <span className="context-bar-divider" aria-hidden />
        <label className="btn btn-sm" title="Add PDF, JPG or PNG files to the list">
          {adding ? "Adding…" : "Add files…"}
          <input
            type="file"
            multiple
            accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
            hidden
            onChange={onInput}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setDriveOpen(true)}
          disabled={adding}
          title="Add files from your Google Drive"
        >
          From Google Drive…
        </button>
        <span className="context-bar-divider" aria-hidden />
        <span className="context-bar-note">New file</span>
        <input
          className="split-part-name"
          value={outName}
          onChange={(e) => setOutName(e.target.value)}
          aria-label="Name of the merged file"
          spellCheck={false}
        />
        <span className="split-part-ext">.pdf</span>
        <span className="split-summary">
          {items.length} file{items.length !== 1 ? "s" : ""} · {totalPages} page
          {totalPages !== 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canMerge}
          title="Open the merged file in the editor"
          onClick={() =>
            run((blob) => onOpenResult(new File([blob], fileName, { type: "application/pdf" })))
          }
        >
          Open in editor
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!canMerge}
          title="See the merged file, name it, and choose where to save"
          onClick={() => void openNaming()}
        >
          {busy ? "Working…" : "Save merged PDF…"}
        </button>
      </div>

      <main
        className={`workspace${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) void addFiles(files);
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
            Files are joined from top to bottom. Drag a file, or use the arrows, to change the order.
            Drop files here to add them.
            {hasCurrent && hasEdits && " The open file is included with your edits."}
            {hasCurrent &&
              pendingRedactions > 0 &&
              ` ${pendingRedactions} redaction mark${pendingRedactions !== 1 ? "s are" : " is"} not applied yet and will not be in the merged file.`}
          </p>

          {items.length === 0 ? (
            <div className="merge-empty">
              <p>Add the PDFs (or JPG/PNG images) you want to join.</p>
              <label className="btn btn-primary">
                Add files…
                <input
                  type="file"
                  multiple
                  accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
                  hidden
                  onChange={onInput}
                />
              </label>
              <button type="button" className="btn btn-primary" onClick={() => setDriveOpen(true)}>
                From Google Drive…
              </button>
            </div>
          ) : (
            <ol className="merge-list">
              {items.map((it, i) => (
                <li
                  key={it.id}
                  className={`merge-item${dragId === it.id ? " is-dragging" : ""}${
                    dropAt?.id === it.id ? (dropAt.after ? " drop-after" : " drop-before") : ""
                  }`}
                  draggable
                  onDragStart={(e) => {
                    setDragId(it.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", it.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropAt(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDropAt({ id: it.id, after: e.clientY > r.top + r.height / 2 });
                  }}
                  onDrop={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (dropAt) dropOn(dropAt.id, dropAt.after);
                    setDragId(null);
                    setDropAt(null);
                  }}
                >
                  <span className="merge-grip" aria-hidden title="Drag to reorder">
                    ⋮⋮
                  </span>
                  <span className="merge-index">{i + 1}</span>
                  <PageThumb doc={it.doc} page={1} width={THUMB_WIDTH} />
                  <span className="merge-info">
                    <span className="merge-name" title={it.name}>
                      {it.name}
                    </span>
                    <span className="merge-meta">
                      {it.pages} page{it.pages !== 1 ? "s" : ""}
                      {!it.file && " · open file"}
                    </span>
                  </span>
                  <span className="merge-actions">
                    <button
                      type="button"
                      className="btn btn-icon btn-sm"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${it.name} up`}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-sm"
                      onClick={() => move(i, 1)}
                      disabled={i === items.length - 1}
                      aria-label={`Move ${it.name} down`}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon btn-sm"
                      onClick={() => remove(it.id)}
                      aria-label={`Remove ${it.name}`}
                      title="Take out of the list (the file itself is not touched)"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>
      {naming && !saveDriveOpen && (
        <NameFilesDialog
          files={[
            {
              key: 0,
              title: `Merged file · ${items.length} files, ${totalPages} pages`,
              name: outName,
              defaultName: standardName,
              pages: previewPages,
            },
          ]}
          startKey={0}
          onName={(_, name) => setOutName(name)}
          onClose={() => setNaming(false)}
          onComputer={saveToThisComputer}
          onDrive={() => setSaveDriveOpen(true)}
        />
      )}
      {saveDriveOpen && (
        <DrivePicker
          mode="folder"
          saveNote={fileName}
          onClose={() => setSaveDriveOpen(false)}
          onPickFolder={(folder: DriveFolderRef) => {
            setSaveDriveOpen(false);
            setNaming(false);
            void run(async (blob) => {
              setStatus("Saving to Google Drive…");
              const res = await uploadToDrive(blob, fileName, folder.id);
              setStatus(`Saved ${res.name} to Google Drive › ${folder.name}.`);
            });
          }}
        />
      )}
      {driveOpen && (
        <DrivePicker
          multiple
          onClose={() => setDriveOpen(false)}
          onPick={(files) => {
            setDriveOpen(false);
            void addFiles(files);
          }}
        />
      )}
    </>
  );
}
