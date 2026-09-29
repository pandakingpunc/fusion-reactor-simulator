/**
 * PROCESS-style cost accounts (lane ws7b, stretch item): a port of the "1990" cost model of the PROCESS systems code (UKAEA, MIT
 * licence; `process/models/costs/costs.py`, class `Costs`, the standard accounts of the US DOE/ORNL cost-accounting scheme):
 *   21 structures and site facilities (buildings scaled with volume), 22 fusion power island (22.1 reactor: first wall, blanket,
 *   shield, structure, divertor; 22.2 magnets and vacuum vessel; 22.3 power injection; 22.4 vacuum; 22.5 power conditioning;
 *   22.6 heat transport; 22.7 fuel handling; 22.8 instrumentation and control; 22.9 maintenance equipment), 23 turbine plant,
 *   24 electric plant, 25 miscellaneous, 26 heat rejection, 9 indirect cost and contingency, and the cost of electricity (`coelc`).
 * Costs are in 1990 US$ (M$ in the results), first-of-a-kind except where `fkind` says otherwise; the general form of the physical
 * accounts is cost = unit cost x mass, area, power or volume^exponent, with the unit costs of `costUnits.ts`.
 * Sources of the model: J. Delene (ORNL, private communication, 1990), the TETRA and STAR/Generomak schemes (Galambos, ORNL), R. Hancox
 * (Culham, 1994) for the superconducting conductor, and the description in Kovari et al., Fusion Eng. Des. 104 (2016) 9-20 and the
 * PROCESS documentation ("Cost Models"). The port reproduces the reference values of the PROCESS unit tests
 * `tests/unit/models/test_costs_1990.py` account by account (costs.test.ts).
 *
 * Differences from the PROCESS source, all deliberate: (1) the inertial-fusion (IFE) branches are not ported; (2) the Nth-of-a-kind
 * factor `fkind` is applied to every heating and current-drive system (PROCESS costs.py applies it, and the cost of the neutral beams,
 * only inside the `ifueltyp = 1` branch since its Fortran-to-Python translation; the original Fortran, and this port, apply it always);
 * (3) if the first-wall/blanket life is not shorter than the plant life the current-drive life is set equal to it (PROCESS leaves it
 * undefined there and divides by zero); (4) the steel-block thermal storage of a pulsed plant (`istore` = 3) is costed in M$ (PROCESS
 * adds dollars to accounts in M$: a missing factor 1e-6); (5) an account whose physical inputs are not given is not costed and is
 * listed in `omitted`: a total with omissions is a partial estimate and `complete` is false. This module is not used by the shot report: the report's
 * capital cost stays the volume scaling of `economics.ts`, whose `capitalOverride_MUSD` can take `concost` of a complete estimate.
 */
import {
  COST_FINANCE_1990, COST_UNITS_1990, CostFinance, CostUnits, DEN_COPPER, J_CRIT_STRAND_0, LSA_FACTORS, SC_DENSITY_KG_M3, lsaFactor,
} from './costUnits';

/** atomic mass unit [kg] (PROCESS constants.UMASS) and days per year (PROCESS constants.N_DAY_YEAR) */
export const UMASS = 1.660538921e-27;
export const N_DAY_YEAR = 365.2425;

/** units, finance and plant type of an estimate */
export interface CostCtx {
  units: CostUnits;
  fin: CostFinance;
  /** a power reactor (turbine plant, cost of electricity) or an experimental device (`ireactor` = 1 or 0) */
  isReactor: boolean;
}

/** default context: PROCESS defaults, a power reactor */
export function costContext(over?: { units?: Partial<CostUnits>; fin?: Partial<CostFinance>; isReactor?: boolean }): CostCtx {
  return { units: { ...COST_UNITS_1990, ...(over?.units ?? {}) }, fin: { ...COST_FINANCE_1990, ...(over?.fin ?? {}) }, isReactor: over?.isReactor ?? true };
}

const M = 1e-6;

// ---------------------------------------------------------------------------------------------------------------------------
// Account 21: structures and site facilities
// ---------------------------------------------------------------------------------------------------------------------------

/** building volumes [m^3] (PROCESS `buildings` module) */
export interface BuildingVolumes {
  /** reactor building */ rbvol: number;
  /** reactor maintenance building */ rmbvol: number;
  /** warm shop */ wsvol: number;
  /** tritium building */ triv: number;
  /** electrical equipment building */ elevol: number;
  /** administration buildings */ admvol: number;
  /** control buildings */ convol: number;
  /** shops and warehouses */ shovol: number;
  /** cryogenic building */ cryvol: number;
  /** reactor containment interior volume (used by the detritiation and ventilation accounts 22.7.3, 22.7.4) */ volrci?: number;
}

export interface Acc21 { c21: number; c211: number; c212: number; c213: number; c214: number; c2141: number; c2142: number; c215: number; c216: number; c217: number; c2171: number; c2172: number; c2173: number; c2174: number }

/** Account 21: cost = unit cost x volume (exponent 1) x safety factor; site improvements and land are allowances */
export function acc21(b: BuildingVolumes, ctx: CostCtx): Acc21 {
  const u = ctx.units, f = lsaFactor(LSA_FACTORS.buildings, ctx.fin.lsa);
  const c211 = u.csi * f + u.cland; // land is not scaled with the safety level
  const c212 = M * u.ucrb * b.rbvol * f;
  const c213 = ctx.isReactor ? u.cturbb * f : 0;
  const c2141 = M * u.ucmb * b.rmbvol * f;
  const c2142 = M * u.ucws * b.wsvol * f;
  const c214 = c2141 + c2142;
  const c215 = M * u.uctr * b.triv * f;
  const c216 = M * u.ucel * b.elevol * f;
  const c2171 = M * u.ucad * b.admvol * f;
  const c2172 = M * u.ucco * b.convol * f;
  const c2173 = M * u.ucsh * b.shovol * f;
  const c2174 = M * u.uccr * b.cryvol * f;
  const c217 = c2171 + c2172 + c2173 + c2174;
  return { c21: c211 + c212 + c213 + c214 + c215 + c216 + c217, c211, c212, c213, c214, c2141, c2142, c215, c216, c217, c2171, c2172, c2173, c2174 };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Account 22.1: reactor (first wall, blanket, shield, structure, divertor)
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Items that can be replaced during the life of the plant (first wall, blanket, divertor) follow `ifueltyp`: 0 capital cost, 1 a fuel
 * cost (the capital account is zero and the whole set is charged by `coelc`), 2 the initial set is capital and the replacements are fuel.
 */
function replaceable(c: number, ifueltyp: number): { capital: number; replacement: number } {
  if (ifueltyp === 1) return { capital: 0, replacement: c };
  if (ifueltyp === 2) return { capital: c, replacement: c };
  return { capital: c, replacement: 0 };
}

/** Account 22.1.1 first wall: the cost is scaled linearly with the surface area (TFCX); armour, structure and a passive stabiliser */
export function acc2211(a_fw_m2: number, ctx: CostCtx): { c2211: number; fwallcst: number } {
  const u = ctx.units, f = lsaFactor(LSA_FACTORS.fwbs, ctx.fin.lsa);
  const c = ctx.fin.fkind * M * f * ((u.ucfwa + u.ucfws) * a_fw_m2 + u.ucfwps);
  const r = replaceable(c, ctx.fin.ifueltyp);
  return { c2211: r.capital, fwallcst: r.replacement };
}

/** blanket material masses [kg] (PROCESS `fwbs`: m_blkt_beryllium, m_blkt_li2o, m_blkt_steel_total, m_blkt_vanadium) */
export interface BlanketMasses { beryllium_kg: number; li2o_kg: number; steel_kg: number; vanadium_kg: number }

/** Account 22.1.2 blanket (solid Li2O and Be blanket materials of the PROCESS CCFE model) */
export function acc2212(m: BlanketMasses, ctx: CostCtx): { c2212: number; c22121: number; c22122: number; c22123: number; c22124: number; blkcst: number } {
  const u = ctx.units, k = ctx.fin.fkind * lsaFactor(LSA_FACTORS.fwbs, ctx.fin.lsa);
  const c22121 = k * M * m.beryllium_kg * u.ucblbe;
  const c22122 = k * M * m.li2o_kg * u.ucblli2o;
  const c22123 = k * M * m.steel_kg * u.ucblss;
  const c22124 = k * M * m.vanadium_kg * u.ucblvd;
  const r = replaceable(c22121 + c22122 + c22123 + c22124, ctx.fin.ifueltyp);
  return { c2212: r.capital, c22121, c22122, c22123, c22124, blkcst: r.replacement };
}

/** Account 22.1.3 shield and penetration shield (steel plate, [kg]) */
export function acc2213(shield_kg: number, penetrationShield_kg: number, ctx: CostCtx): { c2213: number; c22131: number; c22132: number } {
  const u = ctx.units, k = ctx.fin.fkind * lsaFactor(LSA_FACTORS.fwbs, ctx.fin.lsa);
  const c22131 = k * M * shield_kg * u.ucshld;
  const c22132 = k * M * penetrationShield_kg * u.ucpens;
  return { c2213: c22131 + c22132, c22131, c22132 };
}

/** Account 22.1.4 reactor structure: standard steel elements [kg] */
export function acc2214(gsmass_kg: number, ctx: CostCtx): number {
  return ctx.fin.fkind * M * gsmass_kg * ctx.units.ucgss * lsaFactor(LSA_FACTORS.structure, ctx.fin.lsa);
}

/** Account 22.1.5 divertor: scaled linearly with the surface area from TFCX (tenth-of-a-kind engineering and installation) */
export function acc2215(a_div_m2: number, ctx: CostCtx): { c2215: number; divcst: number } {
  const r = replaceable(ctx.fin.fkind * M * a_div_m2 * ctx.units.ucdiv, ctx.fin.ifueltyp);
  return { c2215: r.capital, divcst: r.replacement };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Account 22.2: magnets and vacuum vessel
// ---------------------------------------------------------------------------------------------------------------------------

/** TF coil quantities of the cost accounts (PROCESS `tfcoil` and `structure` modules; masses per coil as in PROCESS) */
export interface TFCostInput {
  /** superconducting coils (else resistive: copper centre post and outboard legs) */ superconducting: boolean;
  /** number of coils */ nCoils: number;
  /** superconductor material index 1 to 9 (`i_tf_sc_mat`) */ scMaterial?: number;
  /** superconductor cost model: 0 by mass, 1 by critical current (`supercond_cost_model`) */ scCostModel?: 0 | 1;
  /** length of the winding of one coil [m] (`len_tf_coil`) */ coilLength_m?: number;
  /** turns per coil (`n_tf_coil_turns`) */ turns?: number;
  /** superconductor mass of one coil [kg] (`m_tf_coil_superconductor`) */ scMass_kg?: number;
  /** copper mass of one coil [kg] (`m_tf_coil_copper`) */ cuMass_kg?: number;
  /** case mass of one coil [kg] (`m_tf_coil_case`) */ caseMass_kg?: number;
  /** strand critical current density under operating conditions [A/m^2] (cost model 1; `j_crit_str_tf`) */ jCritStrand_Am2?: number;
  /** intercoil structure mass [kg] (`aintmass`) */ intercoilMass_kg?: number;
  /** gravity support mass of the coils [kg] (`clgsmass`) */ gravitySupportMass_kg?: number;
  /** resistive coils: centre post mass [kg] (`whtcp`) and outboard legs [kg] (`whttflgs`) */ centrepostMass_kg?: number; outboardLegsMass_kg?: number;
  /** a spherical tokamak (the centre post is a replaceable component if `ifueltyp` > 0) */ spherical?: boolean;
}

export interface Acc2221 { c2221: number; c22211: number; c22212: number; c22213: number; c22214: number; c22215: number; cpstcst: number }

/**
 * Account 22.2.1 TF coils. Copper coils are costed from the TFCX data base ($/kg); superconducting coils by the method devised by
 * R. Hancox for Culham (1994): the conductor (superconductor + copper + sheath + a fixed cost per metre), the winding per metre, the
 * case per kg, the intercoil structure and the gravity support.
 */
export function acc2221(tf: TFCostInput, ctx: CostCtx): Acc2221 {
  const u = ctx.units, fk = ctx.fin.fkind, f = lsaFactor(LSA_FACTORS.magnets, ctx.fin.lsa);
  if (!tf.superconducting) {
    let c22211 = fk * M * (tf.centrepostMass_kg ?? 0) * u.uccpcl1 * f;
    let cpstcst = 0;
    if (tf.spherical && ctx.fin.ifueltyp === 1) { cpstcst = c22211; c22211 = 0; } else if (tf.spherical && ctx.fin.ifueltyp === 2) cpstcst = c22211;
    const c22212 = fk * M * (tf.outboardLegsMass_kg ?? 0) * u.uccpclb * f;
    return { c2221: c22211 + c22212, c22211, c22212, c22213: 0, c22214: 0, c22215: 0, cpstcst };
  }
  const im = (tf.scMaterial ?? 5) - 1;
  const L = tf.coilLength_m ?? 0, N = tf.turns ?? 0, n = tf.nCoils;
  const turnLength = L * N;
  const costSc = (tf.scCostModel ?? 0) === 0
    ? (u.ucsc[im] * (tf.scMass_kg ?? 0)) / turnLength
    : (u.scMatCost0[im] * J_CRIT_STRAND_0[im]) / (tf.jCritStrand_Am2 ?? Infinity); // $/m
  const costCu = (u.uccu * (tf.cuMass_kg ?? 0)) / turnLength; // $/m
  const conductorPerMetre = costSc + costCu + u.cconshtf + u.cconfix;
  const c22211 = fk * M * conductorPerMetre * n * turnLength * f;
  const c22212 = fk * M * u.ucwindtf * n * turnLength * f;
  const c22213 = fk * M * (tf.caseMass_kg ?? 0) * u.uccase * n * f;
  const c22214 = fk * M * (tf.intercoilMass_kg ?? 0) * u.ucint * f;
  const c22215 = fk * M * (tf.gravitySupportMass_kg ?? 0) * u.ucgss * f;
  return { c2221: c22211 + c22212 + c22213 + c22214 + c22215, c22211, c22212, c22213, c22214, c22215, cpstcst: 0 };
}

/** PF and CS coil quantities of the cost accounts (PROCESS `pf_coil` module; coil `n_cs_pf_coils - 1` is the central solenoid if `hasCentralSolenoid`) */
export interface PFCostInput {
  /** superconducting (else resistive) coils (`i_pf_conductor`) */ superconducting: boolean;
  /** the last coil is the central solenoid (`iohcl` = 1) */ hasCentralSolenoid: boolean;
  /** number of coils including the solenoid (`n_cs_pf_coils`) */ nCoils: number;
  /** mean radius of each coil [m] (`r_pf_coil_middle`) */ radius_m: readonly number[];
  /** turns of each coil (`n_pf_coil_turns`) */ turns: readonly number[];
  /** peak current of each coil [MA] (`c_pf_cs_coils_peak_ma`) */ peakCurrent_MA: readonly number[];
  /** peak winding-pack current density of each coil [A/m^2] (`j_pf_coil_wp_peak`) */ jWindingPack_Am2: readonly number[];
  /** void fraction of each PF coil (`f_a_pf_coil_void`) */ voidFraction: readonly number[];
  /** superconductor material index of the PF coils (`i_pf_superconductor`) and of the solenoid (`i_cs_superconductor`) */ pfMaterial: number; csMaterial: number;
  /** copper fraction of the PF superconductor (`fcupfsu`) and of the solenoid (`fcuohsu`) */ pfCopperFraction: number; csCopperFraction: number;
  /** solenoid cable space [m^2] (`a_cs_cable_space`) and void fraction (`f_a_cs_void`) */ csCableSpace_m2: number; csVoidFraction: number;
  /** cost model 1: strand critical current densities [A/m^2] of the PF coils and of the solenoid (`j_crit_str_pf`, `j_crit_str_cs`) */ jCritStrandPF_Am2?: number; jCritStrandCS_Am2?: number;
  /** total mass of the PF coil structure [kg] (`m_pf_coil_structure_total`) and of the outer PF coil fence support (`fncmass`) */ structureMass_kg: number; fenceSupportMass_kg: number;
  /** superconductor cost model (`supercond_cost_model`) */ scCostModel?: 0 | 1;
}

/** Account 22.2.2 PF coils: conductor (per metre, with sheath and fixed cost), winding, steel case and support structure */
export function acc2222(pf: PFCostInput, ctx: CostCtx): { c2222: number; c22221: number; c22222: number; c22223: number; c22224: number } {
  const u = ctx.units, fk = ctx.fin.fkind, f = lsaFactor(LSA_FACTORS.magnets, ctx.fin.lsa);
  const model = pf.scCostModel ?? 0;
  let windingLength = 0; // total length of the PF coil windings [m]; the solenoid is included
  for (let i = 0; i < pf.nCoils; i++) windingLength += 2 * Math.PI * pf.radius_m[i] * pf.turns[i];
  const sheath = pf.superconducting ? u.cconshpf : 0; // steel conduit around each superconducting cable
  const nPF = pf.hasCentralSolenoid ? pf.nCoils - 1 : pf.nCoils;
  let c22221 = 0;
  const pfMat = pf.pfMaterial - 1, csMat = pf.csMaterial - 1;
  for (let i = 0; i < nPF; i++) {
    const turnCurrent = Math.abs(pf.peakCurrent_MA[i] / pf.turns[i]) * 1e6; // A per turn
    const wp = 1 - pf.voidFraction[i];
    let costSc = 0;
    if (pf.superconducting) {
      costSc = model === 0
        ? (u.ucsc[pfMat] * (1 - pf.pfCopperFraction) * wp * turnCurrent) / pf.jWindingPack_Am2[i] * SC_DENSITY_KG_M3[pfMat]
        : (u.scMatCost0[pfMat] * J_CRIT_STRAND_0[pfMat]) / (pf.jCritStrandPF_Am2 ?? Infinity);
    }
    const costCu = pf.superconducting
      ? (u.uccu * pf.pfCopperFraction * wp * turnCurrent) / pf.jWindingPack_Am2[i] * DEN_COPPER
      : (u.uccu * wp * turnCurrent) / pf.jWindingPack_Am2[i] * DEN_COPPER;
    const perMetre = costSc + costCu + sheath + u.cconfix;
    c22221 += M * 2 * Math.PI * pf.radius_m[i] * pf.turns[i] * perMetre;
  }
  if (pf.hasCentralSolenoid) {
    const ics = pf.nCoils - 1;
    let costSc = 0;
    if (pf.superconducting) {
      costSc = model === 0
        ? (u.ucsc[csMat] * pf.csCableSpace_m2 * (1 - pf.csVoidFraction) * (1 - pf.csCopperFraction)) / pf.turns[ics] * SC_DENSITY_KG_M3[csMat]
        : (u.scMatCost0[csMat] * J_CRIT_STRAND_0[csMat]) / (pf.jCritStrandCS_Am2 ?? Infinity);
    }
    const costCu = pf.superconducting
      ? (u.uccu * pf.csCableSpace_m2 * (1 - pf.csVoidFraction) * pf.csCopperFraction) / pf.turns[ics] * DEN_COPPER
      : (u.uccu * pf.csCableSpace_m2 * (1 - pf.csVoidFraction)) / pf.turns[ics] * DEN_COPPER; // PROCESS notes it does not know whether this resistive branch is right
    const perMetre = costSc + costCu + sheath + u.cconfix;
    c22221 += M * 2 * Math.PI * pf.radius_m[ics] * pf.turns[ics] * perMetre;
  }
  c22221 *= fk * f;
  const c22222 = fk * f * M * u.ucwindpf * windingLength;
  const c22223 = fk * f * M * u.uccase * pf.structureMass_kg; // zero for resistive coils
  const c22224 = fk * f * M * u.ucfnc * pf.fenceSupportMass_kg;
  return { c2222: c22221 + c22222 + c22223 + c22224, c22221, c22222, c22223, c22224 };
}

/** Account 22.2.3 vacuum vessel (PROCESS costs it as a cryostat-like steel structure: mass x `uccryo`) */
export function acc2223(m_vv_kg: number, ctx: CostCtx): number {
  return ctx.fin.fkind * M * m_vv_kg * ctx.units.uccryo * lsaFactor(LSA_FACTORS.magnets, ctx.fin.lsa);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Account 22.3 power injection, 22.4 vacuum, 22.5 power conditioning
// ---------------------------------------------------------------------------------------------------------------------------

/** injected heating and current-drive power [MW] (PROCESS `current_drive`) */
export interface HCDPower {
  /** electron cyclotron */ ecrh_MW: number;
  /** lower hybrid, or ion cyclotron if `ich` */ lhOrIch_MW: number;
  /** the second system is ion cyclotron (`i_hcd_primary` = 2), not lower hybrid */ ich?: boolean;
  /** neutral beam */ nbi_MW: number;
}

/**
 * Account 22.3 power injection: TETRA costs updated to 1990 $, scaled linearly with the injected power (they include the power
 * supplies). With `ifueltyp` = 1 the fraction `fcdfuel` of the cost is a recurring cost (charged by `coelc`), the rest is capital.
 */
export function acc223(h: HCDPower, ctx: CostCtx): { c223: number; c2231: number; c2232: number; c2233: number; cdcost: number } {
  const u = ctx.units, capitalShare = ctx.fin.ifueltyp === 1 ? 1 - ctx.fin.fcdfuel : 1;
  const c2231 = ctx.fin.fkind * capitalShare * M * u.ucech * 1e6 * h.ecrh_MW;
  const c2232 = ctx.fin.fkind * capitalShare * M * (h.ich ? u.ucich : u.uclh) * 1e6 * h.lhOrIch_MW;
  const c2233 = ctx.fin.fkind * capitalShare * M * u.ucnbi * 1e6 * h.nbi_MW;
  const c223 = c2231 + c2232 + c2233;
  return { c223, c2231, c2232, c2233, cdcost: c223 };
}

/** vacuum pumping system (PROCESS `vacuum`) */
export interface VacuumSystem {
  pumpType: 'cryopump' | 'turbomolecular';
  /** number of high-vacuum pumps (`n_vac_pumps_high`) */ nPumps: number;
  /** number of ducts (`n_vv_vacuum_ducts`), the length of a duct [m] (`dlscal`), its diameter [m] (`dia_vv_vacuum_ducts`) and shield mass [kg] (`m_vv_vacuum_duct_shield`) */
  nDucts: number; ductLength_m: number; ductDiameter_m: number; ductShieldMass_kg: number;
}

/** Account 22.4 vacuum system, scaled from TETRA runs: pumps, backing pumps, ducts, valves, duct shielding and instrumentation */
export function acc224(v: VacuumSystem, ctx: CostCtx): { c224: number; c2241: number; c2242: number; c2243: number; c2244: number; c2245: number; c2246: number } {
  const u = ctx.units, fk = ctx.fin.fkind;
  const c2241 = fk * M * v.nPumps * (v.pumpType === 'cryopump' ? u.uccpmp : u.uctpmp);
  const c2242 = fk * M * v.nDucts * u.ucbpmp; // backing pumps: one per duct
  const c2243 = fk * M * v.nDucts * v.ductLength_m * u.ucduct;
  const c2244 = fk * M * 2 * v.nDucts * Math.pow(v.ductDiameter_m * 1.2, 1.4) * u.ucvalv; // two valves per duct
  const c2245 = fk * M * v.nDucts * v.ductShieldMass_kg * u.ucvdsh;
  const c2246 = fk * M * u.ucviac;
  return { c224: c2241 + c2242 + c2243 + c2244 + c2245 + c2246, c2241, c2242, c2243, c2244, c2245, c2246 };
}

/** TF power conditioning quantities (PROCESS `tfcoil` and `tfcpwr`) */
export interface TFPowerInput {
  superconducting: boolean; nCoils: number;
  /** resistive power of the coils, from power supplies: kW (`tfckw`) and MW (`tfcmw`) */ tfckw: number; tfcmw: number;
  /** current per turn [A] (`c_tf_turn`), quench dump voltage [kV] (`v_tf_coil_dump_quench_kv`), stored energy of all coils [GJ] (`e_tf_magnetic_stored_total_gj`) */
  turnCurrent_A: number; dumpVoltage_kV: number; storedEnergy_GJ: number;
  /** aluminium bus length [m] (`len_tf_bus`, superconducting) and copper bus mass [kg] (`m_tf_bus`, resistive) */ busLength_m: number; busMass_kg: number;
}

/** Account 22.5.1 TF coil power conditioning: supplies, breakers, dump resistors, instrumentation and busing */
export function acc2251(t: TFPowerInput, ctx: CostCtx): { c2251: number; c22511: number; c22512: number; c22513: number; c22514: number; c22515: number } {
  const u = ctx.units, fk = ctx.fin.fkind, e = 0.7;
  const c22511 = fk * M * u.uctfps * Math.pow(t.tfckw * 1e3 + t.tfcmw * 1e6, e);
  const c22512 = fk * (t.superconducting ? M * (u.uctfbr * t.nCoils * Math.pow(t.turnCurrent_A * t.dumpVoltage_kV * 1e3, e) + u.uctfsw * t.turnCurrent_A) : 0);
  const c22513 = fk * M * (1e9 * u.uctfdr * t.storedEnergy_GJ + u.uctfgr * 0.5 * t.nCoils);
  const c22514 = fk * M * u.uctfic * (30 * t.nCoils);
  const c22515 = fk * (t.superconducting ? M * u.ucbus * t.turnCurrent_A * t.busLength_m : M * u.uctfbus * t.busMass_kg);
  return { c2251: c22511 + c22512 + c22513 + c22514 + c22515, c22511, c22512, c22513, c22514, c22515 };
}

/** PF power conditioning quantities (PROCESS `pf_power` and `heat_transport`) */
export interface PFPowerInput {
  /** peak MVA of the PF supplies (`peakmva`) */ peakMVA: number;
  /** number of PF circuits (`pfckts`) */ circuits: number;
  /** PF bus length [m] (`spfbusl`) and maximum current [kA] (`acptmax`) */ busLength_m: number; maxCurrent_kA: number;
  /** burn power supply [kW] (`srcktpm`) */ burnSupply_kW: number;
  /** PF breaker voltage [kV] (`vpfskv`) */ voltage_kV: number;
  /** stored energy of the PF system for the dump resistors [MJ] (`ensxpfm`) */ dumpEnergy_MJ: number;
}

/** Account 22.5.2 PF coil power conditioning from the equipment specification of the PF power model */
export function acc2252(p: PFPowerInput, ctx: CostCtx): { c2252: number; c22521: number; c22522: number; c22523: number; c22524: number; c22525: number; c22526: number; c22527: number } {
  const u = ctx.units, fk = ctx.fin.fkind;
  const c22521 = fk * M * u.ucpfps * p.peakMVA;
  const c22522 = fk * M * u.ucpfic * p.circuits * 30;
  const c22523 = fk * M * u.ucpfb * p.busLength_m * p.maxCurrent_kA;
  const c22524 = fk * (p.circuits !== 0 ? M * u.ucpfbs * p.circuits * Math.pow(p.burnSupply_kW / p.circuits, 0.7) : 0);
  const c22525 = fk * M * u.ucpfbk * p.circuits * Math.pow(p.maxCurrent_kA * p.voltage_kV, 0.7);
  const c22526 = fk * M * u.ucpfdr1 * p.dumpEnergy_MJ;
  const c22527 = fk * M * u.ucpfcb * p.circuits;
  return { c2252: c22521 + c22522 + c22523 + c22524 + c22525 + c22526 + c22527, c22521, c22522, c22523, c22524, c22525, c22526, c22527 };
}

/** thermal energy storage of a pulsed plant (PROCESS `pulse`): option 1 or 2 of the ELECTROWATT study (AEA FUS 205) or 3, a steel block */
export interface EnergyStorage {
  pulsed: boolean; istore: 1 | 2 | 3;
  /** allowed temperature change of the steel block [K] (`dtstor`) and dwell time between pulses [s] (`t_plant_pulse_no_burn`), option 3 */ dtstor_K?: number; dwell_s?: number;
}

/** Account 22.5.3 energy storage (pulsed plants only; options 1 and 2 are scaled with the net electric power and converted from 1992 pounds) */
export function acc2253(s: EnergyStorage, plant: { P_primaryHeat_MW: number; P_net_MW: number }, ctx: CostCtx): number {
  let c = 0;
  if (s.pulsed) {
    if (s.istore === 1) c = 0.1 + 0.8 + 4.0 + 0.5 + 2.8 + 29.0; // condensate tank, feedpump, turbine duty, auxiliary transformer, drum, fired superheater [M pounds]
    else if (s.istore === 2) c = 0.1 + 0.8 + 2.8 + 4.0 + 330.0 + 1.0 + 2.0 + 18.0; // ... fired boiler, steam bypass, dump condenser, cooling water
    else if (s.istore === 3) {
      const shcss = 520; // specific heat of stainless steel [J/(kg K)]
      // steel mass = heat to store / (c_p dT); PROCESS adds this cost in dollars to accounts in M$ (a missing 1e-6, difference 5 above)
      c = (M * ctx.units.ucblss * (plant.P_primaryHeat_MW * 1e6) * (s.dwell_s ?? 0)) / (shcss * (s.dtstor_K ?? Infinity));
    }
  }
  if (s.istore < 3) c = c * plant.P_net_MW / 1200 * 1.36; // 1992 pounds to 1990 dollars: 5 % inflation per year and 1.5 dollars per pound
  return ctx.fin.fkind * c;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Account 22.6 heat transport, 22.7 fuel handling, 22.8 I&C, 22.9 maintenance
// ---------------------------------------------------------------------------------------------------------------------------

/** heat transport and plant power flows [MW] (PROCESS `heat_transport`, `fwbs`) */
export interface HeatTransportInput {
  coolant: 'helium' | 'water';
  /** heat deposited in the first wall and divertor and nuclear heat of the blanket and of the shield [MW] */ P_fwDiv_MW: number; P_blanketNuclear_MW: number; P_shieldNuclear_MW: number;
  /** primary heat [MW] and number of primary heat exchangers (`n_primary_heat_exchangers`) */ P_primaryHeat_MW: number; nHeatExchangers: number;
  /** electric power of the HCD losses, cryoplant, vacuum pumps, tritium plant and facilities [MW] (aux cooling) */ P_hcdLoss_MW: number; P_cryo_MW: number; P_vacuum_MW: number; P_tritium_MW: number; P_facility_MW: number;
  /** helium refrigeration load at the TF temperature [W] (`helpow`) and that temperature [K] (`temp_tf_cryo`) */ helium_W: number; T_tfCryo_K: number;
  /** gross electric power [MW] and its use: primary AC power [MW] (`pacpmw`), base total [MW] (`p_plant_electric_base_total_mw`), low-voltage [MW] (`tlvpmw`) */ P_gross_MW: number; P_acPrimary_MW: number; P_base_MW: number; P_lowVoltage_MW: number;
  /** electric power of the HCD system [MW] and fusion power [MW] for the heat rejection of a non-reactor */ P_hcdElectric_MW: number; P_fusion_MW: number; tfcmw?: number;
}

/** Accounts 22.6.1 to 22.6.3: reactor cooling (pumps and piping, primary heat exchangers), auxiliary cooling and cryoplant */
export function acc226(h: HeatTransportInput, ctx: CostCtx): { c226: number; c2261: number; c2262: number; c2263: number; cpp: number; chx: number } {
  const u = ctx.units, fk = ctx.fin.fkind, f = lsaFactor(LSA_FACTORS.heat, ctx.fin.lsa), ex = 0.7;
  const p = (x: number) => Math.pow(1e6 * x, ex);
  const cpp = fk * f * M * u.uchts[h.coolant === 'helium' ? 0 : 1] * (p(h.P_fwDiv_MW) + p(h.P_blanketNuclear_MW) + p(h.P_shieldNuclear_MW));
  const chx = fk * f * M * u.ucphx * h.nHeatExchangers * Math.pow((1e6 * h.P_primaryHeat_MW) / h.nHeatExchangers, ex);
  const c2261 = chx + cpp;
  const c2262 = fk * f * M * u.ucahts * (p(h.P_hcdLoss_MW) + p(h.P_cryo_MW) + p(h.P_vacuum_MW) + p(h.P_tritium_MW) + p(h.P_facility_MW));
  const c2263 = fk * f * M * u.uccry * (4.5 / h.T_tfCryo_K) * Math.pow(h.helium_W, 0.67);
  return { c226: c2261 + c2262 + c2263, c2261, c2262, c2263, cpp, chx };
}

/** fuel quantities (PROCESS `physics`) */
export interface FuelInput {
  /** fuel ions burned per second (`rndfuel`) and mean fuel mass [amu] (`m_fuel_amu`) */ burnRate_per_s: number; fuelMass_amu: number;
  /** tritium and helium-3 fraction of the fuel */ tritiumFraction: number; helium3Fraction?: number;
}

/** Accounts 22.7.1 to 22.7.4 fuel handling, scaled from TETRA runs; also returns the fuel throughput `wtgpd` [g/day] */
export function acc227(f: FuelInput, volrci: number, wsvol: number, ctx: CostCtx): { c227: number; c2271: number; c2272: number; c2273: number; c2274: number; wtgpd: number } {
  const u = ctx.units, fk = ctx.fin.fkind;
  const c2271 = fk * M * u.ucf1;
  // 2 nuclei per reaction x reactions per second x kg per nucleus x g per kg x s per day (He-3 is assumed to cost as much to process as tritium)
  const wtgpd = 2 * f.burnRate_per_s * f.fuelMass_amu * UMASS * 1000 * 86400;
  const c2272 = fk * M * u.ucfpr * (0.5 + 0.5 * Math.pow(wtgpd / 60, 0.67));
  const cfrht = 1e5; // detritiation flow per hour [m^3]
  const c2273 = fk * (f.tritiumFraction > 1e-3 ? M * u.ucdtc * (Math.pow(cfrht / 1e4, 0.6) * (volrci + wsvol)) : 0); // none for pure D-He3
  const c2274 = fk * M * u.ucnbv * Math.pow(volrci + wsvol, 0.8);
  return { c227: c2271 + c2272 + c2273 + c2274, c2271, c2272, c2273, c2274, wtgpd };
}

/** Account 22.8 instrumentation and control (TFCX and INTOR, a fixed allowance) */
export function acc228(ctx: CostCtx): number { return ctx.fin.fkind * M * ctx.units.uciac; }
/** Account 22.9 maintenance equipment (a fixed allowance) */
export function acc229(ctx: CostCtx): number { return ctx.fin.fkind * M * ctx.units.ucme; }

// ---------------------------------------------------------------------------------------------------------------------------
// Accounts 23 to 26 and 9
// ---------------------------------------------------------------------------------------------------------------------------

/** Account 23 turbine plant equipment: reference cost of a 1200 MW plant scaled with the gross electric power^0.83 (zero for an experiment) */
export function acc23(P_gross_MW: number, coolant: 'helium' | 'water', ctx: CostCtx): number {
  return ctx.isReactor ? M * ctx.units.ucturb[coolant === 'helium' ? 0 : 1] * Math.pow(P_gross_MW / 1200, 0.83) : 0;
}

/** Account 24 electric plant equipment: switchyard, transformers (primary, auxiliary), low voltage, four 8 MW diesel generators, auxiliary facility power */
export function acc24(h: { P_acPrimary_MW: number; P_base_MW: number; P_lowVoltage_MW: number }, ctx: CostCtx): { c24: number; c241: number; c242: number; c243: number; c244: number; c245: number } {
  const u = ctx.units, f = lsaFactor(LSA_FACTORS.electric, ctx.fin.lsa);
  const c241 = M * u.ucswyd * f;
  const c242 = M * (u.ucpp * Math.pow(h.P_acPrimary_MW * 1e3, 0.9) + u.ucap * (h.P_base_MW * 1e3)) * f;
  const c243 = M * u.uclv * h.P_lowVoltage_MW * 1e3 / 0.8 * f; // 0.8: transformer efficiency
  const c244 = M * u.ucdgen * 4 * f;
  const c245 = M * u.ucaf * f;
  return { c24: c241 + c242 + c243 + c244 + c245, c241, c242, c243, c244, c245 };
}

/** Account 25 miscellaneous plant equipment (waste treatment etc., an allowance) */
export function acc25(ctx: CostCtx): number { return M * ctx.units.ucmisc * lsaFactor(LSA_FACTORS.misc, ctx.fin.lsa); }

/**
 * Account 26 heat rejection: scaled with the plant heat rejection from commercial systems (J. Delene, ORNL, 1990); a reactor rejects
 * the primary heat that does not become electricity, an experiment its fusion, heating and TF resistive power.
 */
export function acc26(h: { P_primaryHeat_MW: number; P_gross_MW: number; P_fusion_MW: number; P_hcdElectric_MW: number; tfcmw?: number }, ctx: CostCtx): number {
  const rejected = ctx.isReactor ? h.P_primaryHeat_MW - h.P_gross_MW : h.P_fusion_MW + h.P_hcdElectric_MW + (h.tfcmw ?? 0);
  return M * ctx.units.uchrs * rejected / 2300 * lsaFactor(LSA_FACTORS.rejection, ctx.fin.lsa);
}

/** Account 9: indirect cost (single contractor doing engineering and construction management) and the project contingency */
export function acc9(cdirt: number, ctx: CostCtx): { cindrt: number; ccont: number } {
  const cindrt = ctx.fin.cfind[ctx.fin.lsa - 1] * cdirt * (1 + ctx.fin.cowner);
  return { cindrt, ccont: ctx.fin.fcontng * (cdirt + cindrt) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Cost of electricity
// ---------------------------------------------------------------------------------------------------------------------------

/** capital recovery factor of an interest rate r over n years (PROCESS's (1+r)^n r / ((1+r)^n - 1), extended to r = 0) */
export function capitalRecoveryFactor(r: number, n: number): number {
  if (!(n > 0)) return Infinity;
  if (r === 0) return 1 / n;
  const g = Math.pow(1 + r, n);
  return (g * r) / (g - 1);
}

/** component lifetimes converted from full-power years to calendar years (`convert_fpy_to_calendar`) */
export function calendarLifetimes(a: { blanketFpy: number; divertorFpy: number; centrepostFpy?: number }, fin: CostFinance): { blanket: number; divertor: number; centrepost: number; currentDrive: number } {
  const conv = (fpy: number) => (fpy < fin.lifePlant ? fpy * fin.availability : fpy);
  const blanket = conv(a.blanketFpy);
  return { blanket, divertor: conv(a.divertorFpy), centrepost: a.centrepostFpy !== undefined ? conv(a.centrepostFpy) : 0, currentDrive: blanket }; // the current drive is assumed to last as long as the blanket
}

export interface CoelcInput {
  /** constructed cost (direct + indirect + contingency) [M$] */ concost: number;
  /** replaceable components and current drive [M$] (from the accounts) */ fwallcst: number; blkcst: number; divcst: number; cpstcst: number; cdcost: number;
  /** net electric power [MW] and burn fraction of the pulse cycle (1 for steady state) */ P_net_MW: number; burnFraction?: number;
  /** calendar lifetimes [y] of the blanket and first wall, divertor, current drive and centre post (spherical), and their lifetimes in full-power years for `ifueltyp` 2 */
  lifeBlanket: number; lifeDivertor: number; lifeCurrentDrive: number; lifeCentrepost?: number; lifeBlanketFpy?: number; lifeDivertorFpy?: number; lifeCentrepostFpy?: number;
  /** a spherical tokamak (centre post replacement) */ spherical?: boolean;
  /** fuel throughput [g/day] (`wtgpd`) and helium-3 fuel fraction */ wtgpd: number; helium3Fraction?: number;
}

export interface CoelcResult {
  /** cost of electricity [mills/kWh = m$/kWh] */ coe: number;
  coecap: number; coefuelt: number; coeoam: number; coedecom: number;
  /** its 'fuel-like' parts: blanket and first wall, divertor, current drive, centre post, fuel, waste */ coefwbl: number; coediv: number; coecdr: number; coecp: number; coefuel: number; coewst: number;
  /** interest during construction [M$] and total capital investment [M$] */ moneyint: number; capcost: number;
  /** electricity sold per year [kWh] */ kwhpy: number;
}

/**
 * Cost of electricity of a fusion power plant (PROCESS `coelc`): capital (with interest during construction), replacement of the
 * first wall, blanket, divertor, centre post and part of the current drive, operation and maintenance, fuel, waste disposal and
 * the decommissioning fund. Annual costs are in M$/y, electricity costs in millidollars per kWh (mills/kWh), all in 1990 dollars.
 */
export function costOfElectricity(inp: CoelcInput, ctx: CostCtx): CoelcResult {
  const fin = ctx.fin, lsa = fin.lsa;
  const burn = inp.burnFraction ?? 1;
  const kwhpy = Math.max(1e3 * inp.P_net_MW * (24 * N_DAY_YEAR) * fin.availability * burn, 1e-10); // PROCESS floor: kwhpy = 0 is avoided
  const moneyint = inp.concost * (fin.fcap0 - 1);
  const capcost = inp.concost + moneyint;
  const anncap = capcost * fin.fcr0;
  const coecap = (1e9 * anncap) / kwhpy;
  const indirect = 1 + fin.cfind[lsa - 1];
  const crf = (life: number) => capitalRecoveryFactor(fin.discountRate, life);
  // first wall and blanket
  let annfwbl = (inp.fwallcst + inp.blkcst) * indirect * fin.fcap0cp * crf(inp.lifeBlanket);
  if (fin.ifueltyp === 2) annfwbl *= 1 - (inp.lifeBlanketFpy ?? inp.lifeBlanket) / fin.lifePlant;
  const coefwbl = (1e9 * annfwbl) / kwhpy;
  // divertor
  let anndiv = inp.divcst * indirect * fin.fcap0cp * crf(inp.lifeDivertor);
  if (fin.ifueltyp === 2) anndiv *= 1 - (inp.lifeDivertorFpy ?? inp.lifeDivertor) / fin.lifePlant;
  const coediv = (1e9 * anndiv) / kwhpy;
  // centre post of a spherical tokamak
  let anncp = 0, coecp = 0;
  if (inp.spherical) {
    anncp = inp.cpstcst * indirect * fin.fcap0cp * crf(inp.lifeCentrepost ?? Infinity);
    if (fin.ifueltyp === 2) anncp *= 1 - (inp.lifeCentrepostFpy ?? inp.lifeCentrepost ?? 0) / fin.lifePlant;
    coecp = (1e9 * anncp) / kwhpy;
  }
  // partial current-drive renewal
  const anncdr = fin.ifueltyp === 0 ? 0 : ((inp.cdcost * fin.fcdfuel) / (1 - fin.fcdfuel)) * indirect * fin.fcap0cp * crf(inp.lifeCurrentDrive);
  const coecdr = (1e9 * anncdr) / kwhpy;
  // operation and maintenance, fuel, waste disposal
  const sqrtP = Math.sqrt(Math.max(inp.P_net_MW, 0) / 1200);
  const coeoam = (1e9 * fin.ucoam[lsa - 1] * sqrtP) / kwhpy;
  const annfuel = fin.ucfuel * inp.P_net_MW / 1200 + M * (inp.helium3Fraction ?? 0) * inp.wtgpd * 1e-3 * fin.uche3 * N_DAY_YEAR * fin.availability;
  const coefuel = (1e9 * annfuel) / kwhpy;
  const coewst = (1e9 * fin.ucwst[lsa - 1] * sqrtP) / kwhpy;
  // decommissioning fund: a fraction of the construction cost is set aside at the start of the plant life
  const anndecom = (fin.decomf * inp.concost * fin.fcr0) / Math.pow(1 + fin.discountRate - fin.dintrt, fin.lifePlant - fin.dtlife);
  const coedecom = (1e9 * anndecom) / kwhpy;
  const coefuelt = coefwbl + coediv + coecdr + coecp + coefuel + coewst;
  return { coe: coecap + coefuelt + coeoam + coedecom, coecap, coefuelt, coeoam, coedecom, coefwbl, coediv, coecdr, coecp, coefuel, coewst, moneyint, capcost, kwhpy };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The whole estimate
// ---------------------------------------------------------------------------------------------------------------------------

/** the physical description of the plant: every group is optional, an absent group leaves its accounts out (see `omitted`) */
export interface CostPlant {
  buildings?: BuildingVolumes;
  /** first wall area [m^2] (`a_fw_total`) */ firstWallArea_m2?: number;
  blanket?: BlanketMasses;
  /** shield mass [kg] (`whtshld`) and penetration shield mass [kg] (`wpenshld`) */ shield?: { mass_kg: number; penetrationMass_kg: number };
  /** reactor (gravity support) structure mass [kg] (`gsmass`) */ structureMass_kg?: number;
  /** divertor surface area [m^2] (`a_div_surface_total`) */ divertorArea_m2?: number;
  tf?: TFCostInput;
  pf?: PFCostInput;
  /** vacuum vessel mass [kg] (`m_vv`) */ vacuumVesselMass_kg?: number;
  hcd?: HCDPower;
  vacuum?: VacuumSystem;
  tfPower?: TFPowerInput;
  pfPower?: PFPowerInput;
  storage?: EnergyStorage;
  heat?: HeatTransportInput;
  fuel?: FuelInput;
  /** net electric power [MW] (for the cost of electricity and the pulsed storage) and the burn fraction of the pulse cycle (default 1) */ P_net_MW?: number; burnFraction?: number;
  /** full-power-year lifetimes [y] of the first wall and blanket, divertor and (spherical) centre post, for the cost of electricity */ lifeBlanketFpy?: number; lifeDivertorFpy?: number; lifeCentrepostFpy?: number;
  /** include the fixed allowances of the accounts 22.8, 22.9, 24.1, 24.4, 24.5 and 25 (default true) */ allowances?: boolean;
}

export interface CostResult {
  /** every account and sub-account, M$ (labels '21', '2211', '22121', ... as in PROCESS without the leading c) */
  accounts: Record<string, number>;
  c21: number; c22: number; c23: number; c24: number; c25: number; c26: number;
  /** total direct cost, indirect cost (account 9), project contingency and constructed cost [M$] */ cdirt: number; cindrt: number; ccont: number; concost: number;
  /** replaceable and recurring items [M$] as `coelc` uses them */ fwallcst: number; blkcst: number; divcst: number; cpstcst: number; cdcost: number;
  /** cost of electricity, if the plant is a reactor and its net power and heat transport are given */ coe?: CoelcResult;
  /** the accounts left out for lack of input; the estimate is a total only if empty */ omitted: string[];
  complete: boolean;
}

/** Run the cost accounts on a plant description. */
export function costAccounts(plant: CostPlant, ctx: CostCtx = costContext()): CostResult {
  const a: Record<string, number> = {};
  const omitted: string[] = [];
  const put = (o: Record<string, number>) => { for (const k of Object.keys(o)) a[k.replace(/^c/, '')] = o[k]; };
  const skip = (label: string, have: unknown) => { if (have === undefined) { omitted.push(label); return false; } return true; };

  let fwallcst = 0, blkcst = 0, divcst = 0, cpstcst = 0, cdcost = 0, wtgpd = 0;

  // 21
  let c21 = 0;
  if (skip('21 structures and site facilities (buildings volumes)', plant.buildings)) { const r = acc21(plant.buildings!, ctx); put({ ...r }); c21 = r.c21; }
  // 22.1
  let c221 = 0;
  if (skip('22.1.1 first wall (area)', plant.firstWallArea_m2)) { const r = acc2211(plant.firstWallArea_m2!, ctx); a['2211'] = r.c2211; fwallcst = r.fwallcst; c221 += r.c2211; }
  if (skip('22.1.2 blanket (masses)', plant.blanket)) { const r = acc2212(plant.blanket!, ctx); const { blkcst: b, ...rest } = r; put(rest); blkcst = b; c221 += r.c2212; }
  if (skip('22.1.3 shield (masses)', plant.shield)) { const r = acc2213(plant.shield!.mass_kg, plant.shield!.penetrationMass_kg, ctx); put({ ...r }); c221 += r.c2213; }
  if (skip('22.1.4 reactor structure (mass)', plant.structureMass_kg)) { const r = acc2214(plant.structureMass_kg!, ctx); a['2214'] = r; c221 += r; }
  if (skip('22.1.5 divertor (area)', plant.divertorArea_m2)) { const r = acc2215(plant.divertorArea_m2!, ctx); a['2215'] = r.c2215; divcst = r.divcst; c221 += r.c2215; }
  a['221'] = c221;
  // 22.2
  let c222 = 0;
  if (skip('22.2.1 TF coils', plant.tf)) { const { cpstcst: cp, ...rest } = acc2221(plant.tf!, ctx); put(rest); cpstcst = cp; c222 += rest.c2221; }
  if (skip('22.2.2 PF coils', plant.pf)) { const r = acc2222(plant.pf!, ctx); put({ ...r }); c222 += r.c2222; }
  if (skip('22.2.3 vacuum vessel (mass)', plant.vacuumVesselMass_kg)) { const r = acc2223(plant.vacuumVesselMass_kg!, ctx); a['2223'] = r; c222 += r; }
  a['222'] = c222;
  // 22.3 to 22.5
  let c223 = 0;
  if (skip('22.3 power injection (HCD power)', plant.hcd)) { const { cdcost: d, ...rest } = acc223(plant.hcd!, ctx); put(rest); cdcost = d; c223 = rest.c223; }
  let c224 = 0;
  if (skip('22.4 vacuum system', plant.vacuum)) { const r = acc224(plant.vacuum!, ctx); put({ ...r }); c224 = r.c224; }
  let c225 = 0;
  if (skip('22.5.1 TF power conditioning', plant.tfPower)) { const r = acc2251(plant.tfPower!, ctx); put({ ...r }); c225 += r.c2251; }
  if (skip('22.5.2 PF power conditioning', plant.pfPower)) { const r = acc2252(plant.pfPower!, ctx); put({ ...r }); c225 += r.c2252; }
  if (plant.storage !== undefined && plant.heat !== undefined && plant.P_net_MW !== undefined) { const r = acc2253(plant.storage, { P_primaryHeat_MW: plant.heat.P_primaryHeat_MW, P_net_MW: plant.P_net_MW }, ctx); a['2253'] = r; c225 += r; }
  else if (plant.storage !== undefined) omitted.push('22.5.3 energy storage (needs the heat transport and the net power)');
  a['225'] = c225;
  // 22.6
  let c226 = 0;
  if (skip('22.6 heat transport', plant.heat)) { const r = acc226(plant.heat!, ctx); put({ c226: r.c226, c2261: r.c2261, c2262: r.c2262, c2263: r.c2263 }); c226 = r.c226; }
  // 22.7
  let c227 = 0;
  if (skip('22.7 fuel handling (fuel throughput)', plant.fuel)) {
    const vol = plant.buildings;
    const r = acc227(plant.fuel!, vol?.volrci ?? 0, vol?.wsvol ?? 0, ctx);
    if (vol === undefined || vol.volrci === undefined) omitted.push('22.7.3 and 22.7.4 need the containment volume of the buildings');
    const { wtgpd: w, ...rest } = r; put(rest); wtgpd = w; c227 = r.c227;
  }
  // 22.8, 22.9
  const allow = plant.allowances ?? true;
  const c228 = allow ? acc228(ctx) : 0, c229 = allow ? acc229(ctx) : 0;
  if (allow) { a['228'] = c228; a['229'] = c229; }
  const c22 = c221 + c222 + c223 + c224 + c225 + c226 + c227 + c228 + c229;
  a['22'] = c22; a['223'] = c223; a['224'] = c224; a['226'] = c226; a['227'] = c227;

  // 23, 24, 25, 26
  let c23 = 0, c24 = 0, c26 = 0;
  if (plant.heat !== undefined) {
    c23 = acc23(plant.heat.P_gross_MW, plant.heat.coolant, ctx);
    const e = acc24(plant.heat, ctx);
    if (allow) { put({ ...e }); c24 = e.c24; } else { a['242'] = e.c242; a['243'] = e.c243; c24 = e.c242 + e.c243; a['24'] = c24; }
    c26 = acc26(plant.heat, ctx);
  } else { omitted.push('23 turbine plant, 24 electric plant, 26 heat rejection (heat transport and gross power)'); if (allow) { const e = acc24({ P_acPrimary_MW: 0, P_base_MW: 0, P_lowVoltage_MW: 0 }, ctx); a['241'] = e.c241; a['244'] = e.c244; a['245'] = e.c245; c24 = e.c241 + e.c244 + e.c245; a['24'] = c24; } }
  const c25 = allow ? acc25(ctx) : 0;
  a['23'] = c23; a['25'] = c25; a['26'] = c26; a['21'] = c21;

  const cdirt = c21 + c22 + c23 + c24 + c25 + c26;
  const { cindrt, ccont } = acc9(cdirt, ctx);
  const concost = cdirt + cindrt + ccont;
  a['9'] = cindrt + ccont;

  let coe: CoelcResult | undefined;
  if (ctx.isReactor && plant.P_net_MW !== undefined && plant.fuel !== undefined) {
    const life = calendarLifetimes({ blanketFpy: plant.lifeBlanketFpy ?? Infinity, divertorFpy: plant.lifeDivertorFpy ?? Infinity, centrepostFpy: plant.lifeCentrepostFpy }, ctx.fin);
    coe = costOfElectricity({
      concost, fwallcst, blkcst, divcst, cpstcst, cdcost, P_net_MW: plant.P_net_MW, burnFraction: plant.burnFraction,
      lifeBlanket: life.blanket, lifeDivertor: life.divertor, lifeCurrentDrive: life.currentDrive, lifeCentrepost: life.centrepost,
      lifeBlanketFpy: plant.lifeBlanketFpy, lifeDivertorFpy: plant.lifeDivertorFpy, lifeCentrepostFpy: plant.lifeCentrepostFpy, spherical: plant.tf?.spherical, wtgpd, helium3Fraction: plant.fuel.helium3Fraction,
    }, ctx);
  }
  return { accounts: a, c21, c22, c23, c24, c25, c26, cdirt, cindrt, ccont, concost, fwallcst, blkcst, divcst, cpstcst, cdcost, coe, omitted, complete: omitted.length === 0 };
}
