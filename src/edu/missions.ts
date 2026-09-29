/**
 * The ten missions: a starting configuration that fails a goal, the controls a player may change, the goal, a
 * headless solution and a negative control (a plausible attempt that must still fail). The tests
 * (missions.test.ts) run every mission three ways, untouched, with the control and with the solution, so a mission is
 * only in this list while it is solvable and not trivial.
 *
 * Pure data and pure functions: no DOM, no React. The screens (src/ui/edu) and the tests share this module;
 * running a mission and judging the run is in missionEval.ts.
 */
import { DEMO, DIIID, JET, NIF, SPARC, SPARC_15D } from '../physics/presets';
import { ICFConfig, MagneticConfig, ReactorConfig } from '../physics/types';
import type { MetricId } from './missionEval';

export type MissionId = 'hmode' | 'density' | 'beta' | 'kink' | 'sparcQ' | 'ignition' | 'elm' | 'fuel' | 'nif' | 'tungsten';

/** a value the player set: the number as shown (in the lever's unit) or, for a choice, the option */
export type EditValue = number | string;
/** what the player changed: lever id → value (levers that are not in it keep their starting value) */
export type Edits = Record<string, EditValue>;

export type LeverId =
  | 'pNBI' | 'pECRH' | 'pICRH' | 'density' | 'Ip' | 'B0' | 'H98' | 'fuel' | 'fuelMix' | 'asymmetry' | 'adiabat'
  | 'laserE' | 'wConc' | 'elmSize' | 'elmMargin' | 'pointN' | 'pointT';

export interface Lever {
  id: LeverId;
  /** dotted path into the configuration; 'point.n' and 'point.T' are the POPCON operating point, not configuration */
  path: string;
  type: 'number' | 'choice';
  min?: number;
  max?: number;
  step?: number;
  /** configuration value = shown value × scale (e.g. 1e20 for a density shown in 1e20 m⁻³) */
  scale?: number;
  unit?: string;
  /** slider on a log scale (concentrations) */
  log?: boolean;
  options?: string[];
}

export interface Goal { metric: MetricId; op: '>=' | '<='; target: number }

export interface Mission {
  id: MissionId;
  level: 1 | 2 | 3;
  kind: 'run' | 'popcon';
  /** the machine the mission starts from (a proper name, not translated) */
  machine: string;
  base: ReactorConfig;
  levers: Lever[];
  goals: Goal[];
  /** the headless solution (a search for the POPCON mission, a fixed set of edits otherwise) */
  solution: () => Edits;
  /** the negative control: a plausible attempt that must still fail */
  control: Edits;
  /** glossary terms the mission touches */
  terms: string[];
  /** the POPCON operating point before the player picks one ({n [1e20 m⁻³], T [keV]}) */
  startPoint?: { n: number; T: number };
}

// ── configuration edits ─────────────────────────────────────────────────────────────────────────────

const isPoint = (l: Lever) => l.path.startsWith('point.');

function getPath(o: unknown, path: string): unknown {
  let cur = o;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setPath(o: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    const copy = next !== null && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
    cur[k] = copy;
    cur = copy;
  }
  cur[keys[keys.length - 1]] = value;
}

/** the value a lever has in the starting configuration, as shown (in the lever's unit) */
export function leverStart(m: Mission, l: Lever): EditValue {
  if (isPoint(l)) return m.startPoint ? (l.path === 'point.n' ? m.startPoint.n : m.startPoint.T) : 0;
  const v = getPath(m.base, l.path);
  if (l.type === 'choice') return String(v);
  return Number(v) / (l.scale ?? 1);
}

/** the values of all levers: the player's edits over the starting values, numbers clamped to the lever's range */
export function leverValues(m: Mission, edits: Edits): Record<string, EditValue> {
  const out: Record<string, EditValue> = {};
  for (const l of m.levers) {
    const raw = l.id in edits ? edits[l.id] : leverStart(m, l);
    if (l.type === 'choice') out[l.id] = l.options?.includes(String(raw)) ? String(raw) : String(leverStart(m, l));
    else {
      const x = Number(raw);
      out[l.id] = Number.isFinite(x) ? Math.min(Math.max(x, l.min ?? -Infinity), l.max ?? Infinity) : Number(leverStart(m, l));
    }
  }
  return out;
}

/** the mission's configuration with the player's edits applied (the base configuration is not modified) */
export function buildConfig(m: Mission, edits: Edits): ReactorConfig {
  const values = leverValues(m, edits);
  const cfg = { ...(m.base as unknown as Record<string, unknown>) };
  for (const l of m.levers) {
    if (isPoint(l)) continue;
    const v = values[l.id];
    setPath(cfg, l.path, l.type === 'choice' ? v : Number(v) * (l.scale ?? 1));
  }
  return cfg as unknown as ReactorConfig;
}

/** the POPCON operating point of the edits, in SI (n [m⁻³], T [keV]); null for a mission without one */
export function operatingPoint(m: Mission, edits: Edits): { n: number; T: number } | null {
  if (m.kind !== 'popcon') return null;
  const v = leverValues(m, edits);
  return { n: Number(v.pointN) * 1e20, T: Number(v.pointT) };
}

// ── the missions ────────────────────────────────────────────────────────────────────────────────────

const dd = DIIID as MagneticConfig;
const withHeating = (b: MagneticConfig, h: Partial<MagneticConfig['heating']>): MagneticConfig => ({ ...b, heating: { ...b.heating, ...h } });

/** DIII-D on 0.5 MW of neutral beam and no ECRH: far too little power to leave L-mode */
const HMODE_BASE = withHeating(dd, { P_NBI_MW: 0.5, P_ECRH_MW: 0 });
/**
 * DIII-D with a 1.25e20 m⁻³ setpoint. The setpoint of the 0D model is the volume-average density, the Greenwald limit (n_G = 1.13e20 m⁻³
 * at 2.0 MA) is on the line average, which is 11 % higher for the profile of this shot: the shot is fuelled to n̄/n_G = 1.22 and disrupts
 * at about 1 s. (Until v4.0-ws2d the setpoint was 1.0e20, 0.98 n_G, and the underdamped fuelling loop overshot it onto the limit; the
 * controller no longer does, so a setpoint has to be beyond the limit to disrupt, and the threshold is clean: about 1.02e20.)
 */
const DENSITY_BASE: MagneticConfig = { ...dd, n_target: 1.25e20 };
/** DIII-D with 30 MW of beam power: beta-limit disruption at 0.4 s */
const BETA_BASE = withHeating(dd, { P_NBI_MW: 30 });
/** DIII-D asked for 5.5 MA at its 2.2 T: q95 below 2 */
const KINK_BASE: MagneticConfig = { ...dd, Ip_MA: 5.5 };
/** SPARC at 4.5e20 m⁻³ and 25 MW: P_LH above the heating, the plasma stays in L-mode */
const SPARC_BASE: MagneticConfig = { ...SPARC, n_target: 4.5e20 };
/** the EU DEMO design with an L-mode-like H98 = 1.0: no ignition anywhere in the POPCON map */
const IGNITION_BASE: MagneticConfig = { ...DEMO, H98: 1.0 };
/** SPARC (1.5D, 6 s) with a storm of large ELMs: 0.6 pedestal fraction per crash at half the stability margin */
const ELM_BASE: MagneticConfig = {
  ...SPARC_15D, t_end: 6, profiles: { ...SPARC_15D.profiles, alphaCritFactor: 0.5, elmFraction: 0.6 },
};
/** JET with a deuterium plasma */
const FUEL_BASE: MagneticConfig = { ...JET, fuel: 'DD', fuelFracA: 1 };
/** NIF with an 8 % low-mode drive asymmetry */
const NIF_BASE: ICFConfig = { ...NIF, asymmetry_rms: 8 };
/** SPARC with 3e-4 tungsten */
const TUNGSTEN_BASE: MagneticConfig = { ...SPARC, impurity: { ...SPARC.impurity, concentration: 3e-4 } };

const num = (id: LeverId, path: string, min: number, max: number, step: number, unit: string, extra: Partial<Lever> = {}): Lever =>
  ({ id, path, type: 'number', min, max, step, unit, ...extra });

export const MISSIONS: Mission[] = [
  {
    id: 'hmode', level: 1, kind: 'run', machine: 'DIII-D', base: HMODE_BASE,
    levers: [
      num('pNBI', 'heating.P_NBI_MW', 0, 12, 0.1, 'MW'),
      num('pECRH', 'heating.P_ECRH_MW', 0, 6, 0.1, 'MW'),
      num('density', 'n_target', 0.2, 1.0, 0.05, '1e20 m⁻³', { scale: 1e20 }),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'hModeFrac', op: '>=', target: 0.6 }],
    solution: () => ({ pNBI: 6 }),
    // more density (it stays below the Greenwald limit) leaves the threshold out of reach
    control: { density: 0.8 },
    terms: ['hMode', 'pLH', 'nbi', 'tauE'],
  },
  {
    id: 'density', level: 1, kind: 'run', machine: 'DIII-D', base: DENSITY_BASE,
    levers: [
      num('density', 'n_target', 0.1, 1.4, 0.05, '1e20 m⁻³', { scale: 1e20 }),
      num('pNBI', 'heating.P_NBI_MW', 2, 20, 0.5, 'MW'),
      num('Ip', 'Ip_MA', 0.8, 2.5, 0.05, 'MA'),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'nbarMax', op: '>=', target: 0.5 }],
    solution: () => ({ density: 0.7 }),
    // a trim of 12 % is not enough: 1.1e20 is below the 1.13e20 of n_G but n_G is a limit of the line average, and the threshold of the
    // setpoint is n_G / 1.11 = 1.02e20
    control: { density: 1.1 },
    terms: ['greenwald', 'disruption', 'ip'],
  },
  {
    id: 'beta', level: 2, kind: 'run', machine: 'DIII-D', base: BETA_BASE,
    levers: [
      num('pNBI', 'heating.P_NBI_MW', 5, 40, 0.5, 'MW'),
      num('Ip', 'Ip_MA', 0.8, 3.5, 0.05, 'MA'),
      num('B0', 'B0', 1.5, 3.5, 0.05, 'T'),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'pauxMax', op: '>=', target: 25 }],
    solution: () => ({ Ip: 2.5, B0: 3 }),
    // a little more current is not enough at 30 MW
    control: { Ip: 2.0 },
    terms: ['betaN', 'troyon', 'nbi'],
  },
  {
    id: 'kink', level: 2, kind: 'run', machine: 'DIII-D', base: KINK_BASE,
    levers: [
      num('Ip', 'Ip_MA', 1, 7, 0.1, 'MA'),
      num('B0', 'B0', 1.5, 4, 0.05, 'T'),
      num('pNBI', 'heating.P_NBI_MW', 2, 20, 0.5, 'MW'),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'ipMax', op: '>=', target: 5 }],
    solution: () => ({ B0: 3 }),
    // less heating does nothing for q95
    control: { pNBI: 4 },
    terms: ['q95', 'disruption', 'ip'],
  },
  {
    id: 'sparcQ', level: 2, kind: 'run', machine: 'SPARC', base: SPARC_BASE,
    levers: [
      num('density', 'n_target', 1, 6, 0.1, '1e20 m⁻³', { scale: 1e20 }),
      num('pICRH', 'heating.P_ICRH_MW', 5, 40, 1, 'MW'),
      num('H98', 'H98', 0.6, 1.3, 0.05, ''),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'qAvg', op: '>=', target: 3 }],
    solution: () => ({ density: 3 }),
    // the threshold power is still out of reach at 30 MW
    control: { pICRH: 30 },
    terms: ['qSci', 'hMode', 'pLH', 'icrh'],
  },
  {
    id: 'ignition', level: 3, kind: 'popcon', machine: 'EU DEMO', base: IGNITION_BASE,
    levers: [
      num('H98', 'H98', 0.8, 1.8, 0.05, ''),
      num('pointN', 'point.n', 0.1, 1.2, 0.01, '1e20 m⁻³'),
      num('pointT', 'point.T', 1, 40, 0.5, 'keV'),
    ],
    goals: [{ metric: 'ignited', op: '>=', target: 1 }, { metric: 'inLimits', op: '>=', target: 1 }],
    // filled in by missionEval.solveIgnition (a search of the POPCON grid), see SOLVERS there
    solution: () => ({ H98: 1.4 }),
    control: { H98: 1.2 },
    terms: ['popcon', 'ignition', 'lawson', 'greenwald'],
    startPoint: { n: 0.5, T: 8 },
  },
  {
    id: 'elm', level: 3, kind: 'run', machine: 'SPARC (1.5D)', base: ELM_BASE,
    levers: [
      num('elmSize', 'profiles.elmFraction', 0.02, 0.8, 0.01, ''),
      num('elmMargin', 'profiles.alphaCritFactor', 0.3, 1.5, 0.05, ''),
      num('pICRH', 'heating.P_ICRH_MW', 10, 40, 1, 'MW'),
    ],
    goals: [
      { metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'hModeFrac', op: '>=', target: 0.5 },
      { metric: 'elmMax', op: '<=', target: 0.3 }, { metric: 'qAvg', op: '>=', target: 3 },
    ],
    solution: () => ({ elmSize: 0.15 }),
    // the crashes shrink only a little
    control: { elmSize: 0.4 },
    terms: ['elm', 'pedestal', 'hMode', 'qSci'],
  },
  {
    id: 'fuel', level: 1, kind: 'run', machine: 'JET', base: FUEL_BASE,
    levers: [
      { id: 'fuel', path: 'fuel', type: 'choice', options: ['DD', 'DT'] },
      num('fuelMix', 'fuelFracA', 0, 1, 0.05, ''),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'eFus', op: '>=', target: 40 }],
    solution: () => ({ fuel: 'DT', fuelMix: 0.5 }),
    // nearly pure deuterium in a D-T mix is still a deuterium plasma
    control: { fuel: 'DT', fuelMix: 0.9 },
    terms: ['fuelMix', 'nbi', 'qSci'],
  },
  {
    id: 'nif', level: 2, kind: 'run', machine: 'NIF', base: NIF_BASE,
    levers: [
      num('asymmetry', 'asymmetry_rms', 0.5, 20, 0.5, '%'),
      num('adiabat', 'adiabat', 1.2, 4, 0.1, ''),
      num('laserE', 'E_laser_MJ', 1, 3, 0.05, 'MJ'),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'gain', op: '>=', target: 1.2 }],
    solution: () => ({ asymmetry: 3 }),
    // the drive asymmetry is still too large
    control: { asymmetry: 6 },
    terms: ['icfGain', 'asymmetry', 'adiabat', 'hohlraum'],
  },
  {
    id: 'tungsten', level: 3, kind: 'run', machine: 'SPARC', base: TUNGSTEN_BASE,
    levers: [
      num('wConc', 'impurity.concentration', 1e-6, 1e-3, 0.05, '', { log: true }),
      num('density', 'n_target', 1, 6, 0.1, '1e20 m⁻³', { scale: 1e20 }),
      num('pICRH', 'heating.P_ICRH_MW', 5, 40, 1, 'MW'),
    ],
    goals: [{ metric: 'noDisruption', op: '>=', target: 1 }, { metric: 'qAvg', op: '>=', target: 3 }],
    solution: () => ({ wConc: 1.5e-5 }),
    // three times less tungsten (1e-4 against 3e-4) avoids the collapse but leaves the plasma cold and in L-mode
    control: { wConc: 1e-4 },
    terms: ['tungsten', 'radiative', 'zeff', 'qSci'],
  },
];

export function findMission(id: string): Mission | undefined { return MISSIONS.find((m) => m.id === id); }

/** the i18n key of a mission's text: title, brief (the situation), hint1, hint2, lesson (what it teaches), answer */
export type MissionText = 'title' | 'brief' | 'hint1' | 'hint2' | 'lesson' | 'answer';
export function missionKey(id: MissionId, part: MissionText): `mis.${MissionId}.${MissionText}` { return `mis.${id}.${part}`; }
