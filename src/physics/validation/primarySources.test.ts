/**
 * Coefficient provenance: the ITPA20 and ITPA20-IL confinement scalings of src/physics/transport.ts
 * compared with the primary paper.
 *
 * Source read (2026-09-29): G. Verdoolaege et al., "The updated ITPA global H-mode confinement database:
 * description and analysis", Nucl. Fusion 61 (2021) 076006, doi:10.1088/1741-4326/abdb91 — the accepted
 * manuscript of January 2021 held by the Ghent University repository (biblio.ugent.be/download/8679315/8750366).
 * It gives, for the standard set DB5.2.3-STD5 of ELMy H-modes:
 *   eq. (5)   ITPA20-IL, the ITER-like subset, WLS estimates of table 10 (also table 17, row 'All');
 *   eq. (7)   ITPA20, the whole standard set, WLS estimates of table 16;
 *   p. 17     the ITER baseline point (I_p 15 MA, B_t 5.3 T, n̄_e 10.3e19 m⁻³, P_l,th 87 MW, R 6.2 m,
 *             δ 0.48, κ_a 1.7, ε 0.32, M_eff 2.5) and p. 40–41 the predictions there:
 *             ITPA20-IL 2.90 ± 0.46 s (2.65 ± 0.42 s at P_l,th = 100 MW), ITPA20 3.07 ± 0.46 s (2.79 ± 0.42 s).
 * The variables are I_p [MA], B_t [T], the central line-averaged n̄_e [10¹⁹ m⁻³], the thermal loss power P_l,th
 * through the LCFS [MW], R_geo [m], the average LCFS triangularity δ, κ_a = V/(2π R_geo a²), ε = a/R_geo and
 * M_eff [amu]: the units and definitions of tauFromParams.
 *
 * Every coefficient of the code is the printed number of eq. (5) and (7). (ws2b rounded the n̄_e exponent of ITPA20-IL to 0.15,
 * the value of secondary quotations and of the UKAEA PROCESS documentation; eq. (5) of the manuscript and table 10 give
 * 0.147 / 0.1473, and since v4.0 the code has 0.147: 0.003 in the exponent is 0.7 % in τ_E at n̄ = 10²⁰ m⁻³.)
 *
 * The Sauter (2016) low-aspect-ratio q95 constants are not covered here: the primary paper (Fusion Eng. Des.
 * 112 (2016) 633, doi:10.1016/j.fusengdes.2016.04.033) could not be retrieved, only its transcriptions in the
 * PROCESS documentation and arXiv:2407.06439 App. A, eq. (8) (F(κ95, δ95, ε), which prints the same constants for the
 * 95 % surface); they stay unverified against the primary text.
 */
import { describe, expect, it } from 'vitest';
import { ITPA20_IL_PARAMS, ITPA20_PARAMS, tauFromParams, tauITPA20, tauITPA20IL, type ConfinementScalingParams } from '../transport';

/** eq. (7) and table 16 (WLS), engineering variables */
const ITPA20_PRINTED = { C: 0.053, Ip: 0.98, B: 0.22, n19: 0.24, P: -0.669, R: 1.71, onePlusDelta: 0.36, kappa: 0.80, eps: 0.35, M: 0.20 };
const ITPA20_TABLE16 = { C: 0.0534, Ip: 0.976, B: 0.218, n19: 0.2442, P: -0.6687, R: 1.710, onePlusDelta: 0.362, kappa: 0.799, eps: 0.354, M: 0.195 };
/** eq. (5) and table 10 (WLS); ε is not a predictor of ITPA20-IL */
const ITPA20_IL_PRINTED = { C: 0.067, Ip: 1.29, B: -0.13, n19: 0.147, P: -0.644, R: 1.19, onePlusDelta: 0.56, kappa: 0.67, eps: 0, M: 0.30 };
const ITPA20_IL_TABLE10 = { C: 0.0670, Ip: 1.291, B: -0.134, n19: 0.1473, P: -0.6442, R: 1.194, onePlusDelta: 0.560, kappa: 0.673, eps: 0, M: 0.302 };

/** the parameters of a scaling in the key names of the tables above */
const flat = (s: ConfinementScalingParams) => ({ C: s.C, ...s.exponents });

describe('ITPA20 and ITPA20-IL against Verdoolaege et al. 2021 (eq. 5 and 7, tables 10 and 16)', () => {
  it('ITPA20 is eq. (7) as printed', () => {
    expect(flat(ITPA20_PARAMS)).toEqual(ITPA20_PRINTED);
  });

  it('ITPA20-IL is eq. (5) as printed, the n̄_e exponent included (0.147)', () => {
    expect(flat(ITPA20_IL_PARAMS)).toEqual(ITPA20_IL_PRINTED);
    expect(ITPA20_IL_PARAMS.exponents.n19).toBe(0.147);
  });

  it('every printed number is the table estimate rounded to the printed digits', () => {
    for (const [printed, table] of [[ITPA20_PRINTED, ITPA20_TABLE16], [ITPA20_IL_PRINTED, ITPA20_IL_TABLE10]] as const) {
      for (const k of Object.keys(printed) as (keyof typeof printed)[]) {
        // the prefactor is printed with 2 significant digits, the exponents with 2–3 decimals
        const tol = k === 'C' ? 0.00051 : 0.00501; // half a unit of the last printed digit
        expect(Math.abs(printed[k] - table[k]), k).toBeLessThanOrEqual(tol);
      }
    }
  });

  // the paper's ITER baseline point; the code takes the areal elongation as geometry.kappa and the LCFS triangularity as delta
  const ITER = { g: { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.48 }, Ip: 15, B: 5.3, n: 10.3e19, M: 2.5 };
  const tau = (f: typeof tauITPA20, P_MW: number) => f(ITER.g, ITER.Ip, ITER.B, ITER.n, P_MW * 1e6, ITER.M);

  it('reproduces the published ITER predictions to the rounding of the printed coefficients (1.5 %; the header of transport.ts quotes 3.07 s and 2.90 s)', () => {
    expect(Math.abs(tau(tauITPA20, 87) / 3.07 - 1)).toBeLessThan(0.015);
    expect(Math.abs(tau(tauITPA20, 100) / 2.79 - 1)).toBeLessThan(0.015);
    expect(Math.abs(tau(tauITPA20IL, 87) / 2.90 - 1)).toBeLessThan(0.015);
    expect(Math.abs(tau(tauITPA20IL, 100) / 2.65 - 1)).toBeLessThan(0.015);
  });

  it('the 95 % triangularity of the presets (0.33) instead of the LCFS value (0.48) would lower τ_E by 3.8 % (ITPA20) and 5.8 % (ITPA20-IL)', () => {
    const at = (f: typeof tauITPA20, delta: number) => f({ ...ITER.g, delta }, ITER.Ip, ITER.B, ITER.n, 87e6, ITER.M);
    expect(1 - at(tauITPA20, 0.33) / at(tauITPA20, 0.48)).toBeCloseTo(0.038, 3);
    expect(1 - at(tauITPA20IL, 0.33) / at(tauITPA20IL, 0.48)).toBeCloseTo(0.058, 3);
  });

  it('with the full-precision estimates of tables 10 and 16 the ITER predictions agree within 0.5 %', () => {
    const asParams = (t: typeof ITPA20_TABLE16): ConfinementScalingParams => ({
      C: t.C, ref: 'table', exponents: { Ip: t.Ip, B: t.B, n19: t.n19, P: t.P, R: t.R, kappa: t.kappa, eps: t.eps, M: t.M, onePlusDelta: t.onePlusDelta },
    });
    const at = (p: ConfinementScalingParams) => tauFromParams(p, ITER.g, ITER.Ip, ITER.B, ITER.n, 87e6, ITER.M);
    expect(Math.abs(at(asParams(ITPA20_TABLE16)) / 3.067 - 1)).toBeLessThan(0.005); // table 16: 3.067 s
    expect(Math.abs(at(asParams(ITPA20_IL_TABLE10)) / 2.902 - 1)).toBeLessThan(0.005); // table 10: 2.902 s
  });
});
