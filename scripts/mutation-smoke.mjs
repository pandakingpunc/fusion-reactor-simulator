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
  { id: 'M10', file: 'src/physics/confinement/magnetic.ts', what: 'fast-ion pool fed with injected (not absorbed) NBI power',
    find: 'd[IDX.Wf] = fus.P_charged + P_NBI - P_fast_out', replace: 'd[IDX.Wf] = fus.P_charged + P_NBI_inj - P_fast_out', tests: [`${REF}/invariants.test.ts`] },
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
      if (count !== 1) { results.push({ ...m, status: `INVALID (search text found ${count}×)`, secs: 0 }); exitCode = 2; continue; }
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
