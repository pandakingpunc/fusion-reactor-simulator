/**
 * Interactive 1.5D radius-time (rho_tor vs t) heat map: renders any radial profile channel over the
 * discharge using matplotlib's perceptually uniform 256-entry colour tables (colormapData.ts), with
 * event markers (L-H vertical line, ELM/sawtooth/NTM rug ticks), live hover readout and click-to-select time.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { SimEvent } from '../../physics/types';
import type { UiFrame } from '../../worker/protocol';
import { LUT_HEX, LutName } from '../../plot/colormapData';
import { localizeDecimals } from '../../i18n';
import { fmtAxis, fmtNum, fmtTime } from '../format';
import { useT } from '../state/store';
import { prepareCanvas, useCanvasSize } from '../hooks/useCanvasSize';

export interface RhoTQuantity {
  key: string;
  label: string;
  unit: string;
  cmap: LutName;
}

export const RHOT_UI_QUANTITIES: readonly RhoTQuantity[] = [
  { key: 'Te', label: 'T_e', unit: 'keV', cmap: 'inferno' },
  { key: 'Ti', label: 'T_i', unit: 'keV', cmap: 'inferno' },
  { key: 'ne', label: 'n_e', unit: '10²⁰ m⁻³', cmap: 'viridis' },
  { key: 'q', label: 'q', unit: '', cmap: 'plasma' },
  { key: 'j', label: 'j_tot', unit: 'MA m⁻²', cmap: 'magma' },
  { key: 'chie', label: 'χ_e', unit: 'm² s⁻¹', cmap: 'cividis' },
  { key: 'chii', label: 'χ_i', unit: 'm² s⁻¹', cmap: 'cividis' },
  { key: 'Palpha', label: 'p_α', unit: 'MW m⁻³', cmap: 'magma' },
];

export interface RhoTGrid {
  t0: number;
  t1: number;
  nt: number;
  nr: number;
  rho: number[];
  /** Z[col * nr + j] = value at column `col` (uniform in time), radial index `j` */
  Z: Float64Array;
  vmin: number;
  vmax: number;
}

const lutCache = new Map<LutName, Uint8Array>();

/** 256 × 3 RGB byte table parsed once per colormap from LUT_HEX. */
export function lutRgb(name: LutName): Uint8Array {
  let out = lutCache.get(name);
  if (out) return out;
  const hex = LUT_HEX[name];
  out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const o = i * 6;
    out[i * 3] = parseInt(hex.slice(o, o + 2), 16);
    out[i * 3 + 1] = parseInt(hex.slice(o + 2, o + 4), 16);
    out[i * 3 + 2] = parseInt(hex.slice(o + 4, o + 6), 16);
  }
  lutCache.set(name, out);
  return out;
}

/**
 * Extracts and resamples a 1.5D profile quantity onto a uniform time grid (at most `maxCols` columns)
 * for fast canvas rasterization and hover lookup. Returns null when fewer than 2 profile frames exist.
 */
export function buildRhoTGrid(frames: readonly UiFrame[], key: string, maxCols = 320): RhoTGrid | null {
  const withP = frames.filter((f) => f.prof && f.prof.rho?.length && f.prof[key]?.length);
  if (withP.length < 2) return null;
  const rho = withP[0].prof!.rho;
  const nr = rho.length;
  const rows = withP.filter((f) => f.prof!.rho.length === nr && f.prof![key].length === nr);
  if (rows.length < 2) return null;
  const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
  const nt = Math.max(2, Math.min(maxCols, rows.length));
  const Z = new Float64Array(nt * nr);
  let vmin = Infinity, vmax = -Infinity;
  let i = 0;
  for (let c = 0; c < nt; c++) {
    const tc = t0 + ((t1 - t0) * c) / (nt - 1);
    while (i < rows.length - 2 && rows[i + 1].t < tc) i++;
    const ta = rows[i].t, tb = rows[i + 1].t;
    const u = tb > ta ? Math.min(1, Math.max(0, (tc - ta) / (tb - ta))) : 0;
    const va = rows[i].prof![key], vb = rows[i + 1].prof![key];
    for (let j = 0; j < nr; j++) {
      const val = (1 - u) * va[j] + u * vb[j];
      Z[c * nr + j] = val;
      if (Number.isFinite(val)) {
        if (val < vmin) vmin = val;
        if (val > vmax) vmax = val;
      }
    }
  }
  if (!Number.isFinite(vmin)) { vmin = 0; vmax = 1; }
  else if (vmax <= vmin) vmax = vmin + Math.abs(vmin) * 0.1 + 1e-9;
  return { t0, t1, nt, nr, rho: rho.slice(), Z, vmin, vmax };
}

/** Sample a built grid at normalised coordinates (uT in [0, 1], uRho in [0, 1]). */
export function sampleRhoTGrid(g: RhoTGrid, uT: number, uRho: number): number {
  const c = Math.max(0, Math.min(g.nt - 1, Math.round(uT * (g.nt - 1))));
  // find closest radial bin in g.rho
  let j = 0;
  while (j < g.nr - 1 && g.rho[j] < uRho) j++;
  if (j > 0 && Math.abs(g.rho[j - 1] - uRho) < Math.abs(g.rho[j] - uRho)) j--;
  return g.Z[c * g.nr + j];
}

const PAD = { l: 44, r: 62, t: 18, b: 24 };
const EVENT_RUG: readonly [string, string][] = [['ELM', '#f8961e'], ['sawtooth', '#c77dff'], ['NTM_onset', '#ef476f']];

export interface RhoTHeatmapProps {
  frames: readonly UiFrame[];
  events?: readonly SimEvent[];
  timeUnit: string;
  /** profile quantity key (default 'Te') */
  quantity?: string;
  onQuantityChange?: (key: string) => void;
  /** selected time cursor (drawn as cyan vertical line) */
  cursorT?: number;
  /** called when the user clicks on the heatmap */
  onSelectT?: (t: number) => void;
  height?: number;
  /** hide the built-in quantity selector buttons when the parent renders its own */
  hidePicker?: boolean;
}

export function RhoTHeatmap({
  frames, events = [], timeUnit, quantity, onQuantityChange, cursorT, onSelectT, height = 230, hidePicker = false,
}: RhoTHeatmapProps) {
  const tr = useT();
  const [localQty, setLocalQty] = useState('Te');
  const activeKey = quantity ?? localQty;
  const setQty = (k: string) => { if (onQuantityChange) onQuantityChange(k); else setLocalQty(k); };
  const avail = useMemo(() => {
    const f = frames.find((fr) => fr.prof && fr.prof.rho?.length);
    if (!f?.prof) return RHOT_UI_QUANTITIES;
    const filtered = RHOT_UI_QUANTITIES.filter((q) => Array.isArray(f.prof![q.key]));
    return filtered.length ? filtered : RHOT_UI_QUANTITIES;
  }, [frames]);
  const qSpec = avail.find((q) => q.key === activeKey) ?? avail[0];
  const grid = useMemo(() => buildRhoTGrid(frames, qSpec.key), [frames, qSpec.key]);
  const { ref, width, dpr } = useCanvasSize<HTMLCanvasElement>(360);
  const [hover, setHover] = useState<{ uT: number; uRho: number } | null>(null);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = prepareCanvas(cv, width, height, dpr);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const pw = Math.max(10, width - PAD.l - PAD.r), ph = Math.max(10, height - PAD.t - PAD.b);
    ctx.font = '10px JetBrains Mono, monospace';
    if (!grid) {
      ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'center';
      ctx.fillText(tr('rhot.empty'), width / 2, height / 2);
      return;
    }
    const lut = lutRgb(qSpec.cmap);
    const spanV = grid.vmax - grid.vmin;
    // render raster into offscreen canvas (nt × nr), then draw scaled smoothly onto plot area
    const off = document.createElement('canvas');
    off.width = grid.nt; off.height = grid.nr;
    const octx = off.getContext('2d');
    const img = octx && typeof octx.createImageData === 'function' ? octx.createImageData(grid.nt, grid.nr) : null;
    if (octx && img?.data) {
      const data = img.data;
      for (let j = 0; j < grid.nr; j++) {
        // y=0 at top corresponds to rho=1 (outermost); bottom corresponds to rho=0 (axis)
        const py = grid.nr - 1 - j;
        for (let c = 0; c < grid.nt; c++) {
          const val = grid.Z[c * grid.nr + j];
          const u = Number.isFinite(val) ? Math.max(0, Math.min(1, (val - grid.vmin) / spanV)) : 0;
          const idx = Math.round(u * 255) * 3;
          const p = (py * grid.nt + c) * 4;
          data[p] = lut[idx]; data[p + 1] = lut[idx + 1]; data[p + 2] = lut[idx + 2]; data[p + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, PAD.l, PAD.t, pw, ph);
    } else {
      ctx.fillStyle = '#10151f';
      ctx.fillRect(PAD.l, PAD.t, pw, ph);
    }

    const tSpan = Math.max(grid.t1 - grid.t0, 1e-9);
    const X = (tVal: number) => PAD.l + ((tVal - grid.t0) / tSpan) * pw;
    const Y = (rVal: number) => PAD.t + (1 - rVal) * ph;

    // events: L-H vertical dotted line, ELM/sawtooth/NTM rug along top
    ctx.save(); ctx.beginPath(); ctx.rect(PAD.l, PAD.t, pw, ph); ctx.clip();
    for (const ev of events) {
      if (ev.t < grid.t0 || ev.t > grid.t1) continue;
      if (ev.kind === 'LH') {
        const px = X(ev.t);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, PAD.t); ctx.lineTo(px, PAD.t + ph); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    EVENT_RUG.forEach(([kind, color], row) => {
      const top = PAD.t + row * 5;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = 0.85;
      let lastPx = -99;
      for (const ev of events) {
        if (ev.kind !== kind || ev.t < grid.t0 || ev.t > grid.t1) continue;
        const px = X(ev.t);
        if (px - lastPx < 1.5) continue;
        lastPx = px;
        ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top + 4); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
    // selected time cursor
    if (cursorT !== undefined && cursorT >= grid.t0 && cursorT <= grid.t1) {
      const cx = X(cursorT);
      ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, PAD.t); ctx.lineTo(cx, PAD.t + ph); ctx.stroke();
    }
    ctx.restore();

    // frame & axes
    ctx.strokeStyle = '#263044'; ctx.lineWidth = 1; ctx.strokeRect(PAD.l, PAD.t, pw, ph);
    ctx.fillStyle = '#7f8ba3';
    ctx.textAlign = 'right';
    for (let r = 0; r <= 1.0001; r += 0.25) ctx.fillText(localizeDecimals(r.toFixed(2)), PAD.l - 4, Y(r) + 3);
    ctx.textAlign = 'left';
    ctx.fillText('ρ_tor', 4, 11);
    ctx.fillText(`${qSpec.label}${qSpec.unit ? ` [${qSpec.unit}]` : ''}`, PAD.l + 2, 11);
    ctx.textAlign = 'center';
    for (let k = 0; k <= 4; k++) {
      const tk = grid.t0 + (tSpan * k) / 4;
      ctx.fillText(fmtAxis(tk), X(tk), height - 9);
    }
    ctx.textAlign = 'right';
    ctx.fillText(`t [${timeUnit}]`, PAD.l + pw, height - 1);

    // colorbar on the right
    const bx = PAD.l + pw + 8, bw = 10;
    for (let y = 0; y < ph; y++) {
      const u = 1 - y / Math.max(1, ph - 1);
      const idx = Math.round(u * 255) * 3;
      ctx.fillStyle = `rgb(${lut[idx]},${lut[idx + 1]},${lut[idx + 2]})`;
      ctx.fillRect(bx, PAD.t + y, bw, 1.5);
    }
    ctx.strokeStyle = '#263044'; ctx.strokeRect(bx, PAD.t, bw, ph);
    ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'left';
    for (let k = 0; k <= 3; k++) {
      const f = k / 3;
      const val = grid.vmin + f * spanV;
      ctx.fillText(fmtAxis(val), bx + bw + 4, PAD.t + (1 - f) * ph + 3);
    }

    // hover crosshair + readout
    if (hover) {
      const hx = PAD.l + hover.uT * pw, hy = PAD.t + (1 - hover.uRho) * ph;
      const tVal = grid.t0 + hover.uT * tSpan;
      const val = sampleRhoTGrid(grid, hover.uT, hover.uRho);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, PAD.t); ctx.lineTo(hx, PAD.t + ph); ctx.moveTo(PAD.l, hy); ctx.lineTo(PAD.l + pw, hy); ctx.stroke();
      const lines = [
        `t = ${fmtTime(tVal, timeUnit)}`,
        `ρ_tor = ${localizeDecimals(hover.uRho.toFixed(2))}`,
        `${qSpec.label} = ${fmtNum(val)}${qSpec.unit ? ` ${qSpec.unit}` : ''}`,
      ];
      const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width || l.length * 6.2)) + 12;
      const boxH = lines.length * 13 + 8;
      const rx = hx + boxW + 8 > PAD.l + pw ? Math.max(PAD.l + 2, hx - boxW - 8) : hx + 8;
      const ry = Math.min(PAD.t + ph - boxH - 2, Math.max(PAD.t + 2, hy - boxH / 2));
      ctx.fillStyle = 'rgba(11,14,20,0.92)'; ctx.fillRect(rx, ry, boxW, boxH);
      ctx.strokeStyle = '#263044'; ctx.strokeRect(rx, ry, boxW, boxH);
      ctx.textAlign = 'left'; ctx.fillStyle = '#d6dce8';
      lines.forEach((l, idx) => ctx.fillText(l, rx + 6, ry + 13 + idx * 13));
    }
  }, [grid, qSpec, events, timeUnit, cursorT, hover, width, height, dpr, ref, tr]);

  const toCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = ref.current; if (!cv || !grid) return null;
    const rect = cv.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const pw = Math.max(10, width - PAD.l - PAD.r), ph = Math.max(10, height - PAD.t - PAD.b);
    if (px < PAD.l || px > PAD.l + pw || py < PAD.t || py > PAD.t + ph) return null;
    return { uT: Math.min(1, Math.max(0, (px - PAD.l) / pw)), uRho: Math.min(1, Math.max(0, 1 - (py - PAD.t) / ph)) };
  };

  return (
    <div>
      {!hidePicker && (
        <div className="row" style={{ gap: 4, marginBottom: 4 }}>
          {avail.map((q) => (
            <button key={q.key} type="button" className={`btn sm ${qSpec.key === q.key ? 'active' : ''}`}
              aria-pressed={qSpec.key === q.key} onClick={() => setQty(q.key)}>{q.label}</button>
          ))}
        </div>
      )}
      <canvas ref={ref} role="img" aria-label={tr('rhot.aria', { qty: qSpec.label })}
        style={{ width: '100%', height, display: 'block', cursor: grid ? (onSelectT ? 'pointer' : 'crosshair') : 'default' }}
        onMouseMove={(e) => setHover(toCoords(e))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (!onSelectT || !grid) return;
          const pt = toCoords(e);
          if (pt) onSelectT(grid.t0 + pt.uT * (grid.t1 - grid.t0));
        }} />
    </div>
  );
}
