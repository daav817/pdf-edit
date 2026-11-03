type Props = {
  error: string | null;
  status: string | null;
  onDismiss: () => void;
};

/** The floating message at the top of a page-tool screen. */
export function StatusBanner({ error, status, onDismiss }: Props) {
  if (!error && !status) return null;
  return (
    <div className="banner-stack">
      <div
        className={`banner ${error ? "banner-error" : "banner-info"}`}
        role={error ? "alert" : "status"}
      >
        {error ?? status}
        <button type="button" className="banner-close" aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </div>
    </div>
  );
}
