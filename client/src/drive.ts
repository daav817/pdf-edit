/** Google Drive import (the server goes through energia-app as the signed-in user). */

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  /** pdf, image, or google (a Doc/Slides file that arrives as PDF). */
  kind: "pdf" | "image" | "google" | null;
  modifiedTime?: string | null;
  size?: number | null;
  owner?: string | null;
};

export type DriveFolder = {
  folderId: string;
  breadcrumbs: { id: string; name: string }[];
  files: DriveItem[];
};

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { detail?: string }).detail || `${fallback} (${res.status})`;
}

export async function listDrive(folderId: string, query: string): Promise<DriveFolder> {
  const params = new URLSearchParams();
  if (folderId) params.set("folderId", folderId);
  if (query) params.set("query", query);
  const res = await fetch(`/api/drive/files?${params}`);
  if (!res.ok) throw new Error(await errorMessage(res, "Could not open Google Drive"));
  return res.json();
}

/** Download one Drive file as a File the editor can open (PDF, JPG or PNG). */
export async function downloadDriveFile(item: DriveItem): Promise<File> {
  const res = await fetch(`/api/drive/files/${encodeURIComponent(item.id)}/download`);
  if (!res.ok) throw new Error(await errorMessage(res, `Could not download ${item.name}`));
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  let name = m ? decodeURIComponent(m[1]) : item.name;
  const type = blob.type || "application/pdf";
  if (type === "application/pdf" && !/\.pdf$/i.test(name)) name += ".pdf";
  return new File([blob], name, { type });
}
