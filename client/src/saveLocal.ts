import { downloadBlob } from "./pages";

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  name: string;
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

type DirectoryPicker = (options: { mode: "readwrite" }) => Promise<FolderHandle>;

type FolderHandle = {
  name: string;
  getFileHandle: (
    name: string,
    options?: { create: boolean }
  ) => Promise<{
    createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  }>;
};

/** A chosen folder, or "downloads" where the browser can't offer one. */
export type SaveTarget = FolderHandle | "downloads";

/**
 * Where several separate files go. Call it straight from the click: browsers
 * refuse the folder window later. Returns null when the user cancelled.
 */
export async function pickSaveTarget(): Promise<SaveTarget | null> {
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) return "downloads";
  try {
    return await picker({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    if (err instanceof DOMException && (err.name === "SecurityError" || err.name === "NotAllowedError")) {
      return "downloads";
    }
    throw err;
  }
}

/** The name, numbered if the folder already has a file called that. */
async function freeName(folder: FolderHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? name : `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
    try {
      await folder.getFileHandle(candidate);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") return candidate;
      throw err;
    }
  }
}

/** Save one of several files. Returns the name it was saved under. */
export async function saveToTarget(target: SaveTarget, blob: Blob, name: string): Promise<string> {
  if (target === "downloads") {
    downloadBlob(blob, name);
    // Browsers drop downloads started in the same instant.
    await new Promise((done) => setTimeout(done, 400));
    return name;
  }
  const saved = await freeName(target, name);
  const handle = await target.getFileHandle(saved, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return saved;
}

/**
 * Save to this computer. Where the browser allows it (Chrome, Edge), a "Save
 * as" window lets the user pick the folder and name; otherwise (Brave, Firefox)
 * the file downloads the normal way. Returns the saved name, or null when the
 * user cancelled the window.
 */
export async function saveToComputer(blob: Blob, suggestedName: string): Promise<string | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    downloadBlob(blob, suggestedName);
    return suggestedName;
  }
  const isZip = /\.zip$/i.test(suggestedName);
  try {
    const handle = await picker({
      suggestedName,
      types: [
        isZip
          ? { description: "ZIP file", accept: { "application/zip": [".zip"] } }
          : { description: "PDF file", accept: { "application/pdf": [".pdf"] } },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return handle.name;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    // Blocked by a policy or flag: fall back to a normal download.
    if (err instanceof DOMException && (err.name === "SecurityError" || err.name === "NotAllowedError")) {
      downloadBlob(blob, suggestedName);
      return suggestedName;
    }
    throw err;
  }
}
