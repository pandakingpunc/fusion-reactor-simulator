/**
 * Colour palettes and colormaps.
 *  - Okabe & Ito (2008) colour-blind-safe qualitative palette (Nature Methods recommendation)
 *  - viridis, magma, inferno, plasma, cividis: the exact 256-entry tables of matplotlib
 *    (van der Walt & Smith; Nuñez, Anderton & Renslow 2018), see colormapData.ts for the sources.
 *    colormap(name)(k / 255) is entry k of the table; values in between are interpolated linearly
 *    in sRGB (a raster that is sampled at the nodes, such as a colour bar, shows the table itself).
 *  - RdBu (ColorBrewer, Brewer 2003) diverging and greys: interpolation between anchor colours
 */
import { RGB, parseColor } from './canvas';
import { LUT_HEX, LutName } from './colormapData';

export const OKABE_ITO = ['#0072B2', '#D55E00', '#009E73', '#E69F00', '#56B4E9', '#CC79A7', '#F0E442', '#000000'];
export const TOL_BRIGHT = ['#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377', '#BBBBBB'];

/** Anchor colours of the ColorBrewer maps (evenly spaced in u) */
const ANCHORS: Record<string, string[]> = {
  RdBu: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
  greys: ['#ffffff', '#f0f0f0', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525', '#000000'],
};

/** Names of the tabulated (256-entry) colormaps */
export const LUT_NAMES: readonly LutName[] = ['viridis', 'magma', 'inferno', 'plasma', 'cividis'];
export type ColormapName = LutName | keyof typeof ANCHORS;

const lutCache = new Map<LutName, Uint8Array>();

/** The 256-entry table of a tabulated colormap as 768 bytes (R, G, B of entry 0, 1, …, 255); a copy. */
export function colormapLUT(name: LutName): Uint8Array {
  let t = lutCache.get(name);
  if (!t) {
    const hex = LUT_HEX[name];
    t = new Uint8Array(768);
    for (let i = 0; i < 768; i++) t[i] = parseInt(hex.substr(2 * i, 2), 16);
    lutCache.set(name, t);
  }
  return t.slice();
}

const isLut = (name: string): name is LutName => (LUT_NAMES as readonly string[]).includes(name);
const isAnchor = (name: string) => Object.prototype.hasOwnProperty.call(ANCHORS, name);
const clamp01 = (u: number) => Math.min(Math.max(Number.isFinite(u) ? u : 0, 0), 1);

/**
 * Colormap function u ∈ [0, 1] → RGB (components 0…1). Unknown names give viridis; NaN gives the first
 * colour. `reverse` runs the map from its last colour to its first.
 */
export function colormap(name: ColormapName | string, reverse = false): (u: number) => RGB {
  if (!isAnchor(name)) {
    const bytes = colormapLUT(isLut(name) ? name : 'viridis');
    const lut = Float64Array.from(bytes, (b) => b / 255);
    const at = (i: number): RGB => { const p = (reverse ? 255 - i : i) * 3; return [lut[p], lut[p + 1], lut[p + 2]]; };
    return (u: number) => {
      const x = clamp01(u) * 255;
      const r = Math.round(x);
      if (Math.abs(x - r) < 1e-9) return at(r); // a node: exactly the table entry (colour bars sample the nodes)
      const i = Math.min(254, Math.floor(x)), t = x - i;
      const a = at(i), b = at(i + 1);
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
    };
  }
  const anchors = ANCHORS[name].map((h) => parseColor(h));
  if (reverse) anchors.reverse();
  const n = anchors.length - 1;
  return (u: number) => {
    const x = clamp01(u) * n;
    const i = Math.min(n - 1, Math.floor(x)), t = x - i;
    const a = anchors[i], b = anchors[i + 1];
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  };
}

/** Renk karıştırma (açma/koyulaştırma) */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}
