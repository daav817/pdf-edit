export const EXPORT_FORMATS = [
  { id: "pdf", label: "PDF with fields (.pdf)" },
  { id: "png", label: "PNG image (.png)" },
  { id: "jpeg", label: "JPEG image (.jpg)" },
  { id: "txt", label: "Plain text (.txt)" },
  { id: "docx", label: "Word document (.docx)" },
  { id: "html", label: "HTML (.html)" },
  { id: "md", label: "Markdown (.md)" },
  { id: "json", label: "JSON (.json)" },
  { id: "rtf", label: "Rich text (.rtf)" },
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number]["id"];

export type ExportResult = {
  blob: Blob;
  filename: string;
  extractionMethod: string | null;
};

/** Text, Word, HTML, … from the server (OCR when pages are scans). Not saved yet. */
export async function buildExport(
  file: File,
  format: ExportFormat
): Promise<ExportResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("format", format);

  const res = await fetch("/api/export", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { detail?: string }).detail || `Export failed (${res.status})`
    );
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const filename = match
    ? decodeURIComponent(match[1].trim())
    : `${file.name.replace(/\.pdf$/i, "")}.${format}`;

  return {
    blob,
    filename,
    extractionMethod: res.headers.get("X-Extraction-Method"),
  };
}
