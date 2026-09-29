/**
 * The glossary: every term the missions, the power-flow diagram and the Explain popovers refer to.
 * An entry is data only (symbol, group, related terms, the diagnostic it is drawn from); the name and the
 * definition are the messages gl.<id>.name and gl.<id>.def of the education dictionaries.
 */
import type { EduKey } from './i18n';

export type GlossaryGroup = 'performance' | 'confinement' | 'limits' | 'mhd' | 'heating' | 'edge' | 'icf' | 'devices';

export interface GlossaryTerm {
  id: string;
  /** physics symbol, shown untranslated next to the name */
  symbol?: string;
  group: GlossaryGroup;
  /** ids of related terms (the popover links to them) */
  related: string[];
  /** the diagnostic channel (DiagSpec key) the term is read from, when there is one */
  diag?: string;
}

export const GLOSSARY_GROUPS: readonly GlossaryGroup[] = ['performance', 'confinement', 'limits', 'mhd', 'heating', 'edge', 'icf', 'devices'];

export const GLOSSARY: GlossaryTerm[] = [
  // performance
  { id: 'qSci', symbol: 'Q_sci', group: 'performance', related: ['qEng', 'ignition', 'lawson'], diag: 'Q' },
  { id: 'qEng', symbol: 'Q_eng', group: 'performance', related: ['qSci', 'powerFlow'] },
  { id: 'lawson', symbol: 'nTτ', group: 'performance', related: ['triple', 'ignition'], diag: 'lawson' },
  { id: 'triple', symbol: 'n·T·τ_E', group: 'performance', related: ['lawson', 'tauE'], diag: 'triple' },
  { id: 'ignition', group: 'performance', related: ['qSci', 'alpha', 'popcon'] },
  { id: 'icfGain', symbol: 'G', group: 'performance', related: ['qSci', 'hohlraum'] },
  { id: 'popcon', symbol: 'POPCON', group: 'performance', related: ['ignition', 'greenwald', 'qSci'] },
  { id: 'powerFlow', symbol: 'P_aux + P_α = P_rad + P_transport + dW/dt', group: 'performance', related: ['alpha', 'radLine', 'transport', 'stored'] },
  // confinement
  { id: 'tauE', symbol: 'τ_E', group: 'confinement', related: ['h98', 'scaling', 'transport'], diag: 'tauE' },
  { id: 'h98', symbol: 'H98', group: 'confinement', related: ['tauE', 'scaling', 'hMode'] },
  { id: 'scaling', symbol: 'IPB98(y,2)', group: 'confinement', related: ['tauE', 'h98'] },
  { id: 'hMode', symbol: 'H-mode', group: 'confinement', related: ['pLH', 'pedestal', 'elm'], diag: 'H_mode' },
  { id: 'pLH', symbol: 'P_LH', group: 'confinement', related: ['hMode', 'nbi'], diag: 'P_LH' },
  { id: 'pedestal', group: 'confinement', related: ['hMode', 'elm'] },
  { id: 'transport', symbol: 'P_transport', group: 'confinement', related: ['tauE', 'elm', 'powerFlow'], diag: 'P_transport' },
  { id: 'stored', symbol: 'dW/dt', group: 'confinement', related: ['powerFlow', 'tauE'], diag: 'dWdt' },
  // limits
  { id: 'greenwald', symbol: 'n_G', group: 'limits', related: ['disruption', 'ip', 'popcon'], diag: 'nG_frac' },
  { id: 'betaN', symbol: 'β_N', group: 'limits', related: ['troyon', 'disruption'], diag: 'betaN' },
  { id: 'troyon', symbol: 'β_N ≈ 3.5', group: 'limits', related: ['betaN', 'disruption'] },
  { id: 'q95', symbol: 'q95', group: 'limits', related: ['ip', 'disruption'], diag: 'q95' },
  { id: 'disruption', group: 'limits', related: ['greenwald', 'troyon', 'q95', 'radiative'] },
  { id: 'radiative', group: 'limits', related: ['tungsten', 'zeff', 'disruption'] },
  { id: 'tungsten', symbol: 'W', group: 'limits', related: ['radiative', 'elm', 'zeff'], diag: 'cZ' },
  // MHD and current
  { id: 'elm', symbol: 'ELM', group: 'mhd', related: ['pedestal', 'hMode', 'divertor'] },
  { id: 'sawtooth', group: 'mhd', related: ['q95', 'ntm'] },
  { id: 'ntm', symbol: 'NTM', group: 'mhd', related: ['sawtooth', 'betaN', 'bootstrap'], diag: 'NTM' },
  { id: 'bootstrap', symbol: 'f_bs', group: 'mhd', related: ['ip', 'ntm'], diag: 'f_bs' },
  { id: 'ip', symbol: 'I_p', group: 'mhd', related: ['q95', 'greenwald', 'ohmic'], diag: 'Ip' },
  // heating and fuel
  { id: 'nbi', symbol: 'P_NBI', group: 'heating', related: ['fastIons', 'pLH', 'fuelMix'] },
  { id: 'icrh', symbol: 'P_ICRH', group: 'heating', related: ['ecrh', 'nbi'] },
  { id: 'ecrh', symbol: 'P_ECRH', group: 'heating', related: ['icrh', 'nbi'] },
  { id: 'ohmic', symbol: 'P_oh', group: 'heating', related: ['ip', 'powerFlow'], diag: 'P_oh' },
  { id: 'alpha', symbol: 'P_α', group: 'heating', related: ['ignition', 'qSci', 'powerFlow'], diag: 'P_alpha' },
  { id: 'fastIons', symbol: 'W_f', group: 'heating', related: ['nbi', 'alpha'], diag: 'Wf' },
  { id: 'fuelMix', symbol: 'n_D/(n_D+n_T)', group: 'heating', related: ['qSci', 'nbi'], diag: 'fuelFracA' },
  // edge, radiation and impurities
  { id: 'divertor', symbol: 'q_div', group: 'edge', related: ['elm', 'radLine'], diag: 'q_div' },
  { id: 'zeff', symbol: 'Z_eff', group: 'edge', related: ['radiative', 'tungsten', 'brems'], diag: 'Zeff' },
  { id: 'heAsh', symbol: 'f_He', group: 'edge', related: ['alpha', 'zeff'], diag: 'fHe' },
  { id: 'wallLoad', symbol: 'n_wall', group: 'edge', related: ['divertor'], diag: 'n_wall' },
  { id: 'brems', symbol: 'P_brems', group: 'edge', related: ['radLine', 'zeff'], diag: 'P_brems' },
  { id: 'sync', symbol: 'P_sync', group: 'edge', related: ['radLine'], diag: 'P_sync' },
  { id: 'radLine', symbol: 'P_rad', group: 'edge', related: ['brems', 'sync', 'radiative'], diag: 'P_rad' },
  // inertial fusion
  { id: 'hohlraum', group: 'icf', related: ['icfGain', 'asymmetry'] },
  { id: 'adiabat', symbol: 'α', group: 'icf', related: ['icfGain'] },
  { id: 'asymmetry', symbol: 'σ_asym', group: 'icf', related: ['icfGain', 'hohlraum'] },
  // devices
  { id: 'tokamak', group: 'devices', related: ['stellarator', 'ip'] },
  { id: 'stellarator', group: 'devices', related: ['tokamak'] },
];

const BY_ID = new Map(GLOSSARY.map((g) => [g.id, g]));

export function findTerm(id: string): GlossaryTerm | undefined { return BY_ID.get(id); }

/** the message keys of a term (typed: the compiler checks them against the dictionary through the tests' key list) */
export function termKeys(id: string): { name: EduKey; def: EduKey } {
  return { name: `gl.${id}.name` as EduKey, def: `gl.${id}.def` as EduKey };
}

/** the term a diagnostic channel belongs to (for the popover on a live value); undefined for channels without one */
export function termOfDiag(diagKey: string): GlossaryTerm | undefined { return GLOSSARY.find((g) => g.diag === diagKey); }
