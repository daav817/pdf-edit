import { downloadBlob } from "./pages";

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  name: string;
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

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
