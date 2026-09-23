/**
 * Renk paletleri ve renk haritaları.
 *  - Okabe & Ito (2008) renk körü dostu nitel palet (Nature Methods önerisi)
 *  - viridis / magma / inferno (van der Walt & Smith, matplotlib; algısal olarak düzgün) — 9 çapa
 *    rengi arasında sRGB doğrusal interpolasyon
 *  - RdBu (ColorBrewer, Brewer 2003) ıraksak
 */
import { RGB, parseColor } from './canvas';

export const OKABE_ITO = ['#0072B2', '#D55E00', '#009E73', '#E69F00', '#56B4E9', '#CC79A7', '#F0E442', '#000000'];
export const TOL_BRIGHT = ['#4477AA', '#EE6677', '#228833', '#CCBB44', '#66CCEE', '#AA3377', '#BBBBBB'];

const ANCHORS: Record<string, string[]> = {
  viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
  magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'],
  inferno: ['#000004', '#1f0c48', '#550f6d', '#88226a', '#ba3655', '#e35933', '#f98e09', '#f9cb35', '#fcffa4'],
  RdBu: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
  greys: ['#ffffff', '#f0f0f0', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525', '#000000'],
};
export type ColormapName = keyof typeof ANCHORS;

export function colormap(name: ColormapName | string, reverse = false): (u: number) => RGB {
  const anchors = (ANCHORS[name] ?? ANCHORS.viridis).map((h) => parseColor(h));
  if (reverse) anchors.reverse();
  const n = anchors.length - 1;
  return (u: number) => {
    const x = Math.min(Math.max(Number.isFinite(u) ? u : 0, 0), 1) * n;
    const i = Math.min(n - 1, Math.floor(x)), t = x - i;
    const a = anchors[i], b = anchors[i + 1];
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  };
}

/** Renk karıştırma (açma/koyulaştırma) */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}
