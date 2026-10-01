/**
 * Poloidal kesit: Miller-benzeri D-şekli akı yüzeyleri, sıcaklık renk haritası,
 * manyetik eksen, separatrix, X-noktası, vakum kabı/bobin.
 * 0D: APPROXIMATION — yüzeyler R(ρ,θ)=R₀+Δ(ρ)+ρa·cos(θ+δρ·sinθ), Z=ρκa·sinθ;
 * Shafranov kayması Δ(ρ)=0.06a(1−ρ²) (β_p ile ölçeklenmez).
 * 1.5D: `eq` verilirse Grad–Shafranov çözümünün gerçek akı yüzeyleri ve eksen konumu, renk
 * haritası ise ölçülen T_e(ρ) profilinden çizilir.
 */
import React, { useEffect, useRef } from 'react';
import { EqSnapshot } from '../../physics/types';
import { useWizText } from '../wizard/wizText';

interface Props {
  R: number; a: number; kappa: number; delta: number;
  gap: number; coilThickness: number;
  T0_keV: number; alphaT: number;
  Hmode?: boolean; divertor?: boolean; stellarator?: boolean;
  disrupted?: boolean; elmFlash?: number; // 0..1 kenar parlaması
  height?: number;
  /** 1.5D: GS akı yüzeyleri ve T_e(ρ) profili */
  eq?: EqSnapshot | null;
  prof?: { rho: number[]; Te: number[] } | null;
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
  return ys[ys.length - 1];
}

function tempColor(u: number): string {
  // 0 → koyu mavi, 0.5 → mor/kırmızı, 1 → sarı-beyaz (plazma görünümü); NaN (no temperature) → the cold end
  const stops = [[10, 20, 60], [60, 20, 140], [190, 40, 110], [255, 120, 40], [255, 235, 160]];
  const x = (Number.isNaN(u) ? 0 : Math.min(1, Math.max(0, u))) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function CrossSection(p: Props) {
  const wt = useWizText();
  const ref = useRef<HTMLCanvasElement>(null);
  const { R, a, kappa, delta, gap, coilThickness, T0_keV, alphaT, Hmode, divertor, stellarator, disrupted, elmFlash = 0, height = 300, eq, prof } = p;

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const width = cv.clientWidth || 300;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const outer = a + gap + coilThickness;
    const halfH = Math.max(kappa * a * 1.25 + gap + coilThickness, outer);
    const scale = Math.min((width - 70) / (2 * outer * 1.05), (height - 30) / (2 * halfH * 1.05));
    const cx = 40 + outer * scale * 1.02, cy = height / 2;
    const X = (r: number) => cx + (r - R) * scale, Y = (z: number) => cy - z * scale;

    const surf = (rho: number, shift = 0) => {
      const pts: [number, number][] = [];
      const dR = 0.06 * a * (1 - rho * rho) + shift;
      for (let k = 0; k <= 72; k++) {
        const th = (k / 72) * 2 * Math.PI;
        const st = Math.sin(th);
        // X-noktalı alt kenarda separatrix'i sivrilt
        const sharpen = divertor && !stellarator && rho > 0.98 && st < 0 ? 1 + 0.12 * Math.pow(-st, 8) : 1;
        const dTri = Math.asin(Math.max(-0.99, Math.min(0.99, delta * rho))); // Miller: cos(θ + arcsin(δ)·sinθ)
        pts.push([R + dR + rho * a * Math.cos(th + dTri * st), rho * kappa * a * st * sharpen]);
      }
      return pts;
    };
    const path = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([r, z], i) => (i ? ctx.lineTo(X(r), Y(z)) : ctx.moveTo(X(r), Y(z)))); ctx.closePath(); };

    // bobin + vakum kabı (dış halka)
    ctx.fillStyle = '#1b2333'; path(surf(1).map(([r, z]) => [R + (r - R) * (1 + (gap + coilThickness) / a), z * (1 + (gap + coilThickness) / (kappa * a))])); ctx.fill();
    ctx.fillStyle = '#0b0e14'; path(surf(1).map(([r, z]) => [R + (r - R) * (1 + gap / a), z * (1 + gap / (kappa * a))])); ctx.fill();
    ctx.strokeStyle = '#3a4660'; ctx.lineWidth = 1; ctx.stroke();

    // sıcaklık dolgulu akı yüzeyleri (dıştan içe)
    const N = 18;
    const T0 = Math.max(prof?.Te?.length ? prof.Te[0] : T0_keV, 1e-3);
    const Tref = Math.max(T0, 5); // renk ölçeği: 0..max(T0, 5 keV) — düşük T'de de görünür kalır
    const useEq = !!eq && eq.R.length > 1 && !stellarator && !disrupted;
    const polyEq = (k: number) => { ctx.beginPath(); eq!.R[k].forEach((r, j) => (j ? ctx.lineTo(X(r), Y(eq!.Z[k][j])) : ctx.moveTo(X(r), Y(eq!.Z[k][j])))); ctx.closePath(); };
    if (useEq) {
      const Tat = (rho: number) => (prof?.rho?.length ? interp(prof.rho, prof.Te, rho) : T0 * Math.pow(Math.max(1 - rho * rho, 0) + 0.02, alphaT));
      // ince bantlar: her yüzey kendi iç bandının ortalama sıcaklığıyla (dıştan içe)
      for (let k = eq!.R.length - 1; k >= 0; k--) {
        const rIn = k > 0 ? eq!.rho[k - 1] : 0;
        ctx.fillStyle = tempColor(Math.pow(Tat(0.5 * (rIn + eq!.rho[k])) / Tref, 0.6));
        polyEq(k); ctx.fill();
      }
    }
    for (let i = N; i >= 1 && !useEq; i--) {
      const rho = i / N;
      const T = T0 * Math.pow(1 - rho * rho + 0.02, alphaT);
      const u = Math.pow(T / Tref, 0.6);
      ctx.fillStyle = disrupted ? `rgba(120,120,130,${0.3 + 0.5 * (1 - rho)})` : tempColor(u);
      path(surf(rho, disrupted ? -0.15 * a : 0)); ctx.fill();
    }
    // H-mod pedestal: kenarda ince parlak halka
    if (Hmode && !disrupted) { ctx.strokeStyle = 'rgba(76,201,240,0.9)'; ctx.lineWidth = 2; if (useEq) { polyEq(eq!.R.length - 1); } else path(surf(0.96)); ctx.stroke(); }
    // ELM flaşı
    if (elmFlash > 0) { ctx.strokeStyle = `rgba(248,150,30,${elmFlash})`; ctx.lineWidth = 6 * elmFlash + 1; path(surf(1.02)); ctx.stroke(); }
    // separatrix / LCFS
    ctx.setLineDash([5, 4]); ctx.strokeStyle = disrupted ? '#ef476f' : '#ffffff'; ctx.lineWidth = 1.2;
    if (useEq) polyEq(eq!.R.length - 1); else path(surf(1, disrupted ? -0.15 * a : 0));
    ctx.stroke(); ctx.setLineDash([]);
    // akı yüzeyi çizgileri (ince)
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.7;
    if (useEq) { for (let k = 1; k < eq!.R.length - 1; k += 2) { polyEq(k); ctx.stroke(); } }
    else for (const rho of [0.2, 0.4, 0.6, 0.8]) { path(surf(rho)); ctx.stroke(); }
    // manyetik eksen
    const axR = useEq ? eq!.Raxis : R + 0.06 * a + (disrupted ? -0.15 * a : 0);
    const axZ = useEq ? eq!.Zaxis : 0;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(X(axR) - 6, Y(axZ)); ctx.lineTo(X(axR) + 6, Y(axZ)); ctx.moveTo(X(axR), Y(axZ) - 6); ctx.lineTo(X(axR), Y(axZ) + 6); ctx.stroke();
    // X-noktası
    if (divertor && !stellarator) {
      const xr = R - Math.max(-0.99, Math.min(0.99, delta)) * a, xz = -kappa * a * 1.12;
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(X(xr) - 7, Y(xz) - 7); ctx.lineTo(X(xr) + 7, Y(xz) + 7); ctx.moveTo(X(xr) + 7, Y(xz) - 7); ctx.lineTo(X(xr) - 7, Y(xz) + 7); ctx.stroke();
      // divertör bacakları
      ctx.strokeStyle = 'rgba(255,209,102,0.6)'; ctx.setLineDash([3, 3]); ctx.beginPath();
      ctx.moveTo(X(xr), Y(xz)); ctx.lineTo(X(xr - 0.35 * a), Y(xz - 0.35 * a)); ctx.moveTo(X(xr), Y(xz)); ctx.lineTo(X(xr + 0.45 * a), Y(xz - 0.3 * a)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffd166'; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillText('X', X(xr) + 9, Y(xz) + 4);
    }
    // eksen çizgisi (simetri ekseni)
    ctx.strokeStyle = '#263044'; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(X(0) < 0 ? 4 : X(0), 4); ctx.lineTo(X(0) < 0 ? 4 : X(0), height - 4); ctx.stroke(); ctx.setLineDash([]);
    // renk skalası
    const bx = width - 22, by = 14, bh = height - 40;
    for (let i = 0; i < bh; i++) { ctx.fillStyle = tempColor(Math.pow(1 - i / bh, 1)); ctx.fillRect(bx, by + i, 10, 1.5); }
    ctx.fillStyle = '#7f8ba3'; ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${Tref.toFixed(Tref < 10 ? 1 : 0)} keV`, bx - 2, by + 8); ctx.fillText('0', bx - 2, by + bh);
    ctx.textAlign = 'left'; ctx.fillStyle = '#d6dce8'; ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`T₀ = ${T0.toFixed(T0 < 10 ? 2 : 1)} keV`, 6, height - 8);
    ctx.fillStyle = '#7f8ba3'; ctx.fillText(`R=${R.toFixed(2)} a=${a.toFixed(2)} κ=${kappa.toFixed(2)} δ=${delta.toFixed(2)}`, 6, 12);
    if (useEq) { ctx.fillText(`GS: q95=${eq!.q95.toFixed(2)} ℓi=${eq!.li.toFixed(2)} βp=${eq!.betaP.toFixed(2)} Δ=${((eq!.Raxis - R) * 100).toFixed(0)} cm`, 6, 24); }
    if (disrupted) { ctx.fillStyle = '#ef476f'; ctx.font = 'bold 12px Inter, sans-serif'; ctx.fillText(wt('DISRUPTION'), 6, 28); }
  }, [R, a, kappa, delta, gap, coilThickness, T0_keV, alphaT, Hmode, divertor, stellarator, disrupted, elmFlash, height, eq, prof, wt]);

  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />;
}
