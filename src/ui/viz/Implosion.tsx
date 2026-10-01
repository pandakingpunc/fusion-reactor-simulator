/**
 * ICF / MTF implozyon görselleştirmesi: solda animasyon (kabuk/liner + hotspot),
 * sağda yarıçap–zaman grafiği.
 *  - MTF/Z-pinch: r(t) = r₀ / C(t)  (C diagnostiği modelden gelir)
 *  - ICF: modelde hidro yok; R(t) şematik — R₀'dan R₀/CR'ye bang-time'a kadar
 *    yumuşak sıkışma, sonra genleşme. APPROXIMATION (yalnızca görsel).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { UiFrame } from '../../worker/protocol';
import { fmtAxis } from '../format';
import { useT } from '../state/store';
import { localizeDecimals } from '../../i18n';

interface Props {
  kind: 'icf' | 'mtf';
  frames: UiFrame[];
  t: number;
  tEnd: number;
  timeUnit: string;
  geometry: Record<string, number>;
  bang_ns?: number;
  height?: number;
}

function smooth(x: number): number { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); }

export function Implosion({ kind, frames, t, tEnd, timeUnit, geometry, bang_ns, height = 240 }: Props) {
  const tr = useT();
  const ref = useRef<HTMLCanvasElement>(null);

  const r0 = kind === 'icf' ? (geometry.capsuleRadius_um ?? 1000) : (geometry.r0 ?? 0.1);
  const CR = kind === 'icf' ? (geometry.convergenceRatio ?? 30) : (geometry.CR_eff ?? geometry.CR ?? 10);
  const unitR = kind === 'icf' ? 'µm' : r0 < 0.01 ? 'mm' : 'm';
  const rScale = unitR === 'mm' ? 1e3 : 1;

  // yarıçap fonksiyonu
  const radiusAt = useMemo(() => {
    if (kind === 'mtf') {
      return (fr: UiFrame) => (r0 / Math.max(fr.d.C ?? 1, 1)) * rScale;
    }
    const tb = bang_ns ?? tEnd * 0.75;
    return (fr: UiFrame) => {
      const tt = fr.t;
      if (tt <= tb) return r0 * (1 - (1 - 1 / CR) * smooth((tt - 0.2 * tb) / (0.8 * tb)));
      return (r0 / CR) * (1 + 6 * (tt - tb)); // bang sonrası genleşme (şematik)
    };
  }, [kind, r0, CR, bang_ns, tEnd, rScale]);

  const pMax = useMemo(() => frames.reduce((m, f) => Math.max(m, f.d.P_fus ?? 0), 0), [frames]);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const width = cv.clientWidth || 400;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cur = frames.length ? frames[frames.length - 1] : null;
    const R0s = r0 * rScale;
    // --- sol: animasyon ---
    const aw = Math.min(width * 0.42, height), acx = aw / 2 + 6, acy = height / 2, amax = aw / 2 - 14;
    const rNow = cur ? radiusAt(cur) : R0s;
    const px = (r: number) => (r / R0s) * amax;
    // hedef odası / dış sınır
    ctx.strokeStyle = '#263044'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(acx, acy, amax, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    // sürücü ışınları / akım
    const phase = Math.min(1, t / Math.max(bang_ns ?? tEnd * 0.75, 1e-9));
    if (kind === 'icf' && t < (bang_ns ?? tEnd)) {
      ctx.strokeStyle = 'rgba(76,201,240,0.7)'; ctx.lineWidth = 1.5;
      for (let k = 0; k < 12; k++) { const th = (k / 12) * 2 * Math.PI; const r1 = px(rNow) + 3; ctx.beginPath(); ctx.moveTo(acx + Math.cos(th) * amax, acy + Math.sin(th) * amax); ctx.lineTo(acx + Math.cos(th) * r1, acy + Math.sin(th) * r1); ctx.stroke(); }
    }
    if (kind === 'mtf') {
      // liner/piston halkası
      const thick = Math.max(3, px(rNow) * 0.25);
      ctx.fillStyle = '#5b6b8a'; ctx.beginPath(); ctx.arc(acx, acy, px(rNow) + thick, 0, 2 * Math.PI); ctx.arc(acx, acy, px(rNow), 0, 2 * Math.PI, true); ctx.fill();
      // J×B okları
      ctx.strokeStyle = 'rgba(255,209,102,0.8)'; ctx.lineWidth = 1.2;
      for (let k = 0; k < 8; k++) { const th = (k / 8) * 2 * Math.PI; const r2 = px(rNow) + thick + 4; const r1 = Math.min(amax, r2 + 10 + 10 * phase); ctx.beginPath(); ctx.moveTo(acx + Math.cos(th) * r1, acy + Math.sin(th) * r1); ctx.lineTo(acx + Math.cos(th) * r2, acy + Math.sin(th) * r2); ctx.stroke(); }
    } else {
      // ablatör kabuğu
      const thick = Math.max(2, px(rNow) * 0.12);
      ctx.fillStyle = '#8ecae6'; ctx.beginPath(); ctx.arc(acx, acy, px(rNow) + thick, 0, 2 * Math.PI); ctx.arc(acx, acy, px(rNow), 0, 2 * Math.PI, true); ctx.fill();
      // ablasyon plazması (dışa doğru bulanık)
      if (t < (bang_ns ?? tEnd)) { const g = ctx.createRadialGradient(acx, acy, px(rNow) + thick, acx, acy, px(rNow) + thick + 14); g.addColorStop(0, 'rgba(76,201,240,0.5)'); g.addColorStop(1, 'rgba(76,201,240,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(acx, acy, px(rNow) + thick + 14, 0, 2 * Math.PI); ctx.fill(); }
    }
    // yakıt / hotspot
    const T = cur?.d.Ti ?? 0, Pf = cur?.d.P_fus ?? 0;
    const glow = pMax > 0 ? Math.min(1, Pf / pMax) : 0;
    const hs = ctx.createRadialGradient(acx, acy, 0, acx, acy, Math.max(px(rNow), 2));
    const tu = Math.min(1, T / 10);
    hs.addColorStop(0, `rgba(255,${Math.round(200 + 55 * glow)},${Math.round(120 + 135 * glow)},${0.4 + 0.6 * Math.max(tu, glow)})`);
    hs.addColorStop(1, `rgba(${Math.round(60 + 150 * tu)},30,${Math.round(120 - 60 * tu)},0.7)`);
    ctx.fillStyle = hs; ctx.beginPath(); ctx.arc(acx, acy, Math.max(px(rNow), 2), 0, 2 * Math.PI); ctx.fill();
    if (glow > 0.05) { const gg = ctx.createRadialGradient(acx, acy, 0, acx, acy, amax); gg.addColorStop(0, `rgba(255,255,220,${0.5 * glow})`); gg.addColorStop(1, 'rgba(255,255,220,0)'); ctx.fillStyle = gg; ctx.fillRect(0, 0, aw + 12, height); }
    ctx.fillStyle = '#d6dce8'; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left';
    ctx.fillText(localizeDecimals(`r = ${fmtAxis(rNow)} ${unitR}  C = ${(R0s / Math.max(rNow, 1e-12)).toFixed(1)}`), 6, height - 8);
    ctx.fillText(`T = ${fmtAxis(T)} keV`, 6, 12);

    // --- sağ: r(t) grafiği ---
    const L = aw + 52, Rr = width - 10, Tp = 10, Bt = 24, pw = Rr - L, ph = height - Tp - Bt;
    const xs = (tt: number) => L + (tt / tEnd) * pw;
    const rMaxPlot = R0s * 1.05, ys = (r: number) => Tp + ph - (Math.min(r, rMaxPlot) / rMaxPlot) * ph;
    ctx.strokeStyle = '#263044'; ctx.strokeRect(L, Tp, pw, ph);
    ctx.fillStyle = '#7f8ba3'; ctx.textAlign = 'center';
    for (let k = 0; k <= 4; k++) ctx.fillText(fmtAxis((tEnd * k) / 4), xs((tEnd * k) / 4), height - 8);
    ctx.fillText(`t [${timeUnit}]`, L + pw / 2, height - 0.5);
    ctx.textAlign = 'right'; for (let k = 0; k <= 4; k++) ctx.fillText(fmtAxis((rMaxPlot * k) / 4), L - 4, ys((rMaxPlot * k) / 4) + 3);
    ctx.save(); ctx.translate(aw + 22, Tp + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(`r [${unitR}]`, 0, 0); ctx.restore();
    // bang-time işareti
    if (bang_ns !== undefined) { ctx.strokeStyle = 'rgba(255,209,102,0.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xs(bang_ns), Tp); ctx.lineTo(xs(bang_ns), Tp + ph); ctx.stroke(); ctx.setLineDash([]); }
    // eğri
    ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 1.6; ctx.beginPath();
    const stride = Math.max(1, Math.floor(frames.length / (pw * 2)));
    for (let i = 0; i < frames.length; i += stride) { const f = frames[i]; const x = xs(f.t), y = ys(radiusAt(f)); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    // P_fus üst üste (normalize)
    if (pMax > 0) {
      ctx.strokeStyle = 'rgba(247,37,133,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); let pen = false;
      for (let i = 0; i < frames.length; i += stride) { const f = frames[i]; const x = xs(f.t), y = Tp + ph - ((f.d.P_fus ?? 0) / pMax) * ph; pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; }
      ctx.stroke();
      ctx.fillStyle = 'rgba(247,37,133,0.9)'; ctx.textAlign = 'left'; ctx.fillText('P_fus (norm.)', L + 6, Tp + 12);
    }
    ctx.fillStyle = '#4cc9f0'; ctx.textAlign = 'left'; ctx.fillText('r(t)', L + 6, Tp + 24);
    // şimdiki t
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xs(t), Tp); ctx.lineTo(xs(t), Tp + ph); ctx.stroke();
  }, [frames, t, tEnd, timeUnit, r0, CR, rScale, unitR, radiusAt, pMax, kind, bang_ns, height]);

  return <canvas ref={ref} role="img" aria-label={tr('run.implosion.aria')} style={{ width: '100%', height, display: 'block' }} />;
}
