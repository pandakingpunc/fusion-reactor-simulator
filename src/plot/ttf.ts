/**
 * Dependency-free TrueType (glyf outline) font parser and subsetter for PDF embedding.
 *
 * Parsing covers what text layout and PDF embedding need: the table directory, `head`, `hhea`,
 * `maxp`, `hmtx`, `loca`, `glyf` (simple and composite glyph headers), `cmap` (formats 4 and 12),
 * `post`, `OS/2` and `name` (PostScript name). The subsetter keeps the requested glyphs plus the
 * components of composite glyphs (recursively), renumbers them densely (new GID 0 = .notdef), strips
 * TrueType hinting by default (drops `cvt `/`fpgm`/`prep` and per-glyph instructions — outlines are
 * unchanged, and unhinted rendering is what PDF viewers do at print resolution anyway), writes a
 * minimal `cmap` (format 4, plus format 12 for non-BMP code points), `post` format 3, long `loca`, and
 * recomputes every table checksum and `head.checkSumAdjustment`.
 *
 * References: Microsoft OpenType specification 1.9 (https://learn.microsoft.com/typography/opentype/spec/),
 * chapters "The OpenType font file" (table directory, checksums), head, hhea, hmtx, maxp, loca, glyf
 * (composite glyph flags), cmap (formats 4 and 12), post (format 3), OS/2, name; Apple TrueType
 * Reference Manual (https://developer.apple.com/fonts/TrueType-Reference-Manual/), same tables.
 */

export interface TableRecord { tag: string; checksum: number; offset: number; length: number }
export interface BBox { xMin: number; yMin: number; xMax: number; yMax: number }

// composite glyph component flags (glyf)
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

export class TtfError extends Error {
  constructor(message: string) { super(message); this.name = 'TtfError'; }
}

class Reader {
  constructor(readonly b: Uint8Array) {}
  u8(p: number): number { this.check(p, 1); return this.b[p]; }
  u16(p: number): number { this.check(p, 2); return (this.b[p] << 8) | this.b[p + 1]; }
  i16(p: number): number { const v = this.u16(p); return v & 0x8000 ? v - 0x10000 : v; }
  u32(p: number): number { this.check(p, 4); return ((this.b[p] << 24) | (this.b[p + 1] << 16) | (this.b[p + 2] << 8) | this.b[p + 3]) >>> 0; }
  fixed(p: number): number { const hi = this.i16(p), lo = this.u16(p + 2); return hi + lo / 65536; }
  tag(p: number): string { this.check(p, 4); return String.fromCharCode(this.b[p], this.b[p + 1], this.b[p + 2], this.b[p + 3]); }
  private check(p: number, n: number): void { if (p < 0 || p + n > this.b.length) throw new TtfError(`read past end of font data (offset ${p})`); }
}

/** Sum of big-endian 32-bit words over [off, off+len), zero-padded to a multiple of 4, modulo 2^32. */
export function tableChecksum(b: Uint8Array, off: number, len: number): number {
  let sum = 0;
  const end = off + len;
  for (let p = off; p < end; p += 4) {
    const w = ((b[p] << 24) | ((p + 1 < end ? b[p + 1] : 0) << 16) | ((p + 2 < end ? b[p + 2] : 0) << 8) | (p + 3 < end ? b[p + 3] : 0)) >>> 0;
    sum = (sum + w) >>> 0;
  }
  return sum;
}

export class TrueTypeFont {
  readonly tables = new Map<string, TableRecord>();
  readonly unitsPerEm: number;
  readonly indexToLocFormat: number;
  readonly numGlyphs: number;
  readonly numberOfHMetrics: number;
  /** hhea ascender / descender / line gap (font units; descender negative) */
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly bbox: BBox;
  readonly italicAngle: number;
  readonly isFixedPitch: boolean;
  /** OS/2 metrics (font units); capHeight/xHeight fall back to the H / x glyph bounds */
  readonly capHeight: number;
  readonly xHeight: number;
  readonly weightClass: number;
  readonly postScriptName: string;
  private readonly r: Reader;
  private readonly cmap = new Map<number, number>();

  constructor(readonly data: Uint8Array) {
    const r = (this.r = new Reader(data));
    const ver = r.u32(0);
    if (ver !== 0x00010000 && ver !== 0x74727565 /* 'true' */) throw new TtfError(`not a TrueType font (sfnt version 0x${ver.toString(16)})`);
    const n = r.u16(4);
    for (let i = 0; i < n; i++) {
      const p = 12 + 16 * i;
      const rec: TableRecord = { tag: r.tag(p), checksum: r.u32(p + 4), offset: r.u32(p + 8), length: r.u32(p + 12) };
      if (rec.offset + rec.length > data.length) throw new TtfError(`table '${rec.tag}' extends past end of font data`);
      this.tables.set(rec.tag, rec);
    }
    for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf']) if (!this.tables.has(t)) throw new TtfError(`missing required table '${t}'`);
    const head = this.off('head');
    if (r.u32(head + 12) !== 0x5f0f3cf5) throw new TtfError('bad head.magicNumber');
    this.unitsPerEm = r.u16(head + 18);
    this.bbox = { xMin: r.i16(head + 36), yMin: r.i16(head + 38), xMax: r.i16(head + 40), yMax: r.i16(head + 42) };
    this.indexToLocFormat = r.i16(head + 50);
    const hhea = this.off('hhea');
    this.ascender = r.i16(hhea + 4); this.descender = r.i16(hhea + 6); this.lineGap = r.i16(hhea + 8);
    this.numberOfHMetrics = r.u16(hhea + 34);
    this.numGlyphs = r.u16(this.off('maxp') + 4);
    if (this.numberOfHMetrics < 1 || this.numberOfHMetrics > this.numGlyphs) throw new TtfError('bad hhea.numberOfHMetrics');
    const post = this.tables.get('post');
    this.italicAngle = post ? r.fixed(post.offset + 4) : 0;
    this.isFixedPitch = post ? r.u32(post.offset + 12) !== 0 : false;
    this.parseCmap();
    const os2 = this.tables.get('OS/2');
    const osVer = os2 ? r.u16(os2.offset) : -1;
    this.weightClass = os2 ? r.u16(os2.offset + 4) : 400;
    const glyphTop = (cp: number) => { const g = this.glyphId(cp); const b = g ? this.glyphBounds(g) : null; return b ? b.yMax : 0; };
    this.capHeight = os2 && osVer >= 2 && os2.length >= 90 ? r.i16(os2.offset + 88) : glyphTop(0x48);
    this.xHeight = os2 && osVer >= 2 && os2.length >= 88 ? r.i16(os2.offset + 86) : glyphTop(0x78);
    this.postScriptName = this.readPostScriptName() ?? 'Unnamed';
  }

  /** table offset (throws for a missing table) */
  off(tag: string): number {
    const t = this.tables.get(tag);
    if (!t) throw new TtfError(`missing table '${tag}'`);
    return t.offset;
  }
  table(tag: string): Uint8Array | null {
    const t = this.tables.get(tag);
    return t ? this.data.subarray(t.offset, t.offset + t.length) : null;
  }

  /** Glyph index for a Unicode code point (0 = .notdef when unmapped). */
  glyphId(cp: number): number { return this.cmap.get(cp) ?? 0; }
  hasChar(cp: number): boolean { return this.cmap.has(cp) && this.cmap.get(cp)! > 0; }
  /** All (code point → glyph) mappings of the preferred Unicode cmap subtable. */
  get codePoints(): ReadonlyMap<number, number> { return this.cmap; }

  /** Advance width (font units). */
  advance(gid: number): number {
    this.checkGid(gid);
    const h = this.off('hmtx');
    return this.r.u16(h + 4 * Math.min(gid, this.numberOfHMetrics - 1));
  }
  /** Left side bearing (font units). */
  lsb(gid: number): number {
    this.checkGid(gid);
    const h = this.off('hmtx'), n = this.numberOfHMetrics;
    return gid < n ? this.r.i16(h + 4 * gid + 2) : this.r.i16(h + 4 * n + 2 * (gid - n));
  }
  /** Byte range of a glyph in `glyf` (length 0 for an empty glyph such as the space). */
  glyphRange(gid: number): [number, number] {
    this.checkGid(gid);
    const loca = this.off('loca'), glyf = this.tables.get('glyf')!;
    const at = (i: number) => (this.indexToLocFormat === 0 ? this.r.u16(loca + 2 * i) * 2 : this.r.u32(loca + 4 * i));
    const a = at(gid), b = at(gid + 1);
    if (b < a || b > glyf.length) throw new TtfError(`bad loca entry for glyph ${gid}`);
    return [glyf.offset + a, glyf.offset + b];
  }
  glyphData(gid: number): Uint8Array { const [a, b] = this.glyphRange(gid); return this.data.subarray(a, b); }
  glyphBounds(gid: number): BBox | null {
    const [a, b] = this.glyphRange(gid);
    if (b - a < 10) return null;
    return { xMin: this.r.i16(a + 2), yMin: this.r.i16(a + 4), xMax: this.r.i16(a + 6), yMax: this.r.i16(a + 8) };
  }
  isComposite(gid: number): boolean {
    const [a, b] = this.glyphRange(gid);
    return b - a >= 10 && this.r.i16(a) < 0;
  }
  /** Direct component glyph indices of a composite glyph ([] for simple/empty glyphs). */
  components(gid: number): number[] {
    const [a, b] = this.glyphRange(gid);
    if (b - a < 10 || this.r.i16(a) >= 0) return [];
    const out: number[] = [];
    walkComponents(this.data, a + 10, b, (p) => { out.push(this.r.u16(p + 2)); });
    return out;
  }

  private checkGid(gid: number): void {
    if (!Number.isInteger(gid) || gid < 0 || gid >= this.numGlyphs) throw new TtfError(`glyph index ${gid} out of range 0..${this.numGlyphs - 1}`);
  }

  private parseCmap(): void {
    const t = this.tables.get('cmap');
    if (!t) return;
    const r = this.r, base = t.offset;
    const n = r.u16(base + 2);
    let best4 = -1, best12 = -1;
    for (let i = 0; i < n; i++) {
      const p = base + 4 + 8 * i;
      const pid = r.u16(p), eid = r.u16(p + 2), off = base + r.u32(p + 4);
      const fmt = r.u16(off);
      const unicode = pid === 0 || (pid === 3 && (eid === 1 || eid === 10));
      if (!unicode) continue;
      if (fmt === 12 && best12 < 0) best12 = off;
      if (fmt === 4 && best4 < 0) best4 = off;
    }
    if (best12 >= 0) this.parseFormat12(best12);
    else if (best4 >= 0) this.parseFormat4(best4);
  }

  private parseFormat4(p: number): void {
    const r = this.r;
    const segX2 = r.u16(p + 6), seg = segX2 / 2;
    const ends = p + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let i = 0; i < seg; i++) {
      const end = r.u16(ends + 2 * i), start = r.u16(starts + 2 * i), delta = r.i16(deltas + 2 * i);
      const roPos = ranges + 2 * i, ro = r.u16(roPos);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = r.u16(roPos + ro + 2 * (c - start));
          g = gi ? (gi + delta) & 0xffff : 0;
        }
        if (g > 0 && g < this.numGlyphs) this.cmap.set(c, g);
      }
    }
  }

  private parseFormat12(p: number): void {
    const r = this.r;
    const nGroups = r.u32(p + 12);
    for (let i = 0; i < nGroups; i++) {
      const q = p + 16 + 12 * i;
      const s = r.u32(q), e = r.u32(q + 4), g0 = r.u32(q + 8);
      if (e < s || e - s > 0x10ffff) throw new TtfError('bad cmap format 12 group');
      for (let c = s; c <= e; c++) { const g = g0 + (c - s); if (g > 0 && g < this.numGlyphs) this.cmap.set(c, g); }
    }
  }

  private readPostScriptName(): string | null {
    const t = this.tables.get('name');
    if (!t) return null;
    const r = this.r, base = t.offset;
    const count = r.u16(base + 2), strings = base + r.u16(base + 4);
    let mac: string | null = null;
    for (let i = 0; i < count; i++) {
      const p = base + 6 + 12 * i;
      const pid = r.u16(p), eid = r.u16(p + 2), nameId = r.u16(p + 6), len = r.u16(p + 8), off = strings + r.u16(p + 10);
      if (nameId !== 6) continue;
      if (pid === 3 && (eid === 1 || eid === 0)) {
        let s = '';
        for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(r.u16(off + k));
        return sanitizePsName(s);
      }
      if (pid === 1 && mac === null) { let s = ''; for (let k = 0; k < len; k++) s += String.fromCharCode(r.u8(off + k)); mac = sanitizePsName(s); }
    }
    return mac;
  }
}

/** PostScript names: printable ASCII without PDF delimiters or spaces (OpenType name ID 6 rules). */
function sanitizePsName(s: string): string {
  return s.replace(/[^\x21-\x7e]|[\[\](){}<>/%]/g, '');
}

/** Calls `fn(p)` for each component record start offset of a composite glyph; returns the offset after the last record. */
function walkComponents(b: Uint8Array, p: number, end: number, fn: (p: number, flags: number) => void): { end: number; lastFlags: number } {
  let flags = 0;
  do {
    if (p + 4 > end) throw new TtfError('truncated composite glyph');
    flags = (b[p] << 8) | b[p + 1];
    fn(p, flags);
    p += 4 + (flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2);
    if (flags & WE_HAVE_A_SCALE) p += 2;
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) p += 4;
    else if (flags & WE_HAVE_A_TWO_BY_TWO) p += 8;
  } while (flags & MORE_COMPONENTS);
  if (p > end) throw new TtfError('truncated composite glyph');
  return { end: p, lastFlags: flags };
}

export function parseTTF(data: Uint8Array): TrueTypeFont { return new TrueTypeFont(data); }

/** Glyph closure: the requested glyphs, .notdef and all (nested) composite components, sorted. */
export function glyphClosure(font: TrueTypeFont, gids: Iterable<number>): number[] {
  const seen = new Set<number>();
  const stack = [0, ...gids];
  while (stack.length) {
    const g = stack.pop()!;
    if (seen.has(g)) continue;
    seen.add(g);
    for (const c of font.components(g)) if (!seen.has(c)) stack.push(c);
  }
  return [...seen].sort((a, b) => a - b);
}

export interface SubsetOptions {
  /** Unicode code point → ORIGINAL glyph index, written as the subset's cmap (entries whose glyph is not kept are dropped). */
  cmap?: ReadonlyMap<number, number>;
  /** keep TrueType instructions and the cvt/fpgm/prep tables (default false: smaller, unhinted) */
  hinting?: boolean;
}
export interface SubsetResult {
  bytes: Uint8Array;
  /** original glyph index → new glyph index */
  gidMap: Map<number, number>;
  /** new glyph index → original glyph index */
  glyphs: number[];
}

class Writer {
  private buf = new Uint8Array(1024);
  length = 0;
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.length + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.buf.subarray(0, this.length)); this.buf = nb;
  }
  u8(v: number): void { this.ensure(1); this.buf[this.length++] = v & 255; }
  u16(v: number): void { this.ensure(2); this.buf[this.length++] = (v >>> 8) & 255; this.buf[this.length++] = v & 255; }
  i16(v: number): void { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number): void { this.ensure(4); for (const s of [24, 16, 8, 0]) this.buf[this.length++] = (v >>> s) & 255; }
  bytes(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; }
  pad4(): void { while (this.length % 4) this.u8(0); }
  done(): Uint8Array { return this.buf.slice(0, this.length); }
}

function setU16(b: Uint8Array, p: number, v: number): void { b[p] = (v >>> 8) & 255; b[p + 1] = v & 255; }
function setU32(b: Uint8Array, p: number, v: number): void { b[p] = (v >>> 24) & 255; b[p + 1] = (v >>> 16) & 255; b[p + 2] = (v >>> 8) & 255; b[p + 3] = v & 255; }

/** Rewrites one glyph for the subset: remaps composite component indices, optionally strips instructions. */
function subsetGlyph(src: Uint8Array, gidMap: Map<number, number>, hinting: boolean): Uint8Array {
  if (src.length < 10) return new Uint8Array(0);
  const nContours = ((src[0] << 8) | src[1]) << 16 >> 16;
  if (nContours >= 0) {
    if (hinting) return src.slice();
    const lenPos = 10 + 2 * nContours;
    if (lenPos + 2 > src.length) throw new TtfError('truncated simple glyph');
    const il = (src[lenPos] << 8) | src[lenPos + 1];
    const rest = src.subarray(lenPos + 2 + il);
    const out = new Uint8Array(lenPos + 2 + rest.length);
    out.set(src.subarray(0, lenPos), 0);
    out.set(rest, lenPos + 2); // instructionLength = 0
    return out;
  }
  const out = src.slice();
  const recs: number[] = [];
  const { end, lastFlags } = walkComponents(out, 10, out.length, (p) => {
    recs.push(p);
    const old = (out[p + 2] << 8) | out[p + 3];
    const nw = gidMap.get(old);
    if (nw === undefined) throw new TtfError(`composite component ${old} missing from subset`);
    setU16(out, p + 2, nw);
  });
  if (hinting || !(lastFlags & WE_HAVE_INSTRUCTIONS)) return hinting ? out : out.subarray(0, end).slice();
  for (const p of recs) setU16(out, p, ((out[p] << 8) | out[p + 1]) & ~WE_HAVE_INSTRUCTIONS);
  return out.subarray(0, end).slice();
}

/** cmap table: (3,1) format 4 for the BMP, plus (3,10) format 12 when non-BMP code points are present. */
function buildCmap(map: [number, number][]): Uint8Array {
  const bmp = map.filter(([c]) => c < 0xffff).sort((a, b) => a[0] - b[0]);
  const all = [...map].sort((a, b) => a[0] - b[0]);
  const needs12 = all.some(([c]) => c > 0xffff);
  // format 4: one segment per run of consecutive code points with a constant glyph delta
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const [c, g] of bmp) {
    const last = segs[segs.length - 1];
    const delta = (g - c) & 0xffff;
    if (last && last.end === c - 1 && last.delta === delta) last.end = c;
    else segs.push({ start: c, end: c, delta });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const f4 = new Writer();
  const segCount = segs.length;
  const pow = 2 ** Math.floor(Math.log2(segCount));
  f4.u16(4); f4.u16(16 + 8 * segCount); f4.u16(0);
  f4.u16(segCount * 2); f4.u16(pow * 2); f4.u16(Math.log2(pow)); f4.u16(segCount * 2 - pow * 2);
  for (const s of segs) f4.u16(s.end);
  f4.u16(0);
  for (const s of segs) f4.u16(s.start);
  for (const s of segs) f4.u16(s.delta);
  for (const _ of segs) f4.u16(0);
  const sub4 = f4.done();
  let sub12: Uint8Array | null = null;
  if (needs12) {
    const groups: { s: number; e: number; g: number }[] = [];
    for (const [c, g] of all) {
      const last = groups[groups.length - 1];
      if (last && last.e === c - 1 && last.g + (c - last.s) === g) last.e = c;
      else groups.push({ s: c, e: c, g });
    }
    const f12 = new Writer();
    f12.u16(12); f12.u16(0); f12.u32(16 + 12 * groups.length); f12.u32(0); f12.u32(groups.length);
    for (const gr of groups) { f12.u32(gr.s); f12.u32(gr.e); f12.u32(gr.g); }
    sub12 = f12.done();
  }
  const w = new Writer();
  const nSub = sub12 ? 2 : 1;
  w.u16(0); w.u16(nSub);
  const hdr = 4 + 8 * nSub;
  w.u16(3); w.u16(1); w.u32(hdr);
  if (sub12) { w.u16(3); w.u16(10); w.u32(hdr + sub4.length); }
  w.bytes(sub4);
  if (sub12) w.bytes(sub12);
  return w.done();
}

/**
 * Subsets a TrueType font to the given glyphs (original indices). Composite glyph components are
 * added automatically; glyphs are renumbered in ascending original order with .notdef first.
 */
export function subsetTTF(font: TrueTypeFont, gids: Iterable<number>, o: SubsetOptions = {}): SubsetResult {
  const hinting = o.hinting ?? false;
  const glyphs = glyphClosure(font, gids);
  const gidMap = new Map<number, number>(glyphs.map((g, i) => [g, i]));
  const n = glyphs.length;
  // glyf + loca (long offsets, 4-byte aligned glyph records)
  const glyf = new Writer();
  const loca = new Writer();
  for (const g of glyphs) {
    loca.u32(glyf.length);
    glyf.bytes(subsetGlyph(font.glyphData(g), gidMap, hinting));
    glyf.pad4();
  }
  loca.u32(glyf.length);
  // hmtx: full metrics for every glyph
  const hmtx = new Writer();
  for (const g of glyphs) { hmtx.u16(font.advance(g)); hmtx.i16(font.lsb(g)); }
  const head = font.table('head')!.slice();
  setU32(head, 8, 0); // checkSumAdjustment, set below
  setU16(head, 50, 1); // indexToLocFormat: long
  const hhea = font.table('hhea')!.slice();
  setU16(hhea, 34, n);
  const maxp = font.table('maxp')!.slice();
  setU16(maxp, 4, n);
  const tables = new Map<string, Uint8Array>([
    ['head', head], ['hhea', hhea], ['maxp', maxp], ['hmtx', hmtx.done()], ['loca', loca.done()], ['glyf', glyf.done()],
  ]);
  const post = font.table('post');
  if (post && post.length >= 32) { const p = post.slice(0, 32); setU32(p, 0, 0x00030000); tables.set('post', p); }
  const os2 = font.table('OS/2');
  if (os2) tables.set('OS/2', os2.slice());
  if (hinting) for (const t of ['cvt ', 'fpgm', 'prep']) { const d = font.table(t); if (d) tables.set(t, d.slice()); }
  if (o.cmap) {
    const m: [number, number][] = [];
    for (const [cp, g] of o.cmap) { const ng = gidMap.get(g); if (ng !== undefined && ng > 0) m.push([cp, ng]); }
    tables.set('cmap', buildCmap(m));
  }
  const bytes = writeSfnt(tables);
  return { bytes, gidMap, glyphs };
}

/** Serialises an sfnt from tables: directory sorted by tag, 4-byte aligned tables, checksums and head.checkSumAdjustment. */
export function writeSfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const num = tags.length;
  const pow = 2 ** Math.floor(Math.log2(num));
  const w = new Writer();
  w.u32(0x00010000); w.u16(num); w.u16(pow * 16); w.u16(Math.log2(pow)); w.u16(num * 16 - pow * 16);
  let off = 12 + 16 * num;
  const layout: { tag: string; off: number; data: Uint8Array }[] = [];
  for (const tag of tags) {
    const data = tables.get(tag)!;
    layout.push({ tag, off, data });
    off += Math.ceil(data.length / 4) * 4;
  }
  for (const t of layout) {
    for (let i = 0; i < 4; i++) w.u8(t.tag.charCodeAt(i));
    w.u32(tableChecksum(t.data, 0, t.data.length)); w.u32(t.off); w.u32(t.data.length);
  }
  for (const t of layout) { w.bytes(t.data); w.pad4(); }
  const out = w.done();
  const head = layout.find((t) => t.tag === 'head');
  if (head) setU32(out, head.off + 8, (0xb1b0afba - tableChecksum(out, 0, out.length)) >>> 0);
  return out;
}

/**
 * Verifies the table checksums (head with checkSumAdjustment treated as 0) and the whole-font
 * checksum (sum of all words must be 0xB1B0AFBA). Returns the tags that failed.
 */
export function verifyChecksums(bytes: Uint8Array): { ok: boolean; bad: string[]; fontSum: number } {
  const f = new TrueTypeFont(bytes);
  const bad: string[] = [];
  for (const t of f.tables.values()) {
    let sum = tableChecksum(bytes, t.offset, t.length);
    if (t.tag === 'head') {
      const adj = ((bytes[t.offset + 8] << 24) | (bytes[t.offset + 9] << 16) | (bytes[t.offset + 10] << 8) | bytes[t.offset + 11]) >>> 0;
      sum = (sum - adj) >>> 0;
    }
    if (sum !== t.checksum) bad.push(t.tag);
  }
  const fontSum = tableChecksum(bytes, 0, bytes.length);
  if (fontSum !== 0xb1b0afba) bad.push('checkSumAdjustment');
  return { ok: bad.length === 0, bad, fontSum };
}
