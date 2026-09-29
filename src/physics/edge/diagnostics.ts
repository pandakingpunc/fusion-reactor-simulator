/**
 * Edge diagnostics of the magnetic models: the time-trace channels, their values from a solution, and the
 * entries of the shot report.
 */
import type { DiagSpec, MagneticConfig } from '../types';
import { Geometry } from '../geometry';
import { edgePlasma0D, edgeSetup } from './config';
import { DETACHMENT_LABELS, detachmentState } from './detachment';
import { EdgeResult, solveEdge } from './solve';

export const EDGE_DIAGS: DiagSpec[] = [
  { key: 'P_sep_R', label: 'P_sep / R', unit: 'MW/m', group: 'Edge' },
  { key: 'lambda_q', label: 'λ_q (Eich #14)', unit: 'mm', group: 'Edge' },
  { key: 'T_u', label: 'T_e,sep (two-point)', unit: 'eV', group: 'Edge' },
  { key: 'T_t', label: 'T_e at the target (two-point)', unit: 'eV', group: 'Edge', log: true },
  { key: 'q_peak', label: 'Peak target heat flux (two-point)', unit: 'MW/m²', group: 'Edge' },
  { key: 'f_pwr', label: 'Power loss of the outer leg', unit: '', group: 'Edge' },
  { key: 'detach', label: 'Detachment (0 attached, 1 partial, 2 detached)', unit: '', group: 'Edge' },
  { key: 'cz_det', label: 'c_z for detachment (Lengyel)', unit: '', group: 'Edge', log: true },
  { key: 'q_det', label: 'Detachment qualifier q_det (Kallenbach)', unit: '', group: 'Edge', log: true },
  { key: 'p_div', label: 'Divertor neutral pressure for n_sep (Kallenbach)', unit: 'Pa', group: 'Edge', log: true },
];

/**
 * Values of the channels of EDGE_DIAGS. c_z for detachment is shown up to 1: a concentration of one or more (impurity as
 * abundant as the fuel) means that the model finds no attainable seeding, as the cooling function is deficient below 100 eV
 * (lengyel.ts); the unclipped value is in EdgeResult.cz_det.
 */
export function edgeDiagValues(r: EdgeResult): Record<string, number> {
  return {
    P_sep_R: r.P_sep_R, lambda_q: r.lambda_q_mm, T_u: r.T_u, T_t: r.T_t, q_peak: r.q_peak, f_pwr: r.f_pwr,
    detach: r.state, cz_det: Math.min(r.cz_det, 1), q_det: r.q_det, p_div: r.p_div,
  };
}

/**
 * Edge channels of the 0D model at the given state: P_sep [W], plasma current [A], volume-average electron density
 * [m⁻³], mean fuel ion mass [amu]. Call with a tokamak or spherical-tokamak configuration.
 */
export function edgeDiagnostics(cfg: MagneticConfig, g: Geometry, P_sep: number, Ip_A: number, ne_vol: number, M_amu: number): Record<string, number> {
  return edgeDiagValues(solveEdge(edgePlasma0D(cfg, g, P_sep, Ip_A, ne_vol, M_amu), edgeSetup(cfg).par));
}

/** Entries of the report's engineering table from the flat-top means of the channels; empty if the history has none */
export function edgeReportEntries(mean: (key: string) => number, has: boolean): Record<string, number | string> {
  if (!has) return {};
  const Tt = mean('T_t'), cz = mean('cz_det');
  return {
    'P_sep/R (MW/m)': +mean('P_sep_R').toFixed(1),
    'Target T_e, two-point (eV)': +Tt.toFixed(1),
    'Target q_peak, two-point (MW/m²)': +mean('q_peak').toFixed(1),
    'Detachment state': DETACHMENT_LABELS[detachmentState(Tt)],
    'c_z for detachment, Lengyel upper bound (%)': Number.isFinite(cz) ? +(100 * cz).toFixed(2) : 'n/a',
  };
}
