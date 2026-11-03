/** Page tools on the server: split (and later merge / organize). */

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { detail?: string }).detail || `${fallback} (${res.status})`;
}

export type SplitOutput = {
  name: string;
  /** 1-based pages, in output order. */
  pages: number[];
};

/** File name from Content-Disposition (filename*=UTF-8''...). */
function dispositionName(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : fallback;
}

/**
 * Build the outputs and download them: one PDF for a single output,
 * a ZIP with one PDF each for several. Returns the downloaded file name.
 */
export async function downloadSplit(
  pdfBytes: Uint8Array,
  sourceName: string,
  outputs: SplitOutput[]
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }),
    sourceName
  );
  form.append(
    "parts",
    JSON.stringify(
      outputs.map((o) => ({ name: o.name, pages: o.pages.map((p) => p - 1) }))
    )
  );
  const res = await fetch("/api/split", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res, "Split failed"));
  const blob = await res.blob();
  const name = dispositionName(res, "split.zip");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/** "1, 3, 5–8" */
export function describePages(pages: number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    if (j - i >= 2) out.push(`${pages[i]}–${pages[j]}`);
    else for (let k = i; k <= j; k++) out.push(String(pages[k]));
    i = j + 1;
  }
  return out.join(", ");
}

/** Save a blob under a name through the browser's download. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const pdfBlob = (bytes: Uint8Array) =>
  new Blob([new Uint8Array(bytes)], { type: "application/pdf" });

/** Join PDFs in the given order. */
export async function mergePdfs(
  inputs: { name: string; bytes: Uint8Array }[]
): Promise<Blob> {
  const form = new FormData();
  for (const f of inputs) form.append("files", pdfBlob(f.bytes), f.name);
  const res = await fetch("/api/merge", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res, "Merge failed"));
  return res.blob();
}

export type OrganizePage = {
  /** 1-based page in the source file. */
  source: number;
  /** Extra clockwise turn: 0, 90, 180 or 270. */
  rotate: number;
};

/** New PDF from the source pages in this order, turned as given. */
export async function organizePdf(
  bytes: Uint8Array,
  name: string,
  pages: OrganizePage[]
): Promise<Blob> {
  const form = new FormData();
  form.append("file", pdfBlob(bytes), name);
  form.append(
    "pages",
    JSON.stringify(pages.map((p) => ({ source: p.source - 1, rotate: p.rotate })))
  );
  const res = await fetch("/api/organize", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorMessage(res, "Organize failed"));
  return res.blob();
}
