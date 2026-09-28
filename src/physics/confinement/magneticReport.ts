/**
 * Manyetik hapsetme atış raporu — 0D (MagneticModel) ve 1.5D (ProfileModel) ortak.
 * Geçmiş karelerindeki standart teşhis anahtarlarından (Ti0, Ti, Te, Q, P_fus, P_alpha,
 * P_rad, P_cond, triple, q_div, Efus_MJ, Ein_MJ, P_aux, P_oh, P_neutron, burnFrac, Nn,
 * fHe, Zeff) skor, mühendislik ve ekonomi özetini üretir.
 */
import { Geometry } from '../geometry';
import { MAGNET_TECH, MagnetCheck, economics, neutronWallLoad, tritiumBreedingRatio } from '../engineering';
import { U } from '../units';
import { flatTopMean } from '../analysis/flatTop';
import { HistoryFrame, MagneticConfig, Method, ShotReport, SimEvent, TerminationInfo } from '../types';

/** Lawson ateşleme referansı: D-T için nTτ_E ≈ 3e21 keV s m^-3 (Wesson; T≈15 keV, profil düz) */
export const LAWSON_DT = 3e21;
/**
 * Battaniyenin nötron enerjisi çoğalma katsayısı (14 MeV nötronlar için tipik 1.15–1.3; EU DEMO
 * battaniye tasarımları ~1.2). APPROXIMATION: D-D'nin 2.45 MeV nötronları için de aynı değer.
 */
export const BLANKET_NEUTRON_MULT = 1.18;

export interface MagneticReportContext {
  cfg: MagneticConfig;
  method: Method;
  g: Geometry;
  V: number;
  magnetInfo: MagnetCheck;
  terminated: TerminationInfo | null;
  tDisrupt: number;
  isStell: boolean;
  extraEngineering?: Record<string, number | string | boolean>;
  extraExtras?: Record<string, number | string>;
  extraWarnings?: string[];
}

export function buildMagneticReport(ctx: MagneticReportContext, hist: HistoryFrame[], events: SimEvent[]): ShotReport {
  const c = ctx.cfg;
  const last = hist[hist.length - 1];
  const d = (k: string) => hist.map((h) => h.d[k] ?? 0);
  const max = (arr: number[]) => arr.reduce((m, v) => (v > m ? v : m), -Infinity);
  const Q = d('Q'), Pf = d('P_fus');
  // Başlangıç geçişi (yoğunluk ve ısıtma rampası: düşük yoğunlukta tam güç → T aşımı) T_max'a ve
  // tasarım skoruna girmez: pencere t ≥ max(n_rampTime, heating.rampTime), en fazla atışın ikinci yarısı.
  const tStartup = Math.min(Math.max(c.n_rampTime, c.heating.rampTime), 0.5 * last.t);
  const post = hist.filter((h) => h.t >= tStartup);
  const dp = (k: string) => post.map((h) => h.d[k] ?? 0);
  const Tmax = max(dp('Ti0'));
  // süreler. Ateşleme süresi: model kendi ateşleme durumunu ('ignited', histerezisli; 0D) veriyorsa
  // o — olay günlüğüyle aynı ölçüt; vermiyorsa (1.5D) çerçeve ölçütü P_α ≥ P_rad + P_cond.
  const hasIgnFlag = hist.some((h) => h.d.ignited !== undefined);
  let burnTime = 0, ignTime = 0;
  for (let i = 1; i < hist.length; i++) {
    const dt = hist[i].t - hist[i - 1].t;
    if (hist[i].d.Q >= 1) burnTime += dt;
    const ign = hasIgnFlag ? (hist[i].d.ignited ?? 0) > 0
      : hist[i].d.P_alpha >= hist[i].d.P_rad + hist[i].d.P_cond && hist[i].d.P_fus > 1 && hist[i].d.Q >= 5;
    if (ign) ignTime += dt;
  }
  const term = ctx.terminated ?? { t: last.t, natural: true, reason: 'In progress', diagnosis: '', fix: '' };
  const stableTime = ctx.tDisrupt > 0 && !term.natural ? ctx.tDisrupt : last.t;
  const Efus = last.d.Efus_MJ, Ein = last.d.Ein_MJ;
  const Qavg = Ein > 0 ? Efus / Ein : 0;
  const triple = max(d('triple'));
  const lawsonRef = c.fuel === 'DT' ? LAWSON_DT : c.fuel === 'DHe3' ? 4e22 : c.fuel === 'DD' ? 1e23 : 1e24;
  // mühendislik (atış ortalaması, son %30)
  const avg = (k: string) => flatTopMean(hist, k, { samples: 'all' });
  const Pfus_avg = avg('P_fus'), Paux_avg = avg('P_aux') + avg('P_oh');
  const Pn_avg = avg('P_neutron');
  const nwl = neutronWallLoad(ctx.g, Pn_avg * 1e6, c.economics.availability);
  const tbr = tritiumBreedingRatio(c.blanket.type, c.blanket.li6_enrichment, c.blanket.coverage);
  const mag = ctx.magnetInfo;
  const P_recirc_other = 0.05 * Pfus_avg + 20 + (c.magnet.tech === 'Cu' ? 0.02 * mag.storedEnergy_GJ * 1e3 * 10 : 5); // pompalar/kriyo/bakır bobin direnci (APPROXIMATION)
  const eco = economics({
    V_core_m3: ctx.V, magnetCostRel: MAGNET_TECH[c.magnet.tech].cost_rel, P_fus_MW: Pfus_avg, P_aux_MW: Paux_avg, P_recirc_MW: P_recirc_other,
    thermalEff: c.economics.thermalEff, wallPlugEff: c.economics.wallPlugEff, availability: c.economics.availability,
    discountRate: c.economics.discountRate, lifetime_yr: c.economics.lifetime_yr,
    // enerji çoğalması yalnız nötron payına ve yalnız battaniye varsa
    P_neutron_MW: Pn_avg, neutronMult: c.blanket.type !== 'none' ? BLANKET_NEUTRON_MULT : 1, blanketCoverage: c.blanket.type !== 'none' ? c.blanket.coverage : 0,
    capitalOverride_MUSD: c.economics.capital_MUSD_override,
  });
  const warnings: string[] = [];
  if (tbr < 1.05 && c.fuel === 'DT') warnings.push(`TBR = ${tbr.toFixed(2)} < 1.05 — this reactor cannot breed its own tritium.`);
  if (max(d('q_div')) > 10) warnings.push(`Peak divertor heat flux ${max(d('q_div')).toFixed(0)} MW/m² > 10 MW/m² — target plates cannot withstand this; increase the divertor radiation fraction.`);
  if (mag.overstress) warnings.push(`TF coil stress ${mag.stress_MPa.toFixed(0)} MPa > ${mag.stress_limit} MPa limit.`);
  if (nwl.dpa_per_year > 20) warnings.push(`Neutron damage ${nwl.dpa_per_year.toFixed(0)} dpa/year — the first wall needs replacement within a few years.`);
  if (eco.P_net_MW < 0) warnings.push(`Negative net electricity (${eco.P_net_MW.toFixed(0)} MW): Q_eng < 1, the plant draws power from the grid.`);
  if (ctx.extraWarnings) warnings.push(...ctx.extraWarnings);
  // skor
  const scoreBreakdown = [
    { label: 'Q_scientific (max)', value: max(dp('Q')), ref: 10, unit: '', note: 'ITER target Q=10 (after start-up)' },
    { label: 'Fusion energy', value: Efus, ref: 59, unit: 'MJ', note: 'JET DTE2 record 59 MJ (2021)' },
    { label: 'Triple product', value: max(dp('triple')), ref: lawsonRef, unit: 'keV s m⁻³', note: 'Ignition ≈ 3e21 (after start-up)' },
    { label: 'Stable time', value: stableTime, ref: c.t_end, unit: 's', note: 'Scheduled duration' },
    { label: 'Temperature', value: Tmax, ref: 20, unit: 'keV', note: 'ITER axis ~20 keV (after start-up)' },
  ];
  let score = 0;
  for (const s of scoreBreakdown) score += 20 * Math.min(1, s.value / s.ref);
  if (!term.natural && !ctx.isStell) score *= 0.7;
  const historical = [
    { label: 'JET DTE2 (2021): 59 MJ', ratio: Efus / 59, note: 'fusion energy' },
    { label: 'JET 1997: P_fus 16.1 MW', ratio: max(Pf) / 16.1, note: 'peak fusion power' },
    { label: 'JT-60U (1996): nTτ 1.5e21', ratio: triple / 1.53e21, note: 'triple product (D-D equivalent)' },
    { label: 'ITER target: Q=10, 500 MW', ratio: max(Q) / 10, note: 'Q' },
    { label: 'NIF 2022: 3.15 MJ', ratio: Efus / 3.15, note: 'fusion energy per shot' },
  ];
  return {
    method: ctx.method, duration: last.t, timeUnit: 's',
    Tmax_keV: Tmax, Tmax_MC: U.keV_to_MC(Tmax), Timax_keV: max(dp('Ti')), Temax_keV: max(dp('Te')),
    stableTime_s: stableTime, burnTime_s: burnTime, ignitionTime_s: ignTime,
    stableDefinition: 'Stable time = duration for which the plasma is sustained without disruption/extinction. Burn time = duration with Q ≥ 1 (P_fusion ≥ P_auxiliary+P_ohmic). Ignition time = duration with P_alpha ≥ P_rad + P_conduction, where P_alpha is the heating by charged fusion products only (beam ions excluded): self-sustaining without external heating.',
    Q_sci_max: max(Q), Q_sci_avg: Qavg, Q_eng: eco.Q_eng,
    Q_eng_note: `Q_eng = P_electric,gross / P_recirculating = (${eco.P_gross_MW.toFixed(0)} MW) / (${eco.P_recirc_MW.toFixed(0)} MW). Scientific Q is measured at the plasma boundary (P_fusion/P_heating,absorbed), Q_eng at the wall plug: heating wall-plug efficiency ${(c.economics.wallPlugEff * 100).toFixed(0)}%, thermal efficiency ${(c.economics.thermalEff * 100).toFixed(0)}%.`,
    E_fusion_MJ: Efus, E_input_MJ: Ein,
    neutronYield: last.d.Nn, neutronFluence_m2: last.d.Nn / nwl.S_wall,
    tripleProduct_max: triple, lawson_ratio: triple / lawsonRef,
    lawsonNote: `Reference (nTτ_E)_ignition ≈ ${lawsonRef.toExponential(1)} keV s m⁻³ (${c.fuel}); 1.0 = ignition threshold (profile effects neglected).`,
    termination: term, score: Math.round(score), scoreBreakdown, historical, warnings,
    engineering: {
      'B_coil (T)': +mag.B_coil.toFixed(2), 'Technology B_max (T)': mag.B_max, 'TF stress (MPa)': +mag.stress_MPa.toFixed(0), 'Stress limit (MPa)': mag.stress_limit,
      'Magnetic energy (GJ)': +mag.storedEnergy_GJ.toFixed(2),
      'Divertor q_max (MW/m²)': +max(d('q_div')).toFixed(1), 'Neutron wall load (MW/m²)': +nwl.load_MWm2.toFixed(2), 'dpa/year': +nwl.dpa_per_year.toFixed(1),
      'TBR': +tbr.toFixed(3), 'Tritium burn fraction': +(last.d.burnFrac ?? 0).toFixed(3),
      'Avg. P_fusion (MW)': +Pfus_avg.toFixed(1), 'P_thermal (MW)': +eco.P_th_MW.toFixed(0), 'Gross P_electric (MW)': +eco.P_gross_MW.toFixed(0),
      'P_recirculating (MW)': +eco.P_recirc_MW.toFixed(0), 'Net P_electric (MW)': +eco.P_net_MW.toFixed(0),
      'Capital cost (M$)': +eco.Ccap_MUSD.toFixed(0), 'LCOE ($/MWh)': isFinite(eco.LCOE_USD_MWh) ? +eco.LCOE_USD_MWh.toFixed(0) : 'n/a (net<0)', 'EROI': +eco.EROI.toFixed(1),
      ...(ctx.extraEngineering ?? {}),
    },
    extras: {
      'He ash fraction (final)': +(last.d.fHe ?? 0).toFixed(3), 'Z_eff (final)': +(last.d.Zeff ?? 0).toFixed(2),
      'ELM count': events.filter((e) => e.kind === 'ELM').length, 'Sawtooth count': events.filter((e) => e.kind === 'sawtooth').length,
      ...(ctx.extraExtras ?? {}),
    },
  };
}
