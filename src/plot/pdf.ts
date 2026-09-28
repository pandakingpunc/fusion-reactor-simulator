/**
 * PDF back end: display lists → vector PDF 1.4 (single figure or multi-page document).
 *
 * Text is set in subset-embedded STIX Two fonts (the same TrueType files whose metrics laid the text
 * out): each face actually used becomes a Type0 font with Identity-H encoding over a CIDFontType2
 * descendant (FontFile2 = TrueType subset, CIDToGIDMap /Identity, CID = subset glyph index, /W
 * widths from hmtx) and a ToUnicode CMap, so Greek letters, math symbols and Turkish letters render
 * and extract as text in any viewer (pdf.js, poppler, Acrobat). Subset font names carry the usual
 * six-letter tag (ISO 32000-1 §9.6.4), derived deterministically from the glyph set.
 * Images: FlateDecode (stored zlib blocks when no deflate is given). Output is byte-for-byte
 * deterministic: no dates; the Info dict carries only title, version and configuration hash.
 *
 * References: ISO 32000-1:2008 §9.7 (composite fonts, Type0/CIDFontType2, /W), §9.9 (embedded
 * font programs, FontFile2), §9.10.3 (ToUnicode CMaps); Adobe Technical Note #5411 (ToUnicode
 * mapping file tutorial); Adobe Technical Note #5014 (CMap and CIDFont file format).
 */
import { DisplayList, PathCmd, Style, baselineOffset, layoutRuns } from './canvas';
import { Deflate, zlibStored } from './png';
import { FONT_KEYS, FontKey, FontSet } from './fonts';
import { subsetTTF } from './ttf';
import { sha256 } from './sha256';

export interface PdfOptions {
  deflate?: Deflate;
  title?: string;
  creator?: string;
  /** software version (Info /Producer and /FRSVersion) */
  version?: string;
  /** SHA-256 of the canonical figure configuration (Info /FRSConfigSHA256); never a git SHA */
  configHash?: string;
}

const n = (x: number) => (Math.abs(x) < 1e-9 ? '0' : (Math.round(x * 1000) / 1000).toString());
const FONT_RES: Record<FontKey, string> = { roman: 'F1', italic: 'F2', bold: 'F3', math: 'F4' };

class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  str(s: string): void { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; this.bin(b); }
  bin(b: Uint8Array): void { this.parts.push(b); this.length += b.length; }
  concat(): Uint8Array { const o = new Uint8Array(this.length); let p = 0; for (const b of this.parts) { o.set(b, p); p += b.length; } return o; }
}

const latin1 = (s: string) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };

/** PDF text string: literal for printable ASCII, otherwise UTF-16BE with BOM (hex) */
export function pdfTextString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[()\\]/g, (m) => '\\' + m)})`;
  let h = 'FEFF';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${h}>`;
}

/** UTF-16BE hex of a code point (surrogate pair above the BMP) */
function utf16hex(cp: number): string {
  if (cp < 0x10000) return cp.toString(16).padStart(4, '0').toUpperCase();
  const v = cp - 0x10000;
  return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).toUpperCase();
}

/** glyphs used from one face: original glyph index → first code point drawn with it */
class FaceUse {
  readonly uni = new Map<number, number>();
  add(gid: number, cp: number): void { if (!this.uni.has(gid)) this.uni.set(gid, cp); }
}

/** content-stream piece: literal operators, or a glyph string resolved to subset CIDs after subsetting */
type Chunk = string | { face: FontKey; gids: number[] };

/** Six-letter subset tag from the face name and glyph set (deterministic) */
function subsetTag(psName: string, gids: number[]): string {
  const h = sha256(`${psName}:${gids.join(',')}`);
  let t = '';
  for (let i = 0; i < 6; i++) t += String.fromCharCode(65 + (h[i] % 26));
  return t;
}

function toUnicodeCMap(pairs: [number, number][]): string {
  const L: string[] = [
    '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
    '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange',
  ];
  for (let k = 0; k < pairs.length; k += 100) {
    const blk = pairs.slice(k, k + 100);
    L.push(`${blk.length} beginbfchar`);
    for (const [cid, cp] of blk) L.push(`<${cid.toString(16).padStart(4, '0').toUpperCase()}> <${utf16hex(cp)}>`);
    L.push('endbfchar');
  }
  L.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return L.join('\n');
}

/** Adobe's StemV estimate from the OS/2 weight class */
const stemV = (weight: number) => Math.round(10 + 220 * ((weight - 50) / 900) ** 2);

interface PageOut { chunks: Chunk[]; w: number; h: number }

/** Single-page PDF of one display list. */
export function toPDF(dl: DisplayList, o: PdfOptions = {}): Uint8Array {
  return toPDFDocument([dl], o);
}

/** Multi-page PDF (one display list per page, each page sized to its list); fonts are shared across pages. */
export function toPDFDocument(pages: readonly DisplayList[], o: PdfOptions = {}): Uint8Array {
  if (!pages.length) throw new Error('toPDFDocument: no pages');
  const fonts: FontSet = pages[0].fonts;
  const uses = new Map<FontKey, FaceUse>();
  const alphas = new Map<number, string>();
  const images: { name: string; w: number; h: number; rgb: Uint8Array; smooth: boolean }[] = [];
  const gsFor = (a: number) => { const k = Math.round(a * 1000) / 1000; if (!alphas.has(k)) alphas.set(k, `GS${alphas.size + 1}`); return alphas.get(k)!; };
  const outPages: PageOut[] = [];

  for (const dl of pages) {
    if (dl.fonts !== fonts) throw new Error('toPDFDocument: all pages must share one FontSet');
    const H = dl.height;
    const Y = (y: number) => H - y;
    const c: Chunk[] = [];
    const pathOps = (d: PathCmd[]) => d.map((q) => q[0] === 'Z' ? 'h' : q[0] === 'M' ? `${n(q[1])} ${n(Y(q[2]))} m` : q[0] === 'L' ? `${n(q[1])} ${n(Y(q[2]))} l`
      : `${n(q[1])} ${n(Y(q[2]))} ${n(q[3])} ${n(Y(q[4]))} ${n(q[5])} ${n(Y(q[6]))} c`).join(' ');
    const styleOps = (s: Style) => {
      const a: string[] = [];
      if (s.stroke) a.push(`${n(s.stroke[0])} ${n(s.stroke[1])} ${n(s.stroke[2])} RG`, `${n(s.lw ?? 1)} w`, `[${(s.dash ?? []).map(n).join(' ')}] 0 d`,
        `${s.cap === 'round' ? 1 : s.cap === 'square' ? 2 : 0} J`, `${s.join === 'round' ? 1 : s.join === 'bevel' ? 2 : 0} j`);
      if (s.fill) a.push(`${n(s.fill[0])} ${n(s.fill[1])} ${n(s.fill[2])} rg`);
      if (s.alpha !== undefined && s.alpha < 1) a.push(`/${gsFor(s.alpha)} gs`);
      return a.join(' ');
    };
    for (const p of dl.prims) {
      switch (p.t) {
        case 'path': {
          const paint = p.s.fill && p.s.stroke ? 'B' : p.s.fill ? 'f' : p.s.stroke ? 'S' : 'n';
          c.push(`q ${styleOps(p.s)} ${pathOps(p.d)} ${paint} Q\n`);
          break;
        }
        case 'clip': c.push(`q ${n(p.x)} ${n(Y(p.y + p.h))} ${n(p.w)} ${n(p.h)} re W n\n`); break;
        case 'unclip': c.push('Q\n'); break;
        case 'image': {
          const name = `Im${images.length + 1}`;
          images.push({ name, w: p.w, h: p.h, rgb: p.rgb, smooth: p.smooth });
          c.push(`q ${n(p.dw)} 0 0 ${n(p.dh)} ${n(p.x)} ${n(Y(p.y + p.dh))} cm /${name} Do Q\n`);
          break;
        }
        case 'text': {
          const lay = layoutRuns(p.runs, p.size, fonts);
          const dx0 = p.anchor === 'middle' ? -lay.width / 2 : p.anchor === 'end' ? -lay.width : 0;
          const dy0 = -baselineOffset(p.baseline, p.size, fonts.metrics); // text space (y up)
          const th = (p.rotate * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
          const mtx = `${n(co)} ${n(si)} ${n(-si)} ${n(co)} ${n(p.x)} ${n(Y(p.y))}`;
          c.push(`q ${n(p.color[0])} ${n(p.color[1])} ${n(p.color[2])} rg BT ${mtx} Tm ${n(dx0)} ${n(dy0)} Td`);
          let curFace: FontKey | null = null, curSize = -1, curRise = 0;
          const setFont = (face: FontKey, size: number) => {
            if (face !== curFace || size !== curSize) { c.push(` /${FONT_RES[face]} ${n(size)} Tf`); curFace = face; curSize = size; }
          };
          for (const r of p.runs) {
            if (r.rule) {
              // rules are drawn after ET; move the pen over them
              const mv = ((r.dx ?? 0) + r.rule.w) * p.size;
              if (Math.abs(mv) > 1e-9) { if (curFace === null) setFont('roman', p.size); c.push(` [${n((-mv / curSize) * 1000)}] TJ`); }
              continue;
            }
            if (!r.text && !r.dx) continue;
            const size = p.size * r.scale;
            if (r.rise !== curRise) { c.push(` ${n(r.rise * p.size)} Ts`); curRise = r.rise; }
            if (r.dx) {
              if (curFace === null) setFont(fonts.glyph(String.fromCodePoint(r.text.codePointAt(0) ?? 32), r.font).face, size);
              c.push(` [${n(((-r.dx * p.size) / curSize) * 1000)}] TJ`);
            }
            // split the run into maximal pieces set in one face (fallback glyphs may come from STIX Two Math)
            let seg: number[] = [], segFace: FontKey | null = null;
            const flush = () => {
              if (!seg.length || !segFace) return;
              setFont(segFace, size);
              c.push(' ', { face: segFace, gids: seg }, ' Tj');
              seg = [];
            };
            for (const ch of r.text) {
              const g = fonts.glyph(ch, r.font);
              if (g.face !== segFace) { flush(); segFace = g.face; }
              let u = uses.get(g.face);
              if (!u) uses.set(g.face, (u = new FaceUse()));
              u.add(g.gid, g.cp);
              seg.push(g.gid);
            }
            flush();
          }
          c.push(' ET');
          const rules = lay.placed.filter((pr) => pr.run.rule);
          if (rules.length) {
            c.push(` ${mtx} cm`);
            for (const pr of rules) {
              const t = pr.run.rule!.t * p.size, w = pr.run.rule!.w * p.size;
              c.push(` ${n(dx0 + pr.x)} ${n(dy0 + pr.run.rise * p.size - t / 2)} ${n(w)} ${n(t)} re f`);
            }
          }
          c.push(' Q\n');
          break;
        }
      }
    }
    outPages.push({ chunks: c, w: dl.width, h: dl.height });
  }

  // ---- font subsets (fixed face order → deterministic object numbering)
  interface FaceOut { key: FontKey; res: string; cid: Map<number, number>; file: Uint8Array; base: string; widths: number[]; toUni: [number, number][] }
  const faces: FaceOut[] = [];
  for (const key of FONT_KEYS) {
    const u = uses.get(key);
    if (!u) continue;
    const font = fonts.faces[key]!;
    const gids = [...u.uni.keys()].sort((a, b) => a - b);
    const sub = subsetTTF(font, gids, { cmap: new Map([...u.uni].map(([g, cp]) => [cp, g])) });
    const widths = sub.glyphs.map((g) => (font.advance(g) * 1000) / font.unitsPerEm);
    const toUni: [number, number][] = [...u.uni].map(([g, cp]): [number, number] => [sub.gidMap.get(g)!, cp]).sort((a, b) => a[0] - b[0]);
    faces.push({ key, res: FONT_RES[key], cid: sub.gidMap, file: sub.bytes, base: `${subsetTag(font.postScriptName, gids)}+${font.postScriptName}`, widths, toUni });
  }
  const faceOf = new Map(faces.map((f) => [f.key, f]));
  const hex4 = (v: number) => v.toString(16).padStart(4, '0').toUpperCase();

  // ---- objects
  const objs = new Map<number, { body: string; stream?: Uint8Array }>();
  let next = 1;
  const alloc = () => next++;
  const catalogId = alloc(), pagesId = alloc();
  const pageIds = outPages.map(() => ({ page: alloc(), content: alloc() }));
  const gsIds = [...alphas.entries()].map(([a, name]) => ({ a, name, id: alloc() }));
  const imgIds = images.map((im) => ({ ...im, id: alloc() }));
  const fontIds = faces.map((f) => ({ f, type0: alloc(), cidFont: alloc(), desc: alloc(), file: alloc(), toUni: alloc() }));
  const infoId = alloc();
  const stream = (data: Uint8Array, extra = '') => {
    const s = o.deflate ? o.deflate(data) : data;
    return { dict: `<< /Length ${s.length}${o.deflate ? ' /Filter /FlateDecode' : ''}${extra} >>`, s };
  };

  const res = '<<' + (fontIds.length ? ` /Font << ${fontIds.map((x) => `/${x.f.res} ${x.type0} 0 R`).join(' ')} >>` : '') +
    (gsIds.length ? ` /ExtGState << ${gsIds.map((g) => `/${g.name} ${g.id} 0 R`).join(' ')} >>` : '') +
    (imgIds.length ? ` /XObject << ${imgIds.map((g) => `/${g.name} ${g.id} 0 R`).join(' ')} >>` : '') + ' /ProcSet [/PDF /Text /ImageC] >>';
  objs.set(catalogId, { body: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` });
  objs.set(pagesId, { body: `<< /Type /Pages /Kids [${pageIds.map((p) => `${p.page} 0 R`).join(' ')}] /Count ${pageIds.length} >>` });
  outPages.forEach((pg, k) => {
    const text = pg.chunks.map((ch) => {
      if (typeof ch === 'string') return ch;
      const f = faceOf.get(ch.face)!;
      return `<${ch.gids.map((g) => hex4(f.cid.get(g)!)).join('')}>`;
    }).join('');
    const st = stream(latin1(text));
    objs.set(pageIds[k].page, { body: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(pg.w)} ${n(pg.h)}] /Resources ${res} /Contents ${pageIds[k].content} 0 R >>` });
    objs.set(pageIds[k].content, { body: st.dict, stream: st.s });
  });
  for (const g of gsIds) objs.set(g.id, { body: `<< /Type /ExtGState /CA ${n(g.a)} /ca ${n(g.a)} >>` });
  for (const im of imgIds) {
    const data = o.deflate ? o.deflate(im.rgb) : zlibStored(im.rgb);
    objs.set(im.id, { body: `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate ${im.smooth ? 'true' : 'false'} /Filter /FlateDecode /Length ${data.length} >>`, stream: data });
  }
  for (const x of fontIds) {
    const f = x.f, font = fonts.faces[f.key]!;
    const k = 1000 / font.unitsPerEm;
    const bb = font.bbox;
    const flags = 4 /* Symbolic: glyphs addressed by CID */ | 2 /* Serif */ | (font.italicAngle !== 0 ? 64 : 0);
    objs.set(x.type0, { body: `<< /Type /Font /Subtype /Type0 /BaseFont /${f.base} /Encoding /Identity-H /DescendantFonts [${x.cidFont} 0 R] /ToUnicode ${x.toUni} 0 R >>` });
    objs.set(x.cidFont, { body: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${x.desc} 0 R /DW ${n(f.widths[0])} /W [0 [${f.widths.map(n).join(' ')}]] /CIDToGIDMap /Identity >>` });
    objs.set(x.desc, { body: `<< /Type /FontDescriptor /FontName /${f.base} /Flags ${flags} /FontBBox [${n(bb.xMin * k)} ${n(bb.yMin * k)} ${n(bb.xMax * k)} ${n(bb.yMax * k)}] /ItalicAngle ${n(font.italicAngle)} /Ascent ${n(font.ascender * k)} /Descent ${n(font.descender * k)} /CapHeight ${n(font.capHeight * k)} /XHeight ${n(font.xHeight * k)} /StemV ${stemV(font.weightClass)} /FontFile2 ${x.file} 0 R >>` });
    const ff = stream(f.file, ` /Length1 ${f.file.length}`);
    objs.set(x.file, { body: ff.dict, stream: ff.s });
    const tu = stream(latin1(toUnicodeCMap(f.toUni)));
    objs.set(x.toUni, { body: tu.dict, stream: tu.s });
  }
  const info = [`/Title ${pdfTextString(o.title ?? 'figure')}`, `/Creator ${pdfTextString(o.creator ?? 'Fusion Reactor Simulator plot engine')}`,
    `/Producer ${pdfTextString(`fusion-reactor-simulator${o.version ? ' ' + o.version : ''} (src/plot)`)}`];
  if (o.version) info.push(`/FRSVersion ${pdfTextString(o.version)}`);
  if (o.configHash) info.push(`/FRSConfigSHA256 ${pdfTextString(o.configHash)}`, `/Keywords ${pdfTextString(`config-sha256:${o.configHash}`)}`);
  objs.set(infoId, { body: `<< ${info.join(' ')} >>` });

  // ---- serialise
  const b = new Bytes();
  const offsets: number[] = [];
  b.str('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  for (let id = 1; id < next; id++) {
    const ob = objs.get(id)!;
    offsets[id] = b.length;
    b.str(`${id} 0 obj\n${ob.body}\n`);
    if (ob.stream) { b.str('stream\n'); b.bin(ob.stream); b.str('\nendstream\n'); }
    b.str('endobj\n');
  }
  const xref = b.length;
  b.str(`xref\n0 ${next}\n0000000000 65535 f \n`);
  for (let i = 1; i < next; i++) b.str(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  b.str(`trailer\n<< /Size ${next} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return b.concat();
}
