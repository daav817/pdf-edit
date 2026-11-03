type Props = {
  coverUnderlying: boolean;
  onChange: (coverUnderlying: boolean) => void;
};

export function FieldBackgroundToggle({ coverUnderlying, onChange }: Props) {
  return (
    <div
      className="field-background-toggle"
      role="group"
      aria-label="Field background"
    >
      <span className="text-format-label">Background</span>
      <button
        type="button"
        className={`btn btn-sm${!coverUnderlying ? " btn-primary" : ""}`}
        aria-pressed={!coverUnderlying}
        title="Let form lines and PDF content show through the box"
        onClick={() => onChange(false)}
      >
        Show through
      </button>
      <button
        type="button"
        className={`btn btn-sm${coverUnderlying ? " btn-primary" : ""}`}
        aria-pressed={coverUnderlying}
        title="White box hides underlying text and lines (redact-style)"
        onClick={() => onChange(true)}
      >
        Cover content
      </button>
    </div>
  );
}
