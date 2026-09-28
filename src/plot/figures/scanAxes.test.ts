/**
 * The operating-space scan (Fig. 9) is normalised to the Greenwald density of the LINE-averaged
 * electron density: the 0D `n_target` is a volume average, so the scan converts it with
 * lineAverageFactor. After ws2b (Greenwald fraction and confinement at the line average) a scan
 * column labelled n̄_e/n_G = 1.0 must sit on the density limit, not 10 % below it.
 */
import { describe, expect, it } from 'vitest';
import { ITER } from '../../physics/presets';
import { greenwaldDensity, lineAverageFactor } from '../../physics/limits';
import { PAPER_FIGURES, scanAxes, scanBaselineX, scanConfig } from './paper';

const nG = greenwaldDensity(ITER.Ip_MA, ITER.geometry.a); // m^-3
const fLine = lineAverageFactor(ITER.transport.alpha_n);

describe('Fig. 9 scan axes', () => {
  it('the x axis is the line-averaged density over the Greenwald density', () => {
    const N = 7;
    const { sx } = scanAxes(N);
    expect(sx[0]).toBeCloseTo(0.5, 12);
    expect(sx[N - 1]).toBeCloseTo(1.0, 12);
    for (let i = 0; i < N; i++) {
      const cfg = scanConfig(N, i, 0);
      expect((cfg.n_target * fLine) / nG).toBeCloseTo(sx[i], 10);
    }
  });

  it('the last column is at the density limit and needs a volume average below n_G', () => {
    const cfg = scanConfig(5, 4, 0);
    expect(cfg.n_target).toBeLessThan(nG);
    expect(cfg.n_target * fLine).toBeCloseTo(nG, 3);
    expect(fLine).toBeGreaterThan(1.05); // ITER alpha_n = 0.3: about 1.10
  });

  it('the ITER baseline marker uses the same conversion as the columns', () => {
    expect(scanBaselineX()).toBeCloseTo((ITER.n_target * fLine) / nG, 12);
    const x = scanBaselineX();
    expect(x).toBeGreaterThan(0.85);
    expect(x).toBeLessThan(0.95); // 0.92 for the 1.0e20 m^-3 volume average of the preset
  });

  it('only the density axis changes; H98 and the shot length are as before', () => {
    const { sy } = scanAxes(5);
    const cfg = scanConfig(5, 2, 3);
    expect(cfg.H98).toBe(sy[3]);
    expect(cfg.t_end).toBe(150);
  });

  it('the scan figure records the density basis in its canonical inputs (the provenance hash changes with it)', () => {
    const scan = PAPER_FIGURES.find((s) => s.id === 'scan')!;
    const inp = scan.inputs({ scan: 5 } as never) as { config: { scan: { nBasis?: string } } };
    expect(inp.config.scan.nBasis).toBe('line-averaged');
  });
});
