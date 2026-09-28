/**
 * Mühendislik kısıtları: mıknatıs, divertör, nötron duvar yükü, TBR, ekonomi.
 * Çoğu ilişki sistem kodu (PROCESS, Sheffield 1986/2016) düzeyinde basitleştirilmiştir;
 * APPROXIMATION işaretli.
 */
import { Geometry, plasmaSurface, poloidalField } from './geometry';
import { BlanketType, MagnetTech } from './types';

/**
 * Mıknatıs teknolojileri — iletken üzerindeki maksimum alan ve TF bobin kasası gerilme sınırı.
 * Kaynaklar: ITER TF (Nb3Sn) 11.8 T tepe alan; SPARC (REBCO) ~20 T (Creely 2020);
 * JET bakır TF ~ 8 T bobinde (darbeli, 3.45 T eksende); NbTi ~ 8–9 T @ 4.2 K (JT-60SA 5.65 T).
 * Gerilme: yapısal çelik (316LN) ~ 660 MPa izin verilen (ITER tasarım).
 */
export const MAGNET_TECH: Record<MagnetTech, { Bmax_coil: number; stress_MPa: number; label: string; cryo_W_per_W: number; cost_rel: number }> = {
  Cu: { Bmax_coil: 9.0, stress_MPa: 300, label: 'Copper (water-cooled, pulsed)', cryo_W_per_W: 0, cost_rel: 0.4 },
  NbTi: { Bmax_coil: 8.5, stress_MPa: 660, label: 'NbTi superconductor (4.5 K)', cryo_W_per_W: 300, cost_rel: 0.8 },
  Nb3Sn: { Bmax_coil: 13.0, stress_MPa: 660, label: 'Nb3Sn superconductor (4.5 K, ITER)', cryo_W_per_W: 300, cost_rel: 1.0 },
  REBCO: { Bmax_coil: 23.0, stress_MPa: 800, label: 'REBCO HTS (20 K, SPARC/ARC)', cryo_W_per_W: 40, cost_rel: 1.6 },
};

export interface MagnetCheck {
  B_coil: number; // iç bacakta tepe alan
  B_max: number;
  stress_MPa: number;
  stress_limit: number;
  quench: boolean;
  overstress: boolean;
  storedEnergy_GJ: number;
}

/**
 * B_coil = B0 · R / R_coil,  R_coil = R − a − gap (iç bacak dış yüzeyi)  (1/R alan düşüşü)
 * Gerilme (hoop, ince halka yaklaşımı): σ ≈ B_coil² / (2μ0) · (R_coil / t_coil) · f_şekil
 * APPROXIMATION: Manyetik basınç × (yarıçap/kalınlık); gerçek TF bobinleri D-şekli ile bükme momentini azaltır (f≈0.5).
 */
export function checkMagnet(g: Geometry, B0: number, tech: MagnetTech, gap: number, coilThickness: number): MagnetCheck {
  const spec = MAGNET_TECH[tech];
  const Rcoil = Math.max(g.R - g.a - gap, 0.05);
  const Bc = (B0 * g.R) / Rcoil;
  const pmag = (Bc * Bc) / (2 * 1.25663706212e-6);
  const stress = (pmag * (Rcoil / Math.max(coilThickness, 0.05)) * 0.5) / 1e6;
  // Depolanan enerji ~ (B0²/2μ0) × toroidal hacim (R_coil..R+a+gap) — kaba
  const Rout = g.R + g.a + gap;
  const vol = Math.PI * (Rout * Rout - Rcoil * Rcoil) * 2 * (g.a * g.kappa + gap);
  const E = ((B0 * B0) / (2 * 1.25663706212e-6)) * vol * ((g.R * g.R) / (Rcoil * Rout));
  return {
    B_coil: Bc, B_max: spec.Bmax_coil, stress_MPa: stress, stress_limit: spec.stress_MPa,
    quench: Bc > spec.Bmax_coil, overstress: stress > spec.stress_MPa, storedEnergy_GJ: E / 1e9,
  };
}

/**
 * Divertör ısı akısı — Eich et al., Nucl. Fusion 53 (2013) 093031 (regresyon #14):
 *  λ_q [mm] = 0.63 · B_pol^-1.19   (H-mode, ELM arası)
 * Islanan alan: A_wet = 2π R_strike · λ_q · f_x (akı genişlemesi) ; dış hedef payı ~ 2/3.
 * Divertör radyasyonu f_rad_div P_SOL'u azaltır (safsızlık tohumlama / detachment).
 */
export function divertorHeatFlux(g: Geometry, Ip_A: number, P_SOL_W: number, f_rad_div: number, fluxExpansion: number): { lambda_q_mm: number; q_div_MWm2: number; A_wet_m2: number } {
  const Bp = poloidalField(g, Ip_A);
  const lambda_q = 0.63 * Math.pow(Math.max(Bp, 0.05), -1.19); // mm
  // Divertör yayılması: λ_int = λ_q + 1.64 S (Makowski 2012), S/λ_q ≈ 1 alındı (APPROXIMATION)
  const lambda_int = lambda_q * (1 + 1.64);
  const Rstrike = g.R - 0.3 * g.a; // APPROXIMATION: dış strike noktası
  const tilt = 3; // hedef plaka eğimi ~20° → 1/sin ≈ 3 (ITER dikey hedef)
  const A_wet = 2 * Math.PI * Rstrike * (lambda_int * 1e-3) * fluxExpansion * tilt;
  const q = (P_SOL_W * (1 - f_rad_div) * (2 / 3)) / A_wet / 1e6;
  return { lambda_q_mm: lambda_q, q_div_MWm2: q, A_wet_m2: A_wet };
}

/** Stellarator/ST için q_div yerine basit ada divertörü: aynı formül, B_pol ≈ ι B a/R */
export function divertorHeatFluxStellarator(g: Geometry, B0: number, iota: number, P_SOL_W: number, f_rad_div: number): number {
  const Bp = (iota * B0 * g.a) / g.R;
  const lambda_q = 0.63 * Math.pow(Math.max(Bp, 0.05), -1.19) * 3; // ada divertörü daha geniş (APPROXIMATION ×3)
  const A_wet = 2 * Math.PI * g.R * (lambda_q * 1e-3) * 10;
  return (P_SOL_W * (1 - f_rad_div)) / A_wet / 1e6;
}

/**
 * Nötron duvar yükü ve hasar: Γ_n = P_n / S_duvar [MW/m²]; dpa/yıl ≈ 10 · Γ_n · (availability)
 * (14 MeV nötronlar için çelikte ~10 dpa per MW·yr/m²; Zinkle & Möslang 2013)
 */
export function neutronWallLoad(g: Geometry, P_neutron_W: number, availability: number): { load_MWm2: number; dpa_per_year: number; S_wall: number } {
  const S = plasmaSurface(g) * 1.15; // duvar plazmadan ~%15 büyük
  const load = P_neutron_W / S / 1e6;
  return { load_MWm2: load, dpa_per_year: 10 * load * availability, S_wall: S };
}

/**
 * Trityum üretim oranı (TBR) — APPROXIMATION: battaniye tipi tam kaplama TBR'si × kaplama
 * oranı × Li-6 zenginleştirme eğrisi. Referans değerler (Fischer 2015, EU DEMO nötronik):
 *  HCPB (%60 Li-6) 1.20–1.27 ; HCLL (%90) 1.14–1.20 ; WCLL (%90) 1.15 ; DCLL (%90) 1.20 ; FLiBe (%90, ARC) ~1.1–1.3
 */
export function tritiumBreedingRatio(type: BlanketType, li6: number, coverage: number): number {
  const base: Record<BlanketType, { tbr: number; refEnrich: number }> = {
    HCPB: { tbr: 1.27, refEnrich: 0.6 }, HCLL: { tbr: 1.18, refEnrich: 0.9 }, WCLL: { tbr: 1.15, refEnrich: 0.9 },
    DCLL: { tbr: 1.2, refEnrich: 0.9 }, FLiBe: { tbr: 1.2, refEnrich: 0.9 }, none: { tbr: 0, refEnrich: 0.9 },
  };
  const b = base[type];
  if (b.tbr === 0) return 0;
  // Zenginleştirme bağımlılığı: doyumlu (Li-6 %7.5 doğal → ~%60 referans; ötesi zayıf kazanç)
  const f = (x: number) => 1 - Math.exp(-x / 0.35);
  const enrichFactor = f(li6) / f(b.refEnrich);
  return b.tbr * enrichFactor * (coverage / 0.9);
}

/**
 * Basit ekonomi katmanı (eğitim amaçlı). Sermaye maliyeti — Sheffield & Milora (2016) tipi
 * hacim ölçekli tahmin: C_cap ≈ 3.5 G$ · (V_core/1000 m³)^0.6 · f_magnet + sabit 1.5 G$ (BOP, bina).
 * LCOE = (CRF·C_cap + O&M) / (P_net · availability · 8760 h).  CRF = r(1+r)^N/((1+r)^N−1).
 * APPROXIMATION: ilk-türden-tesis maliyetleri değil, olgun teknoloji seri üretim varsayımı.
 */
export function economics(p: {
  V_core_m3: number; magnetCostRel: number; P_fus_MW: number; P_aux_MW: number; P_recirc_MW: number;
  thermalEff: number; wallPlugEff: number; availability: number; discountRate: number; lifetime_yr: number;
  /** neutron power (part of P_fus) [MW] */
  P_neutron_MW: number;
  /** energy-multiplication factor M_n of the neutron energy entering the blanket (⁶Li(n,α)T, (n,2n); ≈ 1.18 for D-T); 1 if there is no blanket */
  neutronMult: number;
  /** blanket coverage fraction (share of the neutrons that enter the blanket) */
  blanketCoverage: number;
  capitalOverride_MUSD?: number;
}) {
  const Ccap = p.capitalOverride_MUSD ?? (3500 * Math.pow(p.V_core_m3 / 1000, 0.6) * p.magnetCostRel + 1500);
  // Thermal power: only the NEUTRON energy entering the blanket is multiplied, by (M_n − 1)·coverage·P_n; the power of the charged
  // products goes to the wall/divertor as it is
  const P_th = p.P_fus_MW + (p.neutronMult - 1) * p.blanketCoverage * p.P_neutron_MW + p.P_aux_MW;
  const P_gross = P_th * p.thermalEff;
  const P_heat_wallplug = p.P_aux_MW / p.wallPlugEff;
  const P_recirc = P_heat_wallplug + p.P_recirc_MW; // pompalar, kriyo, vb.
  const P_net = P_gross - P_recirc;
  const Q_eng = P_recirc > 0 ? P_gross / P_recirc : Infinity;
  const r = p.discountRate, N = p.lifetime_yr;
  const CRF = (r * Math.pow(1 + r, N)) / (Math.pow(1 + r, N) - 1);
  const OM = 0.04 * Ccap; // yıllık O&M ~%4 (trityum, değiştirme dahil değil)
  const E_yr_MWh = Math.max(P_net, 0) * p.availability * 8760;
  const LCOE = E_yr_MWh > 0 ? ((CRF * Ccap + OM) * 1e6) / (E_yr_MWh * 1e3) * 1e3 : Infinity; // $/MWh
  // EROI (elektrik): ömür boyu net elektrik / (gömülü enerji ~ 25 GWh·(C_cap/1 G$) + recirc)
  const embodied_MWh = 25000 * (Ccap / 1000);
  const EROI = P_gross > 0 ? (P_gross * p.availability * 8760 * N) / (embodied_MWh + P_recirc * p.availability * 8760 * N) : 0;
  return { Ccap_MUSD: Ccap, P_th_MW: P_th, P_gross_MW: P_gross, P_recirc_MW: P_recirc, P_net_MW: P_net, Q_eng, LCOE_USD_MWh: LCOE, EROI, CRF };
}
