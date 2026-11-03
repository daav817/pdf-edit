import type { RedactRegion, ViewportSize } from "./types";

type Props = {
  regions: RedactRegion[];
  viewport: ViewportSize;
  onRemove: (id: string) => void;
};

/** Areas marked for redaction on the current page, each with a remove button. */
export function RedactionLayer({ regions, viewport, onRemove }: Props) {
  if (regions.length === 0) return null;
  return (
    <div
      className="redaction-layer"
      style={{ width: viewport.width, height: viewport.height }}
    >
      {regions.map((r) => (
        <div
          key={r.id}
          className="redaction-mark"
          title={r.text ? `Will remove "${r.text}"` : "Will be removed"}
          style={{
            left: r.x * viewport.width,
            top: r.y * viewport.height,
            width: r.width * viewport.width,
            height: r.height * viewport.height,
          }}
        >
          <button
            type="button"
            className="redaction-remove"
            data-tool-passthrough
            aria-label="Remove this redaction mark"
            onClick={() => onRemove(r.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
