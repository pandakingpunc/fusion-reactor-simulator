/**
 * Disruption fiziği: termal quench, akım quench, halo akımı, kaçak elektronlar, duvar yükü.
 * Kaynaklar: Hender et al., "Chapter 3: MHD stability, operational limits and disruptions",
 * Nucl. Fusion 47 (2007) S128; Rosenbluth & Putvinski, Nucl. Fusion 37 (1997) 1355;
 * Lehnen et al., J. Nucl. Mater. 463 (2015) 39.
 */
import { Geometry, crossSectionArea } from './geometry';

export type DisruptionCause =
  | 'density_limit' | 'beta_limit' | 'q95_limit' | 'radiative_collapse'
  | 'tungsten_accumulation' | 'vde' | 'ntm_locked_mode' | 'magnet_quench' | 'density_collapse' | 'none';

export interface DisruptionReport {
  cause: DisruptionCause;
  t_onset: number; // s
  W_th_MJ: number; // termal enerji (quench anında)
  W_mag_MJ: number; // poloidal manyetik enerji  ≈ ½ L I²
  tau_TQ_ms: number; // termal quench süresi
  tau_CQ_ms: number; // akım quench süresi
  halo_fraction: number; // I_halo,max / I_p
  TPF: number; // toroidal peaking factor
  halo_TPF_product: number; // I_h/I_p × TPF  (ITER tasarım sınırı ≈ 0.75)
  runaway_avalanche_efolds: number; // ln(gain)
  runaway_current_MA: number; // tahmini
  wall_energy_density_MJm2: number; // TQ'da divertöre/duvara düşen enerji yoğunluğu
  melt_risk: boolean; // W için ~ 0.5 MJ/m² (1 ms) eritme eşiği (Lehnen 2015)
  vertical_force_MN: number; // halo/VDE dikey kuvvet tahmini
}

export function disruptionReport(p: {
  cause: DisruptionCause; t: number; g: Geometry; Ip_MA: number; W_th_J: number; B0: number;
}): DisruptionReport {
  const { g, Ip_MA } = p;
  const A = crossSectionArea(g);
  // İç indüktans + dış: L ≈ μ0 R (ln(8R/a) − 2 + l_i/2), l_i≈0.8
  const L = 1.25663706212e-6 * g.R * (Math.log((8 * g.R) / (g.a * Math.sqrt(g.kappa))) - 2 + 0.4);
  const I = Ip_MA * 1e6;
  const W_mag = 0.5 * L * I * I;
  // Termal quench: τ_TQ ~ 1 ms × (a/2m) (Hender 2007: ~ 0.5–3 ms, büyük makinelerde daha uzun; APPROXIMATION)
  const tau_TQ = 1.0 * (g.a / 2.0) * (1 + 0.5 * Math.log(1 + Ip_MA / 5));
  // Akım quench: ITER limit τ_CQ/S ≥ 1.67 ms/m² (Hender 2007 §3.4.3, deney veritabanı alt sınırı)
  // Tipik: τ_CQ/S ≈ 3–6 ms/m² ; burada 4 kullanıldı (APPROXIMATION)
  const tau_CQ = 4.0 * A;
  // Halo akımı: I_h/I_p ≤ 0.5 ; TPF ≤ 2 ; deneysel: (I_h/I_p)·TPF ≤ 0.75 (Hender 2007 Şek. 45)
  // VDE kaynaklı disruption'larda daha yüksek. Elongasyon ile artar (κ>1.5 dikey kararsız).
  const kFac = Math.min(1, (g.kappa - 1) / 1.0);
  const halo = p.cause === 'vde' || p.cause === 'q95_limit' ? 0.35 + 0.1 * kFac : 0.15 + 0.15 * kFac;
  const TPF = p.cause === 'vde' ? 2.0 : 1.4;
  // Kaçak elektron çığı: e-katlanma sayısı ≈ 2.5 × I_p[MA] (Rosenbluth-Putvinski 1997: gain ~ exp(2.5 I_p[MA]))
  const efolds = 2.5 * Ip_MA;
  // Tohum akım tahmini: Dreicer + Compton/trityum ~ 1e-3 × I_p (ITER: ~ mA-kA tohum). APPROXIMATION.
  // Çığ ile büyüyüp I_p'nin ~%50-70'ine doyar (ITER tahmini ≈ 10 MA / 15 MA).
  const seedFrac = Ip_MA > 3 ? 1e-6 : 1e-8;
  const runaway = Math.min(0.7 * Ip_MA, Ip_MA * seedFrac * Math.exp(efolds));
  // Duvar enerji yoğunluğu: TQ'da W_th'nin ~%50'si divertöre, yayılma alanı ≈ 2πR × (10 λ_q) ×2 (iç+dış)
  // ITER için tipik hesap: 350 MJ → ~ 20–30 MJ/m² (Lehnen 2015). λ_q(TQ) ~ 5-10 × λ_q(H-mode) alınır.
  const lambda_TQ = 0.05; // m (APPROXIMATION: genişlemiş ısı akı katmanı)
  const wetted = 2 * (2 * Math.PI * g.R * lambda_TQ * 4); // iç+dış hedef, akı genişlemesi 4
  const wallE = (0.5 * p.W_th_J) / wetted / 1e6;
  // Dikey kuvvet ~ I_halo × B_T × 2πR × fraksiyon (APPROXIMATION)
  const Fz = (halo * I * p.B0 * 2 * Math.PI * g.R * 0.1) / 1e6;
  return {
    cause: p.cause,
    t_onset: p.t,
    W_th_MJ: p.W_th_J / 1e6,
    W_mag_MJ: W_mag / 1e6,
    tau_TQ_ms: tau_TQ,
    tau_CQ_ms: tau_CQ,
    halo_fraction: halo,
    TPF,
    halo_TPF_product: halo * TPF,
    runaway_avalanche_efolds: efolds,
    runaway_current_MA: runaway,
    wall_energy_density_MJm2: wallE,
    melt_risk: wallE > 0.5, // W: ~0.5 MJ/m² @ 1 ms (Lehnen 2015 eritme eşiği yaklaşık)
    vertical_force_MN: Fz,
  };
}

export const DISRUPTION_LABELS: Record<DisruptionCause, string> = {
  density_limit: 'Density-limit disruption (Greenwald)',
  beta_limit: 'Beta limit — ideal MHD instability (Troyon)',
  q95_limit: 'q95 < 2 — locked mode / vertical displacement (VDE)',
  radiative_collapse: 'Radiative collapse (P_rad > P_heat)',
  tungsten_accumulation: 'Tungsten accumulation — core radiative collapse',
  vde: 'Vertical displacement event (VDE)',
  ntm_locked_mode: 'NTM grew and locked (locked mode)',
  magnet_quench: 'Magnet quench — shot aborted',
  density_collapse: 'Density collapse — fuelling lost',
  none: '—',
};

export const DISRUPTION_FIXES: Record<DisruptionCause, string> = {
  density_limit: 'Lower the target density (n/n_G < 0.85), increase plasma current or reduce the minor radius; limit the fueling rate.',
  beta_limit: 'Reduce heating power, increase B_T or I_p (β_N = β a B / I_p), or raise the β_N limit through wall stabilization/shaping.',
  q95_limit: 'Reduce plasma current or increase B_T: aim for q95 ≈ 5 a² B κ_eff / (R I_p) > 3.',
  radiative_collapse: 'Reduce impurity concentration (wall conditioning), increase auxiliary heating, and lower density.',
  tungsten_accumulation: 'Prevent W accumulation with central ECRH, increase ELM frequency (pellet pacing), and reduce the W source (divertor sputtering).',
  vde: 'Reduce elongation or strengthen vertical position control.',
  ntm_locked_mode: 'Keep β_N below the NTM threshold or stabilize the island with ECCD.',
  magnet_quench: 'Reduce B_T below the magnet technology limit or select HTS (REBCO).',
  density_collapse: 'Raise the maximum fuelling rate or fuel with pellets instead of gas (the density controller cannot hold the target), or lower the target density; a heated plasma with no particle source loses its density and the temperature runs away.',
  none: '',
};
