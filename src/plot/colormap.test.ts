/**
 * The tabulated colormaps (viridis, magma, inferno, plasma, cividis) are matplotlib's 256-entry tables:
 * pinned by SHA-256 and by rows of matplotlib's floating-point tables (round(255 v) is the stored byte),
 * plus the properties of a perceptually uniform map (smooth, luminance increasing).
 */
import { describe, expect, it } from 'vitest';
import { LUT_NAMES, colormap, colormapLUT, mix } from './colors';
import { LUT_HEX } from './colormapData';
import { Figure } from './figure';
import { nodeFontSet } from './fontsNode';
import { sha256, toHex } from './sha256';

const fonts = nodeFontSet();

/** SHA-256 of the 768 table bytes (R, G, B of entries 0 … 255) */
const HASH: Record<string, string> = {
  viridis: '18545f7c72a02f02a54f2e3f6ff9dcf357e0190ab9117a1f8fae44c6eaf179e0',
  magma: 'f95197e8391d18e2c1db50f2a1ab8650ab7c2a9acb781704a8156872615f002b',
  inferno: 'e24e8bd38b972989f64c42856b2b274df5ada3a62bc01bf8e83500a2ea938ad4',
  plasma: '7463ac7565e754490c2c358e89b54a99da3e9b3c0be7734ed66b9fc78958b9a6',
  cividis: '40881f40490dc08ae8b1442b52b01c7169d27124ccb4a501cd0ee290079cc1e1',
};

/**
 * Rows of matplotlib's floating-point tables (lib/matplotlib/_cm_listed.py): [map, entry, R, G, B].
 * The end points and viridis[0..3, 128], magma/inferno/plasma at a middle entry, and cividis at
 * entries 0, 1, 63 and 191 (the cividis rows were read from the table itself).
 */
const MPL_ROWS: [string, number, number, number, number][] = [
  ['viridis', 0, 0.267004, 0.004874, 0.329415], ['viridis', 1, 0.268510, 0.009605, 0.335427], ['viridis', 2, 0.269944, 0.014625, 0.341379],
  ['viridis', 3, 0.271305, 0.019942, 0.347269], ['viridis', 128, 0.127568, 0.566949, 0.550556], ['viridis', 255, 0.993248, 0.906157, 0.143936],
  ['magma', 0, 0.001462, 0.000466, 0.013866], ['magma', 113, 0.620005, 0.183840, 0.497524], ['magma', 255, 0.987053, 0.991438, 0.749504],
  ['inferno', 0, 0.001462, 0.000466, 0.013866], ['inferno', 116, 0.664540, 0.181539, 0.369846], ['inferno', 255, 0.988362, 0.998364, 0.644924],
  ['plasma', 0, 0.050383, 0.029803, 0.527975], ['plasma', 99, 0.679160, 0.151848, 0.575189], ['plasma', 255, 0.940015, 0.975158, 0.131326],
  ['cividis', 0, 0.000000, 0.135112, 0.304751], ['cividis', 1, 0.000000, 0.138068, 0.311105], ['cividis', 63, 0.259740, 0.305120, 0.422810],
  ['cividis', 191, 0.732422, 0.677364, 0.425717], ['cividis', 255, 0.995737, 0.909344, 0.217772],
];

/** relative luminance of an sRGB byte triple (Rec. 709 weights on the gamma-decoded channels) */
const luminance = (r: number, g: number, b: number) => {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

describe('tabulated colormaps', () => {
  it('names and sizes: five maps of 256 entries', () => {
    expect([...LUT_NAMES]).toEqual(['viridis', 'magma', 'inferno', 'plasma', 'cividis']);
    for (const name of LUT_NAMES) {
      expect(LUT_HEX[name]).toMatch(/^[0-9a-f]{1536}$/);
      expect(colormapLUT(name).length).toBe(768);
    }
  });

  it('every table is pinned by its SHA-256', () => {
    for (const name of LUT_NAMES) expect(toHex(sha256(colormapLUT(name))), name).toBe(HASH[name]);
  });

  it('rows of matplotlib\'s floating-point tables: the stored byte is round(255 v)', () => {
    for (const [name, k, r, g, b] of MPL_ROWS) {
      const t = colormapLUT(name as 'viridis');
      expect([t[3 * k], t[3 * k + 1], t[3 * k + 2]], `${name}[${k}]`).toEqual([Math.round(255 * r), Math.round(255 * g), Math.round(255 * b)]);
    }
  });

  it('colormapLUT returns a copy (the table cannot be modified through it)', () => {
    const a = colormapLUT('viridis');
    a[0] = 123;
    expect(colormapLUT('viridis')[0]).toBe(0x44);
  });

  it('smooth: no jump between neighbouring entries (second difference at most 2 per channel; cividis one of 3 where red leaves zero)', () => {
    for (const name of LUT_NAMES) {
      const t = colormapLUT(name);
      let worst = 0;
      for (let k = 1; k < 255; k++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(t[3 * (k + 1) + c] - 2 * t[3 * k + c] + t[3 * (k - 1) + c]));
      expect(worst, name).toBeLessThanOrEqual(name === 'cividis' ? 3 : 2);
    }
  });

  it('perceptually ordered: luminance never decreases along the map (up to one 8-bit step)', () => {
    for (const name of LUT_NAMES) {
      const t = colormapLUT(name);
      let prev = -1;
      for (let k = 0; k < 256; k++) {
        const L = luminance(t[3 * k], t[3 * k + 1], t[3 * k + 2]);
        expect(L, `${name}[${k}]`).toBeGreaterThanOrEqual(prev - 0.004);
        prev = Math.max(prev, L);
      }
      expect(luminance(t[765], t[766], t[767])).toBeGreaterThan(luminance(t[0], t[1], t[2]) + 0.5);
    }
  });

  it('colormap(name)(k/255) is entry k exactly; between the nodes the map is linear', () => {
    for (const name of LUT_NAMES) {
      const f = colormap(name), t = colormapLUT(name);
      for (const k of [0, 1, 37, 128, 254, 255]) expect(f(k / 255).map((v) => Math.round(255 * v)), `${name}[${k}]`).toEqual([t[3 * k], t[3 * k + 1], t[3 * k + 2]]);
      const mid = f(100.5 / 255), a = f(100 / 255), b = f(101 / 255);
      for (let c = 0; c < 3; c++) expect(mid[c]).toBeCloseTo((a[c] + b[c]) / 2, 12);
    }
  });

  it('out-of-range and non-finite input clamps; unknown names give viridis; reverse runs backwards', () => {
    const v = colormap('viridis');
    expect(v(-3)).toEqual(v(0));
    expect(v(7)).toEqual(v(1));
    expect(v(NaN)).toEqual(v(0));
    expect(colormap('no-such-map')(0.3)).toEqual(v(0.3));
    expect(colormap('constructor')(0.3)).toEqual(v(0.3)); // an Object.prototype key is not a colormap
    const r = colormap('inferno', true), f = colormap('inferno');
    for (const u of [0, 0.25, 0.6, 1]) expect(r(u)).toEqual(f(1 - u));
  });

  it('the ColorBrewer maps keep their anchor colours', () => {
    const rdbu = colormap('RdBu');
    expect(rdbu(0).map((x) => Math.round(255 * x))).toEqual([0x67, 0x00, 0x1f]);
    expect(rdbu(0.5).map((x) => Math.round(255 * x))).toEqual([0xf7, 0xf7, 0xf7]);
    expect(rdbu(1).map((x) => Math.round(255 * x))).toEqual([0x05, 0x30, 0x61]);
    expect(colormap('greys')(0)).toEqual([1, 1, 1]);
    expect(colormap('greys', true)(0)).toEqual([0, 0, 0]);
    expect(mix([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25]);
  });

  it('a colour bar shows the table itself: its 256 raster rows are the entries, top row = last entry', () => {
    for (const name of ['cividis', 'plasma']) {
      const fig = new Figure(3, 2.5);
      const [ax] = fig.subplots(1, 1, { right: 0.8 });
      const m = ax.image([1, 2, 3, 4], 2, 2, [0, 1, 0, 1], { cmap: name });
      fig.colorbar(m, ax, { label: 'z' });
      const bar = fig.render(fonts).prims.filter((p) => p.t === 'image').at(-1);
      if (!bar || bar.t !== 'image') throw new Error('no colour bar image');
      expect([bar.w, bar.h]).toEqual([1, 256]);
      const t = colormapLUT(name as 'plasma');
      for (let j = 0; j < 256; j++) expect([...bar.rgb.subarray(3 * j, 3 * j + 3)], `${name} row ${j}`).toEqual([...t.subarray(3 * (255 - j), 3 * (255 - j) + 3)]);
    }
  });
});
