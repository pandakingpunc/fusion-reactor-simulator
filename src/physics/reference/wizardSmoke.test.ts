/**
 * Wizard smoke test: every combination of options the setup wizard exposes (src/ui/wizard/schema.ts,
 * sampled with src/testing/wizardCases.ts) must build a configuration and advance the simulation one
 * output step without throwing and with finite diagnostics and state. This is the class of failure
 * of the v3 unsupported-impurity crash: a combination of legal UI choices that no preset exercises.
 *
 * Failures print the minimal (shrunk) set of edits relative to the starting preset and a replay seed.
 * PROP_RUNS=… and PROP_SEED=… widen the search for soak runs.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import type { Method } from '../types';
import { METHOD_INFO } from '../../ui/wizard/schema';
import { WizardCase, buildConfig, showCase, wizardCase } from '../../testing/wizardCases';
import { forAll } from '../../testing/prop';

function smoke(c: WizardCase): void {
  const sim = new Simulation(buildConfig(c));
  sim.advance(sim.model.outputDt);
  const hint = Number.isNaN(sim.t) ? ' — the time itself is NaN: see BUG(ws2a) "NaN step size" in numericsProps.test.ts' : '';
  for (const f of sim.history) {
    for (const [k, v] of Object.entries(f.d)) if (!Number.isFinite(v)) expect.fail(`diagnostic ${k} = ${v} at t = ${f.t}${hint}`);
  }
  sim.y.forEach((v, i) => { if (!Number.isFinite(v)) expect.fail(`state[${i}] = ${v} at t = ${sim.t}${hint}`); });
}

const METHODS = Object.keys(METHOD_INFO) as Method[];
const PROFILE_METHODS: Method[] = ['tokamak', 'spherical_tokamak'];
/** cases per method, sized to keep the file at a few seconds (0D magnetic ≈ 30 ms/case, pulsed < 1 ms) */
const RUNS: Partial<Record<Method, number>> = { tokamak: 40, spherical_tokamak: 40, stellarator: 25 };

describe.each(METHODS)('wizard → %s (0D)', (method) => {
  it('any combination of wizard fields builds and advances one output step with finite results', () => {
    const force = PROFILE_METHODS.includes(method) ? { fidelity: '0D' } : {};
    forAll(wizardCase(method, 0.5, force), smoke, { runs: RUNS[method] ?? 60, show: showCase, maxShrinks: 150, label: `wizard ${method}` });
  });
});

describe.each(PROFILE_METHODS)('wizard → %s (1.5D profiles)', (method) => {
  // 1.5D construction solves the Grad–Shafranov equilibrium (≈ 0.1–2 s at the largest grids): few cases
  it('any combination of wizard fields builds and advances one output step with finite results', () => {
    forAll(wizardCase(method, 0.5, { fidelity: '1.5D' }), smoke, { runs: 3, show: showCase, maxShrinks: 20, label: `wizard ${method} 1.5D` });
  });
});

// BUG(ws2a): minimal wizard combinations (shrunk from random cases) that end with a NaN state and
// t = NaN, with no event and no error: a MAST-U-like ST with R = 0.3 m < a, and SPARC with 7 % tungsten.
// Both are extreme but legal inputs; the cause is the Dormand–Prince step-size control (a trial step's
// stage leaves the RHS domain → NaN error norm → NaN step size → NaN state accepted), pinned at the
// integrator level in numericsProps.test.ts. With that fixed both runs end in an orderly disruption.
describe('pinned wizard counterexamples', () => {
  const pinned: WizardCase[] = [
    { method: 'spherical_tokamak', preset: 'MASTU', edits: { 'geometry.R': 0.3, 'geometry.kappa': 1.1, 'impurity.species': 'W', 'transport.tau_p_over_tau_E': 0.5, fidelity: '0D' } },
    { method: 'tokamak', preset: 'SPARC', edits: { 'impurity.concentration': 0.07, 'impurity.W_source_frac': 0.44, fidelity: '0D' } },
  ];
  it.each(pinned.map((c) => [showCase(c), c] as const))('builds a configuration without throwing: %s', (_label, c) => {
    expect(() => new Simulation(buildConfig(c))).not.toThrow();
  });
  it.fails.each(pinned.map((c) => [showCase(c), c] as const))('BUG(ws2a) NaN step size — stays finite: %s', (_label, c) => {
    smoke(c);
  });
});
