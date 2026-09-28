/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TtfError, glyphClosure, parseTTF, subsetTTF, tableChecksum, verifyChecksums } from './ttf';
import { canonicalJSON, sha256Hex } from './sha256';

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/stix-two/', import.meta.url));

const load = (f: string) => new Uint8Array(readFileSync(join(FONT_DIR, f)));
const regular = parseTTF(load('STIXTwoText-Regular.ttf'));
const math = parseTTF(load('STIXTwoMath-Regular.ttf'));
const cp = (ch: string) => ch.codePointAt(0)!;
const TEST_CHARS = 'Hello ρβατΔşğıİ−';

describe('TrueType parser', () => {
  it('reads the STIX Two tables and metrics', () => {
    expect(regular.postScriptName).toBe('STIXTwoText-Regular');
    expect(regular.unitsPerEm).toBe(1000);
    expect(regular.numGlyphs).toBeGreaterThan(1000);
    expect(regular.capHeight).toBeGreaterThan(600);
    expect(regular.xHeight).toBeGreaterThan(400);
    expect(verifyChecksums(regular.data).ok).toBe(true); // the parser's checksum agrees with the shipped font
    for (const ch of TEST_CHARS) expect(regular.glyphId(cp(ch)), ch).toBeGreaterThan(0);
    expect(regular.glyphId(cp('≈'))).toBe(0); // only in STIX Two Math
    expect(math.glyphId(cp('≈'))).toBeGreaterThan(0);
  });

  it('reads cmap format 12 (non-BMP mathematical alphanumerics in STIX Two Math)', () => {
    const g = math.glyphId(0x1d6fc); // MATHEMATICAL ITALIC SMALL ALPHA
    expect(g).toBeGreaterThan(0);
    expect(math.advance(g)).toBeGreaterThan(0);
  });

  it('decodes composite glyphs: ş, ğ and İ are built from components', () => {
    for (const ch of 'şğİ') {
      const g = regular.glyphId(cp(ch));
      expect(regular.isComposite(g), ch).toBe(true);
      expect(regular.components(g).length).toBeGreaterThanOrEqual(2);
    }
    // İ = I + dot accent
    expect(regular.components(regular.glyphId(cp('İ')))).toContain(regular.glyphId(cp('I')));
  });

  it('rejects damaged data with TtfError', () => {
    expect(() => parseTTF(new Uint8Array(16))).toThrow(TtfError);
    expect(() => parseTTF(regular.data.slice(0, 400))).toThrow(TtfError);
    expect(() => regular.advance(regular.numGlyphs)).toThrow(TtfError);
  });
});

describe('TrueType subsetter', () => {
  const gids = [...TEST_CHARS].map((c) => regular.glyphId(cp(c)));
  const cmap = new Map([...TEST_CHARS].map((c) => [cp(c), regular.glyphId(cp(c))]));
  const sub = subsetTTF(regular, gids, { cmap });
  const f = parseTTF(sub.bytes);

  it('round-trips: the subset parses, with .notdef first and the closure glyph count', () => {
    const closure = glyphClosure(regular, gids);
    expect(f.numGlyphs).toBe(closure.length);
    expect(sub.glyphs).toEqual(closure);
    expect(sub.glyphs[0]).toBe(0);
    expect(f.numGlyphs).toBeLessThan(40);
    expect(f.unitsPerEm).toBe(regular.unitsPerEm);
  });

  it('has valid table checksums and checkSumAdjustment', () => {
    const v = verifyChecksums(sub.bytes);
    expect(v.bad).toEqual([]);
    expect(v.fontSum).toBe(0xb1b0afba);
    // tables are 4-byte aligned
    for (const t of f.tables.values()) expect(t.offset % 4).toBe(0);
    expect(tableChecksum(new Uint8Array([1, 2, 3]), 0, 3)).toBe(0x01020300);
  });

  it('includes composite-glyph dependencies and remaps their indices', () => {
    for (const ch of 'şğİ') {
      const old = regular.glyphId(cp(ch));
      for (const c of regular.components(old)) expect(sub.gidMap.has(c), `${ch} component ${c}`).toBe(true);
      const nw = sub.gidMap.get(old)!;
      expect(f.isComposite(nw)).toBe(true);
      expect(f.components(nw)).toEqual(regular.components(old).map((c) => sub.gidMap.get(c)));
    }
  });

  it('keeps metrics, outlines and the Unicode mapping; strips hinting', () => {
    for (const ch of TEST_CHARS) {
      const og = regular.glyphId(cp(ch)), ng = f.glyphId(cp(ch));
      expect(ng, ch).toBe(sub.gidMap.get(og));
      expect(f.advance(ng)).toBe(regular.advance(og));
      expect(f.lsb(ng)).toBe(regular.lsb(og));
      expect(f.glyphBounds(ng)).toEqual(regular.glyphBounds(og));
    }
    for (const t of ['fpgm', 'prep', 'cvt ']) expect(f.tables.has(t)).toBe(false);
    for (let g = 0; g < f.numGlyphs; g++) {
      const d = f.glyphData(g);
      if (d.length < 10 || f.isComposite(g)) continue;
      const n = (d[0] << 8) | d[1];
      expect((d[10 + 2 * n] << 8) | d[11 + 2 * n]).toBe(0); // instructionLength
    }
    const hinted = subsetTTF(regular, gids, { hinting: true });
    expect(verifyChecksums(hinted.bytes).ok).toBe(true);
    expect(hinted.bytes.length).toBeGreaterThan(sub.bytes.length);
  });

  it('writes a format 12 cmap for non-BMP code points', () => {
    const g = math.glyphId(0x1d6fc);
    const s = subsetTTF(math, [g], { cmap: new Map([[0x1d6fc, g]]) });
    const m = parseTTF(s.bytes);
    expect(m.glyphId(0x1d6fc)).toBe(s.gidMap.get(g));
    expect(verifyChecksums(s.bytes).ok).toBe(true);
  });

  it('is deterministic', () => {
    expect(subsetTTF(regular, [...gids].reverse(), { cmap }).bytes).toEqual(sub.bytes);
  });
});

describe('SHA-256 and canonical JSON', () => {
  it('matches node:crypto across padding boundaries', () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
      expect(sha256Hex(b)).toBe(createHash('sha256').update(b).digest('hex'));
    }
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('canonical JSON sorts keys and keeps non-finite numbers distinct from null', () => {
    expect(canonicalJSON({ b: 1, a: [NaN, Infinity, null], c: undefined, f: () => 1 })).toBe('{"a":["NaN","Infinity",null],"b":1}');
    expect(canonicalJSON({ x: new Float64Array([1.5]) })).toBe('{"x":[1.5]}');
    expect(canonicalJSON({ a: 1, b: 2 })).toBe(canonicalJSON({ b: 2, a: 1 }));
  });
});
