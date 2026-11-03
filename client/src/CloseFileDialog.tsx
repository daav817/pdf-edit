type Props = {
  fileName: string;
  fieldCount: number;
  editCount: number;
  redactionCount: number;
  /** Redactions were applied to the file since it was last saved. */
  redactionsApplied: boolean;
  saving?: boolean;
  /** Save to this computer (Save-as window or download), then close. */
  onSaveAndClose: () => void;
  /** Pick a Google Drive folder, save there, then close. */
  onSaveToDriveAndClose: () => void;
  onCloseWithoutSaving: () => void;
  onCancel: () => void;
};

/** Asked before closing a file that has work not yet saved. */
export function CloseFileDialog({
  fileName,
  fieldCount,
  editCount,
  redactionCount,
  redactionsApplied,
  saving = false,
  onSaveAndClose,
  onSaveToDriveAndClose,
  onCloseWithoutSaving,
  onCancel,
}: Props) {
  const parts: string[] = [];
  if (fieldCount > 0) {
    parts.push(`${fieldCount} field${fieldCount !== 1 ? "s" : ""}`);
  }
  if (editCount > 0) {
    parts.push(`${editCount} text edit${editCount !== 1 ? "s" : ""}`);
  }
  if (redactionCount > 0) {
    parts.push(
      `${redactionCount} redaction mark${redactionCount !== 1 ? "s" : ""} not yet applied`
    );
  }
  if (redactionsApplied) parts.push("redactions applied but not saved");
  const summary = parts.join(", ") || "changes";

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog close-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-file-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="close-file-title" className="dialog-title">
          Unsaved changes
        </h2>
        <p className="dialog-body">
          {fileName} has {summary}. Save before closing, or close and discard
          them.
          {redactionCount > 0 &&
            " Saving does not apply redaction marks; use Apply redactions first."}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onCloseWithoutSaving}
            disabled={saving}
          >
            Don&apos;t save
          </button>
          <button
            type="button"
            className="btn"
            onClick={onSaveToDriveAndClose}
            disabled={saving}
            title="Save into a Google Drive folder, then close"
          >
            Save to Drive &amp; close
          </button>
          <button
            type="button"
            className="btn btn-accent"
            onClick={onSaveAndClose}
            disabled={saving}
            title="Save to this computer, then close"
          >
            {saving ? "Saving…" : "Save & close"}
          </button>
        </div>
      </div>
    </div>
  );
}
