/**
 * Canlı POPCON (Plasma OPeration CONtour): (n̄, T̄) düzleminde gereken yardımcı güç P_aux
 * ve sabit-Q eğrileri; üstüne anlık çalışma noktası çizilir.
 * APPROXIMATION: 0D kararlı durum, profil çarpanları (1−ρ²)^α ile; Ti = Te; safsızlık/He
 * kabaca Zeff ile; senkrotron ve çizgi radyasyonu ihmal (brems dahil). Tam modelle
 * birebir örtüşmez — nitel harita amaçlıdır.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { MagneticConfig } from '../../physics/types';
import { computePopcon, PopconGrid } from '../../physics/popcon';
import { fmtAxis } from '../format';

const NX = 44, NY = 44;

/** Izgara hesabı fizik katmanında (physics/popcon.ts) — makale figürüyle ortak */
function computeGrid(cfg: MagneticConfig): PopconGrid { return computePopcon(cfg, { nx: NX, ny: NY }); }

interface Props { cfg: MagneticConfig; point?: { n: number; T: number } | null; height?: number }

export function Popcon({ cfg, point, height = 260 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const grid = useMemo(() => computeGrid(cfg), [cfg]);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const width = cv.clientWidth || 320;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr;
    const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = 50, R = 10, Tp = 8, B = 24, pw = width - L - R, ph = height - Tp - B;
    const { n, T, Paux, Q, betaN, PLH_ok, nG } = grid;
    const nMax = n[n.length - 1] * (1 + 0.5 / NX), TMax = 40;
    const xp = (v: number) => L + (v / nMax) * pw, yp = (v: number) => Tp + ph - (v / TMax) * ph;
    ctx.clearRect(0, 0, width, height);
    // hücreler: P_aux renk (negatif = ateşlenmiş yeşil; pozitif → mavi→kırmızı log)
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const k = i * NY + j, Pa = Paux[k] / 1e6;
      const x0 = xp(n[i] - nMax / NX / 2), x1 = xp(n[i] + nMax / NX / 2);
      const Tlo = j > 0 ? (T[j - 1] + T[j]) / 2 : 0, Thi = j < NY - 1 ? (T[j] + T[j + 1]) / 2 : TMax;
      let col: string;
      if (Pa <= 0) col = `rgba(6,214,160,${Math.min(0.85, 0.35 + Math.log10(1 - Pa + 1) * 0.3)})`;
      else { const u = Math.min(1, Math.log10(Pa + 1) / 3); col = `rgba(${Math.round(60 + 190 * u)},${Math.round(100 - 60 * u)},${Math.round(230 - 200 * u)},0.75)`; }
      ctx.fillStyle = col; ctx.fillRect(x0, yp(Thi), x1 - x0 + 0.5, yp(Tlo) - yp(Thi) + 0.5);
      if (betaN[k] > cfg.limits.betaN_limit) { ctx.fillStyle = 'rgba(239,71,111,0.35)'; ctx.fillRect(x0, yp(Thi), x1 - x0 + 0.5, yp(Tlo) - yp(Thi) + 0.5); }
      if (!PLH_ok[k] && cfg.method !== 'stellarator') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x0, yp(Thi), x1 - x0 + 0.5, yp(Tlo) - yp(Thi) + 0.5); }
    }
    // Q konturları (marching squares, basit)
    const levels: { v: number; c: string; lbl: string }[] = [{ v: 1, c: '#ffd166', lbl: 'Q=1' }, { v: 5, c: '#f8961e', lbl: 'Q=5' }, { v: 10, c: '#f72585', lbl: 'Q=10' }, { v: 30, c: '#e0aaff', lbl: 'Q=30' }];
    const field = (i: number, j: number) => { const q = Q[i * NY + j]; return isFinite(q) ? Math.log10(Math.max(q, 1e-3)) : 3; };
    ctx.lineWidth = 1.3;
    for (const lv of levels) {
      const lz = Math.log10(lv.v); ctx.strokeStyle = lv.c; ctx.beginPath();
      for (let i = 0; i < NX - 1; i++) for (let j = 0; j < NY - 1; j++) {
        const f = [field(i, j), field(i + 1, j), field(i + 1, j + 1), field(i, j + 1)];
        const P = [[n[i], T[j]], [n[i + 1], T[j]], [n[i + 1], T[j + 1]], [n[i], T[j + 1]]];
        const pts: number[][] = [];
        for (let e = 0; e < 4; e++) {
          const a = f[e], b = f[(e + 1) % 4];
          if ((a < lz) !== (b < lz)) { const s = (lz - a) / (b - a); pts.push([P[e][0] + s * (P[(e + 1) % 4][0] - P[e][0]), P[e][1] + s * (P[(e + 1) % 4][1] - P[e][1])]); }
        }
        if (pts.length >= 2) { ctx.moveTo(xp(pts[0][0]), yp(pts[0][1])); ctx.lineTo(xp(pts[1][0]), yp(pts[1][1])); }
      }
      ctx.stroke();
    }
    // Greenwald çizgisi
    if (cfg.method !== 'stellarator' && nG < nMax) {
      ctx.strokeStyle = '#ef476f'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(xp(nG * cfg.limits.greenwald_limit), Tp); ctx.lineTo(xp(nG * cfg.limits.greenwald_limit), Tp + ph); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ef476f'; ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left'; ctx.fillText('n_G', xp(nG * cfg.limits.greenwald_limit) + 3, Tp + 10);
    }
    // eksenler
    ctx.strokeStyle = '#263044'; ctx.fillStyle = '#7f8ba3'; ctx.font = '10px JetBrains Mono, monospace';
    ctx.strokeRect(L, Tp, pw, ph);
    ctx.textAlign = 'center';
    for (let v = 0; v <= nMax; v += nMax > 1e21 ? 5e20 : nMax > 4e20 ? 2e20 : 1e20) ctx.fillText(fmtAxis(v / 1e20), xp(v), height - 8);
    ctx.fillText('n̄_e [10²⁰ m⁻³]', L + pw / 2, height - 0.5);
    ctx.textAlign = 'right';
    for (let v = 0; v <= TMax; v += 10) ctx.fillText(String(v), L - 4, yp(v) + 3);
    ctx.save(); ctx.translate(11, Tp + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('T̄ [keV]', 0, 0); ctx.restore();
    // lejant
    ctx.textAlign = 'left'; let ly = Tp + 14;
    for (const lv of levels) { ctx.fillStyle = lv.c; ctx.fillText(lv.lbl, L + pw - 44, ly); ly += 12; }
    ctx.fillStyle = '#06d6a0'; ctx.fillText('P_aux<0', L + pw - 44, ly); ly += 12;
    ctx.fillStyle = '#ef476f'; ctx.fillText('β_N>lim', L + pw - 44, ly); ly += 12;
    ctx.fillStyle = '#7f8ba3'; ctx.fillText('dark: P<P_LH', L + pw - 74, ly);
    // çalışma noktası
    if (point && isFinite(point.n) && isFinite(point.T)) {
      const px = xp(Math.min(point.n, nMax)), py = yp(Math.min(point.T, TMax));
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 9, py); ctx.lineTo(px + 9, py); ctx.moveTo(px, py - 9); ctx.lineTo(px, py + 9); ctx.stroke();
    }
  }, [grid, point, height, cfg]);

  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />;
}
