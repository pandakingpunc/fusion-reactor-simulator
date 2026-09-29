/// <reference types="node" />
/**
 * Multi-page PDF documents (toPDFDocument / figuresToPDF), parsed back with a minimal reader: page tree,
 * page sizes, one shared embedded subset per face that holds the glyphs of every page, page-level
 * graphics-state and image resources, text that extracts per page, and the failure modes.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DisplayList } from './canvas';
import { Figure, figuresToPDF } from './figure';
import { nodeFontSet } from './fontsNode';
import { FontSet } from './fonts';
import { toPDF, toPDFDocument } from './pdf';
import { parseTTF, verifyChecksums } from './ttf';

const fonts = nodeFontSet();
const deflate = (d: Uint8Array) => new Uint8Array(deflateSync(d));
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

interface Obj { dict: string; stream?: Uint8Array }
interface Pdf { objs: Map<number, Obj>; trailer: string; size: number }

/** Objects by number through the xref table (offsets checked), streams inflated when FlateDecode. */
function readPdf(bytes: Uint8Array): Pdf {
  const s = latin1(bytes);
  expect(s.startsWith('%PDF-1.4\n')).toBe(true);
  expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  const xrefAt = parseInt(s.slice(s.lastIndexOf('startxref') + 9).trim(), 10);
  const lines = s.slice(xrefAt).split('\n');
  expect(lines[0]).toBe('xref');
  const size = parseInt(lines[1].split(' ')[1], 10);
  const objs = new Map<number, Obj>();
  for (let id = 1; id < size; id++) {
    const off = parseInt(lines[2 + id].slice(0, 10), 10);
    const head = `${id} 0 obj\n`;
    expect(s.slice(off, off + head.length), `object ${id}`).toBe(head);
    const body = off + head.length, end = s.indexOf('\nendobj', body), st = s.indexOf('\nstream\n', body);
    if (st >= 0 && st < end) {
      const dict = s.slice(body, st);
      const len = parseInt(/\/Length (\d+)/.exec(dict)![1], 10);
      let data = bytes.slice(st + 8, st + 8 + len);
      if (dict.includes('/FlateDecode')) data = new Uint8Array(inflateSync(data));
      objs.set(id, { dict, stream: data });
    } else objs.set(id, { dict: s.slice(body, end) });
  }
  return { objs, trailer: s.slice(s.lastIndexOf('trailer')), size };
}

const refOf = (dict: string, key: string) => parseInt(new RegExp(`/${key} (\\d+) 0 R`).exec(dict)![1], 10);

/** ToUnicode CMap → CID → string */
function toUnicode(cmap: string): Map<number, string> {
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

const pagesOf = (pdf: Pdf) => {
  const root = pdf.objs.get(refOf(pdf.trailer, 'Root'))!.dict;
  const tree = pdf.objs.get(refOf(root, 'Pages'))!;
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(tree.dict)![1]).matchAll(/(\d+) 0 R/g)].map((m) => parseInt(m[1], 10));
  return { tree, kids, pages: kids.map((k) => ({ id: k, dict: pdf.objs.get(k)!.dict })) };
};

const type0Fonts = (pdf: Pdf) => [...pdf.objs.entries()].filter(([, o]) => o.dict.includes('/Subtype /Type0')).map(([id, o]) => ({ id, dict: o.dict }));

/** text of one page: the Tj strings of its content stream mapped through the ToUnicode CMap of the selected font */
function pageText(pdf: Pdf, page: { dict: string }): string {
  const res = page.dict;
  const fontMap = new Map<string, Map<number, string>>();
  for (const m of /\/Font << ([^>]*) >>/.exec(res)![1].matchAll(/\/(F\d) (\d+) 0 R/g)) {
    fontMap.set(m[1], toUnicode(latin1(pdf.objs.get(refOf(pdf.objs.get(+m[2])!.dict, 'ToUnicode'))!.stream!)));
  }
  const content = latin1(pdf.objs.get(refOf(page.dict, 'Contents'))!.stream!);
  let cur: Map<number, string> | undefined, out = '';
  for (const m of content.matchAll(/\/(F\d) [\d.]+ Tf|<([0-9A-F]+)> Tj/g)) {
    if (m[1]) { cur = fontMap.get(m[1]); expect(cur, `${m[1]} declared on the page`).toBeDefined(); continue; }
    for (let k = 0; k < m[2].length; k += 4) out += cur!.get(parseInt(m[2].slice(k, k + 4), 16)) ?? '�';
  }
  return out;
}

const num = (x: number) => (Math.abs(x) < 1e-9 ? '0' : (Math.round(x * 1000) / 1000).toString());

/** page 1: Greek labels, a translucent band and a raster; page 2: another size, Turkish letters and a math-only symbol; page 3: a translucent band */
function threePages(): Figure[] {
  const f1 = new Figure(3.37, 2.4, { title: 'Report — page one' });
  const [a1] = f1.subplots(1, 1);
  a1.fillBetween([0, 1, 2], [0, 1, 0], [1, 2, 1], { alpha: 0.25 });
  a1.image([1, 2, 3, 4], 2, 2, [0, 2, 0, 2]);
  a1.set({ xlabel: '$\\rho$, $\\beta_N$, $\\tau_E$ (Δ)', ylabel: 'plain label' });
  const f2 = new Figure(2, 1.5);
  f2.subplots(1, 1)[0].plot([0, 1], [1, 2]).set({ xlabel: 'ş ğ ı İ ≈ ∝' });
  const f3 = new Figure(3, 2);
  f3.subplots(1, 1)[0].fillBetween([0, 1], [0, 1], [1, 2], { alpha: 0.5 }).plot([0, 1], [0, 1], { label: 'Q' }).legend();
  return [f1, f2, f3];
}

describe('multi-page PDF documents', () => {
  const figs = threePages();
  const dls = figs.map((f) => f.render(fonts));
  const bytes = toPDFDocument(dls, { deflate, title: 'Report — all pages', version: '9.9.9', configHash: 'cafe' });
  const pdf = readPdf(bytes);
  const { tree, kids, pages } = pagesOf(pdf);

  it('page tree: one page per display list, in order, each as large as its list', () => {
    expect(tree.dict).toContain('/Type /Pages');
    expect(tree.dict).toContain('/Count 3');
    expect(kids.length).toBe(3);
    const treeId = refOf(pdf.objs.get(refOf(pdf.trailer, 'Root'))!.dict, 'Pages');
    pages.forEach((p, k) => {
      expect(p.dict).toContain('/Type /Page ');
      expect(refOf(p.dict, 'Parent')).toBe(treeId);
      expect(p.dict).toContain(`/MediaBox [0 0 ${num(dls[k].width)} ${num(dls[k].height)}]`);
      expect(pdf.objs.get(refOf(p.dict, 'Contents'))!.stream!.length).toBeGreaterThan(50);
    });
    expect(new Set(pages.map((p) => p.dict.match(/\/MediaBox \[[^\]]*\]/)![0])).size).toBe(3); // three sizes
    expect(pdf.trailer).toContain(`/Size ${pdf.size}`);
  });

  it('one embedded font program per face, listed by every page', () => {
    const t0 = type0Fonts(pdf);
    const bases = t0.map((f) => /\/BaseFont \/(\S+)/.exec(f.dict)![1]);
    expect(new Set(bases).size).toBe(t0.length); // no face embedded twice
    expect(bases.map((b) => b.replace(/^[A-Z]{6}\+/, '')).sort()).toEqual(['STIXTwoMath-Regular', 'STIXTwoText-Italic', 'STIXTwoText-Regular']);
    const fontFiles = [...pdf.objs.values()].filter((o) => o.dict.includes('/Length1'));
    expect(fontFiles.length).toBe(t0.length);
    const fontDicts = pages.map((p) => /\/Font << ([^>]*) >>/.exec(p.dict)![1]);
    expect(new Set(fontDicts).size).toBe(1); // the same objects on every page
    expect([...fontDicts[0].matchAll(/(\d+) 0 R/g)].map((m) => +m[1]).sort((a, b) => a - b)).toEqual(t0.map((f) => f.id).sort((a, b) => a - b));
  });

  it('the subsets hold the glyphs of every page: text extracts per page, only mapped CIDs are shown', () => {
    const t1 = pageText(pdf, pages[0]), t2 = pageText(pdf, pages[1]), t3 = pageText(pdf, pages[2]);
    for (const ch of ['ρ', 'β', 'τ', 'Δ']) expect(t1, `page 1 ${ch}`).toContain(ch);
    expect(t1).toContain('plain label');
    for (const ch of ['ş', 'ğ', 'ı', 'İ', '≈', '∝']) expect(t2, `page 2 ${ch}`).toContain(ch);
    expect(t3).toContain('Q');
    expect(t1).not.toContain('�');
    expect(t2).not.toContain('�');
    expect(t3).not.toContain('�');
    // a glyph that only page 2 draws is in the shared subset (its cmap and outline), and the font programs are valid TrueType
    for (const f of type0Fonts(pdf)) {
      const cid = pdf.objs.get(parseInt(/\/DescendantFonts \[(\d+) 0 R\]/.exec(f.dict)![1], 10))!.dict;
      const file = pdf.objs.get(refOf(pdf.objs.get(refOf(cid, 'FontDescriptor'))!.dict, 'FontFile2'))!.stream!;
      expect(verifyChecksums(file).ok).toBe(true);
      const ttf = parseTTF(file);
      const map = toUnicode(latin1(pdf.objs.get(refOf(f.dict, 'ToUnicode'))!.stream!));
      for (const [gid, ch] of map) { expect(ttf.glyphId(ch.codePointAt(0)!)).toBe(gid); if (ch.trim()) expect(ttf.glyphData(gid).length).toBeGreaterThan(0); }
    }
  });

  it('sharing pays: the document holds fewer font bytes than its pages as separate files', () => {
    const fontBytes = (b: Uint8Array) => [...readPdf(b).objs.values()].filter((o) => o.dict.includes('/Length1')).reduce((s, o) => s + o.stream!.length, 0);
    const together = fontBytes(bytes);
    const apart = dls.reduce((s, dl) => s + fontBytes(toPDF(dl, { deflate })), 0);
    expect(together).toBeLessThan(apart);
  });

  it('graphics states and images are page resources: a page lists only what it draws', () => {
    const [p1, p2, p3] = pages.map((p) => p.dict);
    expect(p1).toMatch(/\/ExtGState << \/GS\d+ \d+ 0 R >>/);
    expect(p1).toMatch(/\/XObject << \/Im1 \d+ 0 R >>/);
    expect(p2).not.toMatch(/ExtGState|XObject/);
    expect(p3).toMatch(/\/ExtGState << \/GS\d+ \d+ 0 R >>/);
    expect(p3).not.toContain('XObject');
    // page 1 (alpha 0.25) and page 3 (alpha 0.5, 0.35 for the legend swatch ...) draw different states; every listed state exists
    for (const p of [p1, p3]) for (const [, id] of p.matchAll(/\/GS\d+ (\d+) 0 R/g)) expect(pdf.objs.get(+id)!.dict).toContain('/Type /ExtGState');
    for (const [, id] of p1.matchAll(/\/Im\d+ (\d+) 0 R/g)) expect(pdf.objs.get(+id)!.dict).toContain('/Subtype /Image');
    // the same alpha on two pages is one graphics state object
    const twice = toPDFDocument([figs[0].render(fonts), figs[0].render(fonts)], { deflate });
    const tp = pagesOf(readPdf(twice)).pages.map((p) => p.dict.match(/\/ExtGState << ([^>]*) >>/)![1]);
    expect(tp[0]).toBe(tp[1]);
    // the content of each page only names resources of that page
    pages.forEach((p, k) => {
      const c = latin1(pdf.objs.get(refOf(p.dict, 'Contents'))!.stream!);
      for (const m of c.matchAll(/\/(GS\d+) gs/g)) expect(p.dict, `page ${k + 1} ${m[1]}`).toContain(`/${m[1]} `);
      for (const m of c.matchAll(/\/(Im\d+) Do/g)) expect(p.dict, `page ${k + 1} ${m[1]}`).toContain(`/${m[1]} `);
    });
  });

  it('is deterministic, stamps title / version / configuration hash once, and equals toPDF for one page', () => {
    expect(toPDFDocument(dls, { deflate, title: 'Report — all pages', version: '9.9.9', configHash: 'cafe' })).toEqual(bytes);
    const info = pdf.objs.get(refOf(pdf.trailer, 'Info'))!.dict;
    expect(info).toMatch(/\/Title <FEFF/);
    expect(info).toContain('/FRSVersion (9.9.9)');
    expect(info).toContain('/FRSConfigSHA256 (cafe)');
    expect(info).not.toMatch(/CreationDate|ModDate/);
    expect(toPDFDocument([dls[0]], { deflate })).toEqual(toPDF(dls[0], { deflate }));
    expect(toPDFDocument([dls[0]])).toEqual(toPDF(dls[0])); // without deflate as well
  });

  it('figuresToPDF renders the figures with one font set; the title defaults to the first figure\'s', () => {
    const doc = figuresToPDF(figs, { fonts, deflate });
    const p = readPdf(doc);
    expect(pagesOf(p).kids.length).toBe(3);
    expect(p.objs.get(refOf(p.trailer, 'Info'))!.dict).toMatch(/\/Title <FEFF/); // "Report — page one" is not ASCII
    expect(doc).toEqual(toPDFDocument(dls, { deflate, title: 'Report — page one' }));
    expect(latin1(figuresToPDF([figs[1]], { fonts, title: 'Only', deflate }))).toContain('/Title (Only)');
    expect(latin1(figuresToPDF([figs[1]], { fonts, deflate }))).toContain('/Title (figure)'); // a figure without a title
  });

  it('refuses no pages, and pages that were laid out with different font sets', () => {
    expect(() => toPDFDocument([])).toThrow(/no pages/);
    expect(() => figuresToPDF([], { fonts })).toThrow(/no pages/);
    const other = new FontSet({ roman: fonts.faces.roman! });
    expect(() => toPDFDocument([new DisplayList(10, 10, fonts), new DisplayList(10, 10, other)])).toThrow(/share one FontSet/);
  });

  it('many pages of text: one subset, valid xref', () => {
    const pagesMany = Array.from({ length: 12 }, (_, k) => {
      const f = new Figure(2, 1.2, { title: `p${k}` });
      f.subplots(1, 1)[0].plot([0, 1], [0, k]).set({ xlabel: `page ${k + 1} ρ`, ylabel: '$\\alpha$' });
      return f;
    });
    const doc = readPdf(figuresToPDF(pagesMany, { fonts, deflate }));
    expect(pagesOf(doc).kids.length).toBe(12);
    expect(type0Fonts(doc).length).toBeLessThanOrEqual(3);
    expect(pageText(doc, pagesOf(doc).pages[11])).toContain('page 12 ρ');
  });
});
