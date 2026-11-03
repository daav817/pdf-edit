import { buildAnnotatedPdf } from "./savePdf";
import type { FormField, TextEdit } from "./types";

export async function printAnnotatedPdf(
  file: File,
  fields: FormField[],
  textEdits: TextEdit[] = []
): Promise<void> {
  const pdfBytes = await buildAnnotatedPdf(file, fields, textEdits);
  const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.src = url;
  document.body.appendChild(iframe);

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    iframe.onerror = () => reject(new Error("Could not load PDF for printing."));
  });

  setTimeout(() => {
    document.body.removeChild(iframe);
    URL.revokeObjectURL(url);
  }, 60_000);
}
