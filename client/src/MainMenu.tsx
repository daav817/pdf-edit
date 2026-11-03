import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { EXPORT_FORMATS, type ExportFormat } from "./export";

/** A tool shown in the menu as well as on the toolbar. */
export type MenuTool = {
  label: string;
  icon: ReactNode;
  /** The tool is switched on / the screen is open. */
  on?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

type Props = {
  /** Editing tools (same as the toolbar icons). */
  tools: MenuTool[];
  /** Split / merge / organize. */
  pageTools: MenuTool[];
  hasFile: boolean;
  busy: boolean;
  exporting: boolean;
  printing: boolean;
  exportFormat: ExportFormat;
  onExportFormatChange: (format: ExportFormat) => void;
  onImport: (e: ChangeEvent<HTMLInputElement>) => void;
  onImportDrive: () => void;
  onSave: () => void;
  onSaveDrive: () => void;
  onPrint: () => void;
  onSignOut?: () => void;
};

/** The ☰ menu in the top right: import, save as, print, sign out. */
export function MainMenu({
  tools,
  pageTools,
  hasFile,
  busy,
  exporting,
  printing,
  exportFormat,
  onExportFormatChange,
  onImport,
  onImportDrive,
  onSave,
  onSaveDrive,
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
            Import from this computer…
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
          <button
            type="button"
            className="main-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onImportDrive();
            }}
          >
            Import from Google Drive…
          </button>

          {[
            { title: "Tools", items: tools },
            { title: "Pages", items: pageTools },
          ].map(
            (group) =>
              group.items.length > 0 && (
                <div key={group.title} className="main-menu-group" role="group" aria-label={group.title}>
                  <span className="main-menu-label">{group.title}</span>
                  {group.items.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      role="menuitem"
                      className={`main-menu-item with-icon${t.on ? " is-on" : ""}`}
                      aria-pressed={t.on}
                      disabled={t.disabled}
                      onClick={() => {
                        setOpen(false);
                        t.onSelect();
                      }}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>
              )
          )}

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
            <div className="main-menu-save-row">
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => {
                  setOpen(false);
                  onSave();
                }}
                disabled={!hasFile || busy}
                title="Save to this computer"
              >
                {exporting ? "Saving…" : "To this computer…"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setOpen(false);
                  onSaveDrive();
                }}
                disabled={!hasFile || busy}
                title="Save into a Google Drive folder"
              >
                To Google Drive…
              </button>
            </div>
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
          <div className="main-menu-version" title="pdf-edit version">
            Version {__APP_VERSION__}
          </div>
        </div>
      )}
    </div>
  );
}
