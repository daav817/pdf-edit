import { StandardFonts } from "pdf-lib";
import type { TextFontFamily } from "./types";

export const FONT_OPTIONS: { id: TextFontFamily; label: string }[] = [
  { id: "Helvetica", label: "Helvetica" },
  { id: "Times-Roman", label: "Times" },
  { id: "Courier", label: "Courier" },
];

export function cssFontFamily(family: TextFontFamily): string {
  switch (family) {
    case "Times-Roman":
      return '"Times New Roman", Times, serif';
    case "Courier":
      return '"Courier New", Courier, monospace';
    default:
      return "Helvetica, Arial, sans-serif";
  }
}

const metricsCache = new Map<TextFontFamily, { ascent: number; descent: number }>();

/** The browser font's ascent and descent, as fractions of the font size. */
function fontMetrics(family: TextFontFamily): { ascent: number; descent: number } {
  const cached = metricsCache.get(family);
  if (cached) return cached;
  let metrics = { ascent: 0.905, descent: 0.212 };
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx) {
    ctx.font = `100px ${cssFontFamily(family)}`;
    const m = ctx.measureText("Hg");
    if (m.fontBoundingBoxAscent > 0) {
      metrics = {
        ascent: m.fontBoundingBoxAscent / 100,
        descent: m.fontBoundingBoxDescent / 100,
      };
    }
  }
  metricsCache.set(family, metrics);
  return metrics;
}

/** Saved files put a text edit's first baseline this many font sizes below the box top. */
export const FIRST_BASELINE_EM = 1.05;

/**
 * How far (in font sizes) to shift a text box's first CSS line so its baseline
 * lands where Save draws it. CSS centers glyphs inside each line, so the
 * shift depends on the line spacing.
 */
export function firstLineOffsetEm(family: TextFontFamily, lineHeight: number): number {
  const { ascent, descent } = fontMetrics(family);
  return FIRST_BASELINE_EM - ((lineHeight - ascent - descent) / 2 + ascent);
}

export function standardFont(family: TextFontFamily) {
  switch (family) {
    case "Times-Roman":
      return StandardFonts.TimesRoman;
    case "Courier":
      return StandardFonts.Courier;
    default:
      return StandardFonts.Helvetica;
  }
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["Ag"];

  const lines: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = `${line} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

/** Find the largest font size (PDF points) that fits inside a box. */
export function fitFontSizeInBox(
  text: string,
  widthPt: number,
  heightPt: number,
  fontFamily: TextFontFamily,
  lineHeight = 1.25
): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || widthPt <= 4 || heightPt <= 4) return 10;

  const sample = text.trim() || "Ag";
  const cssFamily = cssFontFamily(fontFamily);
  const pad = 4;
  let lo = 4;
  let hi = Math.min(heightPt * 0.92, 96);
  let best = 8;

  while (lo <= hi) {
    const mid = (lo + hi) / 2;
    ctx.font = `${mid}pt ${cssFamily}`;
    const lines = wrapLines(ctx, sample, widthPt - pad);
    const totalHeight = lines.length * mid * lineHeight;
    const fitsWidth = lines.every((line) => ctx.measureText(line).width <= widthPt - pad);
    if (totalHeight <= heightPt - pad && fitsWidth) {
      best = mid;
      lo = mid + 0.25;
    } else {
      hi = mid - 0.25;
    }
  }

  return Math.max(4, Math.round(best * 10) / 10);
}

export function boxDimensionsPt(
  widthNorm: number,
  heightNorm: number,
  pageWidthPt: number,
  pageHeightPt: number
): { widthPt: number; heightPt: number } {
  return {
    widthPt: widthNorm * pageWidthPt,
    heightPt: heightNorm * pageHeightPt,
  };
}

export function fontSizeCssPx(
  fontSizePt: number,
  viewportHeightPx: number,
  pageHeightPt: number
): number {
  if (pageHeightPt <= 0) return fontSizePt;
  return fontSizePt * (viewportHeightPx / pageHeightPt);
}