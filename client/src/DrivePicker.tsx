import { useCallback, useEffect, useState } from "react";
import {
  downloadDriveFile,
  listDrive,
  type DriveFolder,
  type DriveFolderRef,
  type DriveItem,
} from "./drive";

type Props = {
  /** "open" picks files; "folder" picks where to save. */
  mode?: "open" | "folder";
  /** Merge lets you pick several files; Import picks one. */
  multiple?: boolean;
  onPick?: (files: File[]) => void;
  /** Folder mode: the folder shown when "Save here" is clicked. */
  onPickFolder?: (folder: DriveFolderRef) => void;
  /** Folder mode: what will be saved, e.g. "2 PDFs: a.pdf, b.pdf". */
  saveNote?: string;
  onClose: () => void;
};

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function itemNote(item: DriveItem): string {
  const parts: string[] = [];
  if (item.kind === "google") parts.push("opens as PDF");
  if (item.modifiedTime) parts.push(dateFmt.format(new Date(item.modifiedTime)));
  if (item.owner) parts.push(item.owner);
  return parts.join(" · ");
}

const Icon = ({ item }: { item: DriveItem }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`drive-icon drive-icon-${item.isFolder ? "folder" : item.kind}`}>
    {item.isFolder ? (
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
    ) : item.kind === "image" ? (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m20.5 16-5-5-8.5 8.5" />
      </>
    ) : (
      <>
        <path d="M6 3h8l4 4v14H6Z" />
        <path d="M14 3v4h4" />
        {item.kind === "google" ? <path d="M9 12h6M9 15h6M9 18h4" /> : <path d="M9 14h6M9 17h4" />}
      </>
    )}
  </svg>
);

/** Browse the signed-in person's Google Drive and pick PDFs or images. */
export function DrivePicker({
  mode = "open",
  multiple = false,
  onPick,
  onPickFolder,
  saveNote,
  onClose,
}: Props) {
  const folderMode = mode === "folder";
  const [folder, setFolder] = useState<DriveFolder | null>(null);
  const [folderId, setFolderId] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DriveItem[]>([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listDrive(folderId, search)
      .then((f) => {
        if (!cancelled) setFolder(f);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open Google Drive.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !downloading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, downloading]);

  const openFolder = (id: string) => {
    setQuery("");
    setSearch("");
    setFolderId(id);
  };

  const pick = useCallback(
    async (items: DriveItem[]) => {
      if (items.length === 0) return;
      setDownloading(true);
      setError(null);
      try {
        const files: File[] = [];
        for (const it of items) files.push(await downloadDriveFile(it));
        onPick?.(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Download failed.");
        setDownloading(false);
      }
    },
    [onPick]
  );

  const isSelected = (it: DriveItem) => selected.some((s) => s.id === it.id);

  const onItemClick = (it: DriveItem) => {
    if (it.isFolder) {
      openFolder(it.id);
      return;
    }
    if (folderMode) return;
    if (multiple) {
      setSelected((prev) => (isSelected(it) ? prev.filter((s) => s.id !== it.id) : [...prev, it]));
    } else {
      setSelected([it]);
    }
  };

  const files = folder?.files ?? [];

  return (
    <div className="dialog-backdrop" role="presentation" onClick={() => !downloading && onClose()}>
      <div
        className="dialog drive-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drive-head">
          <h2 id="drive-title" className="dialog-title">
            {folderMode ? "Save to Google Drive" : multiple ? "Add from Google Drive" : "Open from Google Drive"}
          </h2>
          <form
            className="drive-search"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(query.trim());
            }}
          >
            <input
              type="search"
              placeholder="Search this folder"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value) setSearch("");
              }}
              aria-label="Search this folder"
            />
          </form>
        </div>

        <nav className="drive-crumbs" aria-label="Folder path">
          {(folder?.breadcrumbs ?? []).map((b, i, all) => (
            <span key={b.id ?? i}>
              {i > 0 && <span className="drive-crumb-sep">›</span>}
              {i < all.length - 1 ? (
                <button type="button" className="drive-crumb" onClick={() => openFolder(b.id)}>
                  {b.name}
                </button>
              ) : (
                <span className="drive-crumb-current">{b.name}</span>
              )}
            </span>
          ))}
          {search && <span className="drive-crumb-search">· results for “{search}”</span>}
        </nav>

        <div className="drive-list" role="listbox" aria-multiselectable={multiple} aria-busy={loading}>
          {loading ? (
            <p className="drive-empty">Loading…</p>
          ) : error && !folder ? null : files.length === 0 ? (
            <p className="drive-empty">
              {search ? "Nothing matches." : "No PDFs, images, Docs or Slides in this folder."}
            </p>
          ) : (
            files.map((it) => (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={isSelected(it)}
                className={`drive-item${isSelected(it) ? " is-selected" : ""}${
                  folderMode && !it.isFolder ? " is-dim" : ""
                }`}
                onClick={() => onItemClick(it)}
                onDoubleClick={() => !folderMode && !it.isFolder && !multiple && void pick([it])}
                disabled={downloading || (folderMode && !it.isFolder)}
                title={it.isFolder ? `Open ${it.name}` : it.name}
              >
                <Icon item={it} />
                <span className="drive-item-name">{it.name}</span>
                <span className="drive-item-note">{it.isFolder ? "Folder" : itemNote(it)}</span>
              </button>
            ))
          )}
        </div>

        {error && (
          <div className="auth-error drive-error" role="alert">
            {error}
          </div>
        )}

        <div className="dialog-actions">
          {folderMode && saveNote && (
            <span className="drive-count" title={saveNote}>
              {saveNote}
            </span>
          )}
          {multiple && selected.length > 0 && (
            <span className="drive-count">
              {selected.length} selected
            </span>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={downloading}>
            Cancel
          </button>
          {folderMode ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || !folder}
              onClick={() => {
                if (!folder) return;
                const crumbs = folder.breadcrumbs;
                onPickFolder?.({
                  id: folder.folderId,
                  name: crumbs.length ? crumbs[crumbs.length - 1].name : "My Drive",
                });
              }}
              title="Save into the folder shown above"
            >
              Save here
            </button>
          ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void pick(selected)}
            disabled={selected.length === 0 || downloading}
          >
            {downloading
              ? "Downloading…"
              : multiple
                ? `Add ${selected.length || ""} file${selected.length === 1 ? "" : "s"}`.replace("  ", " ")
                : "Open"}
          </button>
          )}
        </div>
      </div>
    </div>
  );
}
