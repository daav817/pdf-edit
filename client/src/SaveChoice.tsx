import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  disabled?: boolean;
  onComputer: () => void;
  onDrive: () => void;
};

/** A Save button that asks where: this computer or Google Drive. */
export function SaveChoice({ label, disabled, onComputer, onDrive }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="save-choice" ref={ref}>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label} ▾
      </button>
      {open && (
        <div className="save-choice-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="main-menu-item"
            onClick={() => {
              setOpen(false);
              onComputer();
            }}
          >
            To this computer…
          </button>
          <button
            type="button"
            role="menuitem"
            className="main-menu-item"
            onClick={() => {
              setOpen(false);
              onDrive();
            }}
          >
            To Google Drive…
          </button>
        </div>
      )}
    </div>
  );
}
