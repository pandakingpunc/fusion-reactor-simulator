/**
 * The v4 captions of the paper figures: what they say about the model and the run is computed from the run, not typed in, and a statement
 * the figure cannot support is not made. These tests pin the sentences that carry a number or a claim (the grid and the time stepper, the
 * rational surfaces that panel 2c marks, the points outside the validation bands, the NTM islands, the cells of the scan that are blank
 * or black) on the synthetic context, where the inputs are known.
 */
import { describe, expect, it } from 'vitest';
import { PAPER_FIGURES, model15Text, SCAN_COLD_Q } from './paper';
import { rationalSurface } from './profiles';
import { syntheticPaperCtx } from './testdata/synthetic';

const spec = (id: string) => PAPER_FIGURES.find((s) => s.id === id)!;
const ctx = syntheticPaperCtx(3);

describe('model15Text: the 1.5D model in one sentence, from the settings of the run', () => {
  it('names the TR-BDF2 stepper, the tolerance, the conservative remap and the packed grid with its ratio of cell widths', () => {
    const t = model15Text({ nRho: 50, gridPacking: 4, rtol: 1e-2 });
    expect(t).toContain('50 finite-volume cells');
    expect(t).toContain('packed towards the edge');
    expect(t).toContain('5 times narrower');
    expect(t).toContain('TR-BDF2');
    expect(t).toContain('tolerance 0.01');
    expect(t).toContain('remapped conservatively');
  });

  it('a uniform grid (gridPacking 0, or none: the v3 grid) is described as uniform, and the tolerance falls back to the default', () => {
    for (const ps of [{ nRho: 40, gridPacking: 0 }, { nRho: 40 }]) {
      const t = model15Text(ps);
      expect(t).toContain('40 uniform finite-volume cells');
      expect(t).not.toContain('packed');
      expect(t).toContain('tolerance 0.01');
    }
  });

  it('the equilibrium caption carries it, with the numbers of the run', () => {
    expect(spec('equilibrium').build(ctx).caption).toContain('50 finite-volume cells in ρ_tor packed towards the edge');
  });
});

describe('rationalSurface: where q crosses a rational value', () => {
  const rho = [0, 0.25, 0.5, 0.75, 1];
  it('interpolates linearly between the cells', () => {
    expect(rationalSurface(rho, [1, 1.2, 1.6, 2.2, 3], 1.5)).toBeCloseTo(0.25 + 0.25 * ((1.5 - 1.2) / 0.4), 12);
  });
  it('is NaN where q never reaches the value (a plateau that stays just above 1 has no q = 1 surface)', () => {
    expect(rationalSurface(rho, [1.02, 1.03, 1.3, 1.9, 3], 1)).toBeNaN();
  });
  it('takes the outermost crossing', () => {
    expect(rationalSurface(rho, [1.2, 0.9, 1.1, 1.6, 2], 1)).toBeCloseTo(0.25 + 0.25 * ((1 - 0.9) / 0.2), 12);
  });
});

describe('profile caption: only the rational surfaces that are marked are named', () => {
  it('lists the surfaces q crosses, with their radius, and says so for those it does not', () => {
    const c = spec('profiles').build(ctx).caption;
    const q = ctx.iter!.sim.history.filter((h) => h.prof).slice(-1)[0].prof!.q;
    const crosses = (v: number) => Number.isFinite(rationalSurface(ctx.iter!.sim.history.filter((h) => h.prof).slice(-1)[0].prof!.rho, q, v));
    for (const [v, lbl] of [[1, '1'], [1.5, '3/2'], [2, '2']] as const) {
      if (crosses(v)) expect(c).toContain(`q = ${lbl} (ρ_tor = `);
      else expect(c).toContain(`q does not cross`);
    }
    expect(c).not.toContain('with the q = 1, 3/2, 2 rational surfaces');
  });
});

describe('validation caption: the points outside the ±30% band are those drawn outside it', () => {
  it('names each row with a value below 0.7 or above 1.3 of the reference, and none inside', () => {
    const c = spec('validation').build(ctx).caption;
    const sentence = c.match(/Outside the ±30% band: (.+?\))\.(?: |\n)/);
    const none = c.includes('Every value lies inside the ±30% band');
    expect(Boolean(sentence) !== none).toBe(true);
    // the table lists the ratios: the rows named in the sentence are exactly the rows with a ratio outside 0.7 to 1.3
    const rows = c.split('\n').filter((l) => /^\| .* \| .* \| (—|[\d.]+) \| (—|[\d.]+) \|$/.test(l) && !l.includes('0D ratio'));
    const out = rows.filter((l) => l.split('|').slice(3, 5).some((x) => /^\s*[\d.]+\s*$/.test(x) && (Number(x) < 0.7 || Number(x) > 1.3)));
    if (sentence) expect(sentence[1].split(';').length).toBe(out.length);
    else expect(out.length).toBe(0);
  });
});

describe('MHD caption: the NTM islands', () => {
  it('says that an island that never opens does not open, instead of a width of 0.000', () => {
    const c = spec('mhd').build(ctx).caption;
    expect(c).not.toContain('w/a = 0.000');
    expect(c).toMatch(/the \(2,1\) island (does not open|reaches w\/a = 0\.\d{3})/);
  });
});

describe('scan caption', () => {
  it('names the flat-top Q below which a finished discharge is called out as black', () => {
    expect(SCAN_COLD_Q).toBeGreaterThan(0);
    expect(SCAN_COLD_Q).toBeLessThan(0.5);
  });
  it('explains the blank cells by the reasons the runs stopped', () => {
    const c = spec('scan').build(ctx).caption;
    expect(c).toContain('ended early');
    expect(c).toContain('are left blank (white)');
  });
});
