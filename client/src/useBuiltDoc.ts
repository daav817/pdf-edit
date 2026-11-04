import { useCallback, useEffect, useRef } from "react";
import { loadPdfFromFile, type PdfDocument } from "./pdf";

/**
 * The open file as it will be saved (edits included), for previewing. Built on
 * first use and kept until the screen closes; the editor, and so the edits,
 * can't change while a page screen is open.
 */
export function useBuiltDoc(build: () => Promise<Uint8Array>) {
  const pending = useRef<Promise<PdfDocument> | null>(null);
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(
    () => () => {
      void pending.current?.then((d) => d.destroy()).catch(() => {});
      pending.current = null;
    },
    []
  );

  return useCallback(() => {
    if (!pending.current) {
      const p = buildRef.current().then((bytes) =>
        loadPdfFromFile(new File([new Uint8Array(bytes)], "preview.pdf", { type: "application/pdf" }))
      );
      pending.current = p;
      p.catch(() => {
        if (pending.current === p) pending.current = null;
      });
    }
    return pending.current;
  }, []);
}
