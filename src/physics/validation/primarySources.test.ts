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
 * The Sauter (2016) low-aspect-ratio q95 constants (geometry.ts q95Sauter) are checked against a secondary quotation: the
 * primary paper (Fusion Eng. Des. 112 (2016) 633, doi:10.1016/j.fusengdes.2016.04.033) could not be retrieved again when the
 * table was reviewed for v4.0 (2026-10-01: the EPFL reprint at crppwww.epfl.ch resets the connection from this machine, the
 * Infoscience record holds metadata and a licence file only, ScienceDirect and ResearchGate are not reachable). What was read is
 * eq. (8) of A. Balestri, J. Ball and S. Coda, "On the feasibility of Ohmically heated negative triangularity tokamak power plants"
 * (arXiv:2407.06439v2, EPFL Swiss Plasma Center; the text of the PDF, main text, not an appendix), which prints
 *   F(κ95, δ95, ε) = 4.1 × 10⁶ (1 + 1.2(κ95 − 1) + 0.56(κ95 − 1)²)(1 + 0.09δ95 + 0.16δ95²)(1 + 0.45δ95 ε)/(1 − 0.74 ε)
 * "used to correctly express the current density in terms of I_p [Sauter 2016] for shaped plasmas", with κ95 and δ95 "the elongation
 * and triangularity at the flux surface enclosing 95 % of the poloidal flux". The paper prints F, not q95: the relation
 * I_p = F a² B/(R q95) is the one q95Sauter inverts, and the constants are the printed ones. That the fit takes the shape of the 95 %
 * surface (and not the separatrix) is the reading of this quotation; the abstract of the primary paper, as found through a search summary,
 * speaks of the effective parameters of the last closed flux surface, so which surface the preset shape values should be
 * is open (the sensitivity is tested below). The primary text stays unverified.
 */
import { describe, expect, it } from 'vitest';
import { q95Sauter } from '../geometry';
import { MASTU } from '../presets';
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

/** F(κ, δ, ε) as printed in eq. (8) of Balestri, Ball and Coda (arXiv:2407.06439v2), restated here on purpose */
const F_PRINTED = (kappa: number, delta: number, eps: number): number =>
  4.1e6 * (1 + 1.2 * (kappa - 1) + 0.56 * (kappa - 1) ** 2) * (1 + 0.09 * delta + 0.16 * delta ** 2) * (1 + 0.45 * delta * eps) / (1 - 0.74 * eps);

describe('Sauter (2016) q95 fit against the printed F(κ95, δ95, ε) of Balestri et al., eq. (8)', () => {
  it('q95Sauter is the inverse of I_p = F a² B/(R q95) with the printed F, for conventional, spherical and negative-triangularity shapes', () => {
    for (const [R, a, kappa, delta, B, Ip] of [
      [0.8, 0.5, 2.1, 0.47, 0.55, 0.75], // MAST-U scenario
      [6.2, 2.0, 1.7, 0.33, 5.3, 15], // ITER (95 % shape)
      [1.85, 0.57, 1.97, 0.54, 12.2, 8.7], // a compact high-field shape
      [5.0, 1.5, 1.5, -0.4, 5.0, 12], // negative triangularity, the case the paper of Sauter 2016 is about
      [0.7, 0.55, 1.0, 0.0, 0.5, 1.0], // circular, ε = 0.79
    ] as const) {
      const q = q95Sauter({ R, a, kappa, delta }, B, Ip);
      const q_printed = (F_PRINTED(kappa, delta, a / R) * a * a * B) / (R * Ip * 1e6);
      expect(q / q_printed, `R ${R} κ ${kappa} δ ${delta}`).toBeCloseTo(1, 12);
    }
  });

  it('the preset of MAST-U gives 6.39 and the fit is 8 % per 0.1 in κ there, so the choice of the surface the shape refers to matters at that level', () => {
    const g = MASTU.geometry;
    const at = (kappa: number) => q95Sauter({ ...g, kappa }, MASTU.B0, MASTU.Ip_MA);
    expect(at(g.kappa)).toBeCloseTo(6.39, 2);
    expect(at(g.kappa + 0.1) / at(g.kappa) - 1).toBeCloseTo(0.081, 2);
    // d ln q95 / dκ = (1.2 + 1.12 (κ − 1)) / (1 + 1.2 (κ − 1) + 0.56 (κ − 1)²)
    const k = g.kappa - 1;
    expect((1.2 + 1.12 * k) / (1 + 1.2 * k + 0.56 * k * k)).toBeCloseTo(0.811, 3);
    // the elongation of the 95 % surface of a D-shaped plasma lies below that of the separatrix: the q95 of the same current is lower
    expect(at(g.kappa - 0.2)).toBeLessThan(at(g.kappa));
  });
});
