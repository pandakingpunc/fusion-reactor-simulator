/**
 * The sentences the 0D models write into the event log and the report are read by people: these checks pin the ones that
 * were wrong (a density with two exponents, "10 MW/m² > 10 MW/m²", a Z-pinch called MTF).
 */
import { describe, expect, it } from 'vitest';
import { runShot } from '../config/run';
import { requirePreset } from '../config/registry';

describe('messages of the 0D models', () => {
  it('prints the stagnation density with one exponent', () => {
    for (const id of ['Z', 'GF', 'FRXL']) {
      const { sim } = runShot(requirePreset(id).cfg);
      const msg = sim.events.find((e) => e.kind === 'stagnation')?.msg ?? '';
      expect(msg, id).toMatch(/n = \d\.\de\d+ m⁻³/);
      expect(msg, id).not.toMatch(/e[+-]?\d+e/);
    }
  });

  it('does not call the sheared-flow Z-pinch MTF', () => {
    const zap = runShot(requirePreset('ZAP').cfg).report.warnings.join('\n');
    expect(zap).toContain('The Z-pinch is far from net energy');
    expect(zap).not.toContain('MTF');
    expect(runShot(requirePreset('GF').cfg).report.warnings.join('\n')).toContain('MTF is far from net energy');
  });

  it('never prints a divertor heat flux equal to the limit it is said to exceed', () => {
    for (const id of ['ITER', 'JT60SA', 'SPARC']) {
      const { sim, report } = runShot(requirePreset(id).cfg);
      const lines = [...sim.events.map((e) => e.msg), ...report.warnings].filter((m) => /ivertor heat flux/.test(m));
      expect(lines.length, id).toBeGreaterThan(0);
      for (const m of lines) {
        const v = Number(/heat flux ([\d.]+) MW\/m² > 10 MW\/m²/.exec(m)?.[1]);
        expect(v, m).toBeGreaterThan(10);
      }
    }
  });
});

describe('the density limit of a stellarator', () => {
  it('is named after Sudo, not Greenwald, in the diagnostic label and in the warning', () => {
    const { sim } = runShot(requirePreset('W7X').cfg);
    expect(sim.model.diagSpecs.find((s) => s.key === 'nG_frac')?.label).toBe('n̄/n_Sudo');
    const warn = sim.events.filter((e) => e.kind === 'warning').map((e) => e.msg).join('\n');
    expect(warn).toContain('n̄/n_Sudo = ');
    expect(warn).not.toContain('n_G');
  });
  it('stays Greenwald in a tokamak', () => {
    const { sim } = runShot(requirePreset('ITER').cfg);
    expect(sim.model.diagSpecs.find((s) => s.key === 'nG_frac')?.label).toBe('n̄/n_Greenwald');
    expect(sim.events.some((e) => e.msg.startsWith('n̄/n_G = '))).toBe(true);
  });
});
