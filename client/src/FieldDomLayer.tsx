import { useEffect, useRef } from "react";
import { ResizableField } from "./ResizableField";
import {
  boxDimensionsPt,
  cssFontFamily,
  firstLineOffsetEm,
  fitFontSizeInBox,
  fontSizeCssPx,
} from "./textStyle";
import {
  type FormField,
  type TextEdit,
  type ViewportSize,
  fieldToPixels,
  isTextMoved,
  moveTextEdit,
} from "./types";

/** A press that moves less than this is a click, not a drag. */
const MOVE_THRESHOLD_PX = 3;

type Props = {
  page: number;
  viewport: ViewportSize;
  pageHeightPt: number;
  fields: FormField[];
  textEdits: TextEdit[];
  editTextMode: boolean;
  activeFieldId: string | null;
  editingFieldId: string | null;
  activeTextEditId: string | null;
  editingTextEditId: string | null;
  visible: boolean;
  onFieldsChange: (fields: FormField[]) => void;
  onTextEditsChange: (edits: TextEdit[]) => void;
  onActiveFieldChange: (id: string | null) => void;
  onEditingFieldChange: (id: string | null) => void;
  onActiveTextEditChange: (id: string | null) => void;
  onEditingTextEditChange: (id: string | null) => void;
};

function applyAutoFontSizeToEdit(
  edit: TextEdit,
  pageWidthPt: number,
  pageHeightPt: number
): TextEdit {
  if (edit.fontSizeLocked) return edit;
  const { widthPt, heightPt } = boxDimensionsPt(
    edit.width,
    edit.height,
    pageWidthPt,
    pageHeightPt
  );
  return {
    ...edit,
    fontSize: fitFontSizeInBox(edit.text, widthPt, heightPt, edit.fontFamily),
  };
}

export function FieldDomLayer({
  page,
  viewport,
  pageHeightPt,
  fields,
  textEdits,
  editTextMode,
  activeFieldId,
  editingFieldId,
  activeTextEditId,
  editingTextEditId,
  visible,
  onFieldsChange,
  onTextEditsChange,
  onActiveFieldChange,
  onEditingFieldChange,
  onActiveTextEditChange,
  onEditingTextEditChange,
}: Props) {
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  // A box that just became editable (e.g. right after selecting text) gets the caret.
  useEffect(() => {
    if (!editingTextEditId) return;
    const el = inputRefs.current.get(editingTextEditId);
    if (!el || document.activeElement === el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingTextEditId]);

  if (!visible || viewport.width === 0) return null;

  const pageWidthPt =
    pageHeightPt > 0
      ? (viewport.width / viewport.height) * pageHeightPt
      : viewport.width;

  const updateField = (updated: FormField) => {
    onFieldsChange(fields.map((f) => (f.id === updated.id ? updated : f)));
  };

  const deleteField = (id: string) => {
    onFieldsChange(fields.filter((f) => f.id !== id));
    if (activeFieldId === id) onActiveFieldChange(null);
    if (editingFieldId === id) onEditingFieldChange(null);
  };

  const updateTextEdit = (id: string, patch: Partial<TextEdit>) => {
    onTextEditsChange(
      textEdits.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        return applyAutoFontSizeToEdit(next, pageWidthPt, pageHeightPt);
      })
    );
  };

  const deleteTextEdit = (id: string) => {
    onTextEditsChange(textEdits.filter((t) => t.id !== id));
    if (activeTextEditId === id) onActiveTextEditChange(null);
    if (editingTextEditId === id) onEditingTextEditChange(null);
  };

  /** Drag a gold box to a new spot. A press without movement just selects it. */
  const startMove = (edit: TextEdit, e: React.MouseEvent) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const base = textEdits;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
      moved = true;
      onTextEditsChange(
        base.map((t) =>
          t.id === edit.id
            ? moveTextEdit(t, edit.x + dx / viewport.width, edit.y + dy / viewport.height)
            : t
        )
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const pageFields = fields.filter((f) => f.page === page);
  const pageEdits = textEdits.filter((t) => t.page === page);

  return (
    <div
      className={`field-dom-layer${editTextMode ? " edit-mode" : ""}`}
      style={{ width: viewport.width, height: viewport.height }}
    >
      {/* Moved boxes leave a white cover over the original text, as Save does. */}
      {pageEdits.filter(isTextMoved).map((edit) => {
        const cover = fieldToPixels({ ...edit, ...edit.origin! }, viewport);
        return (
          <div
            key={`cover-${edit.id}`}
            className="text-edit-cover"
            style={{
              left: cover.left,
              top: cover.top,
              width: cover.width,
              height: cover.height,
            }}
          />
        );
      })}

      {pageEdits.map((edit) => {
          const rect = fieldToPixels(edit, viewport);
          const isActive = edit.id === activeTextEditId;
          const isEditing = edit.id === editingTextEditId;
          const displayFontSize = fontSizeCssPx(
            edit.fontSize,
            viewport.height,
            pageHeightPt
          );
          const lineHeight = edit.lineHeight ?? 1.15;
          // Put each line's baseline exactly where Save will draw it.
          const textTop =
            firstLineOffsetEm(edit.fontFamily, lineHeight) * displayFontSize;

          return (
            <div
              key={edit.id}
              data-edit-id={edit.id}
              data-tool-passthrough
              className={`text-edit${isActive ? " active" : ""}${isEditing ? " editing" : ""}`}
              title={isEditing ? undefined : "Drag to move. Double-click to edit."}
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
              onMouseDown={(e) => {
                if (isEditing || e.button !== 0) return;
                if (e.detail > 1) return;
                e.stopPropagation();
                e.preventDefault();
                onActiveTextEditChange(edit.id);
                startMove(edit, e);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onActiveTextEditChange(edit.id);
                onEditingTextEditChange(edit.id);
                requestAnimationFrame(() => {
                  const el = inputRefs.current.get(edit.id);
                  if (!el) return;
                  el.focus();
                  // Start typing at the end of the existing text.
                  el.setSelectionRange(el.value.length, el.value.length);
                });
              }}
            >
              <textarea
                ref={(el) => {
                  if (el) inputRefs.current.set(edit.id, el);
                  else inputRefs.current.delete(edit.id);
                }}
                className="text-edit-input"
                wrap="off"
                value={edit.text}
                readOnly={!isEditing}
                style={{
                  fontFamily: cssFontFamily(edit.fontFamily),
                  fontSize: `${displayFontSize}px`,
                  lineHeight,
                  top: textTop,
                  height: `calc(100% - ${textTop}px)`,
                }}
                onChange={(e) => updateTextEdit(edit.id, { text: e.target.value })}
                onFocus={() => {
                  onActiveTextEditChange(edit.id);
                  onEditingTextEditChange(edit.id);
                }}
                onBlur={() => onEditingTextEditChange(null)}
                onMouseDown={(e) => {
                  // While typing, clicks place the caret; otherwise the box handles them.
                  if (isEditing) e.stopPropagation();
                  else e.preventDefault();
                }}
              />
              {isActive && (
                <button
                  type="button"
                  className="text-edit-reset"
                  aria-label="Revert edit"
                  title="Revert to original text"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateTextEdit(edit.id, { text: edit.originalText });
                  }}
                >
                  ↺
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  className="text-edit-delete"
                  aria-label="Remove edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTextEdit(edit.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

      {pageFields.map((field) => (
        <ResizableField
          key={field.id}
          field={field}
          viewport={viewport}
          pageHeightPt={pageHeightPt}
          active={field.id === activeFieldId}
          editing={field.id === editingFieldId}
          onUpdate={updateField}
          onDelete={() => deleteField(field.id)}
          onActivate={() => onActiveFieldChange(field.id)}
          onStartEdit={() => onEditingFieldChange(field.id)}
          onStopEdit={() => {
            if (editingFieldId === field.id) onEditingFieldChange(null);
          }}
        />
      ))}
    </div>
  );
}
