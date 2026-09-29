/**
 * PROCESS-style cost accounts (lane ws7b): the reference values of the PROCESS unit tests of the 1990 cost model
 * (tests/unit/models/test_costs_1990.py of https://github.com/ukaea/PROCESS, inputs and expected values transcribed from its
 * parametrised cases, generated there from the EU DEMO 2018 baseline run), account by account, then the composition of the accounts
 * and the cost of electricity.
 */
import { describe, expect, it } from 'vitest';
import {
  BuildingVolumes, CoelcInput, CostPlant, PFCostInput, TFCostInput, VacuumSystem, acc21, acc2211, acc2212, acc2213, acc2214, acc2215, acc2221, acc2222,
  acc2223, acc223, acc224, acc2251, acc2252, acc2253, acc226, acc227, acc228, acc229, acc23, acc24, acc25, acc26, acc9, calendarLifetimes,
  capitalRecoveryFactor, costAccounts, costContext, costOfElectricity,
} from './costs';
import { COST_FINANCE_1990, COST_UNITS_1990, LSA_FACTORS, lsaFactor } from './costUnits';

/** |a - b| <= rel |b| (pytest.approx default is rel 1e-6; the transcribed values agree to a few 1e-12) */
function close(a: number, b: number, rel = 1e-9): void {
  expect(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${a} vs reference ${b}`).toBe(true);
}
/** |a - b| <= abs (pytest.approx(x, abs=0.01) of the older PROCESS tests) */
function within(a: number, b: number, abs = 0.01): void {
  expect(Math.abs(a - b) <= abs, `${a} vs reference ${b} (+-${abs})`).toBe(true);
}
const ctx = (lsa: 1 | 2 | 3 | 4, extra?: Parameters<typeof costContext>[0]) => costContext({ ...extra, fin: { lsa, fkind: 1, ifueltyp: 1, ...(extra?.fin ?? {}) } });

describe('units and safety factors', () => {
  it('carry the PROCESS defaults', () => {
    expect(COST_UNITS_1990.ucblss).toBe(90);
    expect(COST_UNITS_1990.uchrs).toBe(87.9e6);
    expect(COST_UNITS_1990.ucsc).toEqual([600, 600, 300, 600, 600, 600, 300, 1200, 1200]);
    expect(COST_FINANCE_1990.cfind).toEqual([0.244, 0.244, 0.244, 0.29]);
    expect(lsaFactor(LSA_FACTORS.magnets, 2)).toBe(0.845);
    expect(lsaFactor(LSA_FACTORS.buildings, 4)).toBe(1);
  });
  it('the safety factors rise monotonically with the level of safety assurance and end at 1', () => {
    for (const fam of Object.values(LSA_FACTORS)) {
      for (let i = 1; i < 4; i++) expect(fam[i]).toBeGreaterThan(fam[i - 1]);
      expect(fam[3]).toBe(1);
    }
  });
});

describe('account 21, buildings (test_acc21)', () => {
  const b1: BuildingVolumes = { shovol: 100000, triv: 40000, elevol: 51601.097615432001, rbvol: 1356973.2891062023, cryvol: 15247.180612719381, rmbvol: 421473.52130148414, admvol: 100000, convol: 60000, wsvol: 130018.25667917728 };
  const b2: BuildingVolumes = { shovol: 100000, triv: 40000, elevol: 51609.268177478581, rbvol: 1358540.6868905292, cryvol: 25826.919937316459, rmbvol: 423252.94369581528, admvol: 100000, convol: 60000, wsvol: 130255.93791329287 };
  it('reproduces both reference cases', () => {
    const a = acc21(b1, ctx(2));
    close(a.c21, 740.00647752036286); close(a.c211, 32.64); close(a.c212, 455.94302513968393); close(a.c213, 31.92); close(a.c214, 142.28887143307821);
    close(a.c2141, 92.049817052244123); close(a.c2142, 50.239054380834098); close(a.c215, 12.432); close(a.c216, 16.471070358845893); close(a.c217, 48.311510588754764);
    close(a.c2171, 15.12); close(a.c2172, 17.64); close(a.c2173, 9.66); close(a.c2174, 5.8915105887547687);
    const b = acc21(b2, ctx(2));
    close(b.c21, 745.10420837411039); close(b.c212, 456.46967079521778); close(b.c2141, 92.438442903166035); close(b.c2174, 9.9795218637790786);
  });
  it('has no turbine building for an experimental device, and the land is not scaled with the safety level', () => {
    expect(acc21(b1, costContext({ isReactor: false })).c213).toBe(0);
    const l1 = acc21(b1, ctx(1)), l4 = acc21(b1, ctx(4));
    close(l1.c211 - COST_UNITS_1990.cland, COST_UNITS_1990.csi * 0.68);
    close(l4.c211 - COST_UNITS_1990.cland, COST_UNITS_1990.csi);
  });
});

describe('accounts 22.1, reactor (test_acc2211 to test_acc2215)', () => {
  it('22.1.1 first wall: fuel-type cost with ifueltyp 1 (both cases)', () => {
    const a = acc2211(1601.1595634509963, ctx(2));
    close(a.fwallcst, 143.19827300247195); expect(a.c2211).toBe(0);
    close(acc2211(1891.2865102700493, ctx(2)).fwallcst, 167.7865317453867);
  });
  it('the ifueltyp switch: 0 capital only, 1 replacement only, 2 both', () => {
    const c = (n: 0 | 1 | 2) => acc2211(1601.1595634509963, ctx(2, { fin: { ifueltyp: n } }));
    close(c(0).c2211, 143.19827300247195); expect(c(0).fwallcst).toBe(0);
    expect(c(1).c2211).toBe(0); close(c(1).fwallcst, 143.19827300247195);
    close(c(2).c2211, 143.19827300247195); close(c(2).fwallcst, 143.19827300247195);
  });
  it('22.1.2 blanket (both cases)', () => {
    const u = { ucblvd: 280 };
    const a = acc2212({ beryllium_kg: 1184720.5052248738, li2o_kg: 1258110.2710352642, steel_kg: 1058196.5489677608, vanadium_kg: 0 }, ctx(2, { units: u }));
    close(a.blkcst, 868.59838754004318); close(a.c22121, 231.02049851885039); close(a.c22122, 566.14962196586885); close(a.c22123, 71.428267055323843);
    const b = acc2212({ beryllium_kg: 1186911.9498227015, li2o_kg: 1260437.468838267, steel_kg: 1060153.955039866, vanadium_kg: 0 }, ctx(2, { units: u }));
    close(b.blkcst, 870.20508315783786); close(b.c22121, 231.44783021542679); close(b.c22122, 567.19686097722013); close(b.c22123, 71.560391965190959);
    // the vanadium of a V-Cr-Ti blanket is costed at ucblvd
    close(acc2212({ beryllium_kg: 0, li2o_kg: 0, steel_kg: 0, vanadium_kg: 1e6 }, ctx(4, { units: u })).c22124, 280);
  });
  it('22.1.3 shield and penetration shield (both cases)', () => {
    const a = acc2213(2294873.8131476026, 2294873.8131476026, ctx(2));
    close(a.c2213, 110.15394303108492); close(a.c22131, 55.076971515542461); close(a.c22132, 55.076971515542461);
    const b = acc2213(2297808.3935174868, 2297808.3935174868, ctx(2));
    close(b.c2213, 110.29480288883934); close(b.c22131, 55.147401444419671);
  });
  it('22.1.4 reactor structure (both cases)', () => {
    close(acc2214(1631228.030796848, ctx(2)), 47.672639200037878);
    close(acc2214(1626877.8363395864, ctx(2)), 47.545504767024411);
  });
  it('22.1.5 divertor (test unit cost 5e5 $/m^2)', () => {
    const a = acc2215(177.80928909705162, ctx(2, { units: { ucdiv: 500000 } }));
    close(a.divcst, 88.904644548525795); expect(a.c2215).toBe(0);
    // Nth-of-a-kind factor
    close(acc2215(177.80928909705162, costContext({ units: { ucdiv: 500000 }, fin: { ifueltyp: 0, fkind: 0.5 } })).c2215, 44.452322274262897);
  });
});

const tf1: TFCostInput = {
  superconducting: true, nCoils: 16, scMaterial: 5, scCostModel: 0, coilLength_m: 50.483843027201402, turns: 200, scMass_kg: 5802.5700395134345,
  cuMass_kg: 58744.465423173802, caseMass_kg: 1034021.9996272125, jCritStrand_Am2: 300, intercoilMass_kg: 5829865.436088616, gravitySupportMass_kg: 1953582.3684708222,
};
const tf2: TFCostInput = {
  ...tf1, coilLength_m: 50.514015976170839, scMass_kg: 5806.038092640837, cuMass_kg: 58779.575542593491, caseMass_kg: 1034699.2182961091, gravitySupportMass_kg: 1951781.4798732549,
};

describe('account 22.2.1, TF coils (test_acc2221)', () => {
  it('conductor and winding of the superconducting coils (both cases)', () => {
    const a = acc2221(tf1, ctx(2));
    close(a.c22211, 127.79612438919186); close(a.c22212, 65.523989541865234);
    const b = acc2221(tf2, ctx(2));
    close(b.c22211, 127.87250498362496); close(b.c22212, 65.563151615791654);
  });
  it('case, intercoil structure and gravity support: the intercoil value is the one PROCESS carries in its state for the same input mass; the case and support values there are from another iteration (1e-3)', () => {
    const b = acc2221(tf2, ctx(2));
    close(b.c22214, 172.4182702723208, 1e-9);
    close(b.c22213, 698.99887174799562, 2e-3); close(b.c22215, 57.77719854752457, 2e-3); close(b.c2221, 1122.5144544988982, 2e-3);
    // the case is mass x unit cost x coils x safety factor: 1.0347e6 kg x 50 $/kg x 16 x 0.845 = 699.5 M$
    close(b.c22213, 1e-6 * 1034699.2182961091 * 50 * 16 * 0.845, 1e-12);
    close(b.c22215, 1e-6 * 1951781.4798732549 * 35 * 0.845, 1e-12);
  });
  it('the critical-current cost model (supercond_cost_model 1) uses the default strand table of PROCESS', () => {
    close(acc2221({ ...tf2, scCostModel: 1 }, ctx(2)).c22211, 1462760.833721748);
  });
  it('resistive coils: copper centre post and outboard legs, the centre post of a spherical tokamak is a replaceable item', () => {
    const r: TFCostInput = { superconducting: false, nCoils: 12, centrepostMass_kg: 1e5, outboardLegsMass_kg: 3e5, spherical: true };
    const a = acc2221(r, ctx(4, { fin: { ifueltyp: 0 } }));
    close(a.c22211, 25); close(a.c22212, 45); expect(a.cpstcst).toBe(0);
    const b = acc2221(r, ctx(4, { fin: { ifueltyp: 1 } }));
    expect(b.c22211).toBe(0); close(b.cpstcst, 25); close(b.c2221, 45);
    const c = acc2221(r, ctx(4, { fin: { ifueltyp: 2 } }));
    close(c.c22211, 25); close(c.cpstcst, 25);
  });
});

const pfBase = {
  superconducting: true, hasCentralSolenoid: true, nCoils: 7,
  radius_m: [6.2732560483870969, 6.2732560483870969, 18.401280308184159, 18.401280308184159, 16.803394770584916, 16.803394770584916, 2.6084100000000001],
  jWindingPack_Am2: [11e6, 11e6, 6e6, 6e6, 8e6, 8e6, 8e6], voidFraction: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
  pfMaterial: 3, csMaterial: 5, pfCopperFraction: 0.69, csCopperFraction: 0.70000000000000007, csCableSpace_m2: 3.8004675824985918, csVoidFraction: 0.3,
  fenceSupportMass_kg: 310716.52923547616, jCritStrandPF_Am2: 200, jCritStrandCS_Am2: 100,
} satisfies Partial<PFCostInput>;
const pf1: PFCostInput = {
  ...pfBase, turns: [349.33800535811901, 474.70809561378354, 192.17751982334951, 192.17751982334951, 130.19624429576547, 130.19624429576547, 4348.5468837135222],
  peakCurrent_MA: [14.742063826112622, 20.032681634901664, -8.1098913365453491, -8.1098913365453491, -5.5984385047179153, -5.5984385047179153, -186.98751599968145],
  structureMass_kg: 2695737.563343476,
};
const pf2: PFCostInput = {
  ...pfBase, turns: [440.26292595093469, 525.4843415877815, 192.44107218389988, 192.44107218389988, 129.65302435274731, 129.65302435274731, 4348.5468837135222],
  peakCurrent_MA: [18.579095475129446, 22.175439215004378, -8.1210132461605742, -8.1210132461605742, -5.575080047168135, -5.575080047168135, -186.98751599968145],
  structureMass_kg: 2510424.9065680322,
};

describe('account 22.2.2, PF coils and central solenoid (test_acc2222)', () => {
  it('reproduces the first reference case (mass-based superconductor cost)', () => {
    const a = acc2222(pf1, ctx(2));
    close(a.c2222, 626.57984594974835); close(a.c22221, 434.46640986938519); close(a.c22222, 69.02908267696219); close(a.c22223, 113.89491205126185); close(a.c22224, 9.1894413521392071);
  });
  it('reproduces the second reference case', () => {
    const a = acc2222(pf2, ctx(2));
    close(a.c2222, 634.503192513881); close(a.c22221, 448.04573758127646); close(a.c22222, 71.202561277966055); close(a.c22223, 106.06545230249935);
  });
  it('reproduces the critical-current cost model case (supercond_cost_model 1)', () => {
    const a = acc2222({ ...pf2, scCostModel: 1 }, ctx(2));
    close(a.c2222, 2271626.1414324627); close(a.c22221, 2271439.6839775303); close(a.c22222, 71.202561277966055);
  });
  it('a resistive coil set has no superconductor, sheath or case', () => {
    const r = acc2222({ ...pf2, superconducting: false, structureMass_kg: 0 }, ctx(2));
    expect(r.c22223).toBe(0);
    expect(r.c22221).toBeGreaterThan(0);
    expect(r.c22221).toBeLessThan(acc2222(pf2, ctx(2)).c22221);
  });
  it('without a central solenoid all coils are PF coils', () => {
    const noCS = acc2222({ ...pf2, hasCentralSolenoid: false }, ctx(2));
    expect(Number.isFinite(noCS.c22221)).toBe(true);
    expect(noCS.c22221).not.toBe(acc2222(pf2, ctx(2)).c22221);
  });
});

describe('accounts 22.2.3, 22.3, 22.4 (vacuum vessel, power injection, vacuum system)', () => {
  it('22.2.3 vacuum vessel (both cases)', () => {
    close(acc2223(9043937.8018644415, ctx(2)), 244.54807816241447);
    close(acc2223(9056931.558219457, ctx(2)), 244.89942933425411);
  });
  it('22.3 power injection: 90 % capital and 10 % fuel-like with ifueltyp 1 (both cases give the same)', () => {
    const a = acc223({ ecrh_MW: 51.978447720428512, lhOrIch_MW: 0, nbi_MW: 0 }, ctx(2));
    close(a.c223, 140.341808845157); close(a.c2231, 140.341808845157); close(a.cdcost, 140.341808845157);
  });
  it('22.3 lower hybrid or ion cyclotron and neutral beams are costed per injected watt, and the Nth-of-a-kind factor applies to all of them', () => {
    const c = costContext({ fin: { ifueltyp: 0, fkind: 0.5 } });
    const a = acc223({ ecrh_MW: 10, lhOrIch_MW: 20, nbi_MW: 30 }, c);
    close(a.c2231, 0.5 * 3 * 10); close(a.c2232, 0.5 * 3.3 * 20); close(a.c2233, 0.5 * 3.3 * 30);
    close(acc223({ ecrh_MW: 0, lhOrIch_MW: 20, ich: true, nbi_MW: 0 }, c).c2232, 0.5 * 3 * 20);
  });
  const vac: VacuumSystem = { pumpType: 'cryopump', nPumps: 46, nDucts: 16, ductLength_m: 4.9196133171476717, ductDiameter_m: 0.57081858183821432, ductShieldMass_kg: 0 };
  it('22.4 vacuum system (both cases)', () => {
    const a = acc224(vac, ctx(2));
    close(a.c224, 34.593599813216727); close(a.c2241, 17.94); close(a.c2242, 4.68); close(a.c2243, 3.3256586023918255); close(a.c2244, 7.3479412108249003); close(a.c2246, 1.3);
    const b = acc224({ ...vac, ductLength_m: 4.9184638394909044, ductDiameter_m: 0.57072331228476758 }, ctx(2));
    close(b.c224, 34.591105904913036); close(b.c2243, 3.3248815554958511); close(b.c2244, 7.346224349417187);
  });
  it('22.4 turbomolecular pumps cost less than cryopumps, duct shielding is costed per kg', () => {
    const t = acc224({ ...vac, pumpType: 'turbomolecular', ductShieldMass_kg: 1e4 }, ctx(2));
    close(t.c2241, 46 * 1.105e5 * 1e-6); close(t.c2245, 16 * 1e4 * 26 * 1e-6);
  });
});

describe('accounts 22.5, power conditioning (test_acc2251 to test_acc2253)', () => {
  const t1 = { superconducting: true, nCoils: 16, tfckw: 32474.753636211804, tfcmw: 0, turnCurrent_A: 74026.751437500003, dumpVoltage_kV: 9.9882637896807953, storedEnergy_GJ: 152.78343648685947, busLength_m: 3397.0129827974288, busMass_kg: 0 };
  it('22.5.1 TF coil power conditioning (both cases)', () => {
    const a = acc2251(t1, ctx(2));
    close(a.c2251, 98.457845594540643); close(a.c22511, 4.3480381629432125); close(a.c22512, 31.601916254373826); close(a.c22513, 26.777101385200407); close(a.c22514, 4.8); close(a.c22515, 30.930789792023205);
    const b = acc2251({ ...t1, tfckw: 32505.257577809778, dumpVoltage_kV: 10.001287165953382, storedEnergy_GJ: 152.98264590137683 }, ctx(2));
    close(b.c2251, 98.524335872804144); close(b.c22511, 4.3508966768725132); close(b.c22512, 31.630686371167478); close(b.c22513, 26.811963032740941);
  });
  it('22.5.1 a resistive coil has no breakers and its bus is costed per kg', () => {
    const r = acc2251({ ...t1, superconducting: false, busMass_kg: 1e5 }, ctx(2));
    expect(r.c22512).toBe(0); close(r.c22515, 1e-6 * 100 * 1e5);
  });
  const p1 = { peakMVA: 736.39062584245937, circuits: 12, busLength_m: 2533.4495999999999, maxCurrent_kA: 24.816666666666666, burnSupply_kW: 1071.1112934857531, voltage_kV: 20, dumpEnergy_MJ: 37429.525515086898 };
  it('22.5.2 PF coil power conditioning (both cases; the breakers, dump resistors and AC breakers to the precision of the PROCESS state)', () => {
    const a = acc2252(p1, ctx(2));
    close(a.c22521, 25.773671904486076); close(a.c22522, 3.6); close(a.c22523, 13.203072590399998); close(a.c22524, 1.36406376579542);
    const b = acc2252({ ...p1, peakMVA: 90.673341440806084, burnSupply_kW: 1069.8879533693198, dumpEnergy_MJ: 37427.228965055205 }, ctx(2));
    close(b.c22521, 3.1735669504282127); close(b.c22524, 1.3629730294999658);
    close(b.c22525, 15.357861411125848, 1e-6); close(b.c22527, 0.9); close(b.c22526, 5.6144288272630343, 1e-3);
  });
  it('22.5.2 no PF circuits, no burn supply cost', () => {
    expect(acc2252({ ...p1, circuits: 0 }, ctx(2)).c22524).toBe(0);
  });
  it('22.5.3 thermal storage of a pulsed plant, option 1 (both cases), scaled with the net power and converted from 1992 pounds', () => {
    close(acc2253({ pulsed: true, istore: 1 }, { P_primaryHeat_MW: 2620.2218111502593, P_net_MW: 493.01760776192009 }, ctx(2)), 20.785622343242554);
    close(acc2253({ pulsed: true, istore: 1 }, { P_primaryHeat_MW: 2619.4223856129224, P_net_MW: 422.4198205312706 }, ctx(2)), 17.809219633598371);
  });
  it('22.5.3 nothing for a steady-state plant; option 2 and the steel block (option 3, in M$) have the expected size', () => {
    expect(acc2253({ pulsed: false, istore: 1 }, { P_primaryHeat_MW: 2600, P_net_MW: 500 }, ctx(2))).toBe(0);
    close(acc2253({ pulsed: true, istore: 2 }, { P_primaryHeat_MW: 2600, P_net_MW: 1200 }, ctx(2)), (0.1 + 0.8 + 2.8 + 4 + 330 + 1 + 2 + 18) * 1.36);
    // a 2.6 GW plant storing its heat for 10 min in a steel block that may change by 300 K: 5.2e9 J/K... = about 10 kt of steel at 90 $/kg
    const s3 = acc2253({ pulsed: true, istore: 3, dtstor_K: 300, dwell_s: 600 }, { P_primaryHeat_MW: 2600, P_net_MW: 500 }, ctx(2));
    close(s3, (1e-6 * 90 * 2600e6 * 600) / (520 * 300));
    expect(s3).toBeGreaterThan(500); expect(s3).toBeLessThan(2000);
  });
});

describe('accounts 22.6 to 22.9 (heat transport, fuel handling, I&C, maintenance)', () => {
  const h = (extra: Partial<Parameters<typeof acc226>[0]>) => ({
    coolant: 'helium' as const, P_fwDiv_MW: 0, P_blanketNuclear_MW: 1504.711566619962, P_shieldNuclear_MW: 1.3609360176065353, P_primaryHeat_MW: 2620.2218111502593, nHeatExchangers: 3,
    P_hcdLoss_MW: 77.967671580642758, P_cryo_MW: 37.900388528497025, P_vacuum_MW: 0.5, P_tritium_MW: 15, P_facility_MW: 61.882833632875375, helium_W: 76851.741036987034, T_tfCryo_K: 4.5,
    P_gross_MW: 982.58317918134742, P_acPrimary_MW: 1226.1273281650574, P_base_MW: 61.882833632875375, P_lowVoltage_MW: 699.34943812129745, P_hcdElectric_MW: 129.94611930107126, P_fusion_MW: 1985.785106643267, ...extra,
  });
  it('22.6.1 reactor cooling: pumps and piping, primary heat exchangers (both cases of the rut test)', () => {
    const a = acc226(h({}), ctx(2));
    close(a.c2261, 85.82488824875719); close(a.chx, 57.169226428813381); close(a.cpp, 28.655661819943806);
    const b = acc226(h({ P_shieldNuclear_MW: 1.4036212304705389, P_blanketNuclear_MW: 1549.9285082739402, P_primaryHeat_MW: 2619.4223856129224 }), ctx(2));
    close(b.c2261, 86.412964519098367); close(b.chx, 57.157016301470911); close(b.cpp, 29.255948217627452);
  });
  it('22.6.1 the older PROCESS test with a helium and a water loop (safety level 1)', () => {
    const base = h({ P_blanketNuclear_MW: 1558, P_shieldNuclear_MW: 1.478, P_primaryHeat_MW: 2647 });
    within(acc226(base, ctx(1)).c2261, 49.68);
    within(acc226({ ...base, coolant: 'water' }, ctx(1)).c2261, 53.85);
  });
  it('22.6.2 auxiliary component cooling', () => {
    close(acc226(h({}), ctx(2)).c2262, 20.313088941037051);
    close(acc226(h({ P_cryo_MW: 108.74512702403499, P_facility_MW: 62.237143915360818 }), ctx(2)).c2262, 25.118525150548585);
    within(acc226(h({ P_hcdLoss_MW: 76.5, P_cryo_MW: 39.936, P_facility_MW: 64.835 }), ctx(4)).c2262, 29.408);
  });
  it('22.6.3 cryogenic system', () => {
    close(acc226(h({}), ctx(2)).c2263, 122.17123799205466);
    close(acc226(h({ helium_W: 220505.71684249729 }), ctx(2)).c2263, 247.55533515524576);
    within(acc226(h({ helium_W: 80980 }), ctx(4)).c2263, 180.76);
    close(acc226(h({}), ctx(2)).c226, 228.30921518184891);
  });
  it('22.7 fuel handling (both cases and the older cases)', () => {
    const f = { burnRate_per_s: 7.0799717510383796e20, fuelMass_amu: 2.5, tritiumFraction: 0.5 };
    const a = acc227(f, 1205439.8543893537, 130018.25667917728, ctx(2));
    close(a.wtgpd, 507.88376577416528); close(a.c2271, 22.3); close(a.c2272, 114.02873340990777); close(a.c2273, 69.115208498727412); close(a.c2274, 79.525098581749191);
    close(a.c227, 284.96904049038437);
    const b = acc227({ ...f, burnRate_per_s: 7.0777619721108953e20 }, 1206887.4047542624, 130255.93791329287, ctx(2));
    close(b.wtgpd, 507.72524666099866); close(b.c2272, 114.00948752346841); close(b.c2273, 69.202425860597359); close(b.c2274, 79.60537144364551); close(b.c227, 285.11728482771127);
    within(acc227({ ...f, burnRate_per_s: 7.158e20 }, 1299783.4, 132304.1, ctx(4)).c2272, 114.707);
    within(acc227(f, 1299783.4, 132304.1, ctx(4)).c2274, 84.1);
    within(acc227(f, 1299783.4, 132304.1, ctx(4)).c2273, 74.12);
  });
  it('22.7.3 no detritiation for pure D-He3 fuel', () => {
    expect(acc227({ burnRate_per_s: 1e20, fuelMass_amu: 2.5, tritiumFraction: 1e-4 }, 1e6, 1e5, ctx(4)).c2273).toBe(0);
  });
  it('22.8 and 22.9 are fixed allowances scaled by fkind', () => {
    const c = costContext();
    close(acc228(c), 150); close(acc229(c), 125);
    const half = costContext({ fin: { fkind: 0.5 } });
    close(acc228(half), 75); close(acc229(half), 62.5);
    close(acc229(costContext({ units: { ucme: 3e8 } })), 300);
  });
});

describe('accounts 23 to 26 and 9', () => {
  it('23 turbine plant: 230 M$ (helium) or 245 M$ (water) at 1200 MW, exponent 0.83', () => {
    within(acc23(1200, 'helium', ctx(4)), 230); within(acc23(1200, 'water', ctx(4)), 245);
    close(acc23(982.58317918134742, 'helium', ctx(4)), 194.83812507173698);
    close(acc23(982.28339460484608, 'helium', ctx(4)), 194.78878460447092);
    expect(acc23(1200, 'helium', costContext({ isReactor: false }))).toBe(0);
  });
  it('24 electric plant: switchyard, transformers, low voltage, diesel generators, auxiliary power (both cases)', () => {
    const a = acc24({ P_acPrimary_MW: 1226.1273281650574, P_base_MW: 61.882833632875375, P_lowVoltage_MW: 699.34943812129745 }, ctx(2));
    close(a.c241, 14.444); close(a.c242, 12.196675853540341); close(a.c243, 10.979786178504369); close(a.c244, 5.338); close(a.c245, 1.1775); close(a.c24, 44.135962032044716);
    const b = acc24({ P_acPrimary_MW: 651.53859031110449, P_base_MW: 62.237143915360818, P_lowVoltage_MW: 412.19758489046046 }, ctx(2));
    close(b.c242, 7.2671621358073075); close(b.c243, 6.471502082780229); close(b.c24, 34.698164218587536);
    const c = acc24({ P_acPrimary_MW: 630, P_base_MW: 65, P_lowVoltage_MW: 403.8 }, ctx(4));
    within(c.c241, 18.4); within(c.c242, 9.06); within(c.c243, 8.08); within(c.c244, 6.8); within(c.c245, 1.5);
  });
  it('25 miscellaneous plant equipment', () => {
    within(acc25(ctx(4)), 25); within(acc25(ctx(1)), 19.25); close(acc25(ctx(2)), 22.125);
  });
  it('26 heat rejection: reactor (primary heat minus gross electricity) and experiment (fusion, heating and TF power)', () => {
    const base = { P_primaryHeat_MW: 0, P_gross_MW: 0, P_fusion_MW: 2000, P_hcdElectric_MW: 250, tfcmw: 50 };
    within(acc26(base, costContext({ isReactor: false, fin: { lsa: 4 } })), 87.9);
    within(acc26({ ...base, P_primaryHeat_MW: 3000, P_gross_MW: 700, P_fusion_MW: 0, P_hcdElectric_MW: 0, tfcmw: 0 }, ctx(4)), 87.9);
    close(acc26({ P_primaryHeat_MW: 2620.2218111502593, P_gross_MW: 982.58317918134742, P_fusion_MW: 1985.785106643267, P_hcdElectric_MW: 129.94611930107126 }, ctx(2)), 56.327648771765475);
    close(acc26({ P_primaryHeat_MW: 2619.4223856129224, P_gross_MW: 982.28339460484608, P_fusion_MW: 1985.1653095257811, P_hcdElectric_MW: 129.94611930107126 }, ctx(2)), 56.310463295064743);
  });
  it('9 indirect cost and contingency', () => {
    const a = acc9(30e3, costContext({ fin: { lsa: 4, cowner: 0.15, fcontng: 0.195 } }));
    within(a.cindrt, 10005, 0.1); within(a.ccont, 7800.98, 0.1);
    const b = acc9(4532.1724050055554, costContext({ fin: { lsa: 2, cowner: 0.15, fcontng: 0.15000000000000002 } }));
    close(b.cindrt, 1271.7275768445588); close(b.ccont, 870.58499727751723);
    const c = acc9(4641.9862239386794, costContext({ fin: { lsa: 2, cowner: 0.15, fcontng: 0.15000000000000002 } }));
    close(c.cindrt, 1302.5413344371934); close(c.ccont, 891.67913375638113);
  });
});

describe('cost of electricity (test_coelc)', () => {
  const finRef = { ifueltyp: 1 as const, lsa: 2 as const, lifePlant: 40, discountRate: 0.060000000000000012, fcr0: 0.065000000000000016, fcap0: 1.15, fcap0cp: 1.06, availability: 0.75000000000000011, fkind: 1 };
  const base: CoelcInput = {
    concost: 6836.2066921322539, fwallcst: 167.7865317453867, blkcst: 870.20508315783786, divcst: 88.904644548525795, cpstcst: 0, cdcost: 140.341808845157,
    P_net_MW: 422.4198205312706, burnFraction: 10230.533336387549 / 864.42613938735622, lifeBlanket: 19.222115557991025, lifeDivertor: 6.145510750914414, lifeCurrentDrive: 19.222115557991025,
    lifeBlanketFpy: 19.222115557991025, lifeDivertorFpy: 6.145510750914414, wtgpd: 507.72524666099866, helium3Fraction: 0,
  };
  it('reproduces the reference case (the components, the total, the interest during construction and the capital cost)', () => {
    const r = costOfElectricity(base, costContext({ fin: finRef }));
    close(r.coeoam, 1.2419424614419636); close(r.coecap, 15.547404530833255); close(r.moneyint, 1025.4310038198375); close(r.capcost, 7861.6376959520912);
    close(r.coe, 21.50420973, 1e-8); close(r.coefuelt, 4.58342338, 1e-8);
  });
  it('reproduces the reference case with no burn (the electricity sold is floored at 1e-10 kWh/y, as PROCESS does)', () => {
    const r = costOfElectricity({
      ...base, concost: 6674.484979127632, fwallcst: 143.19827300247195, blkcst: 868.59838754004318, P_net_MW: 493.01760776192009, burnFraction: 0, lifeBlanket: 19.216116010620578,
      lifeDivertor: 6.1337250397740126, lifeCurrentDrive: 19.216116010620578, wtgpd: 507.88376577416528,
    }, costContext({ fin: finRef }));
    expect(r.kwhpy).toBe(1e-10);
    close(r.coeoam, 4.4099029328740929e20); close(r.coecap, 4.9891775218979061e21); close(r.coe, 6.95253391e21, 1e-8); close(r.coefuelt, 1.48018708e21, 1e-8);
    close(r.moneyint, 1001.1727468691442); close(r.capcost, 7675.6577259967762);
  });
  it('the components add to the total and all are positive for a plant that sells electricity', () => {
    const r = costOfElectricity(base, costContext({ fin: finRef }));
    close(r.coe, r.coecap + r.coefwbl + r.coediv + r.coecdr + r.coecp + r.coefuel + r.coewst + r.coeoam + r.coedecom, 1e-12);
    for (const v of [r.coecap, r.coefwbl, r.coediv, r.coecdr, r.coefuel, r.coewst, r.coeoam, r.coedecom]) expect(v).toBeGreaterThan(0);
    expect(r.coecp).toBe(0);
  });
  it('the cost of electricity falls as the availability rises and rises with the discount rate', () => {
    const at = (fin: object) => costOfElectricity(base, costContext({ fin: { ...finRef, ...fin } })).coe;
    expect(at({ availability: 0.9 })).toBeLessThan(at({ availability: 0.6 }));
    expect(at({ discountRate: 0.1 })).toBeGreaterThan(at({ discountRate: 0.03 }));
  });
  it('with ifueltyp 0 there is no current-drive renewal; with 2 the replacement is charged only for the part of the life not covered by the initial set', () => {
    const c0 = costOfElectricity(base, costContext({ fin: { ...finRef, ifueltyp: 0 } }));
    expect(c0.coecdr).toBe(0);
    const c1 = costOfElectricity(base, costContext({ fin: { ...finRef, ifueltyp: 1 } }));
    const c2 = costOfElectricity(base, costContext({ fin: { ...finRef, ifueltyp: 2 } }));
    close(c2.coefwbl, c1.coefwbl * (1 - 19.222115557991025 / 40), 1e-12);
    close(c2.coediv, c1.coediv * (1 - 6.145510750914414 / 40), 1e-12);
  });
  it('the centre post of a spherical tokamak is renewed like the blanket', () => {
    const r = costOfElectricity({ ...base, spherical: true, cpstcst: 30, lifeCentrepost: 2 * 0.75, lifeCentrepostFpy: 2 }, costContext({ fin: finRef }));
    expect(r.coecp).toBeGreaterThan(0);
  });
  it('the capital recovery factor and the fpy to calendar conversion', () => {
    close(capitalRecoveryFactor(0.06, 40), (0.06 * Math.pow(1.06, 40)) / (Math.pow(1.06, 40) - 1));
    close(capitalRecoveryFactor(0, 20), 0.05);
    expect(capitalRecoveryFactor(0.05, 0)).toBe(Infinity);
    const fin = costContext({ fin: { lifePlant: 40, availability: 0.75 } }).fin;
    const c = calendarLifetimes({ blanketFpy: 5, divertorFpy: 60, centrepostFpy: 2 }, fin);
    close(c.blanket, 3.75); close(c.divertor, 60); close(c.currentDrive, 3.75); close(c.centrepost, 1.5);
  });
});

// The whole plant of the second PROCESS reference case (the inputs of the tests above)
const plant2: CostPlant = {
  buildings: { shovol: 100000, triv: 40000, elevol: 51609.268177478581, rbvol: 1358540.6868905292, cryvol: 25826.919937316459, rmbvol: 423252.94369581528, admvol: 100000, convol: 60000, wsvol: 130255.93791329287, volrci: 1206887.4047542624 },
  firstWallArea_m2: 1891.2865102700493,
  blanket: { beryllium_kg: 1186911.9498227015, li2o_kg: 1260437.468838267, steel_kg: 1060153.955039866, vanadium_kg: 0 },
  shield: { mass_kg: 2297808.3935174868, penetrationMass_kg: 2297808.3935174868 },
  structureMass_kg: 1626877.8363395864, divertorArea_m2: 177.80928909705162,
  tf: tf2, pf: pf2, vacuumVesselMass_kg: 9056931.558219457,
  hcd: { ecrh_MW: 51.978447720428512, lhOrIch_MW: 0, nbi_MW: 0 },
  vacuum: { pumpType: 'cryopump', nPumps: 46, nDucts: 16, ductLength_m: 4.9184638394909044, ductDiameter_m: 0.57072331228476758, ductShieldMass_kg: 0 },
  tfPower: { superconducting: true, nCoils: 16, tfckw: 32505.257577809778, tfcmw: 0, turnCurrent_A: 74026.751437500003, dumpVoltage_kV: 10.001287165953382, storedEnergy_GJ: 152.98264590137683, busLength_m: 3397.0129827974288, busMass_kg: 0 },
  pfPower: { peakMVA: 90.673341440806084, circuits: 12, busLength_m: 2533.4495999999999, maxCurrent_kA: 24.816666666666666, burnSupply_kW: 1069.8879533693198, voltage_kV: 20, dumpEnergy_MJ: 37427.228965055205 },
  storage: { pulsed: true, istore: 1 },
  heat: {
    coolant: 'helium', P_fwDiv_MW: 0, P_blanketNuclear_MW: 1549.9285082739402, P_shieldNuclear_MW: 1.4036212304705389, P_primaryHeat_MW: 2619.4223856129224, nHeatExchangers: 3,
    P_hcdLoss_MW: 77.967671580642758, P_cryo_MW: 108.74512702403499, P_vacuum_MW: 0.5, P_tritium_MW: 15, P_facility_MW: 62.237143915360818, helium_W: 220505.71684249729, T_tfCryo_K: 4.5,
    P_gross_MW: 982.28339460484608, P_acPrimary_MW: 651.53859031110449, P_base_MW: 62.237143915360818, P_lowVoltage_MW: 412.19758489046046, P_hcdElectric_MW: 129.94611930107126, P_fusion_MW: 1985.1653095257811,
  },
  fuel: { burnRate_per_s: 7.0777619721108953e20, fuelMass_amu: 2.5, tritiumFraction: 0.5, helium3Fraction: 0 },
  P_net_MW: 422.4198205312706, burnFraction: 10230.533336387549 / 864.42613938735622, lifeBlanketFpy: 25.6, lifeDivertorFpy: 8.2,
};

describe('the whole estimate (costAccounts)', () => {
  const c2 = ctx(2, { fin: { ifueltyp: 1, lifePlant: 40, discountRate: 0.06, fcr0: 0.065, fcap0: 1.15, fcap0cp: 1.06, fcontng: 0.15 }, units: { ucdiv: 500000, ucblvd: 280 } });
  const r = costAccounts(plant2, c2);
  it('is complete for a full plant description and every sub-account reproduces its reference value', () => {
    expect(r.complete).toBe(true); expect(r.omitted).toEqual([]);
    close(r.accounts['21'], 745.10420837411039); close(r.accounts['22131'], 55.147401444419671); close(r.accounts['2214'], 47.545504767024411);
    close(r.accounts['22211'], 127.87250498362496); close(r.accounts['22221'], 448.04573758127646); close(r.accounts['2223'], 244.89942933425411);
    close(r.accounts['2231'], 140.341808845157); close(r.accounts['224'], 34.591105904913036); close(r.accounts['22511'], 4.3508966768725132);
    close(r.accounts['22521'], 3.1735669504282127); close(r.accounts['2253'], 17.809219633598371); close(r.accounts['226'], 359.08682482489269);
    close(r.accounts['227'], 285.11728482771127); close(r.accounts['23'], 194.78878460447092); close(r.accounts['24'], 34.698164218587536); close(r.accounts['26'], 56.310463295064743);
    // the 25 (22.125 M$ at safety level 2), 228 and 229 allowances
    close(r.accounts['25'], 22.125); close(r.accounts['228'], 150); close(r.accounts['229'], 125);
  });
  it('the totals are the sums of their parts and the constructed cost is direct + indirect + contingency', () => {
    const a = r.accounts;
    close(a['221'], a['2211'] + a['2212'] + a['2213'] + a['2214'] + a['2215'], 1e-12);
    close(a['222'], a['2221'] + a['2222'] + a['2223'], 1e-12);
    close(a['225'], a['2251'] + a['2252'] + a['2253'], 1e-12);
    close(r.c22, a['221'] + a['222'] + a['223'] + a['224'] + a['225'] + a['226'] + a['227'] + a['228'] + a['229'], 1e-12);
    close(r.cdirt, r.c21 + r.c22 + r.c23 + r.c24 + r.c25 + r.c26, 1e-12);
    close(r.cindrt, 0.244 * r.cdirt * 1.15, 1e-12);
    close(r.ccont, 0.15 * (r.cdirt + r.cindrt), 1e-12);
    close(r.concost, r.cdirt + r.cindrt + r.ccont, 1e-12);
    // ifueltyp 1: the first wall, the blanket and the divertor are recurring costs, not capital
    expect(a['2211']).toBe(0); expect(a['2212']).toBe(0); expect(a['2215']).toBe(0);
    close(r.fwallcst, 167.7865317453867); close(r.blkcst, 870.20508315783786); close(r.divcst, 88.904644548525795); close(r.cdcost, 140.341808845157);
  });
  it('the cost of electricity of the estimate is the cost of electricity of its numbers', () => {
    expect(r.coe).toBeDefined();
    const life = calendarLifetimes({ blanketFpy: 25.6, divertorFpy: 8.2 }, c2.fin);
    const direct = costOfElectricity({
      concost: r.concost, fwallcst: r.fwallcst, blkcst: r.blkcst, divcst: r.divcst, cpstcst: 0, cdcost: r.cdcost, P_net_MW: 422.4198205312706, burnFraction: 10230.533336387549 / 864.42613938735622,
      lifeBlanket: life.blanket, lifeDivertor: life.divertor, lifeCurrentDrive: life.currentDrive, lifeBlanketFpy: 25.6, lifeDivertorFpy: 8.2, wtgpd: 507.72524666099866, helium3Fraction: 0,
    }, c2);
    close(r.coe!.coe, direct.coe, 1e-9);
    expect(r.coe!.coe).toBeGreaterThan(0);
  });
  it('a partial description gives a partial estimate that names what it left out', () => {
    const p = costAccounts({ firstWallArea_m2: 1000, divertorArea_m2: 100 }, costContext({ fin: { ifueltyp: 0 } }));
    expect(p.complete).toBe(false);
    expect(p.omitted.some((o) => o.startsWith('21 '))).toBe(true);
    expect(p.omitted.some((o) => o.includes('TF coils'))).toBe(true);
    expect(p.coe).toBeUndefined();
    close(p.accounts['2211'], 1e-6 * 1 * ((6e4 + 5.3e4) * 1000 + 1e7));
    close(p.accounts['2215'], 1e-6 * 100 * 2.8e5);
    // the allowances (22.8, 22.9, 24.1, 24.4, 24.5, 25) are still there and can be switched off
    expect(p.accounts['228']).toBeGreaterThan(0);
    const q = costAccounts({ firstWallArea_m2: 1000 }, costContext({ fin: { ifueltyp: 0 } }));
    const bare = costAccounts({ firstWallArea_m2: 1000, allowances: false }, costContext({ fin: { ifueltyp: 0 } }));
    expect(bare.c22).toBeLessThan(q.c22); expect(bare.accounts['228']).toBeUndefined();
  });
  it('the Nth-of-a-kind factor scales the accounts of the fusion power island but not the buildings, the turbine plant or the electric plant', () => {
    const half = costAccounts(plant2, ctx(2, { fin: { ifueltyp: 1, fkind: 0.5, lifePlant: 40 }, units: { ucdiv: 500000, ucblvd: 280 } }));
    close(half.accounts['22'], 0.5 * r.accounts['22'] * 1, 1e-6); // every account of 22 carries fkind (the ones with no safety factor too)
    close(half.accounts['21'], r.accounts['21'], 1e-12);
    close(half.accounts['23'], r.accounts['23'], 1e-12); close(half.accounts['24'], r.accounts['24'], 1e-12);
  });
  it('an experimental device has no turbine plant and no cost of electricity', () => {
    const e = costAccounts(plant2, costContext({ isReactor: false, fin: { lsa: 2 } }));
    expect(e.c23).toBe(0); expect(e.coe).toBeUndefined();
    close(e.accounts['21'] - acc21(plant2.buildings!, costContext({ isReactor: false, fin: { lsa: 2 } })).c21, 0, 1e-12);
  });
  it('a helium-3 fuelled plant pays for the fuel per kg and needs no detritiation', () => {
    const he3 = costAccounts({ ...plant2, fuel: { burnRate_per_s: 7.0777619721108953e20, fuelMass_amu: 2.5, tritiumFraction: 1e-4, helium3Fraction: 0.5 } }, c2);
    expect(he3.accounts['2273']).toBe(0);
    expect(he3.coe!.coefuel).toBeGreaterThan(r.coe!.coefuel);
  });
});
