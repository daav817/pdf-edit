import * as pdfjs from "pdfjs-dist";
import type { PdfDocument } from "./pdf";
import type { TextEdit, ViewportSize } from "./types";
import { createTextEditId } from "./types";

const LINE_Y_THRESHOLD = 0.012;

export type PageTextItem = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  /** Baseline position from the top of the page, in PDF points. */
  baseline: number;
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function itemToRaw(page: pdfjs.PDFPageProxy, item: PdfTextItem): PageTextItem | null {
  if (!item.str.trim()) return null;

  const vp = page.getViewport({ scale: 1 });
  const fontSize = Math.hypot(item.transform[0], item.transform[1]);
  const [vx, vyBaseline] = vp.convertToViewportPoint(
    item.transform[4],
    item.transform[5]
  );

  // PDF.js already reports width in page units (font size applied).
  const textWidth = Math.abs(item.width);
  // Cover the whole line: ascenders above the baseline and descenders below it.
  const textHeight = fontSize * 1.35;
  const top = vyBaseline - fontSize * 1.05;

  return {
    text: item.str,
    x: clamp01(vx / vp.width),
    y: clamp01(top / vp.height),
    width: clamp01(textWidth / vp.width),
    height: clamp01(textHeight / vp.height),
    fontSize,
    baseline: vyBaseline,
  };
}

/** Skip underline rules and other non-editable noise. */
export function isJunkTextItem(item: PageTextItem): boolean {
  const t = item.text.trim();
  if (!t) return true;
  if (/^[_\-.=\u2014~\s]{3,}$/.test(t)) return true;
  if (item.width > 0.88 && item.height < 0.025) return true;
  if (t.length > 40 && /^[_\-.=\s]+$/.test(t.replace(/\s/g, ""))) return true;
  return false;
}

export async function extractPageTextItems(
  doc: PdfDocument,
  pageNum: number
): Promise<PageTextItem[]> {
  const page = await doc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const items: PageTextItem[] = [];

  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    const converted = itemToRaw(page, item as PdfTextItem);
    if (!converted || isJunkTextItem(converted)) continue;
    items.push(converted);
  }

  return items;
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Merge PDF text items that fall inside a normalized selection rectangle. */
export function textEditFromSelection(
  items: PageTextItem[],
  rect: { x: number; y: number; width: number; height: number }
): Omit<TextEdit, "id" | "page"> | null {
  const hits = items.filter((item) => rectsIntersect(item, rect));
  if (hits.length === 0) return null;
  return mergeItems(hits);
}

/**
 * Like textEditFromSelection, but one box per block of text: a change in font
 * size or a wide vertical gap starts a new block, so a heading caught along
 * with a paragraph keeps its own size and position.
 */
export function textEditsFromSelection(
  items: PageTextItem[],
  rect: { x: number; y: number; width: number; height: number }
): Omit<TextEdit, "id" | "page">[] {
  const hits = items.filter((item) => rectsIntersect(item, rect));
  if (hits.length === 0) return [];
  return splitIntoBlocks(groupIntoLines(hits)).map(mergeLines);
}

function lineFontSize(line: PageTextItem[]): number {
  return line.reduce((max, i) => Math.max(max, i.fontSize), 0);
}

function splitIntoBlocks(lines: PageTextItem[][]): PageTextItem[][][] {
  const blocks: PageTextItem[][][] = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    const prevSize = lineFontSize(prev);
    const curSize = lineFontSize(cur);
    const biggest = Math.max(prevSize, curSize);
    const sameSize = Math.abs(prevSize - curSize) <= biggest * 0.15;
    const gap = cur[0].baseline - prev[0].baseline;
    if (sameSize && gap <= biggest * 2.2) {
      blocks[blocks.length - 1].push(cur);
    } else {
      blocks.push([cur]);
    }
  }
  return blocks;
}

const DEFAULT_LINE_HEIGHT = 1.15;

/** Line spacing of the original text, as a multiple of the font size. */
function lineHeightOf(lines: PageTextItem[][], fontSize: number): number {
  if (lines.length < 2 || fontSize <= 0) return DEFAULT_LINE_HEIGHT;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(lines[i][0].baseline - lines[i - 1][0].baseline);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.min(3, Math.max(1, median / fontSize));
}

/** Text of one line, keeping wide gaps between pieces (e.g. columns) as extra spaces. */
function lineText(line: PageTextItem[]): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const item = line[i];
    if (i > 0) {
      const prev = line[i - 1];
      const gap = item.x - (prev.x + prev.width);
      // Roughly how many space characters would fill the gap (a space is
      // about half an average character in common fonts).
      const spaceWidth = (prev.width / Math.max(prev.text.length, 1)) * 0.55;
      const spaces = Math.max(1, Math.min(12, Math.round(gap / spaceWidth)));
      out += /\s$/.test(out) || /^\s/.test(item.text) ? "" : " ".repeat(spaces);
    }
    out += item.text;
  }
  return out.replace(/\s+$/, "");
}

/** Average width of a space in this line, in normalized page units. */
function spaceWidthOf(line: PageTextItem[]): number {
  const chars = line.reduce((n, i) => n + i.text.length, 0);
  const width = line.reduce((w, i) => w + i.width, 0);
  return (width / Math.max(chars, 1)) * 0.55;
}

function mergeItems(hits: PageTextItem[]): Omit<TextEdit, "id" | "page"> {
  return mergeLines(groupIntoLines(hits));
}

function mergeLines(lines: PageTextItem[][]): Omit<TextEdit, "id" | "page"> {
  const hits = lines.flat();
  const x = Math.min(...hits.map((i) => i.x));
  const y = Math.min(...hits.map((i) => i.y));
  // A little slack: screen fonts run slightly wider than the PDF's own.
  const right = Math.max(...hits.map((i) => i.x + i.width * 1.06));
  const bottom = Math.max(...hits.map((i) => i.y + i.height));
  // One line of text per original line, so the box reads like the page.
  // Indented lines keep their indent as leading spaces.
  const text = lines
    .map((line) => {
      const indent = line[0].x - x;
      const spaces = Math.min(40, Math.round(indent / spaceWidthOf(line)));
      return " ".repeat(Math.max(0, spaces)) + lineText(line);
    })
    .join("\n");
  const fontSize = hits.reduce((max, i) => Math.max(max, i.fontSize), 0) || 12;

  // Tall enough to show every line at the original spacing without scrolling.
  const lineHeight = lineHeightOf(lines, fontSize);
  const fontSizeNorm = Math.max(...hits.map((i) => i.height)) / 1.35;
  const neededHeight = (lines.length * lineHeight + 0.25) * fontSizeNorm;

  return {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(Math.max(right - x, 0.02)),
    height: clamp01(Math.max(bottom - y, neededHeight, 0.012)),
    originalText: text,
    text,
    fontSize,
    fontFamily: "Helvetica",
    // Keep the original size while typing; "Fit to box" can still shrink it.
    fontSizeLocked: true,
    lineHeight,
  };
}

/** Select the text item nearest a normalized point (for click-to-edit). */
export function textEditAtPoint(
  items: PageTextItem[],
  nx: number,
  ny: number
): Omit<TextEdit, "id" | "page"> | null {
  let best: PageTextItem | null = null;
  let bestDist = Infinity;

  for (const item of items) {
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const inside =
      nx >= item.x &&
      nx <= item.x + item.width &&
      ny >= item.y &&
      ny <= item.y + item.height;
    const dist = (cx - nx) ** 2 + (cy - ny) ** 2;
    if (inside || dist < bestDist) {
      if (inside || dist < bestDist) {
        best = item;
        bestDist = inside ? 0 : dist;
      }
    }
  }

  return best ? mergeItems([best]) : null;
}

function groupIntoLines(items: PageTextItem[]): PageTextItem[][] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PageTextItem[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const lastLine = lines[lines.length - 1];
    const ref = lastLine[0];
    const threshold = Math.max(LINE_Y_THRESHOLD, ref.height * 0.6);
    if (Math.abs(item.y - ref.y) <= threshold) {
      lastLine.push(item);
    } else {
      lines.push([item]);
    }
  }

  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
  }

  return lines;
}

function mergeLine(line: PageTextItem[]): Omit<TextEdit, "id" | "page"> {
  const x = Math.min(...line.map((i) => i.x));
  const y = Math.min(...line.map((i) => i.y));
  const right = Math.max(...line.map((i) => i.x + i.width));
  const bottom = Math.max(...line.map((i) => i.y + i.height));
  const text = line.map((i) => i.text).join(" ").replace(/\s+/g, " ").trim();
  const fontSize = line.reduce((max, i) => Math.max(max, i.fontSize), 0);

  return {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(Math.max(right - x, 0.03)),
    height: clamp01(Math.max(bottom - y, 0.015)),
    originalText: text,
    text,
    fontSize,
    fontFamily: "Helvetica",
    fontSizeLocked: true,
  };
}

/** Legacy line-based extraction. */
export async function extractPageTextEdits(
  doc: PdfDocument,
  pageNum: number
): Promise<TextEdit[]> {
  const items = await extractPageTextItems(doc, pageNum);
  return groupIntoLines(items)
    .filter((line) => {
      const merged = mergeLine(line);
      return merged.text.trim().length > 0 && !isJunkTextItem({ ...merged, baseline: 0 });
    })
    .map((line) => ({
      id: createTextEditId(),
      page: pageNum,
      ...mergeLine(line),
    }));
}

export function pixelRectToNormalized(
  rect: { x: number; y: number; width: number; height: number },
  viewport: ViewportSize
) {
  return {
    x: rect.x / viewport.width,
    y: rect.y / viewport.height,
    width: rect.width / viewport.width,
    height: rect.height / viewport.height,
  };
}
