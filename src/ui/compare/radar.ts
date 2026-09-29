/**
 * The radar chart of the headline metrics: which numbers of a shot report are the axes, and how they are scaled to
 * the unit interval so that shots of very different size can share one polygon plot. Pure, no DOM.
 */
import type { ShotReport } from '../../physics/types';

export type RadarAxisId = 'qsci' | 'qeng' | 'ti' | 'efus' | 'burn' | 'lawson' | 'triple' | 'score';

export interface RadarAxis { id: RadarAxisId; get: (r: ShotReport) => number }

export const RADAR_AXES: readonly RadarAxis[] = [
  { id: 'qsci', get: (r) => r.Q_sci_max },
  { id: 'qeng', get: (r) => r.Q_eng },
  { id: 'ti', get: (r) => r.Timax_keV },
  { id: 'efus', get: (r) => r.E_fusion_MJ },
  { id: 'burn', get: (r) => r.burnTime_s },
  { id: 'lawson', get: (r) => r.lawson_ratio },
  { id: 'triple', get: (r) => r.tripleProduct_max },
  { id: 'score', get: (r) => r.score },
];

/** decades below the best shot that the log scale reaches (a shot below that sits at the centre) */
export const LOG_DECADES = 6;

export type RadarScale = 'lin' | 'log';

/**
 * Radii in [0, 1] per shot and axis. Each axis is scaled to the largest value among the shots (1 = the best shot on
 * that axis); a value that is zero, negative or not finite sits at the centre. The log scale spans LOG_DECADES
 * decades below the best value, which keeps a run of Q = 0.001 visible next to one of Q = 10.
 */
export function radarValues(reports: readonly ShotReport[], scale: RadarScale): number[][] {
  const raw = reports.map((r) => RADAR_AXES.map((a) => { const v = a.get(r); return Number.isFinite(v) && v > 0 ? v : 0; }));
  const maxOf = RADAR_AXES.map((_, j) => raw.reduce((m, row) => Math.max(m, row[j]), 0));
  return raw.map((row) => row.map((v, j) => {
    if (v <= 0 || maxOf[j] <= 0) return 0;
    if (scale === 'lin') return v / maxOf[j];
    return Math.min(Math.max((Math.log10(v / maxOf[j]) + LOG_DECADES) / LOG_DECADES, 0), 1);
  }));
}

/** the polygon of one shot: axis i points at angle −90° + i·360°/n (the first axis straight up) */
export function radarPoints(radii: readonly number[], cx: number, cy: number, R: number): { x: number; y: number }[] {
  const n = radii.length;
  return radii.map((r, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: cx + R * r * Math.cos(ang), y: cy + R * r * Math.sin(ang) };
  });
}
