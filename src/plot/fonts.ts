/**
 * Font set of the plot engine: STIX Two Text (regular, italic, bold) for text and STIX Two Math for
 * symbols the text faces lack (≈, ∝, ∞, ∂, ∇, ⟨⟩, arrows, …). All text layout — label widths,
 * alignment, legend boxes — uses the advance widths of these TrueType files (hmtx), so the SVG and
 * PDF back ends place text identically; the PDF back end embeds subsets of the same files.
 *
 * Fonts: STIX Two 2.13 (STI Pub Companies, SIL Open Font License 1.1), assets/fonts/stix-two.
 * Loading goes through an injectable {@link FontProvider}: the Node CLI reads the files with fs
 * (fontsNode.ts), the browser export fetches them lazily via Vite asset URLs (exportFigures.ts).
 */
import { TrueTypeFont, parseTTF } from './ttf';
import { Run, runsWidth } from './mathtext';

export type FontKey = 'roman' | 'italic' | 'bold' | 'math';
export const FONT_KEYS: readonly FontKey[] = ['roman', 'italic', 'bold', 'math'];
export const FONT_FILES: Readonly<Record<FontKey, string>> = {
  roman: 'STIXTwoText-Regular.ttf', italic: 'STIXTwoText-Italic.ttf', bold: 'STIXTwoText-Bold.ttf', math: 'STIXTwoMath-Regular.ttf',
};
/** CSS font stack written into SVG text (text stays text; viewers without STIX Two fall back to Times) */
export const SVG_FONT_FAMILY = "'STIX Two Text', 'STIX Two Math', 'Times New Roman', serif";

/** Resolves a font file name to its bytes (sync or async). */
export type FontProvider = (file: string, key: FontKey) => Uint8Array | Promise<Uint8Array>;

export interface ResolvedGlyph {
  /** face that actually holds the glyph (may differ from the requested key: fallback to STIX Two Math) */
  face: FontKey;
  /** glyph index in that face */
  gid: number;
  /** code point drawn ('?' when no face has the character) */
  cp: number;
  /** advance width, em */
  w: number;
}

/** Vertical metrics (em, y up; descender positive downwards) used for text box alignment. */
export interface FontMetrics {
  capHeight: number;
  xHeight: number;
  ascender: number;
  descender: number;
  /** baseline offsets for 'top' / 'middle' / 'bottom' text alignment, em below the anchor (y down) */
  top: number;
  middle: number;
  bottom: number;
}

const QUESTION = 0x3f;

export class FontSet {
  readonly metrics: FontMetrics;
  /** set when a character needed a face that is not loaded (e.g. the math face was omitted) */
  missingFace = false;
  private readonly cache = new Map<string, ResolvedGlyph>();

  constructor(readonly faces: Readonly<Partial<Record<FontKey, TrueTypeFont>>>) {
    const r = faces.roman;
    if (!r) throw new Error('FontSet: the roman face is required');
    const em = r.unitsPerEm;
    const pBox = r.glyphBounds(r.glyphId(0x70)); // 'p' descender
    const dBox = r.glyphBounds(r.glyphId(0x64)); // 'd' ascender
    const cap = r.capHeight / em, xh = r.xHeight / em;
    const desc = pBox ? -pBox.yMin / em : -r.descender / em;
    const asc = dBox ? dBox.yMax / em : r.ascender / em;
    this.metrics = { capHeight: cap, xHeight: xh, ascender: asc, descender: desc, top: Math.max(asc, cap + 0.06), middle: cap / 2, bottom: -desc };
  }

  has(key: FontKey): boolean { return !!this.faces[key]; }

  /** Face search order for a requested style: the style itself, then the text roman, then STIX Two Math. */
  private order(key: FontKey): FontKey[] {
    return key === 'math' ? ['math', 'roman'] : key === 'roman' ? ['roman', 'math'] : [key, 'roman', 'math'];
  }

  /** Glyph for one character (a single code point) in the requested style, with fallbacks. */
  glyph(ch: string, key: FontKey): ResolvedGlyph {
    const cp = ch.codePointAt(0) ?? QUESTION;
    const ck = `${key}:${cp}`;
    const hit = this.cache.get(ck);
    if (hit) return hit;
    let res: ResolvedGlyph | null = null;
    for (const k of this.order(key)) {
      const f = this.faces[k];
      if (!f) { if (k === 'math') this.missingFace = true; continue; }
      const gid = f.glyphId(cp);
      if (gid > 0) { res = { face: k, gid, cp, w: f.advance(gid) / f.unitsPerEm }; break; }
    }
    if (!res) {
      const k = this.faces[key] ? key : 'roman';
      const f = this.faces[k]!;
      const gid = f.glyphId(QUESTION);
      res = { face: k, gid, cp: QUESTION, w: f.advance(gid) / f.unitsPerEm };
    }
    this.cache.set(ck, res);
    return res;
  }

  /** Advance width of a string, em */
  width(text: string, key: FontKey): number {
    let w = 0;
    for (const ch of text) w += this.glyph(ch, key).w;
    return w;
  }

  /** Highest glyph top of a string above the baseline, em (0 for blanks) */
  height(text: string, key: FontKey): number {
    let h = 0;
    for (const ch of text) {
      const g = this.glyph(ch, key);
      const f = this.faces[g.face]!;
      const b = f.glyphBounds(g.gid);
      if (b) h = Math.max(h, b.yMax / f.unitsPerEm);
    }
    return h;
  }

  /** Total advance of mathtext runs at a base font size (pt), including pen moves and rules */
  runsWidth(runs: readonly Run[], size: number): number { return runsWidth(runs, size, this); }

  /** Builds a font set from raw TTF bytes (faces not given are simply unavailable). */
  static fromBytes(bytes: Partial<Record<FontKey, Uint8Array>>): FontSet {
    const faces: Partial<Record<FontKey, TrueTypeFont>> = {};
    for (const k of FONT_KEYS) { const b = bytes[k]; if (b) faces[k] = parseTTF(b); }
    return new FontSet(faces);
  }
}

/** Loads the given faces through a provider (default: all four STIX Two faces). */
export async function loadFontSet(provider: FontProvider, keys: readonly FontKey[] = FONT_KEYS): Promise<FontSet> {
  const bytes: Partial<Record<FontKey, Uint8Array>> = {};
  await Promise.all(keys.map(async (k) => { bytes[k] = await provider(FONT_FILES[k], k); }));
  return FontSet.fromBytes(bytes);
}
