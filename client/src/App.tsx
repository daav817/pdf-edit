import { useCallback, useEffect, useMemo, useState } from "react";
import { PdfViewer } from "./PdfViewer";
import { buildExport, EXPORT_FORMATS, type ExportFormat } from "./export";
import { MainMenu } from "./MainMenu";
import { printAnnotatedPdf } from "./print";
import type { PdfDocument } from "./pdf";
import { loadPdfFromFile } from "./pdf";
import {
  isImageImportFile,
  isPdfImportFile,
  pdfFileFromImage,
} from "./imageToPdf";
import { buildAnnotatedPageImage } from "./exportImage";
import { saveToComputer } from "./saveLocal";
import { uploadToDrive, type DriveFolderRef } from "./drive";
import {
  annotatedPdfName,
  buildAnnotatedPdf,
  downloadAnnotatedPdf,
  previewAnnotatedPdf,
} from "./savePdf";
import { SplitScreen } from "./SplitScreen";
import { DrivePicker } from "./DrivePicker";
import { MergeScreen } from "./MergeScreen";
import { OrganizeScreen } from "./OrganizeScreen";
import type { MenuTool } from "./MainMenu";
import {
  CopyRegionIcon,
  DrawFieldIcon,
  EditTextIcon,
  PasteIcon,
  RedactIcon,
  ScissorsIcon,
  MergeIcon,
  OrganizeIcon,
  ToolButton,
} from "./ToolButton";
import { CloseFileDialog } from "./CloseFileDialog";
import { TextFormatToolbar } from "./TextFormatToolbar";
import { FieldBackgroundToggle } from "./FieldBackgroundToggle";
import {
  boxDimensionsPt,
  fitFontSizeInBox,
} from "./textStyle";
import type { CopiedTextClip, FormField, TextEdit, TextFontFamily } from "./types";
import { isTextModified, moveTextEdit } from "./types";
import { useUndoRedo } from "./useUndoRedo";
import {
  applyRedactions,
  fetchRedactPatterns,
  searchRedactions,
  type RedactPattern,
} from "./redact";
import type { RedactRegion } from "./types";

/** Everything undo/redo covers, including the file itself so an applied
 * redaction can be undone until the user moves on. */
/** Full-screen page tools that replace the editor while open. */
type PageScreen = "split" | "merge" | "organize";

const PAGE_SCREEN_TITLE: Record<PageScreen, string> = {
  split: "Split pages",
  merge: "Merge files",
  organize: "Organize pages",
};

type AnnotationState = {
  file: File | null;
  fields: FormField[];
  textEdits: TextEdit[];
  redactions: RedactRegion[];
};

const emptyAnnotations = (file: File | null = null): AnnotationState => ({
  file,
  fields: [],
  textEdits: [],
  redactions: [],
});

const sameIds = (a: { id: string }[], b: { id: string }[]) =>
  a.length === b.length && a.every((item, i) => item.id === b[i].id);

type Positioned = { id: string; x: number; y: number; text: string };

/** What kind of edit this is to which items, e.g. "move:abc" or "text:abc". */
function describeChanges(prev: Positioned[], next: Positioned[]): string[] {
  const out: string[] = [];
  next.forEach((n, i) => {
    const p = prev[i];
    if (p === n) return;
    if (p.x !== n.x || p.y !== n.y) out.push(`move:${n.id}`);
    else if (p.text !== n.text) out.push(`text:${n.id}`);
    else out.push(`other:${n.id}`);
  });
  return out;
}

/**
 * Changes with the same key, made in quick succession, undo as one step (a
 * typing burst, one drag). Adding or removing items, or switching from typing
 * to moving, always starts a new step.
 */
function undoMergeKey(prev: AnnotationState, next: AnnotationState): string | null {
  if (
    prev.file !== next.file ||
    prev.redactions !== next.redactions ||
    !sameIds(prev.fields, next.fields) ||
    !sameIds(prev.textEdits, next.textEdits)
  ) {
    return null;
  }
  return [
    ...describeChanges(prev.fields, next.fields),
    ...describeChanges(prev.textEdits, next.textEdits),
  ].join(",");
}

/** What would end up in a saved PDF; used to tell whether there is unsaved work. */
function savedContentKey(s: AnnotationState): string {
  return JSON.stringify({
    fields: s.fields.filter(
      (f) => f.text.trim() || f.imageDataUrl || f.coverUnderlying
    ),
    textEdits: s.textEdits.filter(isTextModified),
  });
}

type Props = {
  onSignOut?: () => void;
};

export default function App({ onSignOut }: Props) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("pdf");
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [editTextMode, setEditTextMode] = useState(false);
  const [copyTextMode, setCopyTextMode] = useState(false);
  const [pasteTextMode, setPasteTextMode] = useState(false);
  const [copiedClip, setCopiedClip] = useState<CopiedTextClip | null>(null);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [activeTextEditId, setActiveTextEditId] = useState<string | null>(
    null
  );
  const [editingTextEditId, setEditingTextEditId] = useState<string | null>(
    null
  );
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [defaultFieldCover, setDefaultFieldCover] = useState(false);
  const [pageReady, setPageReady] = useState(false);
  const [redactMode, setRedactMode] = useState(false);
  const [redactTerms, setRedactTerms] = useState("");
  const [redactPatterns, setRedactPatterns] = useState<RedactPattern[]>([]);
  const [chosenPatterns, setChosenPatterns] = useState<string[]>([]);
  const [redactBusy, setRedactBusy] = useState(false);
  const [pageScreen, setPageScreen] = useState<PageScreen | null>(null);
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [saveDriveOpen, setSaveDriveOpen] = useState(false);

  const {
    state: annotations,
    setState: setAnnotations,
    replaceState: replaceAnnotations,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<AnnotationState>(emptyAnnotations(), undoMergeKey);

  const { file, fields, textEdits, redactions } = annotations;

  // The state as of the last open or PDF save.
  const [savedState, setSavedState] = useState<AnnotationState>(annotations);
  const savedKey = useMemo(() => savedContentKey(savedState), [savedState]);
  const currentKey = useMemo(() => savedContentKey(annotations), [annotations]);
  const fileChangedSinceSave = file !== savedState.file;
  const docHasUnsaved =
    !!file &&
    (fileChangedSinceSave || currentKey !== savedKey || redactions.length > 0);

  useEffect(() => {
    if (!docHasUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [docHasUnsaved]);

  // Load whichever file is current: opened, redacted, or brought back by undo.
  useEffect(() => {
    if (!file) {
      setDoc(null);
      setPageCount(0);
      return;
    }
    let cancelled = false;
    setPageReady(false);
    loadPdfFromFile(file)
      .then((pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        setDoc(pdf);
        setPageCount(pdf.numPages);
        setPage((p) => Math.min(Math.max(p, 1), pdf.numPages));
      })
      .catch(() => {
        if (cancelled) return;
        const empty = emptyAnnotations();
        replaceAnnotations(empty);
        setSavedState(empty);
        setError("Could not open this PDF.");
      });
    return () => {
      cancelled = true;
    };
  }, [file, replaceAnnotations]);

  const setFields = useCallback(
    (next: FormField[] | ((prev: FormField[]) => FormField[])) => {
      setAnnotations((prev) => ({
        ...prev,
        fields: typeof next === "function" ? next(prev.fields) : next,
      }));
    },
    [setAnnotations]
  );

  const setTextEdits = useCallback(
    (next: TextEdit[] | ((prev: TextEdit[]) => TextEdit[])) => {
      setAnnotations((prev) => ({
        ...prev,
        textEdits: typeof next === "function" ? next(prev.textEdits) : next,
      }));
    },
    [setAnnotations]
  );

  const setRedactions = useCallback(
    (next: RedactRegion[]) => {
      setAnnotations((prev) => ({ ...prev, redactions: next }));
    },
    [setAnnotations]
  );

  useEffect(() => {
    if (!redactMode || redactPatterns.length > 0) return;
    fetchRedactPatterns()
      .then(setRedactPatterns)
      .catch(() => setRedactPatterns([]));
  }, [redactMode, redactPatterns.length]);

  const openFile = useCallback(
    async (f: File) => {
      if (!isPdfImportFile(f) && !isImageImportFile(f)) {
        setError("Please choose a PDF, JPG, or PNG file.");
        return;
      }
      setError(null);
      setExportStatus(null);
      setActiveFieldId(null);
      setEditingFieldId(null);
      setActiveTextEditId(null);
      setEditingTextEditId(null);
      setDrawMode(false);
      setEditTextMode(false);
      setCopyTextMode(false);
      setPasteTextMode(false);
      setRedactMode(false);
      setPageScreen(null);
      setCopiedClip(null);
      setPage(1);
      setDefaultFieldCover(isImageImportFile(f));

      try {
        let pdfFile = f;
        if (isImageImportFile(f)) {
          setExportStatus("Converting image to PDF…");
          pdfFile = await pdfFileFromImage(f);
        }
        const opened = emptyAnnotations(pdfFile);
        replaceAnnotations(opened);
        setSavedState(opened);
        if (isImageImportFile(f)) {
          setExportStatus(
            "Image opened as PDF. Use Redact to permanently remove areas, then ☰ → Save."
          );
        }
      } catch {
        const empty = emptyAnnotations();
        replaceAnnotations(empty);
        setSavedState(empty);
        setExportStatus(null);
        setDefaultFieldCover(false);
        setError(
          isImageImportFile(f)
            ? "Could not convert this image to PDF."
            : "Could not open this PDF."
        );
      }
    },
    [replaceAnnotations]
  );

  useEffect(() => {
    return () => {
      doc?.destroy();
    };
  }, [doc]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The Split screen has its own keys; editor undo must not run behind it.
      if (pageScreen || drivePickerOpen || saveDriveOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        clearSelection();
        return;
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        clearSelection();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (
          target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable
        ) {
          return;
        }
        if (activeFieldId) {
          e.preventDefault();
          setFields((prev) => prev.filter((f) => f.id !== activeFieldId));
          clearSelection();
        } else if (activeTextEditId) {
          e.preventDefault();
          setTextEdits((prev) => prev.filter((t) => t.id !== activeTextEditId));
          clearSelection();
        }
      }
      if (activeTextEditId && e.key.startsWith("Arrow")) {
        const target = e.target as HTMLElement;
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
        // Nudge the selected gold box; Shift moves in bigger steps.
        const step = e.shiftKey ? 0.01 : 0.001;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        e.preventDefault();
        setTextEdits((prev) =>
          prev.map((t) =>
            t.id === activeTextEditId ? moveTextEdit(t, t.x + dx, t.y + dy) : t
          )
        );
        return;
      }
      if (e.key === "Escape") {
        if (copyTextMode || pasteTextMode || redactMode) {
          setCopyTextMode(false);
          setPasteTextMode(false);
          setRedactMode(false);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    undo,
    redo,
    activeFieldId,
    activeTextEditId,
    setFields,
    setTextEdits,
    copyTextMode,
    pasteTextMode,
    redactMode,
    pageScreen,
    drivePickerOpen,
    saveDriveOpen,
  ]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) openFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) openFile(f);
  };

  /**
   * ☰ → Save in the chosen format, to this computer (Save-as window or download)
   * or into a Google Drive folder.
   */
  const handleExport = async (driveFolder?: DriveFolderRef) => {
    if (!file) return;
    setExporting(true);
    setError(null);
    const savedNow = annotations;
    try {
      let blob: Blob;
      let filename: string;
      let note: string | null = null;

      if (exportFormat === "pdf") {
        setExportStatus("Building PDF with your changes…");
        const bytes = await buildAnnotatedPdf(file, fields, textEdits);
        blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
        filename = annotatedPdfName(file, fields, textEdits);
      } else if (exportFormat === "png" || exportFormat === "jpeg") {
        if (!doc) return;
        setExportStatus(`Rendering current page as ${exportFormat === "jpeg" ? "JPEG" : "PNG"}…`);
        ({ blob, filename } = await buildAnnotatedPageImage(
          doc,
          page,
          scale,
          fields,
          textEdits,
          exportFormat,
          file.name
        ));
        note = `(page ${page} at current zoom)`;
      } else {
        setExportStatus("Extracting text… scanned PDFs use OCR and may take a minute per page.");
        const result = await buildExport(file, exportFormat);
        ({ blob, filename } = result);
        note =
          result.extractionMethod === "ocr" || result.extractionMethod === "text-layer+ocr"
            ? "Text recognized from page images (OCR)."
            : result.extractionMethod === "text-layer"
              ? "Text read from the PDF."
              : null;
      }

      let where: string;
      if (driveFolder) {
        setExportStatus(`Saving ${filename} to Google Drive…`);
        const res = await uploadToDrive(blob, filename, driveFolder.id);
        filename = res.name;
        where = ` to Google Drive › ${driveFolder.name}`;
      } else {
        setExportStatus("Choose where to save…");
        const saved = await saveToComputer(blob, filename);
        if (!saved) {
          setExportStatus("Not saved.");
          return;
        }
        filename = saved;
        where = "";
      }
      if (exportFormat === "pdf") setSavedState(savedNow);
      setExportStatus(`Saved ${filename}${where}.${note ? ` ${note}` : ""}`);
    } catch (err) {
      setExportStatus(null);
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setExporting(false);
    }
  };

  const handleViewEdited = async () => {
    if (!file) return;
    // Open the built-in viewer during the click so pop-up blockers allow it;
    // it shows "Building…" until the file is handed over.
    const win = window.open("/viewer.html", "_blank");
    if (!win) {
      setError("The browser blocked the new tab. Allow pop-ups for this site, then try again.");
      return;
    }
    setError(null);
    try {
      await previewAnnotatedPdf(win, file, fields, textEdits);
      setExportStatus(
        redactions.length > 0
          ? `Preview opened. ${redactions.length} redaction mark${redactions.length !== 1 ? "s are" : " is"} not applied yet, so ${redactions.length !== 1 ? "they are" : "it is"} not in the preview. Use Apply redactions first.`
          : "Preview opened in a new tab. Nothing has been saved."
      );
    } catch (err) {
      win.close();
      setError(err instanceof Error ? err.message : "Could not build the preview.");
    }
  };

  const handlePrint = async () => {
    if (!file) return;
    setPrinting(true);
    setError(null);
    setExportStatus("Preparing PDF for printing…");
    try {
      await printAnnotatedPdf(file, fields, textEdits);
      setExportStatus("Print dialog opened.");
    } catch (err) {
      setExportStatus(null);
      setError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setPrinting(false);
    }
  };

  const goPage = (delta: number) => {
    setPage((p) => Math.min(pageCount, Math.max(1, p + delta)));
    clearSelection();
  };

  const toggleDrawMode = () => {
    setDrawMode((d) => {
      const next = !d;
      if (next) {
        setEditTextMode(false);
        setCopyTextMode(false);
        setPasteTextMode(false);
        setRedactMode(false);
        clearSelection();
      }
      return next;
    });
  };

  const toggleEditTextMode = () => {
    setEditTextMode((e) => {
      const next = !e;
      if (next) {
        setDrawMode(false);
        setCopyTextMode(false);
        setPasteTextMode(false);
        setRedactMode(false);
        clearSelection();
      }
      return next;
    });
  };

  const toggleCopyTextMode = () => {
    setCopyTextMode((c) => {
      const next = !c;
      if (next) {
        setDrawMode(false);
        setEditTextMode(false);
        setPasteTextMode(false);
        setRedactMode(false);
        clearSelection();
      }
      return next;
    });
  };

  const togglePasteTextMode = () => {
    if (!copiedClip) return;
    setPasteTextMode((p) => {
      const next = !p;
      if (next) {
        setDrawMode(false);
        setEditTextMode(false);
        setCopyTextMode(false);
        setRedactMode(false);
        clearSelection();
      }
      return next;
    });
  };

  const toggleRedactMode = () => {
    setRedactMode((r) => {
      const next = !r;
      if (next) {
        setDrawMode(false);
        setEditTextMode(false);
        setCopyTextMode(false);
        setPasteTextMode(false);
        clearSelection();
      }
      return next;
    });
  };

  const handleRedactSearch = async () => {
    if (!file) return;
    const terms = redactTerms
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length === 0 && chosenPatterns.length === 0) {
      setError("Type words to find or tick a pattern first.");
      return;
    }
    setRedactBusy(true);
    setError(null);
    try {
      const found = await searchRedactions(file, terms, chosenPatterns);
      setRedactions([...redactions, ...found]);
      const pages = new Set(found.map((r) => r.page)).size;
      setExportStatus(
        found.length === 0
          ? "No matches found."
          : `Marked ${found.length} match${found.length !== 1 ? "es" : ""} on ${pages} page${pages !== 1 ? "s" : ""}. Review them, then Apply redactions.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setRedactBusy(false);
    }
  };

  const handleApplyRedactions = async () => {
    if (!file || redactions.length === 0) return;
    const ok = window.confirm(
      `Permanently remove everything under ${redactions.length} marked area${redactions.length !== 1 ? "s" : ""}? ` +
        "Text, images and drawings there are deleted from the file, and document info is cleared. This cannot be undone."
    );
    if (!ok) return;
    setRedactBusy(true);
    setError(null);
    try {
      const redacted = await applyRedactions(file, redactions);
      setAnnotations((prev) => ({ ...prev, file: redacted, redactions: [] }));
      setRedactMode(false);
      setExportStatus(
        `Redactions applied. Undo brings the marks back until you close the file. Use ☰ → Save to download ${redacted.name}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redaction failed.");
    } finally {
      setRedactBusy(false);
    }
  };

  const handleTextCopied = (clip: CopiedTextClip) => {
    setCopiedClip(clip);
    if (clip.text?.trim()) {
      void navigator.clipboard?.writeText(clip.text).catch(() => {});
    }
    setExportStatus("Region copied. Click Paste, then click or drag where it should go.");
  };

  /** Each drawing tool does one job, then switches off; click its button again for another. */
  const handleToolUsed = () => {
    setDrawMode(false);
    setEditTextMode(false);
    setCopyTextMode(false);
    setPasteTextMode(false);
    setRedactMode(false);
  };

  const closePageScreen = useCallback(() => setPageScreen(null), []);

  const openPageScreen = (screen: PageScreen) => {
    handleToolUsed();
    clearSelection();
    setPageScreen(screen);
  };

  /** Organize → Apply: the new file replaces the old one as one undo step. */
  const handleOrganized = (organized: File) => {
    setAnnotations(() => ({ file: organized, fields: [], textEdits: [], redactions: [] }));
    setPageScreen(null);
    setPage(1);
    setError(null);
    setExportStatus(
      "Pages organized. Your edits are now part of the pages. Undo (Ctrl+Z) brings back the old pages and edits."
    );
  };

  const handleMergedOpen = (merged: File) => {
    if (
      docHasUnsaved &&
      !window.confirm(
        `Open the merged file in the editor? Unsaved changes to ${file?.name ?? "the open file"} are in the merged file, but the original is not saved.`
      )
    ) {
      return;
    }
    void openFile(merged);
    setExportStatus(`Opened ${merged.name}. Use ☰ → Save to keep it.`);
  };

  const fieldCount = fields.length;
  const modifiedTextCount = textEdits.filter(isTextModified).length;


  const [pageLayout, setPageLayout] = useState({
    pageWidthPt: 612,
    pageHeightPt: 792,
  });

  const clearSelection = () => {
    setActiveFieldId(null);
    setEditingFieldId(null);
    setActiveTextEditId(null);
    setEditingTextEditId(null);
  };

  const resetPageUiState = () => {
    clearSelection();
    setDrawMode(false);
    setEditTextMode(false);
    setCopyTextMode(false);
    setPasteTextMode(false);
    setRedactMode(false);
    setCopiedClip(null);
  };

  /** Unload the document and return to the empty start screen. */
  const closeDocument = () => {
    resetPageUiState();
    const empty = emptyAnnotations();
    replaceAnnotations(empty);
    setSavedState(empty);
    setCloseDialogOpen(false);
    setPageScreen(null);
    setPage(1);
    setPageReady(false);
    setDefaultFieldCover(false);
    setError(null);
    setExportStatus(null);
  };

  const handleCloseClick = () => {
    if (docHasUnsaved) setCloseDialogOpen(true);
    else closeDocument();
  };

  const handleSaveAndClose = async () => {
    if (!file) return;
    setClosing(true);
    setError(null);
    try {
      const filename = await downloadAnnotatedPdf(file, fields, textEdits);
      closeDocument();
      setExportStatus(`Saved ${filename} and closed it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setClosing(false);
    }
  };

  const activeField = useMemo(
    () => fields.find((f) => f.id === activeFieldId) ?? null,
    [fields, activeFieldId]
  );
  const activeTextEdit = useMemo(
    () => textEdits.find((t) => t.id === activeTextEditId) ?? null,
    [textEdits, activeTextEditId]
  );
  const formatTarget = activeField ?? activeTextEdit;

  const updateActiveField = (patch: Partial<FormField>) => {
    if (!activeField) return;
    setFields((prev) =>
      prev.map((f) => (f.id === activeField.id ? { ...f, ...patch } : f))
    );
  };

  const updateFormatTarget = (patch: {
    fontFamily?: TextFontFamily;
    fontSize?: number;
    fontSizeLocked?: boolean;
  }) => {
    if (activeField) {
      setFields((prev) =>
        prev.map((f) => (f.id === activeField.id ? { ...f, ...patch } : f))
      );
      return;
    }
    if (activeTextEdit) {
      setTextEdits((prev) =>
        prev.map((t) => (t.id === activeTextEdit.id ? { ...t, ...patch } : t))
      );
    }
  };

  const fitFormatTargetToBox = () => {
    const target = activeField ?? activeTextEdit;
    if (!target) return;
    const { widthPt, heightPt } = boxDimensionsPt(
      target.width,
      target.height,
      pageLayout.pageWidthPt,
      pageLayout.pageHeightPt
    );
    const fontSize = fitFontSizeInBox(
      target.text,
      widthPt,
      heightPt,
      target.fontFamily ?? "Helvetica"
    );
    updateFormatTarget({ fontSize, fontSizeLocked: false });
  };

  /** Leave a page screen first, then switch the tool. */
  const fromMenu = (toggle: () => void) => () => {
    setPageScreen(null);
    toggle();
  };
  const menuTools: MenuTool[] = [
    { label: "Edit text", icon: <EditTextIcon />, on: editTextMode, disabled: !doc, onSelect: fromMenu(toggleEditTextMode) },
    { label: "Copy region", icon: <CopyRegionIcon />, on: copyTextMode, disabled: !doc, onSelect: fromMenu(toggleCopyTextMode) },
    {
      label: copiedClip ? "Paste" : "Paste (copy a region first)",
      icon: <PasteIcon />,
      on: pasteTextMode,
      disabled: !doc || !copiedClip,
      onSelect: fromMenu(togglePasteTextMode),
    },
    { label: "Draw field", icon: <DrawFieldIcon />, on: drawMode, disabled: !doc, onSelect: fromMenu(toggleDrawMode) },
    { label: "Redact", icon: <RedactIcon />, on: redactMode, disabled: !doc, onSelect: fromMenu(toggleRedactMode) },
  ];
  const menuPageTools: MenuTool[] = [
    { label: "Split pages", icon: <ScissorsIcon />, on: pageScreen === "split", disabled: !doc, onSelect: () => openPageScreen("split") },
    { label: "Merge files", icon: <MergeIcon />, on: pageScreen === "merge", onSelect: () => openPageScreen("merge") },
    { label: "Organize pages", icon: <OrganizeIcon />, on: pageScreen === "organize", disabled: !doc, onSelect: () => openPageScreen("organize") },
  ];
  const hasEdits = fieldCount > 0 || modifiedTextCount > 0;
  const buildCurrent = () =>
    file ? buildAnnotatedPdf(file, fields, textEdits) : Promise.reject(new Error("No file is open."));

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-left">
          <h1 className="logo">PDF Edit</h1>
          {file && (
            <span className="file-name" title={file.name}>
              {file.name}
            </span>
          )}
        </div>

        {pageScreen && (
          <div className="toolbar-center">
            <span className="page-indicator">
              {PAGE_SCREEN_TITLE[pageScreen]}
              {doc && pageScreen !== "merge" && ` · ${pageCount} page${pageCount !== 1 ? "s" : ""}`}
            </span>
          </div>
        )}

        {doc && !pageScreen && (
          <div className="toolbar-center">
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => goPage(-1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="page-indicator">
              Page {page} / {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => goPage(1)}
              disabled={page >= pageCount}
              aria-label="Next page"
            >
              ›
            </button>
            <div className="zoom">
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
                aria-label="Zoom out"
              >
                −
              </button>
              <span>{Math.round(scale * 100)}%</span>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => setScale((s) => Math.min(3, s + 0.25))}
                aria-label="Zoom in"
              >
                +
              </button>
            </div>
            <div className="history-controls">
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => {
                  undo();
                  clearSelection();
                }}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
              >
                ↶
              </button>
              <button
                type="button"
                onClick={() => {
                  redo();
                  clearSelection();
                }}
                className="btn btn-icon"
                disabled={!canRedo}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
              >
                ↷
              </button>
            </div>
            <button
              type="button"
              className="btn"
              onClick={handleCloseClick}
              disabled={exporting || printing || closing}
              title="Close this file and clear the screen"
            >
              Close file
            </button>
          </div>
        )}

        {doc && !pageScreen && (
          <div className="toolbar-form">
            <ToolButton
              label="Edit text"
              icon={<EditTextIcon />}
              className={`btn${editTextMode ? " btn-primary" : ""}`}
              pressed={editTextMode}
              onClick={toggleEditTextMode}
            />
            <ToolButton
              label="Copy region"
              icon={<CopyRegionIcon />}
              className={`btn${copyTextMode ? " btn-primary" : ""}`}
              pressed={copyTextMode}
              onClick={toggleCopyTextMode}
            />
            <ToolButton
              label={copiedClip ? "Paste" : "Paste (copy a region first)"}
              icon={<PasteIcon />}
              className={`btn${pasteTextMode ? " btn-primary" : ""}`}
              pressed={pasteTextMode}
              disabled={!copiedClip}
              onClick={togglePasteTextMode}
            />
            <ToolButton
              label="Draw field"
              icon={<DrawFieldIcon />}
              className={`btn${drawMode ? " btn-primary" : ""}`}
              pressed={drawMode}
              onClick={toggleDrawMode}
            />
            <ToolButton
              label="Redact"
              icon={<RedactIcon />}
              className={`btn${redactMode ? " btn-danger" : ""}`}
              pressed={redactMode}
              onClick={toggleRedactMode}
            />
            <span className="toolbar-group-divider" aria-hidden />
            <ToolButton
              label="Split pages"
              icon={<ScissorsIcon />}
              className="btn"
              onClick={() => openPageScreen("split")}
            />
            <ToolButton
              label="Merge files"
              icon={<MergeIcon />}
              className="btn"
              onClick={() => openPageScreen("merge")}
            />
            <ToolButton
              label="Organize pages"
              icon={<OrganizeIcon />}
              className="btn"
              onClick={() => openPageScreen("organize")}
            />
          </div>
        )}

        <div className="toolbar-right">
          {doc && (
            <button
              type="button"
              className="btn"
              onClick={handleViewEdited}
              title="Open the file with all your edits in a new tab, before saving"
            >
              View edited file
            </button>
          )}
          <MainMenu
            tools={menuTools}
            pageTools={menuPageTools}
            hasFile={!!file}
            busy={exporting || printing}
            exporting={exporting}
            printing={printing}
            exportFormat={exportFormat}
            onExportFormatChange={setExportFormat}
            onImport={onFileInput}
            onImportDrive={() => setDrivePickerOpen(true)}
            onSave={() => void handleExport()}
            onSaveDrive={() => setSaveDriveOpen(true)}
            onPrint={handlePrint}
            onSignOut={onSignOut}
          />
        </div>
      </header>

      {doc && file && pageScreen === "split" ? (
        <SplitScreen
          doc={doc}
          pageCount={pageCount}
          fileName={file.name}
          buildBytes={buildCurrent}
          hasEdits={hasEdits}
          pendingRedactions={redactions.length}
          onBack={closePageScreen}
          onDropFile={(f) => void openFile(f)}
        />
      ) : doc && file && pageScreen === "organize" ? (
        <OrganizeScreen
          doc={doc}
          pageCount={pageCount}
          fileName={file.name}
          buildBytes={buildCurrent}
          hasEdits={hasEdits}
          pendingRedactions={redactions.length}
          onBack={closePageScreen}
          onApply={handleOrganized}
          onDropFile={(f) => void openFile(f)}
        />
      ) : pageScreen === "merge" ? (
        <MergeScreen
          currentFile={doc ? file : null}
          currentDoc={doc}
          buildCurrentBytes={buildCurrent}
          hasEdits={hasEdits}
          pendingRedactions={redactions.length}
          onBack={closePageScreen}
          onOpenResult={handleMergedOpen}
        />
      ) : (
      <>
      {doc && (
        // One fixed-height row under the toolbar. Its content changes with the
        // tool and selection, but its height never does, so the page never moves.
        <div className="context-bar" role="toolbar" aria-label="Tool options">
          {redactMode || redactions.length > 0 ? (
            <>
              <input
                type="text"
                className="redact-terms"
                placeholder="Find words to redact, comma-separated"
                value={redactTerms}
                onChange={(e) => setRedactTerms(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRedactSearch();
                }}
                disabled={redactBusy}
              />
              {redactPatterns.map((p) => (
                <label key={p.id} className="redact-pattern">
                  <input
                    type="checkbox"
                    checked={chosenPatterns.includes(p.id)}
                    onChange={(e) =>
                      setChosenPatterns((prev) =>
                        e.target.checked
                          ? [...prev, p.id]
                          : prev.filter((id) => id !== p.id)
                      )
                    }
                    disabled={redactBusy}
                  />
                  {p.label}
                </label>
              ))}
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleRedactSearch}
                disabled={redactBusy}
              >
                Find and mark
              </button>
              <span className="context-bar-note">
                {redactions.length} marked
                {redactions.length > 0 &&
                  ` (${redactions.filter((r) => r.page === page).length} on this page)`}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setRedactions([])}
                disabled={redactBusy || redactions.length === 0}
              >
                Clear marks
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={handleApplyRedactions}
                disabled={redactBusy || redactions.length === 0}
              >
                {redactBusy ? "Working…" : "Apply redactions"}
              </button>
            </>
          ) : formatTarget && !activeField?.imageDataUrl ? (
            <>
              <TextFormatToolbar
                fontFamily={formatTarget.fontFamily ?? "Helvetica"}
                fontSize={formatTarget.fontSize}
                onFontFamilyChange={(fontFamily) =>
                  updateFormatTarget({ fontFamily, fontSizeLocked: true })
                }
                onFontSizeChange={(fontSize) =>
                  updateFormatTarget({ fontSize, fontSizeLocked: true })
                }
                onFitToBox={fitFormatTargetToBox}
              />
              {activeField && (
                <FieldBackgroundToggle
                  coverUnderlying={activeField.coverUnderlying ?? false}
                  onChange={(coverUnderlying) =>
                    updateActiveField({ coverUnderlying })
                  }
                />
              )}
              {activeField && editingFieldId !== activeField.id && (
                <span className="context-bar-note">
                  Double-click the box to type in it.
                </span>
              )}
            </>
          ) : (
            <span className="context-bar-note">
              {!pageReady
                ? "Page is loading…"
                : drawMode
                  ? "Click to place a field, or drag to draw a box. To hide content for good, use Redact instead."
                  : editTextMode
                    ? "Drag over the text to change. Gold boxes: double-click to type, drag or use arrow keys to move."
                    : copyTextMode
                      ? "Drag a box around what to copy, then click Paste."
                      : pasteTextMode && copiedClip
                        ? "Click to place the copied region, or drag to size it."
                        : "Select a field or text edit to change its font and background."}
            </span>
          )}
          {(fieldCount > 0 || modifiedTextCount > 0) && (
            <span className="field-count">
              {modifiedTextCount > 0 &&
                `${modifiedTextCount} text edit${modifiedTextCount !== 1 ? "s" : ""}`}
              {modifiedTextCount > 0 && fieldCount > 0 && " · "}
              {fieldCount > 0 &&
                `${fieldCount} field${fieldCount !== 1 ? "s" : ""}`}
            </span>
          )}
        </div>
      )}

      <main
        className={`workspace ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {(error || exportStatus) && (
          <div className="banner-stack">
            {error ? (
              <div className="banner banner-error" role="alert">
                {error}
                <button
                  type="button"
                  className="banner-close"
                  aria-label="Dismiss"
                  onClick={() => setError(null)}
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="banner banner-info" role="status">
                {exportStatus}
                <button
                  type="button"
                  className="banner-close"
                  aria-label="Dismiss"
                  onClick={() => setExportStatus(null)}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}
        {!doc ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden>
              PDF
            </div>
            <h2>Open a PDF or image to get started</h2>
            <p>Drag and drop a PDF, JPG, or PNG here, or choose one.</p>
            <div className="empty-actions">
              <label className="btn btn-primary">
                From this computer…
                <input
                  type="file"
                  accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
                  hidden
                  onChange={onFileInput}
                />
              </label>
              <button type="button" className="btn btn-primary" onClick={() => setDrivePickerOpen(true)}>
                From Google Drive…
              </button>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => openPageScreen("merge")}
            >
              Merge several files…
            </button>
            <p className="hint">
              JPG and PNG are converted to a one-page PDF automatically. Use{" "}
              <strong>Redact</strong> to permanently remove content, or{" "}
              <strong>Draw field</strong> to add text.
            </p>
          </div>
        ) : (
          <div className="viewer-scroll">
            <PdfViewer
              doc={doc}
              page={page}
              scale={scale}
              fields={fields}
              textEdits={textEdits}
              drawMode={drawMode}
              editTextMode={editTextMode}
              copyTextMode={copyTextMode}
              pasteTextMode={pasteTextMode}
              redactMode={redactMode}
              redactions={redactions}
              onRedactionsChange={setRedactions}
              copiedClip={copiedClip}
              activeFieldId={activeFieldId}
              editingFieldId={editingFieldId}
              activeTextEditId={activeTextEditId}
              editingTextEditId={editingTextEditId}
              onFieldsChange={setFields}
              onTextEditsChange={setTextEdits}
              onActiveFieldChange={setActiveFieldId}
              onEditingFieldChange={setEditingFieldId}
              onActiveTextEditChange={setActiveTextEditId}
              onEditingTextEditChange={setEditingTextEditId}
              onTextCopied={handleTextCopied}
              onToolUsed={handleToolUsed}
              defaultFieldCover={defaultFieldCover}
              onPageLayout={setPageLayout}
              onPageReady={setPageReady}
            />
          </div>
        )}
      </main>
      </>
      )}

      {saveDriveOpen && file && (
        <DrivePicker
          mode="folder"
          saveNote={
            exportFormat === "pdf"
              ? annotatedPdfName(file, fields, textEdits)
              : EXPORT_FORMATS.find((f) => f.id === exportFormat)?.label
          }
          onClose={() => setSaveDriveOpen(false)}
          onPickFolder={(folder) => {
            setSaveDriveOpen(false);
            void handleExport(folder);
          }}
        />
      )}

      {drivePickerOpen && (
        <DrivePicker
          onClose={() => setDrivePickerOpen(false)}
          onPick={(picked) => {
            setDrivePickerOpen(false);
            if (picked[0]) void openFile(picked[0]);
          }}
        />
      )}

      {closeDialogOpen && (
        <CloseFileDialog
          fileName={file?.name ?? "this file"}
          fieldCount={fieldCount}
          editCount={modifiedTextCount}
          redactionCount={redactions.length}
          redactionsApplied={fileChangedSinceSave}
          saving={closing}
          onSaveAndClose={handleSaveAndClose}
          onCloseWithoutSaving={closeDocument}
          onCancel={() => setCloseDialogOpen(false)}
        />
      )}
    </div>
  );
}
