/**
 * 1.5D radyal profil grafiği (canlı ve rapor): seçili karedeki T_e/T_i/n_e, q/kayma, akım bileşenleri,
 * χ ve güç yoğunlukları ρ_tor'a karşı. İki y ekseni (sol/sağ), fare üzerinde çapraz okuma ve isteğe bağlı
 * referans profil karşılaştırması desteklenir.
 */
import React, { useEffect, useState } from 'react';
import { fmtAxis, fmtNum } from '../format';
import { localizeDecimals } from '../../i18n';
import { useT } from '../state/store';
import { useWizText } from '../wizard/wizText';
import { prepareCanvas, useCanvasSize } from '../hooks/useCanvasSize';

type Line = { key: string; label: string; color: string; right?: boolean; dash?: number[] };
const VIEWS: { id: string; name: string; left: string; right?: string; lines: Line[]; refLines?: { v: number; label: string; right?: boolean }[] }[] = [
  { id: 'Tn', name: 'T, n', left: 'T [keV]', right: 'n_e [10²⁰ m⁻³]', lines: [
    { key: 'Te', label: 'T_e', color: '#f72585' }, { key: 'Ti', label: 'T_i', color: '#4cc9f0', dash: [5, 3] },
    { key: 'ne', label: 'n_e', color: '#b5e48c', right: true } ] },
  { id: 'q', name: 'q, s', left: 'q', right: 'shear s', lines: [
    { key: 'q', label: 'q', color: '#ffd166' }, { key: 'shear', label: 's', color: '#c77dff', right: true, dash: [5, 3] } ],
    refLines: [{ v: 1, label: 'q=1' }, { v: 1.5, label: '3/2' }, { v: 2, label: '2' }] },
  { id: 'j', name: 'current', left: '⟨j∥B⟩/B₀ [MA m⁻²]', lines: [
    { key: 'j', label: 'total', color: '#e6e6e6' }, { key: 'johm', label: 'ohmic', color: '#4cc9f0', dash: [5, 3] },
    { key: 'jbs', label: 'bootstrap', color: '#f8961e', dash: [6, 2, 1, 2] }, { key: 'jcd', label: 'driven', color: '#06d6a0', dash: [2, 2] } ] },
  { id: 'chi', name: 'χ', left: 'χ [m² s⁻¹]', lines: [
    { key: 'chie', label: 'χ_e', color: '#f72585' }, { key: 'chii', label: 'χ_i', color: '#4cc9f0', dash: [5, 3] } ] },
  { id: 'P', name: 'power', left: 'p [MW m⁻³]', lines: [
    { key: 'Palpha', label: 'α', color: '#f8961e' }, { key: 'Paux', label: 'aux', color: '#4cc9f0', dash: [5, 3] },
    { key: 'Prad', label: 'rad', color: '#c77dff', dash: [6, 2, 1, 2] }, { key: 'Pohm', label: 'ohmic', color: '#06d6a0', dash: [2, 2] } ] },
];
const PAD = { l: 46, r: 46, t: 18, b: 22 };

/** Linearly interpolate a radial profile array at normalised radius `r` in [0, 1]. */
export function interpProfile(rho: readonly number[], vals: readonly number[], r: number): number {
  const n = Math.min(rho.length, vals.length);
  if (n === 0) return NaN;
  if (r <= rho[0]) return vals[0];
  for (let i = 1; i < n; i++) {
    if (r <= rho[i]) {
      const span = rho[i] - rho[i - 1];
      const f = span > 0 ? (r - rho[i - 1]) / span : 0;
      return vals[i - 1] + (vals[i] - vals[i - 1]) * f;
    }
  }
  return vals[n - 1];
}

export interface ProfileChartProps {
  prof: Record<string, number[]> | null | undefined;
  t?: string;
  height?: number;
  /** optional baseline/reference profile overlaid as faint dotted curves */
  compareProf?: Record<string, number[]> | null;
  compareLabel?: string;
}

export function ProfileChart({ prof, t, height = 220, compareProf, compareLabel }: ProfileChartProps) {
  const wt = useWizText();
  const tr = useT();
  const { ref, width, dpr } = useCanvasSize<HTMLCanvasElement>(320);
  const [view, setView] = useState('Tn');
  const [hoverRho, setHoverRho] = useState<number | null>(null);
  const v = VIEWS.find((x) => x.id === view)!;

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = prepareCanvas(cv, width, height, dpr);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const pw = Math.max(10, width - PAD.l - PAD.r), ph = Math.max(10, height - PAD.t - PAD.b);
    ctx.font = '10px JetBrains Mono, monospace';
    if (!prof || !prof.rho?.length) {
      ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'center';
      ctx.fillText(wt('profiles available for 1.5D runs'), width / 2, height / 2);
      return;
    }
    const rho = prof.rho;
    const range = (right: boolean) => {
      let lo = 0, hi = -Infinity;
      for (const src of [prof, compareProf]) {
        if (!src) continue;
        for (const l of v.lines) if (!!l.right === right) for (const y of src[l.key] ?? []) if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      }
      if (v.refLines && !right) hi = Math.max(hi, 2.2);
      if (!Number.isFinite(hi) || hi <= lo) hi = lo + 1;
      return [lo, hi + 0.08 * (hi - lo)] as [number, number];
    };
    const yl = range(false), yr = v.right ? range(true) : yl;
    const X = (r: number) => PAD.l + r * pw;
    const Y = (y: number, right = false) => { const [a, b] = right ? yr : yl; return PAD.t + ph - ((y - a) / (b - a)) * ph; };
    // çerçeve + ızgara
    ctx.strokeStyle = '#263044'; ctx.lineWidth = 1; ctx.strokeRect(PAD.l, PAD.t, pw, ph);
    ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'center';
    for (let r = 0; r <= 1.0001; r += 0.2) { ctx.fillText(localizeDecimals(r.toFixed(1)), X(r), height - 8); ctx.strokeStyle = '#1b2333'; ctx.beginPath(); ctx.moveTo(X(r), PAD.t); ctx.lineTo(X(r), PAD.t + ph); ctx.stroke(); }
    ctx.fillText('ρ_tor', PAD.l + pw / 2, height - 0.5);
    const ticks = (lim: [number, number]) => { const s = niceStep((lim[1] - lim[0]) / 4); const out: number[] = []; for (let y = Math.ceil(lim[0] / s) * s; y <= lim[1] + 1e-12; y += s) out.push(y); return out; };
    ctx.textAlign = 'right';
    for (const y of ticks(yl)) ctx.fillText(fmtAxis(y), PAD.l - 4, Y(y) + 3);
    if (v.right) { ctx.textAlign = 'left'; for (const y of ticks(yr)) ctx.fillText(fmtAxis(y), PAD.l + pw + 4, Y(y, true) + 3); }
    ctx.textAlign = 'left'; ctx.fillText(v.left, PAD.l, 11);
    if (v.right) { ctx.textAlign = 'right'; ctx.fillText(wt(v.right), PAD.l + pw, 11); }
    // referans çizgileri (rasyonel q)
    for (const rl of v.refLines ?? []) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(PAD.l, Y(rl.v)); ctx.lineTo(PAD.l + pw, Y(rl.v)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'left'; ctx.fillText(rl.label, PAD.l + 3, Y(rl.v) - 2);
    }
    // optional reference / comparison profile (faint dotted curves)
    if (compareProf && compareProf.rho?.length) {
      const cRho = compareProf.rho;
      ctx.save(); ctx.globalAlpha = 0.42;
      for (const l of v.lines) {
        const ys = compareProf[l.key]; if (!ys) continue;
        ctx.strokeStyle = l.color; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
        ctx.beginPath(); cRho.forEach((r, i) => { const px = X(r), py = Y(ys[i], l.right); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      }
      ctx.restore(); ctx.setLineDash([]);
    }
    // eğriler + lejant
    let lx = PAD.l + 8;
    for (const l of v.lines) {
      const ys = prof[l.key]; if (!ys) continue;
      ctx.strokeStyle = l.color; ctx.lineWidth = 1.6; ctx.setLineDash(l.dash ?? []);
      ctx.beginPath(); rho.forEach((r, i) => { const px = X(r), py = Y(ys[i], l.right); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      ctx.setLineDash([]);
      const label = wt(l.label);
      ctx.fillStyle = l.color; ctx.textAlign = 'left'; ctx.fillText(label, lx, PAD.t + 12); lx += ctx.measureText(label).width + 12;
    }
    if (t) {
      ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'right';
      ctx.fillText(compareLabel ? `${t} · · · ${compareLabel}` : t, PAD.l + pw - 4, PAD.t + 12);
    }
    // interactive hover crosshair + interpolated values
    if (hoverRho !== null && hoverRho >= 0 && hoverRho <= 1) {
      const hx = X(hoverRho);
      ctx.strokeStyle = 'rgba(214,220,232,0.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, PAD.t); ctx.lineTo(hx, PAD.t + ph); ctx.stroke();
      const rows: { text: string; color: string }[] = [{ text: `ρ_tor = ${localizeDecimals(hoverRho.toFixed(2))}`, color: '#d6dce8' }];
      for (const l of v.lines) {
        const ys = prof[l.key]; if (!ys) continue;
        const val = interpProfile(rho, ys, hoverRho);
        if (!Number.isFinite(val)) continue;
        const py = Y(val, l.right);
        ctx.fillStyle = l.color; ctx.beginPath(); ctx.arc(hx, py, 3, 0, Math.PI * 2); ctx.fill();
        let line = `${wt(l.label)}: ${fmtNum(val)}`;
        if (compareProf?.rho?.length && compareProf[l.key]) {
          const cv0 = interpProfile(compareProf.rho, compareProf[l.key], hoverRho);
          if (Number.isFinite(cv0)) line += ` (${fmtNum(cv0)})`;
        }
        rows.push({ text: line, color: l.color });
      }
      ctx.font = '10px JetBrains Mono, monospace';
      const bw = Math.max(...rows.map((r) => ctx.measureText(r.text).width || r.text.length * 6.2)) + 12;
      const bh = rows.length * 13 + 8;
      const bx = hx + bw + 8 > PAD.l + pw ? Math.max(PAD.l + 2, hx - bw - 8) : hx + 8;
      const by = PAD.t + 18;
      ctx.fillStyle = 'rgba(11,14,20,0.92)'; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#263044'; ctx.strokeRect(bx, by, bw, bh);
      ctx.textAlign = 'left';
      rows.forEach((r, i) => { ctx.fillStyle = r.color; ctx.fillText(r.text, bx + 6, by + 13 + i * 13); });
    }
  }, [prof, compareProf, compareLabel, v, height, t, wt, width, dpr, ref, hoverRho]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = ref.current; if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const pw = Math.max(10, width - PAD.l - PAD.r);
    if (px < PAD.l || px > PAD.l + pw) { setHoverRho(null); return; }
    setHoverRho(Math.min(1, Math.max(0, (px - PAD.l) / pw)));
  };

  return (
    <div>
      <div className="row" style={{ gap: 4, marginBottom: 4 }}>
        {VIEWS.map((x) => <button key={x.id} type="button" className={`btn sm ${view === x.id ? 'active' : ''}`} aria-pressed={view === x.id} onClick={() => setView(x.id)}>{wt(x.name)}</button>)}
      </div>
      <canvas ref={ref} role="img" aria-label={tr('chart.profile.aria', { view: wt(v.name) })}
        style={{ width: '100%', height, display: 'block', cursor: prof?.rho?.length ? 'crosshair' : 'default' }}
        onMouseMove={onMove} onMouseLeave={() => setHoverRho(null)} />
    </div>
  );
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
