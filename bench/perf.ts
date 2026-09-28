/// <reference types="node" />
/**
 * Performance benchmark: npm run bench:perf [-- --update | --only A,B | --repeat N | --strict]
 *
 * Runs each benchmark preset (ITER, JET, ITER15, JET15, DEMO15, NIF) to the end in this process, one
 * after the other, `--repeat` times (default 3), and compares the median wall time with
 * bench/perf-baseline.json. A preset more than 25 % slower than its baseline is flagged; with
 * --strict that is exit code 1, otherwise a warning. --update records the current medians as the new
 * baseline. Timings depend on the machine and its load: compare only with a baseline recorded on the
 * same machine (the baseline stores the CPU model and Node version and the report warns on a mismatch).
 * Not part of ci:local.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineCli, parseArgsOrExit } from '../src/cli/args';
import { PRESETS } from '../src/physics/presets';
import { Simulation } from '../src/physics/simulation';

const BENCH_PRESETS = ['ITER', 'JET', 'ITER15', 'JET15', 'DEMO15', 'NIF'] as const;
const BASELINE = fileURLToPath(new URL('./perf-baseline.json', import.meta.url));
/** relative slow-down that is flagged */
const WARN = 0.25;

const CLI = defineCli({
  name: 'npm run bench:perf --',
  summary: 'Median wall time of preset runs versus bench/perf-baseline.json (warning above +25 %).',
  flags: {
    only: { type: 'list', choices: BENCH_PRESETS, metavar: 'ID,…', help: `only these presets (default: ${BENCH_PRESETS.join(', ')})` },
    repeat: { type: 'int', default: 3, min: 1, max: 25, metavar: 'N', help: 'runs per preset; the median is compared' },
    update: { type: 'bool', help: 'record the medians as the new baseline' },
    strict: { type: 'bool', help: 'exit with code 1 when a preset is more than 25 % slower than its baseline' },
  },
});

interface Baseline {
  comment: string;
  node: string;
  cpu: string;
  platform: string;
  date: string;
  repeat: number;
  /** median wall time per preset [ms] */
  medianMs: Record<string, number>;
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
};

function timeRun(id: string): number {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  const t0 = performance.now();
  new Simulation(p.cfg).runAll();
  return performance.now() - t0;
}

function main() {
  const args = parseArgsOrExit(CLI);
  const ids = args.only ?? [...BENCH_PRESETS];
  const cpu = cpus()[0]?.model?.trim() ?? 'unknown';
  const base: Baseline | undefined = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined;
  console.log(`bench:perf — ${ids.length} presets × ${args.repeat} runs, Node ${process.version}, ${cpu}`);
  if (base && !args.update && (base.cpu !== cpu || base.node.split('.')[0] !== process.version.split('.')[0])) {
    console.log(`  note: baseline recorded on ${base.cpu}, Node ${base.node} (${base.date.slice(0, 10)}); timings may not be comparable`);
  }
  const medians: Record<string, number> = {};
  const rows: string[] = [];
  let slower = 0;
  for (const id of ids) {
    const times: number[] = [];
    for (let k = 0; k < args.repeat; k++) times.push(timeRun(id));
    const med = median(times);
    medians[id] = med;
    const ref = base?.medianMs[id];
    const rel = ref ? med / ref - 1 : NaN;
    const flag = Number.isFinite(rel) && rel > WARN;
    if (flag) slower++;
    rows.push(`| ${id} | ${(med / 1000).toFixed(2)} | ${times.map((t) => (t / 1000).toFixed(2)).join(', ')} | ${ref ? (ref / 1000).toFixed(2) : '—'} | ` +
      `${Number.isFinite(rel) ? `${rel >= 0 ? '+' : ''}${(100 * rel).toFixed(0)} %` : '—'} | ${args.update ? 'recorded' : !ref ? 'no baseline' : flag ? '⚠ SLOWER' : 'ok'} |`);
    console.error(`  ${id}: median ${(med / 1000).toFixed(2)} s`);
  }
  console.log(['', '| Preset | median [s] | runs [s] | baseline [s] | Δ | status |', '|---|---|---|---|---|---|', ...rows, ''].join('\n'));

  if (args.update) {
    const out: Baseline = {
      comment: 'Median wall times of `npm run bench:perf` [ms]; re-record with `npm run bench:perf -- --update` on the reference machine.',
      node: process.version, cpu, platform: `${platform()} ${process.arch}`, date: new Date().toISOString(), repeat: args.repeat,
      medianMs: { ...(base?.medianMs ?? {}), ...Object.fromEntries(Object.entries(medians).map(([k, v]) => [k, Math.round(v)])) },
    };
    writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n');
    console.log(`baseline written: bench/perf-baseline.json (${Object.keys(medians).join(', ')})`);
    return;
  }
  if (slower) {
    console.log(`⚠ ${slower} preset(s) more than ${100 * WARN} % slower than the baseline`);
    if (args.strict) process.exitCode = 1;
  } else if (base) {
    console.log(`✓ no preset more than ${100 * WARN} % slower than the baseline`);
  } else {
    console.log('no baseline yet: record one with npm run bench:perf -- --update');
  }
}

main();
