/**
 * Görüntü listesi (display list): Figure/Axes çizimlerini arka uçtan bağımsız ilkellere çevirir.
 * Koordinatlar punto (1/72 inç), orijin sol-üst (y aşağı) — SVG kuralı; PDF arka ucu y'yi çevirir.
 */
import { Run } from './mathtext';

export type RGB = [number, number, number];

export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'];

export interface Style {
  stroke?: RGB | null;
  fill?: RGB | null;
  lw?: number;
  dash?: number[];
  alpha?: number; // dolgu ve çizgi saydamlığı
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
}

export type Prim =
  | { t: 'path'; d: PathCmd[]; s: Style }
  | { t: 'text'; runs: Run[]; x: number; y: number; size: number; anchor: 'start' | 'middle' | 'end'; baseline: 'alphabetic' | 'middle' | 'top' | 'bottom'; rotate: number; color: RGB }
  | { t: 'image'; w: number; h: number; rgb: Uint8Array; x: number; y: number; dw: number; dh: number; smooth: boolean }
  | { t: 'clip'; x: number; y: number; w: number; h: number }
  | { t: 'unclip' };

export class DisplayList {
  readonly prims: Prim[] = [];
  constructor(readonly width: number, readonly height: number) {}
  path(d: PathCmd[], s: Style): void { if (d.length) this.prims.push({ t: 'path', d, s }); }
  polyline(xs: ArrayLike<number>, ys: ArrayLike<number>, s: Style, closed = false): void {
    const d: PathCmd[] = [];
    let pen = false;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
      d.push(pen ? ['L', x, y] : ['M', x, y]);
      pen = true;
    }
    if (closed && d.length) d.push(['Z']);
    this.path(d, s);
  }
  rect(x: number, y: number, w: number, h: number, s: Style): void {
    this.path([['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], s);
  }
  circle(cx: number, cy: number, r: number, s: Style): void {
    const k = 0.5522847498 * r;
    this.path([
      ['M', cx + r, cy], ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r], ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
      ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r], ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy], ['Z'],
    ], s);
  }
  text(runs: Run[], x: number, y: number, size: number, o: { anchor?: 'start' | 'middle' | 'end'; baseline?: 'alphabetic' | 'middle' | 'top' | 'bottom'; rotate?: number; color?: RGB } = {}): void {
    this.prims.push({ t: 'text', runs, x, y, size, anchor: o.anchor ?? 'start', baseline: o.baseline ?? 'alphabetic', rotate: o.rotate ?? 0, color: o.color ?? [0, 0, 0] });
  }
  image(rgb: Uint8Array, w: number, h: number, x: number, y: number, dw: number, dh: number, smooth = true): void {
    this.prims.push({ t: 'image', rgb, w, h, x, y, dw, dh, smooth });
  }
  clip(x: number, y: number, w: number, h: number): void { this.prims.push({ t: 'clip', x, y, w, h }); }
  unclip(): void { this.prims.push({ t: 'unclip' }); }
}

export function hex(c: RGB): string {
  return '#' + c.map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0')).join('');
}
export function parseColor(s: string | RGB): RGB {
  if (Array.isArray(s)) return s;
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Taban çizgisi ofseti (pt, y aşağı pozitif) — metin kutusunu hizalamak için (Times metrikleri) */
export function baselineOffset(baseline: 'alphabetic' | 'middle' | 'top' | 'bottom', size: number): number {
  switch (baseline) {
    case 'top': return 0.72 * size;
    case 'middle': return 0.33 * size;
    case 'bottom': return -0.22 * size;
    default: return 0;
  }
}
