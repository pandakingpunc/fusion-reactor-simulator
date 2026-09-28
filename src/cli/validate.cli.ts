/// <reference types="node" />
/**
 * Doğrulama CLI'si — `npm run validate` (tsx ile çalışır).
 *
 * Her preset'i (0D ve 1.5D) worker_threads havuzunda paralel koşturur (çekirdek sayısı − 1 işçi)
 * ve seçili çıktıları açık literatürdeki beklenen aralıklarla karşılaştırır. Amaç regresyon
 * yakalamaktır (mertebe/tutarlılık). Bir kontrol başarısız olursa süreç sıfırdan farklı kodla çıkar.
 *   --threads N   işçi sayısı (varsayılan: çekirdek − 1)
 *   --only a,b    yalnız bu preset kimlikleri
 *   --json        machine-readable results on stdout instead of the report (use `npm run -s`: plain
 *                 `npm run` writes its banner to stdout before the JSON)
 * Exit codes: 0 all executed checks passed; 1 a check or run failed, or no check was executed
 * (the selected presets have none); 2 usage error (unknown flag or preset id, bad --threads).
 */
import { PRESETS } from '../physics/presets';
import { ShotReport } from '../physics/types';
import { PoolConfigError, defaultThreads, runPool } from './pool';
import { defineCli, exitUsage, parseArgsOrExit } from './args';
import type { RunResult, RunTask } from './presetRunner.worker';

interface Check {
  id: string;
  label: string;
  get: (r: ShotReport, avg: Record<string, number>) => number;
  lo: number;
  hi: number;
  unit: string;
  ref: string;
}

// Beklenen aralıklar — açık literatür (0D/1.5D olduğu için toleranslar geniştir).
const CHECKS: Check[] = [
  { id: 'ITER', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 8, hi: 40, unit: '', ref: 'ITER target Q≈10 (0D overprediction is normal)' },
  { id: 'JET', label: 'E_fusion', get: (r) => r.E_fusion_MJ, lo: 40, hi: 80, unit: 'MJ', ref: 'JET DTE2 2021: 59 MJ' },
  { id: 'SPARC', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 2, hi: 20, unit: '', ref: 'SPARC estimate Q≈11' },
  { id: 'DEMO', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 10, hi: 60, unit: '', ref: 'EU DEMO ~2 GW fusion, P_aux 50 MW' },
  { id: 'NIF', label: 'Gain G', get: (r) => r.Q_sci_max, lo: 1.0, hi: 3.0, unit: '', ref: 'NIF N221204: G≈1.5' },
  { id: 'DIRECT', label: 'Gain G', get: (r) => r.Q_sci_max, lo: 1.0, hi: 8.0, unit: '', ref: 'Direct drive (scaled)' },
  { id: 'MUON', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 0.0, hi: 0.99, unit: '', ref: 'µCF Q<1 (sticking + muon cost)' },
  // 1.5D profil modeli — son %30 ortalamaları (düz tepe)
  { id: 'ITER15', label: 'Q (flat-top avg.)', get: (_r, a) => a.Q, lo: 5, hi: 20, unit: '', ref: 'ITER baseline Q=10 (Shimada 2007)' },
  { id: 'ITER15', label: 'P_fusion (flat-top)', get: (_r, a) => a.P_fus, lo: 300, hi: 800, unit: 'MW', ref: 'ITER 500 MW' },
  { id: 'ITER15', label: 'Bootstrap fraction', get: (_r, a) => a.f_bs, lo: 0.1, hi: 0.4, unit: '', ref: 'ITER inductive ≈ 0.15–0.25 (Sips 2005)' },
  { id: 'ITER15', label: 'ℓ_i(3)', get: (_r, a) => a.li, lo: 0.6, hi: 1.1, unit: '', ref: 'ITER flat-top ℓ_i(3) ≈ 0.7–1.0' },
  { id: 'ITER15', label: 'q95', get: (_r, a) => a.q95, lo: 2.7, hi: 4.0, unit: '', ref: 'ITER q95 ≈ 3' },
  { id: 'ITER15', label: 'T_e pedestal', get: (_r, a) => a.Tped, lo: 2, hi: 7, unit: 'keV', ref: 'EPED ITER T_ped ≈ 4–5 keV' },
  { id: 'ITER15', label: 'n̄/n_G', get: (_r, a) => a.nG_frac, lo: 0.6, hi: 1.0, unit: '', ref: 'ITER n̄/n_G ≈ 0.85' },
  { id: 'JET15', label: 'E_fusion', get: (r) => r.E_fusion_MJ, lo: 40, hi: 90, unit: 'MJ', ref: 'JET DTE2 59 MJ (1.5D beam-target ~60% of yield, cf. TRANSP)' },
  { id: 'JET15', label: 'T_i axis', get: (_r, a) => a.Ti0, lo: 6, hi: 15, unit: 'keV', ref: 'JET DTE2 T_i(0) ≈ 10 keV' },
  { id: 'SPARC15', label: 'Q (flat-top avg.)', get: (_r, a) => a.Q, lo: 2, hi: 20, unit: '', ref: 'SPARC Q≈11 (Creely 2020)' },
  { id: 'DEMO15', label: 'P_fusion (flat-top)', get: (_r, a) => a.P_fus, lo: 1000, hi: 3000, unit: 'MW', ref: 'EU DEMO 2 GW' },
  { id: 'DEMO15', label: 'Bootstrap fraction', get: (_r, a) => a.f_bs, lo: 0.2, hi: 0.6, unit: '', ref: 'EU DEMO f_bs ≈ 0.35 (Siccinio 2020)' },
];

const CLI = defineCli({
  name: 'npm run validate --',
  summary: 'Runs the presets (0D and 1.5D) on a worker-thread pool and checks selected outputs against published values.\n' +
    'Exit codes: 0 all executed checks passed; 1 a check or run failed, or no check was executed; 2 usage error.',
  flags: {
    threads: { type: 'int', min: 1, help: 'worker threads (default: cores − 1)' },
    only: { type: 'list', choices: PRESETS.map((p) => p.id), metavar: 'ID,…', help: 'only these preset ids' },
    json: { type: 'bool', help: 'print machine-readable JSON results instead of the report' },
  },
  epilog: 'With --json, stdout is a single JSON document. Plain `npm run` writes its own "> script" banner to\n' +
    'stdout first, so run it silently to capture the JSON:\n' +
    '  npm run -s validate -- --json > results.json     (or: npx tsx src/cli/validate.cli.ts --json > results.json)',
});

/** --json: one entry per executed check */
interface CheckResult {
  preset: string;
  metric: string;
  /** null when the run failed or the value is not finite */
  value: number | null;
  unit: string;
  expected: { lo: number; hi: number };
  pass: boolean;
  ref: string;
  error?: string;
}
/** --json: one entry per selected preset */
interface PresetResult {
  id: string;
  ok: boolean;
  error?: string;
  Q_sci_max?: number | null;
  E_fusion_MJ?: number | null;
  Tmax_keV?: number | null;
  score?: number | null;
  steps?: number;
  cpu_s?: number;
}

const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

async function main() {
  const args = parseArgsOrExit(CLI);
  const only = args.only;
  const threads = args.threads ?? defaultThreads();
  const json = args.json;
  const say = (line: string) => { if (!json) console.log(line); };
  const list = PRESETS.filter((p) => !only || only.includes(p.id));
  const tasks: RunTask[] = list.map((p) => ({ id: p.id, cfg: p.cfg }));
  const t0 = performance.now();
  // uzun koşular önce (yük dengeleme)
  const order = [...tasks].sort((a, b) => weight(b) - weight(a));
  const res = await runPool<RunTask, RunResult>(order, new URL('./presetRunner.worker.ts', import.meta.url), threads);
  const wall = performance.now() - t0;
  const byId = new Map(res.map((r) => [r.id, r]));

  let fails = 0;
  const presetResults: PresetResult[] = [];
  const checkResults: CheckResult[] = [];
  say(`\n=== SUMMARY (all presets, ${threads} worker threads, ${(wall / 1000).toFixed(1)} s wall) ===`);
  let cpu = 0;
  for (const p of list) {
    const r = byId.get(p.id);
    if (!r?.ok || !r.report) {
      fails++; say(`  ERROR ${p.id}: ${r?.error ?? 'no result'}`);
      presetResults.push({ id: p.id, ok: false, error: r?.error ?? 'no result' });
      continue;
    }
    cpu += r.ms ?? 0;
    const rep = r.report;
    const finite = isFinite(rep.Q_sci_max) && isFinite(rep.E_fusion_MJ) && isFinite(rep.Tmax_keV) && isFinite(rep.score);
    presetResults.push({
      id: p.id, ok: finite, ...(finite ? {} : { error: 'non-finite report' }),
      Q_sci_max: finiteOrNull(rep.Q_sci_max), E_fusion_MJ: finiteOrNull(rep.E_fusion_MJ), Tmax_keV: finiteOrNull(rep.Tmax_keV),
      score: finiteOrNull(rep.score), steps: r.steps, cpu_s: (r.ms ?? 0) / 1000,
    });
    if (!finite) { fails++; say(`  NAN!  ${p.id}`); continue; }
    say(
      `  ${p.id.padEnd(8)} Q=${rep.Q_sci_max.toExponential(2)}  E_fus=${rep.E_fusion_MJ.toExponential(2)} MJ  T=${rep.Tmax_keV.toFixed(2)} keV  score=${rep.score}` +
      `  (${((r.ms ?? 0) / 1000).toFixed(1)} s, ${r.steps} steps)`
    );
  }
  say(`  parallel speed-up ≈ ${(cpu / wall).toFixed(1)}× (Σ CPU ${(cpu / 1000).toFixed(1)} s)`);

  say('\n=== VALIDATION (against literature) ===');
  for (const c of CHECKS) {
    const r = byId.get(c.id);
    if (!r) continue; // --only ile filtrelenmiş
    const entry = (value: number | null, pass: boolean): CheckResult =>
      ({ preset: c.id, metric: c.label, value, unit: c.unit, expected: { lo: c.lo, hi: c.hi }, pass, ref: c.ref });
    if (!r.ok || !r.report || !r.avg) {
      fails++; say(`  FAIL  ${c.id} — run failed`);
      checkResults.push({ ...entry(null, false), error: 'run failed' });
      continue;
    }
    const v = c.get(r.report, r.avg);
    const pass = isFinite(v) && v >= c.lo && v <= c.hi;
    if (!pass) fails++;
    checkResults.push(entry(finiteOrNull(v), pass));
    say(
      `  ${pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(8)} ${c.label} = ${v.toPrecision(3)} ${c.unit}` +
      ` (expected ${c.lo}–${c.hi})  [${c.ref}]`
    );
  }

  // zero executed checks is a failure: a filter that selects nothing checkable must not look green
  const none = checkResults.length === 0;
  if (json) {
    const out = {
      schema: 1, threads, wall_s: wall / 1000, presets: presetResults, checks: checkResults,
      checksExecuted: checkResults.length, failures: fails, passed: fails === 0 && !none,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else if (none && fails === 0) {
    say('  (none — the selected presets have no literature checks)\n\n✗ NO CHECKS EXECUTED\n');
  } else {
    say(`\n${fails === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${fails} CHECKS FAILED`}\n`);
  }
  if (fails > 0 || none) process.exitCode = 1;
}

/** kaba maliyet tahmini: 1.5D ve uzun atışlar önce */
function weight(t: RunTask): number {
  const c = t.cfg as { fidelity?: string; t_end?: number };
  return (c.fidelity === '1.5D' ? 100 : 1) * (c.t_end ?? 1);
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(CLI.name, e.message);
  console.error(e);
  process.exitCode = 1;
});
