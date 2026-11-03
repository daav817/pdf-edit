import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { EXPORT_FORMATS, type ExportFormat } from "./export";

type Props = {
  hasFile: boolean;
  busy: boolean;
  exporting: boolean;
  printing: boolean;
  exportFormat: ExportFormat;
  onExportFormatChange: (format: ExportFormat) => void;
  onImport: (e: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onPrint: () => void;
  onSignOut?: () => void;
};

/** The ☰ menu in the top right: import, save as, print, sign out. */
export function MainMenu({
  hasFile,
  busy,
  exporting,
  printing,
  exportFormat,
  onExportFormatChange,
  onImport,
  onSave,
  onPrint,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="main-menu" ref={rootRef}>
      <button
        type="button"
        className={`btn btn-icon main-menu-button${open ? " btn-primary" : ""}`}
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path
            d="M2 4.5h14M2 9h14M2 13.5h14"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <div className="main-menu-panel" role="menu">
          <label className="main-menu-item" role="menuitem">
            Import file…
            <input
              type="file"
              accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
              hidden
              onChange={(e) => {
                setOpen(false);
                onImport(e);
              }}
            />
          </label>

          <div className="main-menu-section">
            <span className="main-menu-label">Save as</span>
            <select
              className="format-select"
              value={exportFormat}
              onChange={(e) => onExportFormatChange(e.target.value as ExportFormat)}
              disabled={!hasFile || exporting}
              aria-label="Save format"
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => {
                setOpen(false);
                onSave();
              }}
              disabled={!hasFile || busy}
            >
              {exporting ? "Saving…" : "Save"}
            </button>
          </div>

          <button
            type="button"
            className="main-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onPrint();
            }}
            disabled={!hasFile || busy}
          >
            {printing ? "Preparing…" : "Print…"}
          </button>

          {onSignOut && (
            <button
              type="button"
              className="main-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
