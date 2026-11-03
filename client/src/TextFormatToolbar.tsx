import type { TextFontFamily } from "./types";
import { FONT_OPTIONS } from "./textStyle";

type Props = {
  fontFamily: TextFontFamily;
  fontSize: number;
  onFontFamilyChange: (family: TextFontFamily) => void;
  onFontSizeChange: (size: number) => void;
  onFitToBox: () => void;
};

export function TextFormatToolbar({
  fontFamily,
  fontSize,
  onFontFamilyChange,
  onFontSizeChange,
  onFitToBox,
}: Props) {
  return (
    <div className="text-format-toolbar" role="group" aria-label="Text formatting">
      <label className="text-format-label">
        Font
        <select
          className="text-format-select"
          value={fontFamily}
          onChange={(e) => onFontFamilyChange(e.target.value as TextFontFamily)}
        >
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-format-label">
        Size
        <input
          type="number"
          className="text-format-size"
          min={4}
          max={144}
          step={0.5}
          value={Math.round(fontSize * 10) / 10}
          onChange={(e) => {
            const n = Number.parseFloat(e.target.value);
            if (Number.isFinite(n) && n > 0) onFontSizeChange(n);
          }}
        />
      </label>
      <button type="button" className="btn btn-sm" onClick={onFitToBox}>
        Fit to box
      </button>
    </div>
  );
}
