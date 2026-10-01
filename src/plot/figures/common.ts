/** Makale figürleri için ortak boyutlar, renkler ve yardımcılar. */
import { HistoryFrame, SimEvent } from '../../physics/types';
import { Axes } from '../figure';
import { OKABE_ITO } from '../colors';
import { contourLines } from '../contour';

/** Dergi sütun genişlikleri (inç): tek sütun ≈ 86 mm, çift sütun ≈ 178 mm (APS/IOP/Elsevier) */
export const COL1 = 3.37, COL2 = 7.0;
export const C = {
  blue: OKABE_ITO[0], vermilion: OKABE_ITO[1], green: OKABE_ITO[2], orange: OKABE_ITO[3], sky: OKABE_ITO[4],
  purple: OKABE_ITO[5], yellow: OKABE_ITO[6], black: '#000000', grey: '#7a7a7a',
};

/** Profil içeren son düzenli kare (veya t'ye en yakın) */
export function profileFrame(hist: HistoryFrame[], t?: number): HistoryFrame | null {
  const withP = hist.filter((h) => h.prof);
  if (!withP.length) return null;
  if (t === undefined) return withP[withP.length - 1];
  return withP.reduce((best, h) => (Math.abs(h.t - t) < Math.abs(best.t - t) ? h : best));
}

/** Geçmişten zaman serisi (yalnız düzenli kareler: ELM/testere dişi kareleri seriyi sıçratmasın) */
export function series(hist: HistoryFrame[], key: string, scale = 1, regularOnly = false): { t: number[]; v: number[] } {
  const h = regularOnly ? hist.filter((f) => f.prof) : hist;
  return { t: h.map((f) => f.t), v: h.map((f) => (f.d[key] ?? NaN) * scale) };
}

/** Olay işaretleri: eksenin üst kenarında kısa çentikler */
export function eventTicks(ax: Axes, events: SimEvent[], kind: string, color: string, label?: string): void {
  const xs = events.filter((e) => e.kind === kind).map((e) => e.t);
  if (xs.length) ax.xmarks(xs, { color, label });
}

/**
 * Typical size of an inline contour label as a fraction of the axis spans (x, y): a 5.5 pt label such as "100 MW" with its box is about a
 * tenth of the width and 4.5 % of the height of the plot area of the single-column POPCON panel (an estimate from the rendered labels, not a font metric).
 */
export const LABEL_SPAN: readonly [number, number] = [0.1, 0.045];

/** Kontur çizgisine satır içi etiket (en uzun parçanın `pos` kesrindeki noktada, beyaz kutulu) */
export function contourLabel(ax: Axes, x: ArrayLike<number>, y: ArrayLike<number>, Z: ArrayLike<number>, level: number, text: string,
  o: { color?: string; size?: number; pos?: number; avoid?: [number, number][] } = {}): [number, number] | null {
  const lines = contourLines(x, y, Z, level);
  if (!lines.length) return null;
  const pl = lines.reduce((p, q) => (q.x.length > p.x.length ? q : p));
  let k = Math.min(pl.x.length - 1, Math.floor(pl.x.length * (o.pos ?? 0.5)));
  if (o.avoid?.length) {
    // the inner point farthest from the points to avoid (trajectory, other labels, legend), 8 % in from the edges;
    // the distance is measured in label sizes (LABEL_SPAN), so that two labels never end up overlapping each other
    const x0 = x[0], x1 = x[x.length - 1], y0 = y[0], y1 = y[y.length - 1];
    const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0);
    let best = -1;
    for (let i = 0; i < pl.x.length; i++) {
      const u = (pl.x[i] - x0) / sx, v = (pl.y[i] - y0) / sy;
      if (u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92) continue;
      let dmin = Infinity;
      for (const [ax_, ay] of o.avoid) dmin = Math.min(dmin, Math.hypot((pl.x[i] - ax_) / (sx * LABEL_SPAN[0]), (pl.y[i] - ay) / (sy * LABEL_SPAN[1])));
      if (dmin > best) { best = dmin; k = i; }
    }
  }
  ax.text(pl.x[k], pl.y[k], text, { size: o.size ?? 6, color: o.color, anchor: 'middle', baseline: 'middle', box: true });
  return [pl.x[k], pl.y[k]];
}

/** Log–log eğim referans üçgeni yerine çizgi: (x0,y0)'dan geçen y ∝ x^p, [x0,x1] aralığında */
export function slopeLine(ax: Axes, x0: number, x1: number, y0: number, p: number, label: string, color = '#555555'): void {
  const xs = [x0, x1], ys = [y0, y0 * Math.pow(x1 / x0, p)];
  ax.plot(xs, ys, { color, lw: 0.6, dash: 'dashed' });
  ax.text(Math.sqrt(x0 * x1), Math.sqrt(ys[0] * ys[1]) / 1.5, label, { size: 6.5, color, anchor: 'start', baseline: 'top' });
}
