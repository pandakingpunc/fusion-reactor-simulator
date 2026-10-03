/**
 * Yayın kalitesinde figür API'si (matplotlib benzeri, bağımlılıksız): Figure → Axes → sanatçılar.
 * Boyutlar inç/punto; varsayılanlar fizik dergisi stili: serif yazı 8 pt, içe dönük çentikler dört
 * kenarda, ince çerçeve, Okabe–Ito renk körü dostu palet. Çıktı: toSVG() / toPDF().
 * Text is measured with the STIX Two metrics of the FontSet passed to render()/toSVG()/toPDF().
 */
import { DisplayList, PathCmd, RGB, Style, parseColor } from './canvas';
import { Run, parseMath } from './mathtext';
import { Ticks, linearTicks, logTicks } from './ticks';
import { OKABE_ITO, colormap } from './colors';
import { contourLines } from './contour';
import { SvgOptions, toSVG } from './svg';
import { PdfOptions, toPDF, toPDFDocument } from './pdf';
import type { FontSet } from './fonts';

export type Dash = number[] | 'solid' | 'dashed' | 'dotted' | 'dashdot';
export type Marker = 'o' | 's' | '^' | 'v' | 'd' | 'x' | '+' | null;

export interface LineOpts {
  color?: string; lw?: number; dash?: Dash; label?: string; marker?: Marker; ms?: number; mfc?: string | 'none';
  alpha?: number; z?: number; step?: boolean;
}
export interface AxesOpts {
  xlim?: [number, number]; ylim?: [number, number]; xlabel?: string; ylabel?: string; title?: string;
  xscale?: 'linear' | 'log'; yscale?: 'linear' | 'log'; aspect?: 'auto' | 'equal'; grid?: boolean;
  xticks?: number[]; yticks?: number[]; xticklabels?: string[]; yticklabels?: string[];
  xmargin?: number; ymargin?: number; hideXLabels?: boolean; hideYLabels?: boolean; frame?: boolean;
}
export interface Mappable { cmap: (u: number) => RGB; vmin: number; vmax: number; log: boolean; label?: string }

type Artist =
  | { k: 'line'; x: ArrayLike<number>; y: ArrayLike<number>; o: LineOpts; color: RGB }
  | { k: 'fill'; x: ArrayLike<number>; y1: ArrayLike<number>; y2: ArrayLike<number>; color: RGB; alpha: number; label?: string; z: number }
  | { k: 'text'; x: number; y: number; s: string; coords: 'data' | 'axes'; size?: number; anchor: 'start' | 'middle' | 'end'; baseline: 'alphabetic' | 'middle' | 'top' | 'bottom'; color: RGB; rotate: number; box?: boolean; z: number }
  | { k: 'image'; rgb: Uint8Array; nx: number; ny: number; extent: [number, number, number, number]; smooth: boolean; z: number }
  | { k: 'hspan' | 'vspan'; a: number; b: number; color: RGB; alpha: number; z: number; label?: string }
  | { k: 'hline' | 'vline'; v: number; o: LineOpts; color: RGB }
  | { k: 'arrow'; x0: number; y0: number; x1: number; y1: number; color: RGB; lw: number; z: number }
  | { k: 'xmarks'; xs: number[]; color: RGB; frac: number; lw: number; label?: string; z: number }
  | { k: 'poly'; x: ArrayLike<number>; y: ArrayLike<number>; s: { stroke?: RGB; fill?: RGB; lw?: number; alpha?: number; dash?: Dash }; label?: string; z: number };

const DASHES: Record<string, number[]> = { dashed: [3.7, 1.6], dotted: [1, 1.65], dashdot: [6.4, 1.6, 1, 1.6] };
function dashArray(d: Dash | undefined, lw: number): number[] | undefined {
  if (!d || d === 'solid') return undefined;
  const base = Array.isArray(d) ? d : DASHES[d];
  return base.map((v) => v * Math.max(lw, 0.6));
}

export class Axes {
  readonly artists: Artist[] = [];
  opts: AxesOpts = {};
  private colorIdx = 0;
  private legendOpts: { loc: string; ncol: number; frame: boolean; size?: number } | null = null;
  private panel: string | null = null;
  shareX: Axes | null = null;
  twinOf: Axes | null = null;
  ySide: 'left' | 'right' = 'left';
  // çözümlenmiş (render sırasında)
  xl: [number, number] = [0, 1];
  yl: [number, number] = [0, 1];

  constructor(readonly fig: Figure, public x0: number, public y0: number, public w: number, public h: number) {}

  private nextColor(): RGB { return parseColor(OKABE_ITO[this.colorIdx++ % OKABE_ITO.length]); }

  plot(x: ArrayLike<number>, y: ArrayLike<number>, o: LineOpts = {}): this {
    this.artists.push({ k: 'line', x, y, o, color: o.color ? parseColor(o.color) : this.nextColor() });
    return this;
  }
  scatter(x: ArrayLike<number>, y: ArrayLike<number>, o: LineOpts = {}): this {
    return this.plot(x, y, { marker: 'o', ...o, lw: 0 });
  }
  fillBetween(x: ArrayLike<number>, y1: ArrayLike<number>, y2: ArrayLike<number> | number, o: { color?: string; alpha?: number; label?: string; z?: number } = {}): this {
    const y2a = typeof y2 === 'number' ? Array.from(x, () => y2) : y2;
    this.artists.push({ k: 'fill', x, y1, y2: y2a, color: o.color ? parseColor(o.color) : this.nextColor(), alpha: o.alpha ?? 0.25, label: o.label, z: o.z ?? 0 });
    return this;
  }
  axhspan(a: number, b: number, o: { color?: string; alpha?: number; label?: string } = {}): this {
    this.artists.push({ k: 'hspan', a, b, color: parseColor(o.color ?? '#888888'), alpha: o.alpha ?? 0.15, z: -1, label: o.label });
    return this;
  }
  axvspan(a: number, b: number, o: { color?: string; alpha?: number; label?: string } = {}): this {
    this.artists.push({ k: 'vspan', a, b, color: parseColor(o.color ?? '#888888'), alpha: o.alpha ?? 0.15, z: -1, label: o.label });
    return this;
  }
  axhline(v: number, o: LineOpts = {}): this { this.artists.push({ k: 'hline', v, o, color: parseColor(o.color ?? '#555555') }); return this; }
  axvline(v: number, o: LineOpts = {}): this { this.artists.push({ k: 'vline', v, o, color: parseColor(o.color ?? '#555555') }); return this; }
  text(x: number, y: number, s: string, o: { coords?: 'data' | 'axes'; size?: number; anchor?: 'start' | 'middle' | 'end'; baseline?: 'alphabetic' | 'middle' | 'top' | 'bottom'; color?: string; rotate?: number; box?: boolean } = {}): this {
    this.artists.push({ k: 'text', x, y, s, coords: o.coords ?? 'data', size: o.size, anchor: o.anchor ?? 'start', baseline: o.baseline ?? 'alphabetic', color: parseColor(o.color ?? '#000000'), rotate: o.rotate ?? 0, box: o.box, z: 10 });
    return this;
  }
  /** x veri, y eksen kesri: üst kenarda kısa dikey işaretler (olaylar); sınırları etkilemez */
  xmarks(xs: number[], o: { color?: string; frac?: number; lw?: number; label?: string } = {}): this {
    this.artists.push({ k: 'xmarks', xs, color: parseColor(o.color ?? '#555555'), frac: o.frac ?? 0.07, lw: o.lw ?? 0.5, label: o.label, z: 8 });
    return this;
  }
  arrow(x0: number, y0: number, x1: number, y1: number, o: { color?: string; lw?: number } = {}): this {
    this.artists.push({ k: 'arrow', x0, y0, x1, y1, color: parseColor(o.color ?? '#000000'), lw: o.lw ?? 0.7, z: 9 });
    return this;
  }
  polygon(x: ArrayLike<number>, y: ArrayLike<number>, o: { stroke?: string; fill?: string; lw?: number; alpha?: number; dash?: Dash; label?: string; z?: number } = {}): this {
    this.artists.push({ k: 'poly', x, y, s: { stroke: o.stroke ? parseColor(o.stroke) : undefined, fill: o.fill ? parseColor(o.fill) : undefined, lw: o.lw, alpha: o.alpha, dash: o.dash }, label: o.label, z: o.z ?? 1 });
    return this;
  }
  /** Kontur çizgileri (Z: ny×nx satır-öncelikli) */
  contour(x: ArrayLike<number>, y: ArrayLike<number>, Z: ArrayLike<number>, levels: number[], o: { colors?: string | string[]; cmap?: Mappable; lw?: number; dash?: Dash; label?: string; mask?: (i: number, j: number) => boolean } = {}): this {
    levels.forEach((lv, k) => {
      const col = o.cmap ? this.mapColor(o.cmap, lv) : parseColor(Array.isArray(o.colors) ? o.colors[k % o.colors.length] : o.colors ?? '#000000');
      for (const pl of contourLines(x, y, Z, lv, o.mask)) {
        this.artists.push({ k: 'line', x: pl.x, y: pl.y, o: { lw: o.lw ?? 0.6, dash: o.dash, label: k === 0 ? o.label : undefined }, color: col });
        o = { ...o, label: undefined };
      }
    });
    return this;
  }
  private mapColor(m: Mappable, v: number): RGB {
    const u = m.log ? (Math.log10(v) - Math.log10(m.vmin)) / (Math.log10(m.vmax) - Math.log10(m.vmin)) : (v - m.vmin) / (m.vmax - m.vmin);
    return m.cmap(u);
  }
  /** Isı haritası: Z (ny×nx) → raster (veri çözünürlüğünde; smooth: görüntüleyici interpolasyonu) */
  image(Z: ArrayLike<number>, nx: number, ny: number, extent: [number, number, number, number], o: { cmap?: string; vmin?: number; vmax?: number; log?: boolean; smooth?: boolean; mask?: (i: number, j: number) => boolean; bg?: string } = {}): Mappable {
    const [vmin, vmax] = colorLimits(Z, o.vmin, o.vmax, !!o.log);
    const m: Mappable = { cmap: colormap(o.cmap ?? 'viridis'), vmin, vmax, log: !!o.log };
    const bg = parseColor(o.bg ?? '#ffffff');
    const rgb = new Uint8Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = Z[j * nx + i];
      // missing data (NaN, ±∞, non-positive on a log scale, masked) shows the background
      const c = !Number.isFinite(v) || (o.log && v <= 0) || (o.mask && !o.mask(i, j)) ? bg : this.mapColor(m, v);
      const p = ((ny - 1 - j) * nx + i) * 3; // raster üstten aşağı
      rgb[p] = Math.round(c[0] * 255); rgb[p + 1] = Math.round(c[1] * 255); rgb[p + 2] = Math.round(c[2] * 255);
    }
    this.artists.push({ k: 'image', rgb, nx, ny, extent, smooth: o.smooth ?? true, z: -2 });
    return m;
  }
  set(o: AxesOpts): this { this.opts = { ...this.opts, ...o }; return this; }
  legend(o: { loc?: 'best' | 'upper right' | 'upper left' | 'lower left' | 'lower right' | 'upper center' | 'lower center' | 'center right'; ncol?: number; frame?: boolean; size?: number } = {}): this {
    this.legendOpts = { loc: o.loc ?? 'best', ncol: o.ncol ?? 1, frame: o.frame ?? false, size: o.size };
    return this;
  }
  panelLabel(s: string): this { this.panel = s; return this; }
  sharex(other: Axes): this { this.shareX = other; return this; }
  twinx(): Axes {
    const t = new Axes(this.fig, this.x0, this.y0, this.w, this.h);
    t.twinOf = this; t.ySide = 'right'; t.colorIdx = this.colorIdx + 2;
    this.fig.axes.push(t);
    return t;
  }

  // ---------------------------------------------------------------- render
  private tf(v: number, log: boolean) { return log ? Math.log10(v) : v; }
  X(v: number): number {
    const lg = this.opts.xscale === 'log', a = this.tf(this.xl[0], lg), b = this.tf(this.xl[1], lg);
    return this.x0 + ((this.tf(v, lg) - a) / (b - a)) * this.w;
  }
  Y(v: number): number {
    const lg = this.opts.yscale === 'log', a = this.tf(this.yl[0], lg), b = this.tf(this.yl[1], lg);
    return this.y0 + this.h - ((this.tf(v, lg) - a) / (b - a)) * this.h;
  }

  /** veri sınırları (+ kenar payı), eşit en-boy */
  resolveLimits(): void {
    const o = this.opts;
    const src = this.twinOf ? this.twinOf : this;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    const accX = (v: number) => { if (Number.isFinite(v) && (o.xscale !== 'log' || v > 0)) { xmin = Math.min(xmin, v); xmax = Math.max(xmax, v); } };
    const accY = (v: number) => { if (Number.isFinite(v) && (o.yscale !== 'log' || v > 0)) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); } };
    for (const a of this.artists) {
      if (a.k === 'line' || a.k === 'poly') for (let i = 0; i < a.x.length; i++) { if (Number.isFinite(a.y[i])) accX(a.x[i]); if (Number.isFinite(a.x[i])) accY(a.y[i]); }
      else if (a.k === 'fill') for (let i = 0; i < a.x.length; i++) { accX(a.x[i]); accY(a.y1[i]); accY(a.y2[i]); }
      else if (a.k === 'image') { accX(a.extent[0]); accX(a.extent[1]); accY(a.extent[2]); accY(a.extent[3]); }
      else if (a.k === 'text' && a.coords === 'data') { accX(a.x); accY(a.y); }
    }
    if (!Number.isFinite(xmin)) { xmin = o.xscale === 'log' ? 1 : 0; xmax = o.xscale === 'log' ? 10 : 1; }
    if (!Number.isFinite(ymin)) { ymin = o.yscale === 'log' ? 1 : 0; ymax = o.yscale === 'log' ? 10 : 1; }
    const pad = (lo: number, hi: number, m: number, log: boolean): [number, number] => {
      if (log) {
        if (!(hi > lo)) return [lo / Math.sqrt(10), hi * Math.sqrt(10)]; // one value (a constant series): a decade around it, as colorLimits; f = 1 gave [lo, lo] and NaN coordinates
        const f = Math.pow(hi / lo, m); return [lo / f, hi * f];
      }
      if (hi === lo) { const d = Math.abs(lo) * 0.1 || 1; return [lo - d, hi + d]; }
      const d = (hi - lo) * m; return [lo - d, hi + d];
    };
    const hasImage = this.artists.some((a) => a.k === 'image');
    // user limits that cannot be drawn (non-finite, empty, non-positive on a log axis — e.g. from all-NaN data) fall back to the data range
    const usable = (l: [number, number] | undefined, log: boolean) => (l && Number.isFinite(l[0]) && Number.isFinite(l[1]) && l[0] !== l[1] && (!log || (l[0] > 0 && l[1] > 0)) ? l : undefined);
    this.xl = usable(o.xlim, o.xscale === 'log') ?? (this.shareX ? this.shareX.xl : src !== this ? src.xl : pad(xmin, xmax, o.xmargin ?? (hasImage ? 0 : 0.02), o.xscale === 'log'));
    this.yl = usable(o.ylim, o.yscale === 'log') ?? pad(ymin, ymax, o.ymargin ?? (hasImage ? 0 : 0.05), o.yscale === 'log');
    if (o.aspect === 'equal') {
      const dx = this.xl[1] - this.xl[0], dy = this.yl[1] - this.yl[0];
      const s = Math.max(dx / this.w, dy / this.h);
      const cx = 0.5 * (this.xl[0] + this.xl[1]), cy = 0.5 * (this.yl[0] + this.yl[1]);
      this.xl = [cx - (s * this.w) / 2, cx + (s * this.w) / 2];
      this.yl = [cy - (s * this.h) / 2, cy + (s * this.h) / 2];
    }
  }

  private ticksFor(axis: 'x' | 'y'): Ticks {
    const o = this.opts;
    const lim = axis === 'x' ? this.xl : this.yl;
    const log = (axis === 'x' ? o.xscale : o.yscale) === 'log';
    const user = axis === 'x' ? o.xticks : o.yticks;
    const t = log ? logTicks(lim[0], lim[1]) : linearTicks(lim[0], lim[1], axis === 'x' ? Math.max(3, Math.round(this.w / 50)) : Math.max(3, Math.round(this.h / 38)));
    if (user) {
      const labels = (axis === 'x' ? o.xticklabels : o.yticklabels) ?? user.map((v) => String(+v.toPrecision(6)).replace('-', '−'));
      return { major: user, minor: [], labels };
    }
    return t;
  }

  render(dl: DisplayList): void {
    const fs = this.fig.fontSize;
    const o = this.opts;
    const fonts = dl.fonts;
    const P = (s: string) => parseMath(s, fonts);
    const lwFrame = 0.6;
    const black: RGB = [0, 0, 0];
    // arka plan artistleri: kesme bölgesi
    dl.clip(this.x0, this.y0, this.w, this.h);
    const sorted = [...this.artists].sort((a, b) => zOf(a) - zOf(b));
    for (const a of sorted) this.drawArtist(dl, a);
    dl.unclip();
    // ızgara
    const tx = this.ticksFor('x'), ty = this.ticksFor('y');
    if (o.grid) {
      for (const v of tx.major) { const px = this.X(v); dl.path([['M', px, this.y0], ['L', px, this.y0 + this.h]], { stroke: [0.85, 0.85, 0.85], lw: 0.4 }); }
      for (const v of ty.major) { const py = this.Y(v); dl.path([['M', this.x0, py], ['L', this.x0 + this.w, py]], { stroke: [0.85, 0.85, 0.85], lw: 0.4 }); }
    }
    // çerçeve
    if (o.frame !== false && !this.twinOf) dl.rect(this.x0, this.y0, this.w, this.h, { stroke: black, lw: lwFrame });
    // çentikler (içe dönük)
    const inRange = (v: number, lim: [number, number]) => v >= Math.min(lim[0], lim[1]) - 1e-12 * Math.abs(lim[1] - lim[0]) && v <= Math.max(lim[0], lim[1]) + 1e-12 * Math.abs(lim[1] - lim[0]);
    const L = 3.5, Lm = 2;
    const tickStyle: Style = { stroke: black, lw: lwFrame };
    if (!this.twinOf) {
      for (const [vals, len] of [[tx.major, L], [tx.minor, Lm]] as const) for (const v of vals) {
        if (!inRange(v, this.xl)) continue;
        const px = this.X(v);
        dl.path([['M', px, this.y0 + this.h], ['L', px, this.y0 + this.h - len]], tickStyle);
        dl.path([['M', px, this.y0], ['L', px, this.y0 + len]], tickStyle);
      }
    }
    const yRight = this.ySide === 'right';
    const hasTwin = this.fig.axes.some((a) => a.twinOf === this);
    for (const [vals, len] of [[ty.major, L], [ty.minor, Lm]] as const) for (const v of vals) {
      if (!inRange(v, this.yl)) continue;
      const py = this.Y(v);
      if (!yRight) dl.path([['M', this.x0, py], ['L', this.x0 + len, py]], tickStyle);
      if (yRight || !hasTwin) dl.path([['M', this.x0 + this.w, py], ['L', this.x0 + this.w - len, py]], tickStyle);
    }
    // etiketler
    const gap = 3;
    let maxYLabelW = 0;
    if (!o.hideYLabels) ty.major.forEach((v, k) => {
      if (!inRange(v, this.yl)) return;
      const runs = P(ty.labels[k]);
      maxYLabelW = Math.max(maxYLabelW, fonts.runsWidth(runs, fs));
      dl.text(runs, yRight ? this.x0 + this.w + gap : this.x0 - gap, this.Y(v), fs, { anchor: yRight ? 'start' : 'end', baseline: 'middle' });
    });
    if (!o.hideXLabels && !this.twinOf) tx.major.forEach((v, k) => {
      if (!inRange(v, this.xl)) return;
      dl.text(P(tx.labels[k]), this.X(v), this.y0 + this.h + gap, fs, { anchor: 'middle', baseline: 'top' });
    });
    if (o.xlabel && !o.hideXLabels && !this.twinOf) dl.text(P(o.xlabel), this.x0 + this.w / 2, this.y0 + this.h + gap + fs * 1.15 + 2, fs, { anchor: 'middle', baseline: 'top' });
    // shared multiplier / offset of the tick labels, once at the axis end (matplotlib convention)
    if (tx.offset && !o.hideXLabels && !this.twinOf) dl.text(P(tx.offset), this.x0 + this.w, this.y0 + this.h + gap + fs * 1.15 + 2, fs, { anchor: 'end', baseline: 'top' });
    if (ty.offset && !o.hideYLabels) dl.text(P(ty.offset), yRight ? this.x0 + this.w : this.x0, this.y0 - 2, fs, { anchor: yRight ? 'end' : 'start', baseline: 'bottom' });
    if (o.ylabel) {
      // 90° döndürülmüş (aşağıdan yukarı okunur); solda glif tabanı eksene, sağda glif tepesi eksene bakar
      const xL = yRight ? this.x0 + this.w + gap + maxYLabelW + 3 : this.x0 - gap - maxYLabelW - 3;
      dl.text(P(o.ylabel), xL, this.y0 + this.h / 2, fs, { anchor: 'middle', baseline: yRight ? 'top' : 'bottom', rotate: 90 });
    }
    if (o.title) dl.text(P(o.title), this.x0 + this.w / 2, this.y0 - 4, fs, { anchor: 'middle', baseline: 'bottom' });
    if (this.panel) {
      // yarı saydam beyaz zemin: panel etiketi veri çizgileri üzerinde de okunur kalır
      const pr: Run[] = [{ text: this.panel, font: 'bold', scale: 1, rise: 0 }];
      dl.rect(this.x0 + 2.5, this.y0 + 2.5, fonts.runsWidth(pr, fs + 0.5) + 3, fs + 2.5, { fill: [1, 1, 1], alpha: 0.8 });
      dl.text(pr, this.x0 + 4, this.y0 + 4, fs + 0.5, { anchor: 'start', baseline: 'top' });
    }
    if (this.legendOpts) this.drawLegend(dl);
  }

  private drawArtist(dl: DisplayList, a: Artist): void {
    switch (a.k) {
      case 'line': {
        const lw = a.o.lw ?? 1.2;
        const n = a.x.length;
        const xs = new Float64Array(n), ys = new Float64Array(n);
        const lx = this.opts.xscale === 'log', ly = this.opts.yscale === 'log';
        for (let i = 0; i < n; i++) {
          xs[i] = lx && a.x[i] <= 0 ? NaN : this.X(a.x[i]);
          ys[i] = ly && a.y[i] <= 0 ? NaN : this.Y(a.y[i]);
        }
        if (lw > 0) {
          if (a.o.step) {
            const sx: number[] = [], sy: number[] = [];
            for (let i = 0; i < n; i++) { if (i > 0) { sx.push(xs[i]); sy.push(ys[i - 1]); } sx.push(xs[i]); sy.push(ys[i]); }
            dl.polyline(sx, sy, { stroke: a.color, lw, dash: dashArray(a.o.dash, lw), alpha: a.o.alpha, join: 'round' });
          } else {
            const [dx, dy] = decimateMinMax(xs, ys);
            const [sx, sy] = simplify(dx, dy);
            dl.polyline(sx, sy, { stroke: a.color, lw, dash: dashArray(a.o.dash, lw), alpha: a.o.alpha, join: 'round', cap: 'butt' });
          }
        }
        if (a.o.marker) for (let i = 0; i < n; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) drawMarker(dl, a.o.marker, xs[i], ys[i], a.o.ms ?? 3.2, a.color, a.o.mfc);
        break;
      }
      case 'fill': {
        const d: PathCmd[] = [];
        for (let i = 0; i < a.x.length; i++) d.push([i ? 'L' : 'M', this.X(a.x[i]), this.Y(a.y1[i])]);
        for (let i = a.x.length - 1; i >= 0; i--) d.push(['L', this.X(a.x[i]), this.Y(a.y2[i])]);
        d.push(['Z']);
        dl.path(d, { fill: a.color, alpha: a.alpha });
        break;
      }
      case 'hspan': dl.rect(this.x0, Math.min(this.Y(a.a), this.Y(a.b)), this.w, Math.abs(this.Y(a.a) - this.Y(a.b)), { fill: a.color, alpha: a.alpha }); break;
      case 'vspan': dl.rect(Math.min(this.X(a.a), this.X(a.b)), this.y0, Math.abs(this.X(a.a) - this.X(a.b)), this.h, { fill: a.color, alpha: a.alpha }); break;
      case 'hline': { const lw = a.o.lw ?? 0.6; const py = this.Y(a.v); dl.path([['M', this.x0, py], ['L', this.x0 + this.w, py]], { stroke: a.color, lw, dash: dashArray(a.o.dash ?? 'dashed', lw) }); break; }
      case 'vline': { const lw = a.o.lw ?? 0.6; const px = this.X(a.v); dl.path([['M', px, this.y0], ['L', px, this.y0 + this.h]], { stroke: a.color, lw, dash: dashArray(a.o.dash ?? 'dashed', lw) }); break; }
      case 'image': {
        const [x0, x1, y0, y1] = a.extent;
        const px0 = this.X(x0), px1 = this.X(x1), py0 = this.Y(y1), py1 = this.Y(y0);
        dl.image(a.rgb, a.nx, a.ny, Math.min(px0, px1), Math.min(py0, py1), Math.abs(px1 - px0), Math.abs(py1 - py0), a.smooth);
        break;
      }
      case 'poly': {
        const xs = Array.from(a.x, (v) => this.X(v)), ys = Array.from(a.y, (v) => this.Y(v));
        dl.polyline(xs, ys, { stroke: a.s.stroke ?? null, fill: a.s.fill ?? null, lw: a.s.lw ?? 0.8, alpha: a.s.alpha, dash: dashArray(a.s.dash, a.s.lw ?? 0.8), join: 'round' }, true);
        break;
      }
      case 'xmarks': {
        const { ticks, bands } = aggregateMarks(a.xs.map((v) => this.X(v)), Math.max(2 * a.lw, 0.8));
        const y1 = this.y0 + a.frac * this.h;
        const d: PathCmd[] = [];
        for (const px of ticks) d.push(['M', px, this.y0], ['L', px, y1]);
        dl.path(d, { stroke: a.color, lw: a.lw });
        // runs of marks closer than the separation (e.g. hundreds of ELMs) become one band
        const b: PathCmd[] = [];
        for (const [p0, p1] of bands) b.push(['M', p0 - a.lw / 2, this.y0], ['L', p1 + a.lw / 2, this.y0], ['L', p1 + a.lw / 2, y1], ['L', p0 - a.lw / 2, y1], ['Z']);
        dl.path(b, { fill: a.color, alpha: 0.75 });
        break;
      }
      case 'arrow': {
        const x0 = this.X(a.x0), y0 = this.Y(a.y0), x1 = this.X(a.x1), y1 = this.Y(a.y1);
        dl.path([['M', x0, y0], ['L', x1, y1]], { stroke: a.color, lw: a.lw });
        const ang = Math.atan2(y1 - y0, x1 - x0), hl = 4, hw = 1.8;
        const bx = x1 - hl * Math.cos(ang), by = y1 - hl * Math.sin(ang);
        dl.path([['M', x1, y1], ['L', bx + hw * Math.sin(ang), by - hw * Math.cos(ang)], ['L', bx - hw * Math.sin(ang), by + hw * Math.cos(ang)], ['Z']], { fill: a.color });
        break;
      }
      case 'text': {
        const px = a.coords === 'axes' ? this.x0 + a.x * this.w : this.X(a.x);
        const py = a.coords === 'axes' ? this.y0 + (1 - a.y) * this.h : this.Y(a.y);
        const size = a.size ?? this.fig.fontSize;
        const runs = parseMath(a.s, dl.fonts);
        if (a.box) {
          const w = dl.fonts.runsWidth(runs, size);
          const bx = a.anchor === 'middle' ? px - w / 2 : a.anchor === 'end' ? px - w : px;
          const by = a.baseline === 'middle' ? py - 0.55 * size : a.baseline === 'top' ? py : py - 0.85 * size;
          dl.rect(bx - 1.5, by - 1, w + 3, size * 1.15 + 1, { fill: [1, 1, 1], alpha: 0.85 });
        }
        dl.text(runs, px, py, size, { anchor: a.anchor, baseline: a.baseline, color: a.color, rotate: a.rotate });
        break;
      }
    }
  }

  private drawLegend(dl: DisplayList): void {
    const lo = this.legendOpts!;
    const fonts = dl.fonts;
    const items: { runs: Run[]; a: Artist }[] = [];
    const owned: [Artist, Axes][] = [
      ...this.artists.map((a): [Artist, Axes] => [a, this]),
      ...this.fig.axes.filter((x) => x.twinOf === this).flatMap((x) => x.artists.map((a): [Artist, Axes] => [a, x])),
    ];
    for (const [a] of owned) {
      const label = a.k === 'line' || a.k === 'hline' || a.k === 'vline' ? a.o.label : a.k === 'fill' || a.k === 'hspan' || a.k === 'vspan' || a.k === 'poly' || a.k === 'xmarks' ? a.label : undefined;
      if (label) items.push({ runs: parseMath(label, fonts), a });
    }
    if (!items.length) return;
    const L = legendLayout(items.map((it) => fonts.runsWidth(it.runs, 1)), lo.ncol, lo.size ?? this.fig.fontSize - 0.5, this.w - 6, this.h - 6);
    const { fs, nrow, colW, rowH, W, H } = L;
    const sampleW = LEGEND_SAMPLE_W, pad = LEGEND_PAD;
    // sol üst köşede panel etiketi varsa lejantı sağına kaydır
    const panelW = this.panel ? fonts.runsWidth([{ text: this.panel, font: 'bold', scale: 1, rise: 0 }], this.fig.fontSize + 0.5) + 6 : 0;
    const cands: Record<string, [number, number]> = {
      'upper right': [this.x0 + this.w - W - 3, this.y0 + 3], 'upper left': [this.x0 + 3 + panelW, this.y0 + 3],
      'lower left': [this.x0 + 3, this.y0 + this.h - H - 3], 'lower right': [this.x0 + this.w - W - 3, this.y0 + this.h - H - 3],
      'upper center': [this.x0 + (this.w - W) / 2, this.y0 + 3], 'lower center': [this.x0 + (this.w - W) / 2, this.y0 + this.h - H - 3],
      'center right': [this.x0 + this.w - W - 3, this.y0 + (this.h - H) / 2],
    };
    let loc = lo.loc;
    if (loc === 'best') {
      // en az veri noktası örten köşe
      let best = Infinity;
      for (const [key, [bx, by]] of Object.entries(cands)) {
        let cnt = key.includes('center') && !key.startsWith('center') ? 0.5 : 0;
        for (const [a, ax] of owned) {
          if (a.k !== 'line' && a.k !== 'fill') continue;
          const n = a.x.length, stride = Math.max(1, Math.floor(n / 200));
          for (let i = 0; i < n; i += stride) {
            const yv = a.k === 'line' ? a.y[i] : a.y1[i];
            const px = ax.X(a.x[i]), py = ax.Y(yv);
            if (px >= bx - 2 && px <= bx + W + 2 && py >= by - 2 && py <= by + H + 2) cnt++;
          }
        }
        if (cnt < best) { best = cnt; loc = key; }
      }
    }
    const [bx, by] = cands[loc] ?? cands['upper right'];
    if (lo.frame) dl.rect(bx, by, W, H, { fill: [1, 1, 1], stroke: [0.6, 0.6, 0.6], lw: 0.4, alpha: 0.9 });
    items.forEach((it, k) => {
      const c = Math.floor(k / nrow), r = k % nrow;
      const x = bx + pad + colW.slice(0, c).reduce((s, v) => s + v + LEGEND_COL_GAP, 0);
      const y = by + pad + (r + 0.5) * rowH;
      const a = it.a;
      if (a.k === 'line') {
        const lw = a.o.lw ?? 1.2;
        if (lw > 0) dl.path([['M', x, y], ['L', x + sampleW, y]], { stroke: a.color, lw, dash: dashArray(a.o.dash, lw), alpha: a.o.alpha });
        if (a.o.marker) drawMarker(dl, a.o.marker, x + sampleW / 2, y, a.o.ms ?? 3.2, a.color, a.o.mfc);
      } else if (a.k === 'hline' || a.k === 'vline') {
        const lw = a.o.lw ?? 0.6;
        dl.path([['M', x, y], ['L', x + sampleW, y]], { stroke: a.color, lw, dash: dashArray(a.o.dash ?? 'dashed', lw) });
      } else if (a.k === 'fill') dl.rect(x, y - fs * 0.35, sampleW, fs * 0.7, { fill: a.color, alpha: Math.max(a.alpha, 0.35) });
      else if (a.k === 'hspan' || a.k === 'vspan') dl.rect(x, y - fs * 0.35, sampleW, fs * 0.7, { fill: a.color, alpha: Math.min(1, a.alpha * 1.6) });
      else if (a.k === 'poly') dl.rect(x, y - fs * 0.35, sampleW, fs * 0.7, { fill: a.s.fill ?? null, stroke: a.s.stroke ?? null, lw: a.s.lw ?? 0.8, alpha: a.s.alpha });
      else if (a.k === 'xmarks') dl.path([['M', x + sampleW / 2, y - fs * 0.4], ['L', x + sampleW / 2, y + fs * 0.4]], { stroke: a.color, lw: a.lw * 1.5 });
      dl.text(it.runs, x + sampleW + 4, y, fs, { anchor: 'start', baseline: 'middle' });
    });
  }
}

function zOf(a: Artist): number {
  if (a.k === 'line') return a.o.z ?? 2;
  return 'z' in a ? a.z : a.o.z ?? 1;
}

// çizgi sadeleştirme: 0.25 pt'den yakın ardışık noktaları at (dosya boyutu; görsel fark yok)
function simplify(xs: ArrayLike<number>, ys: ArrayLike<number>): [number[], number[]] {
  const n = xs.length;
  const ox: number[] = [], oy: number[] = [];
  let lastX = -Infinity, lastY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) { ox.push(NaN); oy.push(NaN); lastX = -Infinity; continue; }
    if (i > 0 && i < n - 1 && Math.abs(x - lastX) < 0.25 && Math.abs(y - lastY) < 0.25) continue;
    ox.push(x); oy.push(y); lastX = x; lastY = y;
  }
  return [ox, oy];
}

const LEGEND_SAMPLE_W = 16, LEGEND_PAD = 3, LEGEND_COL_GAP = 8;

export interface LegendLayout { ncol: number; fs: number; nrow: number; colW: number[]; rowH: number; W: number; H: number }

/**
 * Legend box layout from the label widths (em). Overflow handling: when the box is wider than
 * `maxW` it is re-flowed into fewer columns; when taller than `maxH`, spare width buys more columns;
 * as a last resort the text shrinks (not below 4.5 pt).
 */
export function legendLayout(labelEm: number[], ncol: number, fs: number, maxW: number, maxH: number): LegendLayout {
  const measure = (nc: number, size: number): LegendLayout => {
    const nrow = Math.ceil(labelEm.length / nc);
    const colW: number[] = new Array(nc).fill(0);
    labelEm.forEach((w, k) => { const c = Math.floor(k / nrow); colW[c] = Math.max(colW[c], LEGEND_SAMPLE_W + 4 + w * size); });
    const rowH = size * 1.3;
    return { ncol: nc, fs: size, nrow, colW, rowH, W: colW.reduce((s, v) => s + v, 0) + LEGEND_COL_GAP * (nc - 1) + 2 * LEGEND_PAD, H: nrow * rowH + 2 * LEGEND_PAD };
  };
  let L = measure(Math.max(1, Math.min(ncol, labelEm.length)), fs);
  while (L.W > maxW && L.ncol > 1) L = measure(L.ncol - 1, L.fs);
  while (L.H > maxH && L.ncol < labelEm.length) { const m = measure(L.ncol + 1, L.fs); if (m.W > maxW) break; L = m; }
  for (let guard = 0; (L.W > maxW || L.H > maxH) && L.fs > 4.5 && guard < 40; guard++) L = measure(L.ncol, Math.max(4.5, L.fs * 0.94));
  return L;
}

/**
 * Min/max ("M4") decimation of an x-monotone polyline in device space: per column of width `col`
 * (pt) only the first, lowest, highest and last points are kept, in their original order — the
 * drawn envelope is unchanged while a long time series shrinks to at most 4 points per column.
 * Series that are short, not monotone in x, or would not shrink are returned unchanged.
 * Reference: U. Jugel, Z. Jerzak, G. Hackenbroich, V. Markl, "M4: A visualization-oriented time
 * series data aggregation", Proc. VLDB Endowment 7(10), 797–808 (2014).
 */
export function decimateMinMax(xs: ArrayLike<number>, ys: ArrayLike<number>, col = 0.25): [ArrayLike<number>, ArrayLike<number>] {
  const n = xs.length;
  if (n < 64) return [xs, ys];
  let prev = -Infinity;
  for (let i = 0; i < n; i++) { const x = xs[i]; if (!Number.isFinite(x) || !Number.isFinite(ys[i])) continue; if (x < prev) return [xs, ys]; prev = x; }
  const ox: number[] = [], oy: number[] = [];
  let c = NaN, iF = -1, iMin = -1, iMax = -1, iL = -1;
  const flush = () => {
    if (iF < 0) return;
    const idx = [...new Set([iF, iMin, iMax, iL])].sort((a, b) => a - b);
    for (const k of idx) { ox.push(xs[k]); oy.push(ys[k]); }
    iF = -1;
  };
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) { flush(); ox.push(NaN); oy.push(NaN); c = NaN; continue; }
    const k = Math.floor(x / col);
    if (k !== c) { flush(); c = k; iF = iMin = iMax = iL = i; }
    else { iL = i; if (y < ys[iMin]) iMin = i; if (y > ys[iMax]) iMax = i; }
  }
  flush();
  return ox.length < 0.9 * n ? [ox, oy] : [xs, ys];
}

/** Event marks in device x: isolated marks stay ticks, runs of >= 3 marks closer than `sep` (pt) become bands [x0, x1]. */
export function aggregateMarks(px: number[], sep: number): { ticks: number[]; bands: [number, number][] } {
  const xs = px.filter(Number.isFinite).sort((a, b) => a - b);
  const ticks: number[] = [], bands: [number, number][] = [];
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] - xs[j] < sep) j++;
    if (j - i >= 2) bands.push([xs[i], xs[j]]);
    else for (let k = i; k <= j; k++) ticks.push(xs[k]);
    i = j + 1;
  }
  return { ticks, bands };
}

/**
 * Colour-scale limits that are always finite and increasing: the range of the finite (and, on a log
 * scale, positive) data, overridden by valid vmin/vmax; empty or degenerate ranges are widened.
 */
export function colorLimits(Z: ArrayLike<number>, vmin?: number, vmax?: number, log = false): [number, number] {
  const ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && (!log || v > 0);
  const fixLo = ok(vmin), fixHi = ok(vmax);
  let lo = fixLo ? vmin! : Infinity, hi = fixHi ? vmax! : -Infinity;
  if (!fixLo || !fixHi) for (let k = 0; k < Z.length; k++) {
    const v = Z[k];
    if (!ok(v)) continue;
    if (!fixLo && v < lo) lo = v;
    if (!fixHi && v > hi) hi = v;
  }
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return log ? [1, 10] : [0, 1];
  if (!Number.isFinite(lo)) lo = log ? hi / 10 : hi - 1;
  if (!Number.isFinite(hi)) hi = log ? lo * 10 : lo + 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    if (log) { lo /= Math.sqrt(10); hi *= Math.sqrt(10); }
    else { const d = Math.abs(lo) * 0.1 || 0.5; lo -= d; hi += d; }
  }
  return [lo, hi];
}

function drawMarker(dl: DisplayList, m: Exclude<Marker, null>, x: number, y: number, s: number, c: RGB, mfc?: string): void {
  const fill = mfc === 'none' ? null : mfc ? parseColor(mfc) : c;
  const st: Style = { fill, stroke: c, lw: 0.6 };
  const r = s / 2;
  switch (m) {
    case 'o': dl.circle(x, y, r, st); break;
    case 's': dl.rect(x - r, y - r, s, s, st); break;
    case '^': dl.path([['M', x, y - r * 1.15], ['L', x + r, y + r * 0.7], ['L', x - r, y + r * 0.7], ['Z']], st); break;
    case 'v': dl.path([['M', x, y + r * 1.15], ['L', x + r, y - r * 0.7], ['L', x - r, y - r * 0.7], ['Z']], st); break;
    case 'd': dl.path([['M', x, y - r * 1.2], ['L', x + r * 0.85, y], ['L', x, y + r * 1.2], ['L', x - r * 0.85, y], ['Z']], st); break;
    case 'x': dl.path([['M', x - r, y - r], ['L', x + r, y + r], ['M', x - r, y + r], ['L', x + r, y - r]], { stroke: c, lw: 0.8 }); break;
    case '+': dl.path([['M', x - r, y], ['L', x + r, y], ['M', x, y - r], ['L', x, y + r]], { stroke: c, lw: 0.8 }); break;
  }
}

export interface FigureRenderOptions {
  /** STIX Two font set used for text layout (and embedded by the PDF back end) */
  fonts: FontSet;
}

export interface SubplotsOpts { left?: number; right?: number; top?: number; bottom?: number; wspace?: number; hspace?: number; widthRatios?: number[]; heightRatios?: number[] }

export class Figure {
  readonly axes: Axes[] = [];
  readonly W: number;
  readonly H: number;
  private cbars: { m: Mappable; ax: Axes; label?: string; x: number; y: number; w: number; h: number; ticks?: number[] }[] = [];
  private texts: { s: string; x: number; y: number; size: number; anchor: 'start' | 'middle' | 'end' }[] = [];
  /** width/height inç; fontSize pt (dergi: 7–9 pt) */
  constructor(widthIn: number, heightIn: number, readonly o: { fontSize?: number; title?: string } = {}) {
    this.W = widthIn * 72; this.H = heightIn * 72;
  }
  get fontSize(): number { return this.o.fontSize ?? 8; }

  /** figür kesirleriyle eksen ekle: [sol, alt, genişlik, yükseklik] (matplotlib add_axes gibi) */
  addAxes(rect: [number, number, number, number]): Axes {
    const [l, b, w, h] = rect;
    const ax = new Axes(this, l * this.W, (1 - b - h) * this.H, w * this.W, h * this.H);
    this.axes.push(ax);
    return ax;
  }
  /** Izgara düzeni; kenar boşlukları ve aralıklar inç cinsinden */
  subplots(nrows: number, ncols: number, o: SubplotsOpts = {}): Axes[] {
    const L = (o.left ?? 0.55) * 72, R = (o.right ?? 0.15) * 72, T = (o.top ?? 0.15) * 72, B = (o.bottom ?? 0.45) * 72;
    const ws = (o.wspace ?? 0.55) * 72, hs = (o.hspace ?? 0.4) * 72;
    const wr = o.widthRatios ?? new Array(ncols).fill(1), hr = o.heightRatios ?? new Array(nrows).fill(1);
    const aw = this.W - L - R - ws * (ncols - 1), ah = this.H - T - B - hs * (nrows - 1);
    const sw = wr.reduce((s, v) => s + v, 0), sh = hr.reduce((s, v) => s + v, 0);
    const out: Axes[] = [];
    let y = T;
    for (let r = 0; r < nrows; r++) {
      const h = (ah * hr[r]) / sh;
      let x = L;
      for (let c = 0; c < ncols; c++) {
        const w = (aw * wr[c]) / sw;
        const ax = new Axes(this, x, y, w, h);
        this.axes.push(ax); out.push(ax);
        x += w + ws;
      }
      y += h + hs;
    }
    return out;
  }
  /** Eksenin sağına renk çubuğu */
  colorbar(m: Mappable, ax: Axes, o: { label?: string; width?: number; pad?: number; ticks?: number[] } = {}): void {
    const pad = (o.pad ?? 0.08) * 72, w = (o.width ?? 0.1) * 72;
    this.cbars.push({ m: { ...m, label: o.label }, ax, label: o.label, x: ax.x0 + ax.w + pad, y: ax.y0, w, h: ax.h, ticks: o.ticks });
  }
  /** figür koordinatında metin (kesir, sol-alt orijin) */
  text(x: number, y: number, s: string, o: { size?: number; anchor?: 'start' | 'middle' | 'end' } = {}): void {
    this.texts.push({ s, x, y, size: o.size ?? this.fontSize, anchor: o.anchor ?? 'start' });
  }

  /** Lays the figure out with the given fonts (text metrics) into a back-end independent display list. */
  render(fonts: FontSet): DisplayList {
    const dl = new DisplayList(this.W, this.H, fonts);
    const P = (s: string) => parseMath(s, fonts);
    // önce paylaşılan eksenlerin kaynakları
    const order = [...this.axes].sort((a, b) => Number(!!a.shareX || !!a.twinOf) - Number(!!b.shareX || !!b.twinOf));
    for (const ax of order) ax.resolveLimits();
    for (const ax of this.axes) ax.render(dl);
    for (const cb of this.cbars) {
      const N = 256;
      const rgb = new Uint8Array(N * 3);
      for (let j = 0; j < N; j++) {
        const c = cb.m.cmap(1 - j / (N - 1));
        rgb[j * 3] = Math.round(c[0] * 255); rgb[j * 3 + 1] = Math.round(c[1] * 255); rgb[j * 3 + 2] = Math.round(c[2] * 255);
      }
      dl.image(rgb, 1, N, cb.x, cb.y, cb.w, cb.h, true);
      dl.rect(cb.x, cb.y, cb.w, cb.h, { stroke: [0, 0, 0], lw: 0.6 });
      const [vmin, vmax] = colorLimits([], cb.m.vmin, cb.m.vmax, cb.m.log);
      const t = cb.m.log ? logTicks(vmin, vmax) : linearTicks(vmin, vmax, 5);
      const vals = cb.ticks ?? t.major;
      const labels = cb.ticks ? cb.ticks.map((v) => String(+v.toPrecision(4)).replace('-', '−')) : t.labels;
      let maxW = 0;
      vals.forEach((v, k) => {
        const u = cb.m.log ? (Math.log10(v) - Math.log10(vmin)) / (Math.log10(vmax) - Math.log10(vmin)) : (v - vmin) / (vmax - vmin);
        if (!(u >= -1e-9 && u <= 1 + 1e-9)) return;
        const py = cb.y + (1 - u) * cb.h;
        dl.path([['M', cb.x + cb.w, py], ['L', cb.x + cb.w - 2.5, py]], { stroke: [0, 0, 0], lw: 0.6 });
        const runs = P(labels[k]);
        maxW = Math.max(maxW, fonts.runsWidth(runs, this.fontSize));
        dl.text(runs, cb.x + cb.w + 2.5, py, this.fontSize, { anchor: 'start', baseline: 'middle' });
      });
      if (t.offset && !cb.ticks) dl.text(P(t.offset), cb.x, cb.y - 2, this.fontSize, { anchor: 'start', baseline: 'bottom' });
      if (cb.label) dl.text(P(cb.label), cb.x + cb.w + 5 + maxW, cb.y + cb.h / 2, this.fontSize, { anchor: 'middle', baseline: 'top', rotate: 90 });
    }
    for (const t of this.texts) dl.text(P(t.s), t.x * this.W, (1 - t.y) * this.H, t.size, { anchor: t.anchor, baseline: 'alphabetic' });
    return dl;
  }
  get title(): string | undefined { return this.o.title; }
  toSVG(o: FigureRenderOptions & Omit<SvgOptions, 'title'>): string { const { fonts, ...rest } = o; return toSVG(this.render(fonts), { ...rest, title: this.o.title }); }
  toPDF(o: FigureRenderOptions & Omit<PdfOptions, 'title'>): Uint8Array { const { fonts, ...rest } = o; return toPDF(this.render(fonts), { ...rest, title: this.o.title }); }
}

/**
 * One multi-page PDF from several figures (one page per figure, each page as large as its figure).
 * The pages share one embedded font subset per face (see toPDFDocument); the document title is the
 * given one or, when none is given, the title of the first figure.
 */
export function figuresToPDF(figs: readonly Figure[], o: FigureRenderOptions & PdfOptions): Uint8Array {
  const { fonts, ...rest } = o;
  return toPDFDocument(figs.map((f) => f.render(fonts)), { ...rest, title: rest.title ?? figs[0]?.title });
}
