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
import type { MagneticConfig, Method, ReactorConfig } from '../types';
import { METHOD_INFO, PRESETS, setPath } from '../../ui/wizard/schema';
import { NONE, WizardCase, buildConfig, canBlank, fieldArbitrary, showCase, wizardCase, wizardFields } from '../../testing/wizardCases';
import { forAll, mulberry32 } from '../../testing/prop';
import { INTEGRATOR_FIXED } from '../../testing/knownBugs';
import { pinUntil } from '../../testing/pinUntil';

/**
 * Integrator steps allowed for one output step: typical cases need ~20, the largest regular ones
 * ~6000 (a 4000 s DEMO-like shot); a stiff stall at dtMin runs to 10⁵–10⁶ steps and freezes the UI
 * worker for tens of seconds (see the density-collapse finding below).
 */
const STEP_BUDGET = 20000;

/** advance one output step (in `slices` calls, so that a stalled integration is stopped by the budget) */
function smoke(c: WizardCase, slices = 20): void {
  const sim = new Simulation(buildConfig(c));
  const tOut = sim.t + sim.model.outputDt;
  for (let k = 0; k < slices && sim.t < tOut - 1e-12 && !sim.done; k++) {
    sim.advance(sim.model.outputDt / slices);
    if (sim.nSteps > STEP_BUDGET) expect.fail(`integration stalled: ${sim.nSteps} steps before t = ${sim.t} (output step ${sim.model.outputDt})`);
  }
  const hint = Number.isNaN(sim.t) && !INTEGRATOR_FIXED ? ' — the time itself is NaN: see BUG(ws2a) "NaN step size" in numericsProps.test.ts' : '';
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
  }, 120_000);
});

describe.each(PROFILE_METHODS)('wizard → %s (1.5D profiles)', (method) => {
  // 1.5D construction solves the Grad–Shafranov equilibrium (≈ 0.1–2 s at the largest grids): few cases
  it('any combination of wizard fields builds and advances one output step with finite results', () => {
    forAll(wizardCase(method, 0.5, { fidelity: '1.5D' }), smoke, { runs: 3, show: showCase, maxShrinks: 20, label: `wizard ${method} 1.5D` });
  }, 120_000);
});

// BUG(ws2a): minimal wizard combinations (shrunk from random cases) that end with a NaN state and
// t = NaN, with no event and no error: a MAST-U-like ST with R = 0.3 m < a, and SPARC with 7 % tungsten.
// Both are extreme but legal inputs; the cause is the Dormand–Prince step-size control (a trial step's
// stage leaves the RHS domain → NaN error norm → NaN step size → NaN state accepted), pinned at the
// integrator level in numericsProps.test.ts. With that fixed both runs end in an orderly disruption.
// ws5 fixed it in dafd2bf (on v4/integration); with that integrator these cases run as plain tests.
describe('pinned wizard counterexamples', () => {
  const pinned: WizardCase[] = [
    { method: 'spherical_tokamak', preset: 'MASTU', edits: { 'geometry.R': 0.3, 'geometry.kappa': 1.1, 'impurity.species': 'W', 'transport.tau_p_over_tau_E': 0.5, fidelity: '0D' } },
    { method: 'tokamak', preset: 'SPARC', edits: { 'impurity.concentration': 0.07, 'impurity.W_source_frac': 0.44, fidelity: '0D' } },
  ];
  it.each(pinned.map((c) => [showCase(c), c] as const))('builds a configuration without throwing: %s', (_label, c) => {
    expect(() => new Simulation(buildConfig(c))).not.toThrow();
  });
  // one advance() call, as the UI and CLI do: slicing the step changes the trial step sizes
  pinUntil(INTEGRATOR_FIXED).each(pinned.map((c) => [showCase(c), c] as const))('BUG(ws2a) NaN step size — stays finite: %s', (_label, c) => {
    smoke(c, 1);
  });
});

describe('pinned wizard findings beyond one output step', () => {
  // BUG(ws2a): "Max. fueling rate" = 0 (the control's minimum) lets the density decay without end while
  // the heating stays on: W7-X passes T_e = 1 MeV at t ≈ 0.66 s (n_e ≈ 2e15 m⁻³) and reaches n_e ≈ 1e11 m⁻³,
  // T_e ≈ 5e5 keV at t ≈ 1 s; nothing terminates
  // the shot, the integrator is then pinned at dtMin (20 000 steps per 20 ms output step, the UI worker
  // stalls) and the state overflows to NaN at t ≈ 1.39 s after ~30 s of wall time. A density-collapse
  // termination (or a floor) is missing. Checked cheaply here through the unphysical temperature.
  it.fails('BUG(ws2a) density collapse — W7-X without fuelling keeps T_e, T_i below 1 MeV up to 1.05 s', () => {
    const sim = new Simulation(buildConfig({ method: 'stellarator', preset: 'W7X', edits: { 'fueling.maxRate_1e20s': 0 } }));
    while (sim.t < 1.05 && !sim.done) sim.advance(0.05);
    for (const f of sim.history) {
      if (!(f.d.Te < 1000 && f.d.Ti < 1000)) expect.fail(`t = ${f.t}: T_e = ${f.d.Te} keV, T_i = ${f.d.Ti} keV, n_e = ${f.d.ne}e20 m⁻³`);
    }
  }, 30_000);

  // BUG(ws2a): the geometry controls allow a minor radius larger than the major radius (a ∈ [0.1, 4] m,
  // R ∈ [0.3, 12] m, no cross-check). In 1.5D the kernels then throw internal, Turkish-language errors
  // ("GS: eksende ψ ≤ 0 — çözüm ıraksadı", "solveTridiag: sıfır pivot") instead of the wizard or the
  // model rejecting the impossible torus with a clear message. On v4/integration (ws4, ws3) the 1.5D
  // model now refuses it with a typed EquilibriumInitFailure quoting "Grad–Shafranov (bad-input): need …
  // R − a(1 + margin) > 0" (integrity.test.ts); the wizard still offers the combination (no cross-field
  // check) and the run still throws, so the pin still holds there.
  it.fails('BUG(ws2a) 1.5D with a > R — no internal solver error (MAST-U, a = 2 m, R = 0.85 m)', () => {
    const c: WizardCase = { method: 'spherical_tokamak', preset: 'MASTU', edits: { fidelity: '1.5D', 'geometry.a': 2 } };
    expect(() => { const sim = new Simulation(buildConfig(c)); sim.advance(sim.model.outputDt); }).not.toThrow();
  });
});

describe('blank wizard fields', () => {
  const presetCfg = (id: string): ReactorConfig => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) throw new Error(`unknown preset ${id}`);
    return p.cfg;
  };
  /** frames recorded over one output step (a throw propagates) */
  const oneStep = (cfg: ReactorConfig) => {
    const sim = new Simulation(cfg);
    sim.advance(sim.model.outputDt);
    return sim.history;
  };
  /** two runs record the same frames with the same finite diagnostics (within 1e-12 relative) */
  const expectSameRun = (got: Simulation['history'], want: Simulation['history']) => {
    expect(got.length, 'frames').toBe(want.length);
    want.forEach((w, i) => {
      const g = got[i];
      expect(g.t, `t of frame ${i}`).toBe(w.t);
      expect(Object.keys(g.d).sort(), `diagnostics of frame ${i}`).toEqual(Object.keys(w.d).sort());
      for (const [k, v] of Object.entries(w.d)) {
        const x = g.d[k];
        const ok = Number.isFinite(v) && Number.isFinite(x) && Math.abs(x - v) <= 1e-12 * Math.max(Math.abs(v), 1e-300);
        if (!ok) expect.fail(`frame ${i} (t = ${w.t}): ${k} = ${x}, expected ${v}`);
      }
    });
  };

  it('the generator leaves blank exactly the number fields the wizard can leave blank', () => {
    const r = mulberry32(0x5eed2a);
    for (const method of ['tokamak', 'stellarator'] as Method[]) {
      for (const f of wizardFields(method)) {
        if ((f.type ?? 'number') !== 'number') continue;
        const arb = fieldArbitrary(f);
        let blanks = 0;
        for (let i = 0; i < 200; i++) if (arb.generate(r) === NONE) blanks++;
        if (canBlank(f)) expect(blanks, `${f.path}: blanks in 200 draws`).toBeGreaterThan(20);
        else expect(blanks, `${f.path}: blanks in 200 draws`).toBe(0);
      }
    }
  });

  // blank is a documented setting of these fields (their wizard hints): it runs as the value it stands for
  it('documented blanks: seeding c_s blank = 0 (ITER), LCFS κ and δ blank = geometry κ and δ (ITER 1.5D)', () => {
    const iter = presetCfg('ITER');
    expect((iter as MagneticConfig).impurity.seedSpecies).toBeTruthy();
    expectSameRun(oneStep(setPath(iter, 'impurity.seedConcentration', undefined)), oneStep(setPath(iter, 'impurity.seedConcentration', 0)));
    const iter15 = presetCfg('ITER15'), g = (iter15 as MagneticConfig).geometry;
    const lcfs = (k: unknown, d: unknown) => setPath(setPath(iter15, 'profiles.lcfsKappa', k), 'profiles.lcfsDelta', d);
    expectSameRun(oneStep(lcfs(undefined, undefined)), oneStep(lcfs(g.kappa, g.delta)));
  });

  // Was BUG(ws2a), fixed in profileSettings() (profiles/context.ts) by ws3d. A
  // blank number input stores undefined and RUN is allowed for fields with a model default (`def`);
  // ProfileModel used to let the undefined override DEFAULT_PROFILE_SETTINGS: one output step of each
  // single-field blank over every magnetic preset (0D and 1.5D; v4/integration af38dbe) failed 131 of 261
  // times — "solveBlockTridiag2: tekil blok" for χ shape, χ_i/χ_e, D/χ_e, stiffness, R/L_T crit, ECRH ρ and
  // width, ICRH width, NBI R_tan, n_sep; "Invalid array length" for N_ρ; T_ped = undefined for the pedestal
  // width. Reproduction: setPath(ITER15, 'profiles.DoverChi', undefined), then advance one output step.
  it('blank 1.5D fields with a model default run exactly as that default (MAST-U 1.5D; was BUG(ws2a))', () => {
    const fields = wizardFields('spherical_tokamak').filter((f) => (f.type ?? 'number') === 'number' && f.def !== undefined);
    expect(fields.length).toBeGreaterThan(10);
    const base = setPath(presetCfg('MASTU'), 'fidelity', '1.5D');
    const blank = fields.reduce((c, f) => setPath(c, f.path, undefined), base);
    const dflt = fields.reduce((c, f) => setPath(c, f.path, f.def), base);
    expectSameRun(oneStep(blank), oneStep(dflt));
  });
});
