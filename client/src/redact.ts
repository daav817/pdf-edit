import { createRedactId, type RedactRegion } from "./types";

export type RedactPattern = { id: string; label: string };

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { detail?: string }).detail || `${fallback} (${res.status})`;
}

export async function fetchRedactPatterns(): Promise<RedactPattern[]> {
  const res = await fetch("/api/redact/patterns");
  if (!res.ok) throw new Error(await errorMessage(res, "Could not load patterns"));
  return res.json();
}

/** Find words and patterns on every page; returns them as pending regions. */
export async function searchRedactions(
  file: File,
  terms: string[],
  patterns: string[]
): Promise<RedactRegion[]> {
  const form = new FormData();
  form.append("file", file);
  form.append("terms", JSON.stringify(terms));
  form.append("patterns", JSON.stringify(patterns));
  const res = await fetch("/api/redact/search", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res, "Search failed"));
  const hits = (await res.json()) as Array<{
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
  }>;
  return hits.map((h) => ({
    id: createRedactId(),
    page: h.page + 1,
    x: h.x,
    y: h.y,
    width: h.width,
    height: h.height,
    text: h.text,
  }));
}

/** Permanently remove everything under the regions; returns the new PDF. */
export async function applyRedactions(
  file: File,
  regions: RedactRegion[]
): Promise<File> {
  const form = new FormData();
  form.append("file", file);
  form.append(
    "regions",
    JSON.stringify(
      regions.map((r) => ({
        page: r.page - 1,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }))
    )
  );
  const res = await fetch("/api/redact", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res, "Redaction failed"));
  const blob = await res.blob();
  const stem = file.name.replace(/\.pdf$/i, "").replace(/-redacted$/i, "");
  return new File([blob], `${stem}-redacted.pdf`, { type: "application/pdf" });
}

type PageArea = { page: number; x: number; y: number; width: number; height: number };

/**
 * Delete the original words under edited text (page content only; images and
 * drawings stay). Returns the new PDF bytes for the edits to be drawn on.
 */
export async function removeOriginalText(
  file: File,
  areas: PageArea[]
): Promise<ArrayBuffer> {
  const form = new FormData();
  form.append("file", file);
  form.append(
    "regions",
    JSON.stringify(areas.map((a) => ({ ...a, page: a.page - 1 })))
  );
  const res = await fetch("/api/text/remove", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(
      `${await errorMessage(res, "Could not remove the original text")}. Nothing was saved.`
    );
  }
  return res.arrayBuffer();
}
