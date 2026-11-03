export type TextFontFamily = "Helvetica" | "Times-Roman" | "Courier";

export type FormField = {
  id: string;
  page: number;
  /** Left edge, 0–1 relative to page width */
  x: number;
  /** Top edge, 0–1 relative to page height */
  y: number;
  width: number;
  height: number;
  text: string;
  fontFamily: TextFontFamily;
  /** Font size in PDF points */
  fontSize: number;
  /** When false, font size auto-fits the box as text or size changes */
  fontSizeLocked: boolean;
  /** When true, a white background covers underlying PDF content (redact-style). */
  coverUnderlying: boolean;
  /** When true, resizing scales fontSize with the box (copied/pasted text). */
  scaleFontWithBox: boolean;
  /** Raster image pasted from a copied region. */
  imageDataUrl?: string;
};

/** Visual snapshot captured from a PDF region for copy/paste. */
export type CopiedTextClip = {
  imageDataUrl: string;
  /** Normalized width/height of the source selection. */
  width: number;
  height: number;
  coverUnderlying: boolean;
  /** Optional extracted text for the system clipboard. */
  text?: string;
};

export type TextEdit = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  originalText: string;
  text: string;
  /** Font size in PDF points */
  fontSize: number;
  fontFamily: TextFontFamily;
  fontSizeLocked: boolean;
  /** Distance between lines as a multiple of fontSize, taken from the original. */
  lineHeight?: number;
  /** Where the box was before the user moved it; the original text there stays covered. */
  origin?: { x: number; y: number; width: number; height: number };
};

export type ViewportSize = {
  width: number;
  height: number;
};

export function createFieldId(): string {
  return `field-${crypto.randomUUID().slice(0, 8)}`;
}

export function createTextEditId(): string {
  return `text-${crypto.randomUUID().slice(0, 8)}`;
}

export function fieldToPixels(
  field: FormField | TextEdit,
  viewport: ViewportSize
): { left: number; top: number; width: number; height: number } {
  return {
    left: field.x * viewport.width,
    top: field.y * viewport.height,
    width: field.width * viewport.width,
    height: field.height * viewport.height,
  };
}

export function pixelsToField(
  page: number,
  left: number,
  top: number,
  width: number,
  height: number,
  viewport: ViewportSize,
  options?: {
    fontFamily?: TextFontFamily;
    fontSize?: number;
    coverUnderlying?: boolean;
    text?: string;
    scaleFontWithBox?: boolean;
    fontSizeLocked?: boolean;
    imageDataUrl?: string;
  }
): FormField {
  return {
    id: createFieldId(),
    page,
    x: left / viewport.width,
    y: top / viewport.height,
    width: width / viewport.width,
    height: height / viewport.height,
    text: options?.text ?? "",
    fontFamily: options?.fontFamily ?? "Helvetica",
    fontSize: options?.fontSize ?? 12,
    fontSizeLocked: options?.fontSizeLocked ?? false,
    coverUnderlying: options?.coverUnderlying ?? false,
    scaleFontWithBox: options?.scaleFontWithBox ?? false,
    imageDataUrl: options?.imageDataUrl,
  };
}

export function isImageField(field: FormField): boolean {
  return Boolean(field.imageDataUrl);
}

export function isTextMoved(edit: TextEdit): boolean {
  return (
    !!edit.origin &&
    (Math.abs(edit.origin.x - edit.x) > 1e-6 || Math.abs(edit.origin.y - edit.y) > 1e-6)
  );
}

export function isTextModified(edit: TextEdit): boolean {
  if (isTextMoved(edit)) return true;
  if (!edit.originalText) return edit.text.trim().length > 0;
  return edit.text.trim() !== edit.originalText.trim();
}

/** Move a text-edit box, remembering where it started so the original text stays covered. */
export function moveTextEdit(edit: TextEdit, x: number, y: number): TextEdit {
  const origin = edit.origin ?? {
    x: edit.x,
    y: edit.y,
    width: edit.width,
    height: edit.height,
  };
  return {
    ...edit,
    origin,
    x: Math.max(0, Math.min(1 - edit.width, x)),
    y: Math.max(0, Math.min(1 - edit.height, y)),
  };
}

/** True when annotations would produce changes in a saved/exported PDF. */
export function hasUnsavedChanges(
  fields: FormField[],
  textEdits: TextEdit[]
): boolean {
  return (
    fields.some(
      (f) =>
        f.text.trim().length > 0 || Boolean(f.imageDataUrl) || f.coverUnderlying
    ) || textEdits.some((e) => isTextModified(e))
  );
}

export function hasPageAnnotations(
  page: number,
  fields: FormField[],
  textEdits: TextEdit[]
): boolean {
  return (
    fields.some((f) => f.page === page) ||
    textEdits.some((t) => t.page === page)
  );
}

export function hasUnsavedChangesOnPage(
  page: number,
  fields: FormField[],
  textEdits: TextEdit[]
): boolean {
  return hasUnsavedChanges(
    fields.filter((f) => f.page === page),
    textEdits.filter((t) => t.page === page)
  );
}

/** An area marked for permanent removal; nothing is removed until it is applied. */
export type RedactRegion = {
  id: string;
  /** 1-based page number, like fields */
  page: number;
  /** Left/top/size as 0–1 of the visible page */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text that search-and-redact matched, shown as a tooltip. */
  text?: string;
};

export function createRedactId(): string {
  return `redact-${crypto.randomUUID().slice(0, 8)}`;
}
