/**
 * Simple economics layer (educational) and power balance of the plant (systems-lite, lane ws7b; moved here unchanged from
 * engineering.ts, which re-exports it).
 *
 * Capital cost after Sheffield & Milora (2016) type volume scaling: C_cap = 3.5 G$ (V_core / 1000 m^3)^0.6 f_magnet + a fixed
 * 1.5 G$ (balance of plant, buildings). LCOE = (CRF C_cap + O&M) / (P_net availability 8760 h), CRF = r (1+r)^N / ((1+r)^N - 1)
 * (its limit 1/N at r = 0).
 * APPROXIMATION: mature-technology series production, not first-of-a-kind costs. The PROCESS-style account structure is in
 * `costs.ts`.
 */
export function economics(p: {
  V_core_m3: number; magnetCostRel: number; P_fus_MW: number; P_aux_MW: number; P_recirc_MW: number;
  thermalEff: number; wallPlugEff: number; availability: number; discountRate: number; lifetime_yr: number;
  /** neutron power (part of P_fus) [MW] */
  P_neutron_MW: number;
  /** energy-multiplication factor M_n of the neutron energy entering the blanket (6Li(n,alpha)T, (n,2n); about 1.18 for D-T); 1 if there is no blanket */
  neutronMult: number;
  /** blanket coverage fraction (share of the neutrons that enter the blanket) */
  blanketCoverage: number;
  capitalOverride_MUSD?: number;
}) {
  const Ccap = p.capitalOverride_MUSD ?? (3500 * Math.pow(p.V_core_m3 / 1000, 0.6) * p.magnetCostRel + 1500);
  // Thermal power: only the NEUTRON energy entering the blanket is multiplied, by (M_n - 1) coverage P_n; the power of the charged
  // products goes to the wall/divertor as it is
  const P_th = p.P_fus_MW + (p.neutronMult - 1) * p.blanketCoverage * p.P_neutron_MW + p.P_aux_MW;
  const P_gross = P_th * p.thermalEff;
  const P_heat_wallplug = p.P_aux_MW / p.wallPlugEff;
  const P_recirc = P_heat_wallplug + p.P_recirc_MW; // pumps, cryoplant, etc.
  const P_net = P_gross - P_recirc;
  const Q_eng = P_recirc > 0 ? P_gross / P_recirc : Infinity;
  const r = p.discountRate, N = p.lifetime_yr;
  const CRF = r === 0 ? 1 / N : (r * Math.pow(1 + r, N)) / (Math.pow(1 + r, N) - 1); // r = 0 (allowed) is 0/0 in the closed form
  const OM = 0.04 * Ccap; // annual O&M about 4 % (tritium and replacement parts not included)
  const E_yr_MWh = Math.max(P_net, 0) * p.availability * 8760;
  const LCOE = E_yr_MWh > 0 ? ((CRF * Ccap + OM) * 1e6) / (E_yr_MWh * 1e3) * 1e3 : Infinity; // $/MWh
  // EROI (electric): lifetime gross electricity / (embodied energy about 25 GWh (C_cap / 1 G$) + recirculating energy)
  const embodied_MWh = 25000 * (Ccap / 1000);
  const EROI = P_gross > 0 ? (P_gross * p.availability * 8760 * N) / (embodied_MWh + P_recirc * p.availability * 8760 * N) : 0;
  return { Ccap_MUSD: Ccap, P_th_MW: P_th, P_gross_MW: P_gross, P_recirc_MW: P_recirc, P_net_MW: P_net, Q_eng, LCOE_USD_MWh: LCOE, EROI, CRF };
}
