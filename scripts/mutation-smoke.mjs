#!/usr/bin/env node
// Mutation smoke test for the physics test suite.
//
// Copies src/ (and the vitest/TypeScript configuration) into a temporary directory OUTSIDE the
// repository, then applies one single-token mutant at a time to a core physics formula, runs the
// vitest files that are supposed to guard that formula, and restores the file. A mutant is
// "killed" when those tests fail and "survived" when they still pass — a survivor marks a formula
// the tests do not pin down. The repository itself is never modified; node_modules is reached
// through a directory junction (Windows) / symlink that is removed without touching its target.
//
// Usage:  node scripts/mutation-smoke.mjs [--only M1,M4] [--keep] [--threads N]
//   --only     run only these mutant ids
//   --keep     keep the temporary directory (its path is printed)
//   --threads  vitest workers per run (default 2)
// Exit codes: 0 all mutants killed; 1 at least one survived; 2 setup error (baseline failing,
// a mutant's search text not found exactly once, bad arguments).
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REF = 'src/physics/reference';
const PROF = 'src/physics/profiles';
// test files that guard the v4 numerics (short ones: a mutant of the 1.5D model runs each of them once)
const TRBDF2 = `${PROF}/solver/trbdf2.test.ts`, STEP = `${PROF}/solver/coupledStep.test.ts`, ENERGY = `${PROF}/energy.test.ts`, IPRAMP = `${PROF}/currentDiffusion.test.ts`;
const ANDERSON = 'src/physics/numerics/anderson.test.ts', NUM = 'src/physics/numerics/numerics.test.ts', EDGE = 'src/physics/edge/twoPoint.test.ts', EDGE_SOLVE = 'src/physics/edge/solve.test.ts';
const TF = 'src/physics/systems/tfCoil.test.ts', TF_STATE = 'src/physics/systems/tfStressState.test.ts', GS = 'src/physics/equilibrium/gs.test.ts', OUTER = `${PROF}/coupling/outer.test.ts`;

/** each mutant replaces `find` (which must occur exactly once in `file`) by `replace` */
const MUTANTS = [
  { id: 'M1', file: 'src/physics/reactivity.ts', what: 'Bosch–Hale reactivity: exp(−3ξ) → exp(−2.9ξ)',
    find: 'Math.sqrt(xi / (c.mrc2 * T * T * T)) * Math.exp(-3 * xi)', replace: 'Math.sqrt(xi / (c.mrc2 * T * T * T)) * Math.exp(-2.9 * xi)', tests: [`${REF}/reactivity.test.ts`] },
  { id: 'M2', file: 'src/physics/reactivity.ts', what: 'cross-section Gamow factor: exp(B_G/√E) → exp(B_G/∛E)',
    find: 'Math.exp(c.BG / Math.sqrt(E))', replace: 'Math.exp(c.BG / Math.cbrt(E))', tests: [`${REF}/reactivity.test.ts`] },
  { id: 'M3', file: 'src/physics/reactivity.ts', what: 'beam-target c.m. energy: E m_t/(m_b+m_t) → E m_b/(m_b+m_t)',
    find: '(E * mt) / (mb + mt)', replace: '(E * mb) / (mb + mt)', tests: [`${REF}/reactivity.test.ts`] },
  { id: 'M4', file: 'src/physics/transport.ts', what: 'IPB98(y,2) current exponent 0.93 → 0.83',
    find: 'Math.pow(Ip_MA, 0.93)', replace: 'Math.pow(Ip_MA, 0.83)', tests: [`${REF}/transport.test.ts`] },
  { id: 'M5', file: 'src/physics/transport.ts', what: 'Martin 2008 isotope factor 2/M → 2.5/M',
    find: '* (2 / M);', replace: '* (2.5 / M);', tests: [`${REF}/transport.test.ts`] },
  { id: 'M6', file: 'src/physics/radiation.ts', what: 'bremsstrahlung prefactor 5.35e-37 → 5.35e-36',
    find: 'return 5.35e-37 * ne', replace: 'return 5.35e-36 * ne', tests: [`${REF}/radiation.test.ts`] },
  { id: 'M7', file: 'src/physics/radiation.ts', what: 'synchrotron wall-reflection exponent (1−R)^0.62 → ^0.26',
    find: 'Math.pow(1 - Rw, 0.62)', replace: 'Math.pow(1 - Rw, 0.26)', tests: [`${REF}/radiation.test.ts`] },
  { id: 'M8', file: 'src/physics/heating.ts', what: 'Stix critical energy exponent 2/3 → 3/2',
    find: 'Math.pow(ionSum, 2 / 3)', replace: 'Math.pow(ionSum, 3 / 2)', tests: [`${REF}/heating.test.ts`] },
  { id: 'M9', file: 'src/physics/geometry.ts', what: 'q95 aspect-ratio factor (1.17 − 0.65ε) → (1.17 + 0.65ε)',
    find: '(1.17 - 0.65 * eps)', replace: '(1.17 + 0.65 * eps)', tests: [`${REF}/limits.test.ts`] },
  { id: 'M10', file: 'src/physics/confinement/magnetic.ts', what: 'NBI fast-ion pool fed with injected (not absorbed) NBI power',
    find: 'd[IDX.Wb] = P_NBI - P_beam', replace: 'd[IDX.Wb] = P_NBI_inj - P_beam', tests: [`${REF}/invariants.test.ts`] },
  { id: 'M11', file: 'src/physics/confinement/magnetic.ts', what: 'total radiation sign slip: P_brems + P_line + P_sync → … − P_sync',
    find: 'P_rad: P_brems + P_line + P_sync', replace: 'P_rad: P_brems + P_line - P_sync', tests: [`${REF}/invariants.test.ts`] },
  { id: 'M12', file: 'src/physics/confinement/magnetic.ts', what: 'neutron counter integrates the total reaction rate',
    find: 'd[IDX.Nn] = fus.neutrons;', replace: 'd[IDX.Nn] = fus.rate;', tests: [`${REF}/invariants.test.ts`] },
  { id: 'M13', file: 'src/physics/numerics/linalg.ts', what: 'Thomas forward sweep sign d − a·d′ → d + a·d′',
    find: 'dp[i] = (d[i] - a[i] * dp[i - 1]) / beta;', replace: 'dp[i] = (d[i] + a[i] * dp[i - 1]) / beta;', tests: [`${REF}/numericsProps.test.ts`] },
  { id: 'M14', file: 'src/physics/disruption.ts', what: 'current-quench time 4 ms/m² → 1 ms/m² (below the ITER database bound)',
    find: 'const tau_CQ = 4.0 * A;', replace: 'const tau_CQ = 1.0 * A;', tests: [`${REF}/disruption.test.ts`] },
  { id: 'M15', file: 'src/physics/numerics/linalg.ts', what: 'dense LU refuses every matrix: singular test best === 0 → best >= 0',
    find: 'if (best === 0) throw', replace: 'if (best >= 0) throw', tests: [`${REF}/numericsProps.test.ts`] },
  // v4 numerics: TR-BDF2 with error control, Anderson-accelerated Picard, the edge two-point chain, the Tresca layers, the Grad-Shafranov iterations
  { id: 'M16', file: 'src/physics/profiles/solver/trbdf2.ts', what: 'TR-BDF2 error constant C: (−3γ² + 4γ − 2) → (… − 1)',
    find: '(-3 * TRBDF2_GAMMA ** 2 + 4 * TRBDF2_GAMMA - 2)', replace: '(-3 * TRBDF2_GAMMA ** 2 + 4 * TRBDF2_GAMMA - 1)', tests: [TRBDF2] },
  { id: 'M17', file: 'src/physics/profiles/solver/trbdf2.ts', what: 'TR-BDF2 estimate weight of the old rate: (2 − γ) → (1 − γ)',
    find: 'cR: (2 * TRBDF2_C * (2 - g)) / (g * (1 - g))', replace: 'cR: (2 * TRBDF2_C * (1 - g)) / (g * (1 - g))', tests: [TRBDF2] },
  { id: 'M18', file: 'src/physics/profiles/solver/trbdf2.ts', what: 'step controller exponent after an accepted step: err^(−1/2) → err^(−1/3)',
    find: 'Math.max(err, ERR_FLOOR), -0.5)', replace: 'Math.max(err, ERR_FLOOR), -1 / 3)', tests: [TRBDF2] },
  { id: 'M19', file: 'src/physics/profiles/solver/trbdf2.ts', what: 'retry factor after a rejection: (safety/err)^(1/order) → (safety/err)^order',
    find: 'Math.pow(c.safety / err, 1 / order)', replace: 'Math.pow(c.safety / err, order)', tests: [TRBDF2] },
  { id: 'M20', file: 'src/physics/profiles/solver/trbdf2.ts', what: 'a repeated step may grow after all (afterReject cap removed)',
    find: 'return afterReject ? Math.min(fac, 1) : fac;', replace: 'return afterReject ? fac : fac;', tests: [TRBDF2] },
  { id: 'M21', file: 'src/physics/profiles/solver/coupledStep.ts', what: 'error estimate of the internal energy: 3/2 n_e T_e at the stage state loses its 3/2',
    find: 'c.cG * 1.5 * g1.ne[i] * g1.Te[i]', replace: 'c.cG * g1.ne[i] * g1.Te[i]', tests: [STEP] },
  { id: 'M22', file: 'src/physics/profiles/solver/coupledStep.ts', what: 'error estimate not filtered with the inverse iteration matrix (Hosea–Shampine): density part unfiltered',
    find: 'ctx.dens.filter({ dt: dtEff, D: w.D, v: w.v }, eNe, fNe);', replace: 'fNe.set(eNe);', tests: [STEP] },
  { id: 'M23', file: 'src/physics/profiles/solver/coupledStep.ts', what: 'a rejected step is not repeated: error test err > 1 → err > 1e9',
    find: 'if (err > 1 && dt > STEP_DT_FLOOR', replace: 'if (err > 1e9 && dt > STEP_DT_FLOOR', tests: [STEP] },
  { id: 'M24', file: 'src/physics/profiles/solver/coupledStep.ts', what: 'plasma-current boundary of the trapezoidal stage at t + dt/2 instead of t + γ dt',
    find: 'const ip1 = ctx.ipAt(t + TRBDF2_GAMMA * dt)', replace: 'const ip1 = ctx.ipAt(t + 0.5 * dt)', tests: [STEP, IPRAMP] },
  { id: 'M25', file: 'src/physics/numerics/anderson.ts', what: 'Anderson: the update difference of G uses the residual differences (ΔG := ΔF)',
    find: 'dGs[i] = g[i] - gPrev[i];', replace: 'dGs[i] = f[i] - fPrev[i];', tests: [ANDERSON, NUM] },
  { id: 'M26', file: 'src/physics/numerics/anderson.ts', what: 'Anderson: the damped correction adds (1 − β)ΔF γ instead of subtracting it',
    find: 'x[i] -= gp * (dGs[i] - damp * dFs[i]);', replace: 'x[i] -= gp * (dGs[i] + damp * dFs[i]);', tests: [ANDERSON, NUM] },
  { id: 'M27', file: 'src/physics/numerics/anderson.ts', what: 'Anderson: damping 1 − β → β',
    find: 'const damp = 1 - beta;', replace: 'const damp = beta;', tests: [ANDERSON, NUM] },
  { id: 'M28', file: 'src/physics/numerics/anderson.ts', what: 'Anderson: back substitution of R γ = Qᵀf: s − Σ R γ → s + Σ R γ',
    find: 's -= Rm[p * depth + c] * gam[c];', replace: 's += Rm[p * depth + c] * gam[c];', tests: [ANDERSON, NUM] },
  { id: 'M29', file: 'src/physics/numerics/anderson.ts', what: 'Anderson: a column is dropped as dependent at 1e-2 (not 1e-20) of its squared norm',
    find: 'if (!(v2 > 1e-20 * a2) || !(a2 > 0)) continue;', replace: 'if (!(v2 > 1e-2 * a2) || !(a2 > 0)) continue;', tests: [ANDERSON, NUM] },
  { id: 'M30', file: 'src/physics/numerics/anderson.ts', what: 'Anderson: the first (Picard) step ignores the damping β',
    find: 'if (m === 0) { for (let i = 0; i < n; i++) x[i] += beta * f[i]; return; }', replace: 'if (m === 0) { for (let i = 0; i < n; i++) x[i] += f[i]; return; }', tests: [ANDERSON, NUM] },
  { id: 'M31', file: 'src/physics/profiles/solver/coupledStep.ts', what: 'Picard of a stage: the Anderson depth 4 → 0 (plain Picard)',
    find: 'export const PICARD_DEPTH = 4;', replace: 'export const PICARD_DEPTH = 0;', tests: [STEP, ENERGY] },
  { id: 'M32', file: 'src/physics/profiles/solver/coupledStep.ts', what: 'Picard of a stage: the T_i block of the scaled iterate is scaled with the T_e scale',
    find: 'xk[N + i] = w.TiIt[i] / sTi;', replace: 'xk[N + i] = w.TiIt[i] / sTe;', tests: [STEP, ENERGY] },
  { id: 'M33', file: 'src/physics/profiles/solver/coupledStep.ts', what: 'Picard of a stage: convergence tolerance 0.1 rtol → 10 rtol',
    find: 'const tolPicard = Math.min(2e-3, 0.1 * rtol);', replace: 'const tolPicard = Math.min(2e-3, 10 * rtol);', tests: [STEP, ENERGY] },
  { id: 'M34', file: 'src/physics/edge/twoPoint.ts', what: 'conduction law exponent 2/7 → 2/5',
    find: '(3.5 * Math.max(q, 0) * Math.max(L, 0)) / kappa0, 2 / 7)', replace: '(3.5 * Math.max(q, 0) * Math.max(L, 0)) / kappa0, 2 / 5)', tests: [EDGE] },
  { id: 'M35', file: 'src/physics/edge/twoPoint.ts', what: 'sheath heat flux: momentum loss enters as (1 + f_mom)',
    find: 'return gamma * (1 - fMom) * n_u', replace: 'return gamma * (1 + fMom) * n_u', tests: [EDGE] },
  { id: 'M36', file: 'src/physics/edge/twoPoint.ts', what: 'target density: pressure balance without the factor 2 (n_t = (1 − f_mom) n_u T_u / T_t)',
    find: '/ (2 * Math.max(Tt_eV, 1e-9));', replace: '/ Math.max(Tt_eV, 1e-9);', tests: [EDGE] },
  { id: 'M37', file: 'src/physics/edge/solve.ts', what: 'edge chain: the entrance temperature T_x uses the unradiated heat flux q_u instead of q_u/b',
    find: 'conductionTemperature(Tt, g.q_u / g.b, g.L_div, par.kappa0e)', replace: 'conductionTemperature(Tt, g.q_u, g.L_div, par.kappa0e)', tests: [EDGE_SOLVE] },
  { id: 'M38', file: 'src/physics/edge/solve.ts', what: 'edge chain: the sheath equation is solved with the opposite sign (F: q_sheath − q_layer → q_layer − q_sheath)',
    find: 'return br.qSheath - (1 - br.fCool) * br.qcc;', replace: 'return (1 - br.fCool) * br.qcc - br.qSheath;', tests: [EDGE_SOLVE] },
  { id: 'M39', file: 'src/physics/edge/solve.ts', what: 'edge chain: upstream heat-flux density without the parallel-to-poloidal factor B/B_p',
    find: 'const q_u = (P_leg * B) / (2 * Math.PI * Ru * lq * 1e-3 * Bp);', replace: 'const q_u = (P_leg) / (2 * Math.PI * Ru * lq * 1e-3);', tests: [EDGE_SOLVE] },
  { id: 'M40', file: 'src/physics/systems/tfCoil.ts', what: 'Tresca stress: one of the three principal-stress differences has a sign slip |σz − σr| → |σz + σr|',
    find: 'Math.abs(sZ - sR));', replace: 'Math.abs(sZ + sR));', tests: [TF, TF_STATE] },
  { id: 'M41', file: 'src/physics/systems/tfCoil.ts', what: 'TF layers: enclosed current of the inner layers counts r0² instead of −r0²',
    find: 'Iin += Math.PI * (l.r1 * l.r1 - l.r0 * l.r0) * l.J;', replace: 'Iin += Math.PI * (l.r1 * l.r1 + l.r0 * l.r0) * l.J;', tests: [TF, TF_STATE] },
  { id: 'M42', file: 'src/physics/systems/tfCoil.ts', what: 'TF layers: hoop stress particular part (1 + 3ν) → (3 + ν)',
    find: '0.125 * (1 + 3 * layers[i].nu) * alpha[i]', replace: '0.125 * (3 + layers[i].nu) * alpha[i]', tests: [TF, TF_STATE] },
  { id: 'M43', file: 'src/physics/systems/tfCoil.ts', what: 'TF layers: plane-stress modulus E/(1 − ν²) → E/(1 − ν)',
    find: 'l.E / (1 - l.nu * l.nu)', replace: 'l.E / (1 - l.nu)', tests: [TF, TF_STATE] },
  { id: 'M44', file: 'src/physics/systems/tfCoil.ts', what: 'TF layers: displacement continuity at an interface has a sign slip (− up(i) + up(i+1) → − up(i) − up(i+1))',
    find: 'b[2 * i + 2] = -up(i, r) + up(i + 1, r);', replace: 'b[2 * i + 2] = -up(i, r) - up(i + 1, r);', tests: [TF, TF_STATE] },
  { id: 'M45', file: 'src/physics/systems/tfCoil.ts', what: 'TF: the winding-pack radial stress in the steel is not scaled by E_steel/E_effective',
    find: 'st0.sigR * fac : st0.sigR', replace: 'st0.sigR : st0.sigR', tests: [TF, TF_STATE] },
  { id: 'M46', file: 'src/physics/systems/tfCoil.ts', what: 'TF: the governing stress is the smallest of the three layers, not the largest',
    find: 'x.tresca_MPa > m.tresca_MPa', replace: 'x.tresca_MPa < m.tresca_MPa', tests: [TF, TF_STATE] },
  { id: 'M47', file: 'src/physics/equilibrium/gs.ts', what: 'GS iteration: the table current is normalised with a sign slip c = (I_p + I_a)/I_b',
    find: 'const c = (o.Ip - Ia) / Ib;', replace: 'const c = (o.Ip + Ia) / Ib;', tests: [GS] },
  { id: 'M48', file: 'src/physics/equilibrium/gs.ts', what: 'GS iteration: residual normalised without the axis flux (resid = max|G − ψ|)',
    find: 'resid = dmax / dpsi;', replace: 'resid = dmax;', tests: [GS] },
  { id: 'M49', file: 'src/physics/equilibrium/gs.ts', what: 'GS iteration: the mixing damping is not applied (ω = 1 in every step)',
    find: 'acc.step(xv, gv, omega);', replace: 'acc.step(xv, gv, 1);', tests: [GS, OUTER] },
  { id: 'M50', file: 'src/physics/equilibrium/gs.ts', what: 'GS iteration: the damping is cut by 0.9 (not 0.5) at a restart',
    find: 'omega = Math.max(0.5 * omega, OMEGA_MIN); acc.reset();', replace: 'omega = Math.max(0.9 * omega, OMEGA_MIN); acc.reset();', tests: [GS, OUTER] },
  { id: 'M51', file: 'src/physics/equilibrium/gs.ts', what: 'GS iteration: shape profile current scale lam without the (1 − β0) I_1/R part',
    find: 'const lam = o.Ip / (beta0 * I_R + (1 - beta0) * I_1R);', replace: 'const lam = o.Ip / (beta0 * I_R + I_1R);', tests: [GS] },
  { id: 'M52', file: 'src/physics/profiles/coupling/outer.ts', what: 'GS outer iteration: node update takes the whole step (no under-relaxation ω)',
    find: 'x = Float64Array.from(x, (v, j) => v + omega * (xNew[j] - v));', replace: 'x = Float64Array.from(x, (v, j) => xNew[j]);', tests: [OUTER] },
  { id: 'M53', file: 'src/physics/profiles/coupling/outer.ts', what: 'GS outer iteration: no contraction test (delta > 0.9 prev → never)',
    find: 'if (delta > 0.9 * prev) {', replace: 'if (delta > 1e9 * prev) {', tests: [OUTER] },
  { id: 'M54', file: 'src/physics/profiles/coupling/outer.ts', what: 'GS outer iteration: minimum fraction of the way 0.75 → 0.5',
    find: 'export const MIN_FRACTION = 0.75;', replace: 'export const MIN_FRACTION = 0.5;', tests: [OUTER] },
  { id: 'M55', file: 'src/physics/profiles/coupling/outer.ts', what: 'GS outer iteration: stagnation after 3 (not 2) non-contracting iterations',
    find: 'if (++stalled >= 2) break;', replace: 'if (++stalled >= 3) break;', tests: [OUTER] },
  { id: 'M56', file: 'src/physics/profiles/coupling/outer.ts', what: 'GS outer iteration: a short-of-the-whole-way solve is not final after the second iteration',
    find: 'if (fraction < 1 && outer >= 2) break;', replace: 'if (fraction < 1 && outer >= 3) break;', tests: [OUTER] },
  { id: 'M57', file: 'src/physics/profiles/coupling/outer.ts', what: 'GS outer iteration: continuation halves the step at most 5 (not 3) times',
    find: 'if (++halvings > 3) break;', replace: 'if (++halvings > 5) break;', tests: [OUTER] },
  { id: 'M58', file: 'src/physics/systems/tfCoil.ts', what: 'TF: the winding-pack hoop stress in the steel is not scaled by E_steel/E_effective',
    find: "st = kind === 'wp' ? st0.sigT * fac : st0.sigT;", replace: "st = kind === 'wp' ? st0.sigT : st0.sigT;", tests: [TF, TF_STATE] },
];

function parseArgs(argv) {
  const o = { only: null, keep: false, threads: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') o.keep = true;
    else if (a === '--only') o.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--threads') o.threads = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      // the comment block after the shebang, up to the first line that is not a comment
      const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1);
      const end = lines.findIndex((l) => !l.startsWith('//'));
      console.log(lines.slice(0, end < 0 ? lines.length : end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    }
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  if (!Number.isInteger(o.threads) || o.threads < 1) { console.error('--threads needs a positive integer'); process.exit(2); }
  if (o.only) for (const id of o.only) if (!MUTANTS.some((m) => m.id === id)) { console.error(`unknown mutant ${id}`); process.exit(2); }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const selected = MUTANTS.filter((m) => !opts.only || opts.only.includes(m.id));

// long-path form: vite resolves module ids to it (a Windows 8.3 short temp path would not match)
const work = realpathSync.native(mkdtempSync(join(tmpdir(), 'fusion-mutants-')));
if (!relative(root, work).startsWith('..')) { console.error(`temporary directory ${work} is inside the repository`); process.exit(2); }
const link = join(work, 'node_modules');

function cleanup() {
  if (opts.keep) { console.log(`kept ${work}`); return; }
  try {
    if (existsSync(link) && lstatSync(link).isSymbolicLink()) unlinkSync(link); // the link only, never its target
    if (existsSync(link)) { console.error(`refusing to delete ${work}: node_modules is not a link`); return; }
    rmSync(work, { recursive: true, force: true });
  } catch (e) { console.error(`cleanup of ${work} failed: ${e.message}`); }
}

function vitest(files) {
  const cli = join(link, 'vitest', 'vitest.mjs');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [cli, 'run', ...files, `--maxWorkers=${opts.threads}`, '--reporter=dot'],
    { cwd: work, encoding: 'utf8', timeout: 600_000, env: { ...process.env, FORCE_COLOR: '0' } });
  return { ok: r.status === 0, secs: (Date.now() - t0) / 1000, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, error: r.error };
}

let exitCode = 0;
try {
  cpSync(join(root, 'src'), join(work, 'src'), { recursive: true });
  for (const f of ['package.json', 'tsconfig.json', 'vite.config.ts']) cpSync(join(root, f), join(work, f));
  symlinkSync(join(root, 'node_modules'), link, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`mutation smoke: ${selected.length} mutants, sandbox ${work}`);

  const allTests = [...new Set(selected.flatMap((m) => m.tests))];
  const base = vitest(allTests);
  if (!base.ok) {
    console.error(`baseline FAILED (${base.secs.toFixed(1)} s) — fix the tests before measuring mutants:\n${base.out.slice(-3000)}`);
    exitCode = 2;
  } else {
    console.log(`baseline passes (${allTests.length} test files, ${base.secs.toFixed(1)} s)\n`);
    const results = [];
    for (const m of selected) {
      const path = join(work, m.file);
      const orig = readFileSync(path, 'utf8');
      const count = orig.split(m.find).length - 1;
      if (count !== 1) {
        const status = `INVALID (search text found ${count}×)`;
        results.push({ ...m, status, secs: 0 });
        console.log(`  ${m.id.padEnd(4)} ${status}  ${m.what}`);
        exitCode = 2;
        continue;
      }
      writeFileSync(path, orig.replace(m.find, m.replace));
      let r;
      try { r = vitest(m.tests); } finally { writeFileSync(path, orig); }
      const status = r.error ? `ERROR (${r.error.message})` : r.ok ? 'SURVIVED' : 'killed';
      results.push({ ...m, status, secs: r.secs });
      console.log(`  ${m.id.padEnd(4)} ${status.padEnd(9)} ${r.secs.toFixed(1).padStart(5)} s  ${m.what}`);
    }
    const survivors = results.filter((r) => r.status === 'SURVIVED');
    const killed = results.filter((r) => r.status === 'killed').length;
    console.log(`\n${killed}/${results.length} mutants killed.`);
    if (survivors.length) {
      console.log('Survivors (formulas the listed tests do not pin down):');
      for (const s of survivors) console.log(`  ${s.id}: ${s.file} — ${s.what}  [tests: ${s.tests.join(', ')}]`);
      if (exitCode === 0) exitCode = 1;
    }
    if (results.some((r) => r.status.startsWith('ERROR'))) exitCode = 2;
  }
} catch (e) {
  console.error(`mutation smoke failed: ${e.stack ?? e}`);
  exitCode = 2;
} finally {
  cleanup();
}
process.exit(exitCode);
