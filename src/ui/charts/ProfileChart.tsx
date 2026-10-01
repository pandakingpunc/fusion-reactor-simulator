/**
 * 1.5D radyal profil grafiği (canlı): seçili karedeki T_e/T_i/n_e, q/kayma, akım bileşenleri,
 * χ ve güç yoğunlukları ρ_tor'a karşı. İki y ekseni (sol/sağ) desteklenir.
 */
import React, { useEffect, useRef, useState } from 'react';
import { fmtAxis } from '../format';
import { localizeDecimals } from '../../i18n';
import { useWizText } from '../wizard/wizText';

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

export function ProfileChart({ prof, t, height = 220 }: { prof: Record<string, number[]> | null | undefined; t?: string; height?: number }) {
  const wt = useWizText();
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState('Tn');
  const v = VIEWS.find((x) => x.id === view)!;

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const width = cv.clientWidth || 320;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const pw = width - PAD.l - PAD.r, ph = height - PAD.t - PAD.b;
    ctx.font = '10px JetBrains Mono, monospace';
    if (!prof || !prof.rho?.length) {
      ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'center';
      ctx.fillText(wt('profiles available for 1.5D runs'), width / 2, height / 2);
      return;
    }
    const rho = prof.rho;
    const range = (right: boolean) => {
      let lo = 0, hi = -Infinity;
      for (const l of v.lines) if (!!l.right === right) for (const y of prof[l.key] ?? []) if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
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
    if (t) { ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'right'; ctx.fillText(t, PAD.l + pw - 4, PAD.t + 12); }
  }, [prof, v, height, t, wt]);

  return (
    <div>
      <div className="row" style={{ gap: 4, marginBottom: 4 }}>
        {VIEWS.map((x) => <button key={x.id} className={`btn sm ${view === x.id ? 'active' : ''}`} onClick={() => setView(x.id)}>{wt(x.name)}</button>)}
      </div>
      <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />
    </div>
  );
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
