/**
 * Unit costs, level-of-safety-assurance factors and financial parameters of the PROCESS "1990" cost model (lane ws7b).
 *
 * The values are the defaults of `process/data_structure/cost_variables.py` of the PROCESS systems code (UKAEA, MIT licence,
 * https://github.com/ukaea/PROCESS): the unit costs are in 1990 US$ and come from the TETRA and STAR/Generomak cost data
 * (J. Delene, ORNL, private communication, 1990; Galambos, ORNL STAR code; R. Hancox, Culham, 1994 for the coil conductor), see
 * M. Kovari, F. Fox, C. Harrington, R. Kembleton, P. Knight, H. Lux, J. Morris, "PROCESS: a systems code for fusion power
 * plants - Part 2: Engineering", Fusion Eng. Des. 104 (2016) 9-20 and the PROCESS documentation "Cost Models". Names are the
 * PROCESS names (lower case) so that the port can be audited line by line; the doc comments give the unit as used in the formulas.
 * These are first-of-a-kind, 1990 dollars, and an educational estimate: not a quotation.
 */

/** level of safety assurance (lsa): 1 = "few" nuclear safety requirements, 4 = full fission-plant standards */
export type SafetyLevel = 1 | 2 | 3 | 4;

/** cost multipliers by level of safety assurance, per account family (`cmlsa` of PROCESS costs.py) */
export const LSA_FACTORS = {
  /** account 21 buildings */
  buildings: [0.68, 0.84, 0.92, 1.0],
  /** accounts 22.1.1, 22.1.2, 22.1.3: first wall, blanket, shield */
  fwbs: [0.5, 0.75, 0.875, 1.0],
  /** account 22.1.4 reactor structure */
  structure: [0.67, 0.835, 0.9175, 1.0],
  /** accounts 22.2: magnets and vacuum vessel */
  magnets: [0.69, 0.845, 0.9225, 1.0],
  /** account 22.6 heat transport */
  heat: [0.4, 0.7, 0.85, 1.0],
  /** account 24 electric plant */
  electric: [0.57, 0.785, 0.8925, 1.0],
  /** account 25 miscellaneous plant equipment */
  misc: [0.77, 0.885, 0.9425, 1.0],
  /** account 26 heat rejection */
  rejection: [0.8, 0.9, 0.95, 1.0],
} as const;

/** the multiplier of a family at a safety level */
export function lsaFactor(family: readonly number[], lsa: SafetyLevel): number {
  return family[lsa - 1];
}

/** superconductor materials of PROCESS (`i_tf_sc_mat`, `i_pf_superconductor`, `i_cs_superconductor`): index 1 to 9 */
export const SC_MATERIALS = ['ITER Nb3Sn', 'Bi-2212', 'NbTi (Lubell)', 'user Nb3Sn', 'WST Nb3Sn', 'CroCo REBCO', 'Durham NbTi', 'Durham REBCO', 'Hazelton-Zhai REBCO'] as const;

/** density of the superconducting strand material by index [kg/m^3] (`dcond` of PROCESS tfcoil_variables.py) */
export const SC_DENSITY_KG_M3: readonly number[] = [6080, 6080, 6070, 6080, 6080, 8500, 6070, 8500, 8500];

/** strand critical current density of the material at 6 T and 4.2 K [A/m^2] (`j_crit_str_0` of PROCESS tfcoil_variables.py) */
export const J_CRIT_STRAND_0: readonly number[] = [
  596905475.8039012, 1925501534.8512938, 724544682.96063495, 549858624.45072436, 669284509.85818779, 0.0, 898964415.36996782, 1158752995.2559297, 865652122.9071957,
];

/** density of copper [kg/m^3] (PROCESS constants.DEN_COPPER) */
export const DEN_COPPER = 8900;

export interface CostUnits {
  // -- buildings, account 21 [$/m^3 of building volume unless noted; the formulas apply 1e-6 to give M$]
  /** reactor building */ ucrb: number;
  /** reactor maintenance building */ ucmb: number;
  /** active assembly shop (warm shop) */ ucws: number;
  /** tritium building */ uctr: number;
  /** electrical equipment building */ ucel: number;
  /** administration buildings */ ucad: number;
  /** control buildings */ ucco: number;
  /** shops and warehouses */ ucsh: number;
  /** cryogenic building */ uccr: number;
  /** site improvements, facilities [M$] (allowance, scaled with the safety level) */ csi: number;
  /** land [M$] (not scaled) */ cland: number;
  /** turbine building [M$] */ cturbb: number;
  // -- account 22.1 reactor: first wall, blanket, shield, structure, divertor
  /** first wall armour [$/m^2] */ ucfwa: number;
  /** first wall structure [$/m^2] */ ucfws: number;
  /** first wall passive stabiliser [$] */ ucfwps: number;
  /** blanket beryllium [$/kg] */ ucblbe: number;
  /** blanket Li2O [$/kg] */ ucblli2o: number;
  /** blanket stainless steel [$/kg] */ ucblss: number;
  /** blanket vanadium [$/kg] */ ucblvd: number;
  /** shield structural steel [$/kg] */ ucshld: number;
  /** penetration shield [$/kg] */ ucpens: number;
  /** reactor (gravity support) structure [$/kg] */ ucgss: number;
  /** divertor blade [$ per m^2 of divertor surface] */ ucdiv: number;
  // -- account 22.2 magnets and vacuum vessel
  /** superconductor by material index [$/kg] */ ucsc: readonly number[];
  /** superconductor by material index for cost model 1 [$/(kA m)] at 6.4 T, 4.2 K */ scMatCost0: readonly number[];
  /** copper in the superconducting cable [$/kg] */ uccu: number;
  /** fixed cost of the superconducting cable [$/m] */ cconfix: number;
  /** TF coil steel conduit or sheath [$/m] */ cconshtf: number;
  /** PF coil steel conduit or sheath [$/m] */ cconshpf: number;
  /** TF winding [$/m of conductor] */ ucwindtf: number;
  /** PF winding [$/m of conductor] */ ucwindpf: number;
  /** coil steel case [$/kg] */ uccase: number;
  /** superconductor intercoil structure [$/kg] */ ucint: number;
  /** outer PF coil fence support [$/kg] */ ucfnc: number;
  /** high-strength tapered copper of the centre post [$/kg] */ uccpcl1: number;
  /** copper TF outboard leg plate coils [$/kg] */ uccpclb: number;
  /** vacuum vessel [$/kg] (PROCESS names it uccryo) */ uccryo: number;
  // -- account 22.3 power injection [$/W]
  ucech: number; uclh: number; ucich: number; ucnbi: number;
  // -- account 22.4 vacuum system
  /** cryopump [$] */ uccpmp: number;
  /** turbomolecular pump [$] */ uctpmp: number;
  /** backing pump [$] */ ucbpmp: number;
  /** duct [$/m] */ ucduct: number;
  /** valve [$] */ ucvalv: number;
  /** duct shield [$/kg] */ ucvdsh: number;
  /** instrumentation and control [$] */ ucviac: number;
  // -- account 22.5 power conditioning
  /** TF power supplies [$/W^0.7] */ uctfps: number;
  /** TF breakers [$/W^0.7] */ uctfbr: number;
  /** TF slow dump switches [$/A] */ uctfsw: number;
  /** TF dump resistors [$/J] */ uctfdr: number;
  /** TF dump resistors, additional [$/coil] */ uctfgr: number;
  /** TF instrumentation and control [$/coil/30] */ uctfic: number;
  /** TF bus of a resistive coil [$/kg] */ uctfbus: number;
  /** TF aluminium bus [$/(A m)] */ ucbus: number;
  /** PF pulsed power supplies [$/MVA] */ ucpfps: number;
  /** PF instrumentation and control [$/channel] */ ucpfic: number;
  /** PF buses [$/(kA m)] */ ucpfb: number;
  /** PF burn power supplies [$/kW^0.7] */ ucpfbs: number;
  /** PF DC breakers [$/MVA^0.7] */ ucpfbk: number;
  /** PF dump resistors [$/MJ] */ ucpfdr1: number;
  /** PF AC breakers [$/circuit] */ ucpfcb: number;
  // -- account 22.6 heat transport
  /** heat transport equipment by coolant type [$/W^0.7]: [helium, water] */ uchts: readonly [number, number];
  /** primary heat exchangers [$/W^0.7] */ ucphx: number;
  /** auxiliary heat transport [$/W^0.7] */ ucahts: number;
  /** cryoplant [$/W^0.67] */ uccry: number;
  // -- account 22.7 to 22.9
  /** fuelling system [$] */ ucf1: number;
  /** 60 g/day tritium processing unit [$] */ ucfpr: number;
  /** detritiation and air cleanup [$ per 10000 m^3/h] */ ucdtc: number;
  /** nuclear building ventilation [$/m^3] */ ucnbv: number;
  /** instrumentation, control and diagnostics [$] */ uciac: number;
  /** maintenance equipment [$] */ ucme: number;
  // -- accounts 23 to 26
  /** turbine plant equipment by coolant type [$]: [helium, water] */ ucturb: readonly [number, number];
  /** switchyard [$] */ ucswyd: number;
  /** primary power transformer [$/kVA^0.9] */ ucpp: number;
  /** auxiliary transformer [$/kVA] */ ucap: number;
  /** low voltage system [$/kVA] */ uclv: number;
  /** diesel generator, 8 MW each [$] */ ucdgen: number;
  /** auxiliary facility power equipment [$] */ ucaf: number;
  /** miscellaneous plant allowance [$] */ ucmisc: number;
  /** heat rejection system, reference [$] (2300 MW rejected) */ uchrs: number;
}

/** PROCESS defaults (1990 US$) */
export const COST_UNITS_1990: Readonly<CostUnits> = {
  ucrb: 400, ucmb: 260, ucws: 460, uctr: 370, ucel: 380, ucad: 180, ucco: 350, ucsh: 115, uccr: 460, csi: 16, cland: 19.2, cturbb: 38,
  ucfwa: 6.0e4, ucfws: 5.3e4, ucfwps: 1.0e7, ucblbe: 260, ucblli2o: 600, ucblss: 90, ucblvd: 200, ucshld: 32, ucpens: 32, ucgss: 35, ucdiv: 2.8e5,
  ucsc: [600, 600, 300, 600, 600, 600, 300, 1200, 1200], scMatCost0: [4.8, 2.0, 1.0, 4.8, 4.8, 47.4, 1.0, 47.4, 47.4],
  uccu: 75, cconfix: 80, cconshtf: 75, cconshpf: 70, ucwindtf: 480, ucwindpf: 465, uccase: 50, ucint: 35, ucfnc: 35, uccpcl1: 250, uccpclb: 150, uccryo: 32,
  ucech: 3, uclh: 3.3, ucich: 3, ucnbi: 3.3,
  uccpmp: 3.9e5, uctpmp: 1.105e5, ucbpmp: 2.925e5, ucduct: 4.225e4, ucvalv: 3.9e5, ucvdsh: 26, ucviac: 1.3e6,
  uctfps: 24, uctfbr: 1.22, uctfsw: 1, uctfdr: 1.75e-4, uctfgr: 5000, uctfic: 1e4, uctfbus: 100, ucbus: 0.123,
  ucpfps: 3.5e4, ucpfic: 1e4, ucpfb: 210, ucpfbs: 4.9e3, ucpfbk: 1.66e4, ucpfdr1: 150, ucpfcb: 7.5e4,
  uchts: [15.3, 19.1], ucphx: 15, ucahts: 31, uccry: 9.3e4,
  ucf1: 2.23e7, ucfpr: 4.4e7, ucdtc: 13, ucnbv: 1000, uciac: 1.5e8, ucme: 1.25e8,
  ucturb: [230e6, 245e6], ucswyd: 1.84e7, ucpp: 48, ucap: 17, uclv: 16, ucdgen: 1.7e6, ucaf: 1.5e6, ucmisc: 2.5e7, uchrs: 87.9e6,
};

/** financial parameters of the PROCESS cost model and of its cost of electricity (`coelc`) */
export interface CostFinance {
  /** level of safety assurance */ lsa: SafetyLevel;
  /** multiplier for Nth-of-a-kind costs of the accounts of the fusion power island (1 = first of a kind) */ fkind: number;
  /** 0: first wall, blanket and divertor are capital costs; 1: they are fuel costs (replaced periodically); 2: the initial set is capital, replacements are fuel */ ifueltyp: 0 | 1 | 2;
  /** fraction of the current-drive cost that is a recurring cost (ifueltyp 1) */ fcdfuel: number;
  /** indirect cost factor by safety level */ cfind: readonly [number, number, number, number];
  /** owner's cost factor */ cowner: number;
  /** project contingency factor */ fcontng: number;
  /** discount rate */ discountRate: number;
  /** average cost of money during the construction of the plant (six years) */ fcap0: number;
  /** average cost of money for replaceable components (two years lead time) */ fcap0cp: number;
  /** fixed charge rate during construction */ fcr0: number;
  /** decommissioning fund: fraction of the construction cost set aside */ decomf: number;
  /** difference between borrowing and saving interest rates */ dintrt: number;
  /** years before the end of the plant life at which the fund is completed */ dtlife: number;
  /** plant life [y] */ lifePlant: number;
  /** total plant availability */ availability: number;
  /** annual operation and maintenance by safety level [M$/y/(1200 MW)^0.5] */ ucoam: readonly [number, number, number, number];
  /** annual waste disposal by safety level [M$/y/(1200 MW)] */ ucwst: readonly [number, number, number, number];
  /** D-T fuel [M$/y/(1200 MW)] */ ucfuel: number;
  /** helium-3 [$/kg] */ uche3: number;
}

/** PROCESS defaults: first-of-a-kind, full fission-plant safety level, available 75 % */
export const COST_FINANCE_1990: Readonly<CostFinance> = {
  lsa: 4, fkind: 1, ifueltyp: 0, fcdfuel: 0.1, cfind: [0.244, 0.244, 0.244, 0.29], cowner: 0.15, fcontng: 0.195, discountRate: 0.0435, fcap0: 1.165,
  fcap0cp: 1.08, fcr0: 0.0966, decomf: 0.1, dintrt: 0, dtlife: 0, lifePlant: 30, availability: 0.75, ucoam: [68.8, 68.8, 68.8, 74.4],
  ucwst: [0, 3.94, 5.91, 7.88], ucfuel: 3.45, uche3: 1e6,
};
