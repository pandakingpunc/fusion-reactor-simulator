/// <reference types="node" />
/**
 * Structure of the generated PDF (parsed back with a minimal reader): embedded TrueType subsets
 * (Type0 / CIDFontType2 / FontFile2), ToUnicode CMaps covering Greek, math and Turkish letters, and
 * text positions that agree between the PDF (embedded /W widths) and SVG back ends.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DisplayList, baselineOffset } from './canvas';
import { Figure } from './figure';
import { nodeFontSet } from './fontsNode';
import { SVG_FONT_FAMILY } from './fonts';
import { parseMath } from './mathtext';
import { toPDF, toPDFDocument } from './pdf';
import { toSVG } from './svg';
import { parseTTF, verifyChecksums } from './ttf';

const fonts = nodeFontSet();
const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d));

interface PdfObj { dict: string; stream?: Uint8Array }

/** Minimal PDF reader: objects via the xref table, streams inflated when FlateDecode. */
function readPdf(bytes: Uint8Array): { objs: Map<number, PdfObj>; trailer: string } {
  const s = new TextDecoder('latin1').decode(bytes);
  const sx = s.lastIndexOf('startxref');
  const xrefOff = parseInt(s.slice(sx + 9).trim(), 10);
  const lines = s.slice(xrefOff).split('\n');
  expect(lines[0]).toBe('xref');
  const count = parseInt(lines[1].split(' ')[1], 10);
  const objs = new Map<number, PdfObj>();
  for (let id = 1; id < count; id++) {
    const off = parseInt(lines[2 + id].slice(0, 10), 10);
    const head = `${id} 0 obj\n`;
    expect(s.slice(off, off + head.length)).toBe(head);
    const body0 = off + head.length;
    const end = s.indexOf('\nendobj', body0);
    const st = s.indexOf('\nstream\n', body0);
    if (st >= 0 && st < end) {
      const dict = s.slice(body0, st);
      const len = parseInt(/\/Length (\d+)/.exec(dict)![1], 10);
      let data = bytes.slice(st + 8, st + 8 + len);
      if (dict.includes('/FlateDecode')) data = new Uint8Array(inflateSync(data));
      objs.set(id, { dict, stream: data });
    } else objs.set(id, { dict: s.slice(body0, end) });
  }
  return { objs, trailer: s.slice(s.lastIndexOf('trailer')) };
}

const ref = (dict: string, key: string): number => parseInt(new RegExp(`/${key} (\\d+) 0 R`).exec(dict)![1], 10);
const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** ToUnicode CMap → CID → string */
function parseToUnicode(cmap: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const blk of cmap.matchAll(/beginbfchar\n([\s\S]*?)endbfchar/g)) {
    for (const [, cid, u] of blk[1].matchAll(/<([0-9A-F]+)> <([0-9A-F]+)>/g)) {
      const units: number[] = [];
      for (let k = 0; k < u.length; k += 4) units.push(parseInt(u.slice(k, k + 4), 16));
      m.set(parseInt(cid, 16), String.fromCharCode(...units));
    }
  }
  return m;
}

interface EmbeddedFont { res: string; base: string; toUni: Map<number, string>; widths: number[]; file: Uint8Array; descriptor: string; cidFont: string }

function embeddedFonts(pdf: ReturnType<typeof readPdf>): EmbeddedFont[] {
  const out: EmbeddedFont[] = [];
  const page = [...pdf.objs.values()].find((o) => o.dict.includes('/Type /Page '))!;
  const fontDict = /\/Font << ([^>]*) >>/.exec(page.dict)![1];
  for (const [, res, id] of fontDict.matchAll(/\/(F\d) (\d+) 0 R/g)) {
    const t0 = pdf.objs.get(+id)!.dict;
    expect(t0).toContain('/Subtype /Type0');
    expect(t0).toContain('/Encoding /Identity-H');
    const base = /\/BaseFont \/(\S+)/.exec(t0)![1];
    const cid = pdf.objs.get(parseInt(/\/DescendantFonts \[(\d+) 0 R\]/.exec(t0)![1], 10))!.dict;
    expect(cid).toContain('/Subtype /CIDFontType2');
    expect(cid).toContain('/CIDToGIDMap /Identity');
    const widths = /\/W \[0 \[([^\]]*)\]\]/.exec(cid)![1].trim().split(/\s+/).map(Number);
    const descriptor = pdf.objs.get(ref(cid, 'FontDescriptor'))!.dict;
    const file = pdf.objs.get(ref(descriptor, 'FontFile2'))!;
    expect(file.dict).toMatch(/\/Length1 \d+/);
    const toUni = parseToUnicode(text(pdf.objs.get(ref(t0, 'ToUnicode'))!.stream!));
    out.push({ res, base, toUni, widths, file: file.stream!, descriptor, cidFont: cid });
  }
  return out;
}

const REQUIRED = ['ρ', 'β', 'α', 'τ', 'Δ', '≈', 'ş', 'ğ', 'ı', 'İ'];

function glyphFigure(): Figure {
  const fig = new Figure(3.37, 2.4, { title: 'Glyph coverage — ρβατΔ≈şğıİ' });
  const [ax] = fig.subplots(1, 1);
  ax.plot([0, 1], [0, 1], { label: '$\\rho$, $\\beta_N$, $\\alpha$, $\\tau_E$' })
    .set({ xlabel: '$\\Delta T \\approx 1$ (şğıİ)', ylabel: '$\\frac{dq}{d\\rho}$, $\\bar{n}_e$, $\\hat{T}$' }).legend();
  return fig;
}

describe('PDF with embedded STIX Two subsets', () => {
  const bytes = glyphFigure().toPDF({ fonts, deflate, version: '9.9.9', configHash: 'c0ffee' });
  const pdf = readPdf(bytes);
  const fontsIn = embeddedFonts(pdf);

  it('embeds each used face as Type0/CIDFontType2 with FontFile2, subset tag and ToUnicode', () => {
    expect(fontsIn.map((f) => f.base.replace(/^[A-Z]{6}\+/, ''))).toEqual(expect.arrayContaining(['STIXTwoText-Regular', 'STIXTwoText-Italic', 'STIXTwoMath-Regular']));
    for (const f of fontsIn) {
      expect(f.base).toMatch(/^[A-Z]{6}\+STIXTwo/);
      expect(f.descriptor).toContain(`/FontName /${f.base}`);
      expect(f.descriptor).toMatch(/\/Flags \d+ /);
      expect(f.toUni.size).toBeGreaterThan(0);
    }
    expect(text(bytes)).not.toMatch(/\/Subtype \/Type1|Times-Roman|\/Symbol/);
  });

  it('ToUnicode maps the glyphs of ρ β α τ Δ ≈ ş ğ ı İ', () => {
    const mapped = new Set(fontsIn.flatMap((f) => [...f.toUni.values()]));
    for (const ch of REQUIRED) expect(mapped.has(ch), ch).toBe(true);
  });

  it('every mapped CID is a real glyph of the embedded subset, with /W = hmtx advance', () => {
    for (const f of fontsIn) {
      const ttf = parseTTF(f.file);
      expect(verifyChecksums(f.file).ok).toBe(true);
      expect(f.widths.length).toBe(ttf.numGlyphs);
      for (const [cid, ch] of f.toUni) {
        expect(cid).toBeLessThan(ttf.numGlyphs);
        expect(ttf.glyphId(ch.codePointAt(0)!), `${f.base} ${ch}`).toBe(cid); // subset cmap agrees with ToUnicode
        if (ch.trim()) expect(ttf.glyphData(cid).length, `${f.base} ${ch} outline`).toBeGreaterThan(0);
        expect(f.widths[cid]).toBeCloseTo((ttf.advance(cid) * 1000) / ttf.unitsPerEm, 6);
      }
    }
  });

  it('content streams only show CIDs that the ToUnicode CMaps map', () => {
    const content = [...pdf.objs.values()].filter((o) => o.stream && !o.dict.includes('/Length1') && text(o.stream).includes(' Tf'));
    expect(content.length).toBe(1);
    const byRes = new Map(fontsIn.map((f) => [f.res, f]));
    let cur: EmbeddedFont | undefined, shown = 0;
    for (const m of text(content[0].stream!).matchAll(/\/(F\d) [\d.]+ Tf|<([0-9A-F]+)> Tj/g)) {
      if (m[1]) { cur = byRes.get(m[1]); continue; }
      for (let k = 0; k < m[2].length; k += 4) { expect(cur!.toUni.has(parseInt(m[2].slice(k, k + 4), 16))).toBe(true); shown++; }
    }
    expect(shown).toBeGreaterThan(30);
  });

  it('is deterministic and stamps version + config hash only', () => {
    expect(glyphFigure().toPDF({ fonts, deflate, version: '9.9.9', configHash: 'c0ffee' })).toEqual(bytes);
    const info = pdf.objs.get(ref(pdf.trailer, 'Info'))!.dict;
    expect(info).toContain('/FRSVersion (9.9.9)');
    expect(info).toContain('/FRSConfigSHA256 (c0ffee)');
    expect(info).toMatch(/\/Title <FEFF/); // non-ASCII title as UTF-16BE
    expect(info).not.toMatch(/git|CreationDate|ModDate/);
  });

  it('multi-page documents share one font per face', () => {
    const f1 = glyphFigure(), f2 = new Figure(2, 1.5);
    f2.subplots(1, 1)[0].plot([0, 1], [1, 2]).set({ xlabel: 'ρ ≈ ş' });
    const doc = readPdf(toPDFDocument([f1.render(fonts), f2.render(fonts)], { deflate }));
    expect([...doc.objs.values()].find((o) => o.dict.includes('/Type /Pages'))!.dict).toContain('/Count 2');
    const type0 = [...doc.objs.values()].filter((o) => o.dict.includes('/Subtype /Type0'));
    expect(new Set(type0.map((o) => /\/BaseFont \/[A-Z]{6}\+(\S+)/.exec(o.dict)![1])).size).toBe(type0.length);
  });
});

describe('SVG and PDF place text with the same (hmtx) metrics', () => {
  it('FontSet widths are hmtx advances', () => {
    const ttf = fonts.faces.roman!;
    const exp = [...'Hello, şğ'].reduce((s, c) => s + ttf.advance(ttf.glyphId(c.codePointAt(0)!)), 0) / ttf.unitsPerEm;
    expect(fonts.width('Hello, şğ', 'roman')).toBeCloseTo(exp, 12);
    expect(fonts.width('≈', 'roman')).toBeCloseTo(fonts.faces.math!.advance(fonts.faces.math!.glyphId(0x2248)) / 1000, 12);
  });

  const label = 'ρ τ şğ $\\frac{a}{b+c}$ $\\bar{n}$ İ ≈ 1';
  const X = 150, Y = 50, SIZE = 10;
  const dl = new DisplayList(200, 100, fonts);
  dl.text(parseMath(label, fonts), X, Y, SIZE, { anchor: 'end' });
  const pdf = readPdf(toPDF(dl));
  const content = text([...pdf.objs.values()].find((o) => o.stream && text(o.stream).includes(' Tj'))!.stream!);
  const svg = toSVG(dl);

  it('an end-anchored label ends exactly at the anchor in the PDF (pen advanced by the embedded /W widths)', () => {
    const f = new Map(embeddedFonts(pdf).map((e) => [e.res, e.widths]));
    const bt = /Tm (-?[\d.]+) (-?[\d.]+) Td([\s\S]*?) ET/.exec(content)!;
    let pen = parseFloat(bt[1]), w: number[] = [], size = 0;
    for (const m of bt[3].matchAll(/\/(F\d) ([\d.]+) Tf|\[(-?[\d.]+)\] TJ|<([0-9A-F]+)> Tj/g)) {
      if (m[1]) { w = f.get(m[1])!; size = parseFloat(m[2]); }
      else if (m[3]) pen -= (parseFloat(m[3]) / 1000) * size;
      else for (let k = 0; k < m[4].length; k += 4) pen += (w[parseInt(m[4].slice(k, k + 4), 16)] / 1000) * size;
    }
    expect(Math.abs(pen)).toBeLessThan(0.01);
    expect(svg).toContain(`<text x="${X}" y="${Y}" font-family="${SVG_FONT_FAMILY}" font-size="${SIZE}" fill="#000000" text-anchor="end"`);
  });

  it('fraction and overbar rules sit at the same place in SVG and PDF', () => {
    const pdfRects = [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+) re f/g)].map((m) => m.slice(1, 5).map(Number));
    const svgRects = [...svg.matchAll(/M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)h/g)].map((m) => m.slice(1, 5).map(Number));
    expect(pdfRects.length).toBe(2); // \frac rule + \bar rule
    expect(svgRects.length).toBe(2);
    for (let k = 0; k < 2; k++) {
      const [px, py, pw, pt] = pdfRects[k], [sx, sy, sw, st] = svgRects[k];
      expect(X + px).toBeCloseTo(sx, 1); // PDF: text space relative to the anchor (unrotated)
      expect(pw).toBeCloseTo(sw, 1);
      expect(pt).toBeCloseTo(st, 1);
      expect(Y - py - pt).toBeCloseTo(sy, 1); // PDF y up (text space) → SVG y down
    }
    expect(baselineOffset('alphabetic', SIZE, fonts.metrics)).toBe(0);
  });
});

describe('SVG output', () => {
  it('uses one xlink:href per image, the STIX font stack and provenance metadata', () => {
    const fig = new Figure(2, 2, { title: 'img' });
    const [ax] = fig.subplots(1, 1);
    ax.image([1, 2, 3, NaN], 2, 2, [0, 1, 0, 1]);
    const svg = fig.toSVG({ fonts, version: '1.2.3', configHash: 'abc' });
    const imgs = svg.match(/<image [^>]*>/g)!;
    expect(imgs.length).toBe(1);
    expect(imgs[0].match(/href=/g)!.length).toBe(1);
    expect(imgs[0]).toContain('xlink:href="data:image/png;base64,');
    expect(svg).toContain(`font-family="${SVG_FONT_FAMILY}"`);
    expect(svg).toMatch(/<metadata><frs:provenance [^>]*version="1\.2\.3" config-sha256="abc"\/><\/metadata>/);
    expect(svg).not.toContain('NaN');
  });
});
