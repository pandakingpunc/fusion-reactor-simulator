import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SimEvent } from '../../physics/types';
import { UiFrame } from '../../worker/protocol';
import { fmtAxis, fmtNum, fmtTime } from '../format';
import { useT } from '../state/store';

export interface Series { key: string; label: string; unit: string; color: string; log?: boolean }

interface Props {
  frames: UiFrame[];
  series: Series[];
  timeUnit: string;
  tEnd: number;
  events?: SimEvent[];
  height?: number;
  title?: string;
  /** canlı mod: sağ kenar mevcut t'yi takip eder */
  live?: boolean;
  /** dış zoom sıfırlama tetikleyicisi (yeni koşu) */
  resetKey?: number;
  /** zaman imleci (rewind) → dikey çizgi */
  cursorT?: number;
  onSeek?: (t: number) => void;
}

const EVENT_COLOR: Record<string, string> = {
  ELM: '#f8961e', sawtooth: '#c77dff', NTM_onset: '#ef476f', NTM_gone: '#7f8ba3', LH: '#06d6a0', HL: '#ffd166',
  disruption: '#ef476f', quench: '#ef476f', ignition: '#06d6a0', burn_start: '#06d6a0', burn_end: '#ffd166', warning: '#ffd166', stagnation: '#4cc9f0', end: '#7f8ba3', info: '#7f8ba3',
};
const PAD = { l: 58, r: 12, t: 8, b: 22 };

export function TimeChart({ frames, series, timeUnit, tEnd, events = [], height = 220, title, live, resetKey, cursorT, onSeek }: Props) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [xRange, setXRange] = useState<[number, number] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [logY, setLogY] = useState(series.some((s) => s.log));
  const [hover, setHover] = useState<number | null>(null); // px x
  const drag = useRef<{ x0: number; range: [number, number] } | null>(null);

  useEffect(() => { setXRange(null); }, [resetKey]);
  useEffect(() => { setLogY(series.some((s) => s.log)); }, [series]);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const tNow = frames.length ? frames[frames.length - 1].t : 0;
  const visible = useMemo(() => series.filter((s) => !hidden.has(s.key)), [series, hidden]);

  // görünür x aralığı: manuel zoom > canlı takip > tam atış
  const [x0, x1] = useMemo<[number, number]>(() => {
    if (xRange) return xRange;
    if (live && tNow > 0) return [0, Math.max(tNow * 1.05, tEnd * 0.02)];
    return [0, Math.max(tEnd, tNow, 1e-9)];
  }, [xRange, live, tNow, tEnd]);

  // y aralığı (görünür pencere)
  const [y0, y1] = useMemo<[number, number]>(() => {
    let lo = Infinity, hi = -Infinity;
    for (const f of frames) {
      if (f.t < x0 || f.t > x1) continue;
      for (const s of visible) {
        const v = f.d[s.key];
        if (v === undefined || !isFinite(v)) continue;
        if (logY && v <= 0) continue;
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) return logY ? [1e-3, 1] : [0, 1];
    if (logY) { lo = Math.max(lo, hi * 1e-6); return [lo / 2, hi * 2]; }
    if (hi === lo) { hi = lo + Math.abs(lo) * 0.1 + 1e-9; }
    const m = (hi - lo) * 0.08;
    return [lo >= 0 && lo - m < 0 ? 0 : lo - m, hi + m];
  }, [frames, visible, x0, x1, logY]);

  const plotW = width - PAD.l - PAD.r, plotH = height - PAD.t - PAD.b;
  const xToPx = useCallback((t: number) => PAD.l + ((t - x0) / (x1 - x0)) * plotW, [x0, x1, plotW]);
  const pxToX = useCallback((px: number) => x0 + ((px - PAD.l) / plotW) * (x1 - x0), [x0, x1, plotW]);
  const yToPx = useCallback((v: number) => {
    const f = logY ? (Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) : (v - y0) / (y1 - y0);
    return PAD.t + plotH - f * plotH;
  }, [y0, y1, plotH, logY]);

  // çizim
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '10px JetBrains Mono, monospace';
    // ızgara + eksenler
    ctx.strokeStyle = '#263044'; ctx.fillStyle = '#7f8ba3'; ctx.lineWidth = 1;
    const yt = logY ? logTicks(y0, y1) : linTicks(y0, y1, 5);
    for (const v of yt) { const py = yToPx(v); if (py < PAD.t - 1 || py > PAD.t + plotH + 1) continue; ctx.beginPath(); ctx.moveTo(PAD.l, py); ctx.lineTo(PAD.l + plotW, py); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(fmtAxis(v), PAD.l - 4, py + 3); }
    for (const t of linTicks(x0, x1, 8)) { const px = xToPx(t); ctx.beginPath(); ctx.moveTo(px, PAD.t); ctx.lineTo(px, PAD.t + plotH); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(fmtAxis(t), px, height - 8); }
    ctx.textAlign = 'left'; ctx.fillText(`t [${timeUnit}]`, PAD.l + plotW - 34, height - 8);
    if (title) { ctx.fillStyle = '#d6dce8'; ctx.font = '11px Inter, sans-serif'; ctx.fillText(title, PAD.l + 4, PAD.t + 11); }
    // olaylar
    ctx.save(); ctx.beginPath(); ctx.rect(PAD.l, PAD.t, plotW, plotH); ctx.clip();
    for (const ev of events) {
      if (ev.t < x0 || ev.t > x1) continue;
      const px = xToPx(ev.t);
      const major = ev.kind === 'disruption' || ev.kind === 'quench' || ev.kind === 'ignition' || ev.kind === 'LH' || ev.kind === 'HL' || ev.kind === 'NTM_onset' || ev.kind === 'burn_start';
      ctx.strokeStyle = EVENT_COLOR[ev.kind] ?? '#7f8ba3'; ctx.globalAlpha = major ? 0.9 : 0.35; ctx.lineWidth = major ? 1.5 : 1;
      ctx.setLineDash(major ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(px, PAD.t); ctx.lineTo(px, PAD.t + plotH); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // seriler (piksel başına ≤2 nokta olacak şekilde seyrelt)
    const inWin = frames.filter((f) => f.t >= x0 && f.t <= x1);
    const stride = Math.max(1, Math.floor(inWin.length / (plotW * 2)));
    for (const s of visible) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.beginPath(); let pen = false;
      for (let i = 0; i < inWin.length; i += stride) {
        const v = inWin[i].d[s.key];
        if (v === undefined || !isFinite(v) || (logY && v <= 0)) { pen = false; continue; }
        const px = xToPx(inWin[i].t), py = yToPx(v);
        if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // imleç / hover
    const drawV = (px: number, color: string) => { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, PAD.t); ctx.lineTo(px, PAD.t + plotH); ctx.stroke(); };
    if (cursorT !== undefined && cursorT >= x0 && cursorT <= x1) drawV(xToPx(cursorT), '#4cc9f0');
    if (hover !== null) {
      drawV(hover, '#d6dce8');
      const f = nearest(frames, pxToX(hover));
      if (f) {
        const lines = [fmtTime(f.t, timeUnit), ...visible.map((s) => `${s.label}: ${fmtNum(f.d[s.key])} ${s.unit}`)];
        const bw = Math.max(...lines.map((l) => l.length)) * 6.2 + 12, bh = lines.length * 13 + 8;
        const bx = hover + bw + 10 > width ? hover - bw - 6 : hover + 6;
        ctx.fillStyle = 'rgba(11,14,20,0.92)'; ctx.fillRect(bx, PAD.t + 4, bw, bh); ctx.strokeStyle = '#263044'; ctx.strokeRect(bx, PAD.t + 4, bw, bh);
        ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left';
        lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? '#d6dce8' : visible[i - 1].color; ctx.fillText(l, bx + 6, PAD.t + 17 + i * 13); });
      }
    }
    ctx.restore();
  }, [frames, visible, events, width, height, x0, x1, y0, y1, logY, xToPx, yToPx, pxToX, plotW, plotH, hover, cursorT, timeUnit, title]);

  // etkileşim
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const tx = pxToX(e.clientX - rect.left);
    const k = e.deltaY > 0 ? 1.25 : 0.8;
    const nx0 = Math.max(0, tx - (tx - x0) * k), nx1 = tx + (x1 - tx) * k;
    if (nx1 - nx0 < tEnd * 1e-4) return;
    setXRange([nx0, nx1]);
  };
  const onDown = (e: React.MouseEvent) => { drag.current = { x0: e.clientX, range: [x0, x1] }; };
  const onMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (drag.current) {
      const dt = ((drag.current.x0 - e.clientX) / plotW) * (drag.current.range[1] - drag.current.range[0]);
      const a = Math.max(0, drag.current.range[0] + dt);
      setXRange([a, a + (drag.current.range[1] - drag.current.range[0])]);
    }
    setHover(px >= PAD.l && px <= PAD.l + plotW ? px : null);
  };
  const onUp = (e: React.MouseEvent) => {
    if (drag.current && Math.abs(e.clientX - drag.current.x0) < 3 && onSeek) {
      const rect = canvasRef.current!.getBoundingClientRect();
      onSeek(pxToX(e.clientX - rect.left));
    }
    drag.current = null;
  };

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ height, cursor: 'crosshair' }} onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onMouseLeave={() => { drag.current = null; setHover(null); }} onDoubleClick={() => setXRange(null)} />
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key} className={`li ${hidden.has(s.key) ? 'off' : ''}`} onClick={() => setHidden((h) => { const n = new Set(h); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; })}>
            <span className="sw" style={{ background: s.color }} />{s.label}{s.unit ? ` [${s.unit}]` : ''}
          </span>
        ))}
        <span className="spacer" />
        <span className="li" onClick={() => setLogY((v) => !v)} title={t('chart.logTitle')}>{logY ? 'log' : 'lin'}</span>
        {xRange && <span className="li" onClick={() => setXRange(null)} title={t('chart.resetZoom')}>⟲</span>}
      </div>
    </div>
  );
}

function linTicks(a: number, b: number, n: number): number[] {
  const span = b - a; if (span <= 0 || !isFinite(span)) return [a];
  const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return out;
}
function logTicks(a: number, b: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) out.push(Math.pow(10, e));
  return out;
}
function nearest(frames: UiFrame[], t: number): UiFrame | null {
  if (!frames.length) return null;
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t < t) lo = m; else hi = m; }
  return Math.abs(frames[lo].t - t) < Math.abs(frames[hi].t - t) ? frames[lo] : frames[hi];
}
