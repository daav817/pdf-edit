import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** The button's name: shown as its tooltip and read by screen readers. */
  label: string;
  icon: ReactNode;
  className?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/**
 * Icon-only toolbar button with a tooltip. The tooltip is drawn in a portal
 * because the toolbar clips anything that hangs below it.
 */
export function ToolButton({ label, icon, className = "btn", pressed, disabled, onClick }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setTip({ x: r.left + r.width / 2, y: r.bottom + 6 });
  };
  const hide = () => setTip(null);

  return (
    <>
      {/* A disabled button gets no mouse events, so the wrapper shows its tooltip. */}
      <span className="tool-btn-wrap" onMouseEnter={show} onMouseLeave={hide}>
        <button
          ref={ref}
          type="button"
          className={`${className} tool-btn`}
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={() => {
            hide();
            onClick();
          }}
          onFocus={show}
          onBlur={hide}
        >
          {icon}
        </button>
      </span>
      {tip &&
        createPortal(
          <div className="tool-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
            {label}
          </div>,
          document.body
        )}
    </>
  );
}

const svg = (children: ReactNode) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** A letter T with a text cursor beside it. */
export const EditTextIcon = () =>
  svg(
    <>
      <path d="M4 6V4h12v2" />
      <path d="M10 4v15" />
      <path d="M7.5 19h5" />
      <path d="M19 9v11" />
      <path d="M17 9h4M17 20h4" />
    </>
  );

/** Dashed selection with a small copy behind it. */
export const CopyRegionIcon = () =>
  svg(
    <>
      <rect x="8" y="8" width="13" height="13" rx="1.5" strokeDasharray="3 2.5" />
      <path d="M5 16H4.5A1.5 1.5 0 0 1 3 14.5v-10A1.5 1.5 0 0 1 4.5 3h10A1.5 1.5 0 0 1 16 4.5V5" />
    </>
  );

/** Clipboard with an arrow going in. */
export const PasteIcon = () =>
  svg(
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h1.5A2.5 2.5 0 0 1 20 6.5V9" />
      <path d="M8 4H6.5A2.5 2.5 0 0 0 4 6.5v13A2.5 2.5 0 0 0 6.5 22H11" />
      <path d="M21 15h-8" />
      <path d="m16 12-3 3 3 3" />
    </>
  );

/** A box with a plus: draw a new field. */
export const DrawFieldIcon = () =>
  svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M12 9v6M9 12h6" />
    </>
  );

/** Lines of text with one blacked out. */
export const RedactIcon = () =>
  svg(
    <>
      <path d="M4 5h16" />
      <rect x="4" y="10" width="16" height="5" rx="1" fill="currentColor" />
      <path d="M4 20h10" />
    </>
  );

/** Scissors: split the file into new PDFs. */
export const ScissorsIcon = () =>
  svg(
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9" />
      <path d="M14.5 14.5 20 20" />
      <path d="M8.1 8.1 12 12" />
    </>
  );

/** Two pages joining into one: merge files. */
export const MergeIcon = () =>
  svg(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="9" rx="1" />
      <path d="M6.5 12v2.5a2 2 0 0 0 2 2H12m5.5-4.5v2.5a2 2 0 0 1-2 2H12" />
      <path d="M12 16.5V21" />
      <path d="m9.5 18.5 2.5 2.5 2.5-2.5" />
    </>
  );

/** A grid of pages with a turn arrow: reorder, rotate, remove. */
export const OrganizeIcon = () =>
  svg(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 17.5a3.5 3.5 0 1 0 3.5-3.5" />
      <path d="m15.5 12 2 2-2 2" />
    </>
  );
