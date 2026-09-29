/**
 * Hooks for later lanes (lane ws2b): confinement scalings as data (ConfinementScalingParams) and the
 * ITPA20 / ITPA20-IL H-mode scalings of Verdoolaege et al., Nucl. Fusion 61 (2021) 076006.
 * The existing scalings must stay bit-for-bit unchanged (values recorded from v4/integration @ 3d04e96).
 */
import { describe, expect, it } from 'vitest';
import {
  CONFINEMENT_SCALINGS, IPB98Y2_PARAMS, ITPA20_IL_PARAMS, ITPA20_PARAMS, pLH_Martin, tauFromParams, tauHmode, tauIPB98y2, tauISS04, tauITER89P,
  tauITPA20, tauITPA20IL, tauSTValovic,
} from '../transport';

const ITER_G = { R: 6.2, a: 2.0, kappa: 1.7, delta: 0.33 };

describe('existing scalings are bitwise unchanged', () => {
  it('IPB98(y,2), ITER89-P, ISS04, ST (Valovič), Martin', () => {
    expect(tauIPB98y2(ITER_G, 15, 5.3, 1.0e20, 100e6, 2.5)).toBe(3.2622945692361656);
    expect(tauITER89P(ITER_G, 15, 5.3, 1.0e20, 100e6, 2.5)).toBe(1.517565597064081);
    expect(tauISS04({ R: 5.5, a: 0.53, kappa: 1, delta: 0 }, 2.5, 0.8e20, 7e6, 0.9, 0.8)).toBe(0.14556055876359475);
    expect(tauSTValovic({ R: 0.85, a: 0.65, kappa: 2.5, delta: 0.5 }, 1, 0.75, 0.4e20, 5e6, 2)).toBe(0.06784486602886657);
    expect(pLH_Martin(1e20, 5.3, 683, 2.5)).toBe(69229821.91554333);
  });
});

describe('ConfinementScalingParams', () => {
  it('the IPB98(y,2) parameter set reproduces tauIPB98y2', () => {
    for (const [Ip, n, P] of [[15, 1e20, 100e6], [3.5, 7e19, 30e6], [8.7, 3e20, 60e6]]) {
      expect(tauFromParams(IPB98Y2_PARAMS, ITER_G, Ip, 5.3, n, P, 2.5) / tauIPB98y2(ITER_G, Ip, 5.3, n, P, 2.5)).toBeCloseTo(1, 12);
    }
    expect(Object.keys(CONFINEMENT_SCALINGS).sort()).toEqual(['IPB98y2', 'ITPA20', 'ITPA20-IL']);
  });

  it('ITPA20 = 0.053 I^0.98 B^0.22 n19^0.24 P^−0.669 R^1.71 (1+δ)^0.36 κ_a^0.80 ε^0.35 M^0.20', () => {
    const [Ip, B, n19, P, M] = [15, 5.3, 10, 100, 2.5];
    const ref = 0.053 * Ip ** 0.98 * B ** 0.22 * n19 ** 0.24 * P ** -0.669 * 6.2 ** 1.71 * 1.33 ** 0.36 * 1.7 ** 0.8 * (2 / 6.2) ** 0.35 * M ** 0.2;
    expect(tauITPA20(ITER_G, Ip, B, n19 * 1e19, P * 1e6, M) / ref).toBeCloseTo(1, 12);
    expect(ITPA20_PARAMS.exponents.P).toBe(-0.669);
  });

  it('ITPA20-IL = 0.067 I^1.29 B^−0.13 n19^0.147 P^−0.644 R^1.19 (1+δ)^0.56 κ_a^0.67 M^0.30 (eq. 5 of Verdoolaege et al. 2021)', () => {
    const [Ip, B, n19, P, M] = [15, 5.3, 10, 100, 2.5];
    const ref = 0.067 * Ip ** 1.29 * B ** -0.13 * n19 ** 0.147 * P ** -0.644 * 6.2 ** 1.19 * 1.33 ** 0.56 * 1.7 ** 0.67 * M ** 0.3;
    expect(tauITPA20IL(ITER_G, Ip, B, n19 * 1e19, P * 1e6, M) / ref).toBeCloseTo(1, 12);
    expect(ITPA20_IL_PARAMS.exponents.eps).toBe(0);
    expect(ITPA20_IL_PARAMS.exponents.n19).toBe(0.147);
  });

  it('tauHmode dispatches on the scaling; the default IPB98(y,2) and ST_Valovic are bitwise the direct calls', () => {
    const args = [15, 5.3, 1.0e20, 100e6, 2.5] as const;
    expect(tauHmode('IPB98y2', ITER_G, ...args)).toBe(tauIPB98y2(ITER_G, ...args));
    expect(tauHmode('ST_Valovic', ITER_G, ...args)).toBe(tauSTValovic(ITER_G, ...args));
    expect(tauHmode('ITPA20', ITER_G, ...args)).toBe(tauITPA20(ITER_G, ...args));
    expect(tauHmode('ITPA20-IL', ITER_G, ...args)).toBe(tauITPA20IL(ITER_G, ...args));
    expect(new Set([tauHmode('IPB98y2', ITER_G, ...args), tauHmode('ITPA20', ITER_G, ...args), tauHmode('ITPA20-IL', ITER_G, ...args)]).size).toBe(3);
  });

  it('for ITER all three H-mode scalings agree within a factor 1.5', () => {
    const t98 = tauIPB98y2(ITER_G, 15, 5.3, 1e20, 100e6, 2.5);
    for (const t of [tauITPA20(ITER_G, 15, 5.3, 1e20, 100e6, 2.5), tauITPA20IL(ITER_G, 15, 5.3, 1e20, 100e6, 2.5)]) {
      expect(t / t98).toBeGreaterThan(0.67);
      expect(t / t98).toBeLessThan(1.5);
    }
  });
});
