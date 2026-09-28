/// <reference types="node" />
/**
 * Numerical convergence study of the 1.5D ITER preset: npm run bench:convergence [-- options]
 *
 * Runs ITER15 at three radial resolutions (ProfileSettings.nRho, default 25/50/100 cells) and at three
 * upper limits of the adaptive time step (default 0.5/0.05/0.01 s; the model's own cap is 0.5 s), one
 * parameter at a time, and reports the flat-top Q, bootstrap fraction f_bs, internal inductance ℓ_i(3)
 * and pedestal temperature T_ped with a Richardson estimate of the error of the finest run
 * (bench/richardson.ts). Prints a Markdown table; --out writes the full results as JSON.
 * Not part of ci:local (minutes of CPU time).
 */
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { defineCli, exitUsage, parseArgsOrExit } from '../src/cli/args';
import { PoolAbortError, PoolConfigError, defaultThreads, runPool } from '../src/cli/pool';
import { ITER_15D } from '../src/physics/presets';
import type { MagneticConfig } from '../src/physics/types';
import type { ConvResult, ConvTask } from './convergence.worker';
import { type Richardson, richardson } from './richardson';

const METRICS: readonly { key: string; label: string; unit: string }[] = [
  { key: 'Q', label: 'Q', unit: '' },
  { key: 'f_bs', label: 'f_bs', unit: '' },
  { key: 'li', label: 'ℓ_i(3)', unit: '' },
  { key: 'Tped', label: 'T_ped', unit: 'keV' },
];

const CLI = defineCli({
  name: 'npm run bench:convergence --',
  summary: 'Grid and time-step convergence of ITER15 (1.5D): flat-top Q, f_bs, ℓ_i(3), T_ped with Richardson error estimates.',
  flags: {
    grids: { type: 'list', default: ['25', '50', '100'], metavar: 'N,N,N', help: 'three radial cell counts (nRho), coarse to fine' },
    dts: { type: 'list', default: ['0.5', '0.05', '0.01'], metavar: 'S,S,S', help: 'three time-step limits [s], coarse to fine' },
    'base-grid': { type: 'int', default: 50, min: 5, metavar: 'N', help: 'nRho of the time-step series' },
    't-end': { type: 'number', min: 1, metavar: 'S', help: 'shorten the discharge (default: the preset, 400 s); for smoke tests' },
    threads: { type: 'int', min: 1, help: 'worker threads (default: min(6, cores − 1))' },
    out: { type: 'string', metavar: 'FILE', help: 'write the results as JSON' },
  },
});

function triple(name: string, items: readonly string[], parse: (s: string) => number): [number, number, number] {
  const v = items.map(parse);
  if (v.length !== 3 || v.some((x) => !Number.isFinite(x) || x <= 0)) exitUsage(CLI.name, `--${name} needs three positive numbers, got '${items.join(',')}'`);
  return v as [number, number, number];
}

interface Series {
  parameter: 'nRho' | 'dtMax';
  values: [number, number, number];
  /** Richardson step size of each run: 1/nRho or dtMax */
  h: [number, number, number];
  runs: { value: number; ok: boolean; error?: string; ms?: number; steps?: number; metrics: Record<string, number> }[];
  richardson: Record<string, Richardson>;
}

async function main() {
  const args = parseArgsOrExit(CLI);
  const grids = triple('grids', args.grids, (s) => Number.parseInt(s, 10)).sort((a, b) => a - b) as [number, number, number];
  const dts = triple('dts', args.dts, Number).sort((a, b) => b - a) as [number, number, number];
  if (new Set(grids).size < 3 || new Set(dts).size < 3) exitUsage(CLI.name, '--grids and --dts need three different values');
  const base: MagneticConfig = { ...ITER_15D, ...(args['t-end'] ? { t_end: args['t-end'] } : {}) };
  const cfg = (nRho: number): MagneticConfig => ({ ...base, profiles: { ...base.profiles, nRho } });
  const tasks: ConvTask[] = [
    ...grids.map((n) => ({ id: `nRho=${n}`, cfg: cfg(n) })),
    ...dts.map((dt) => ({ id: `dtMax=${dt}`, cfg: cfg(args['base-grid']), dtMax: dt })),
  ];
  const threads = args.threads ?? Math.min(6, defaultThreads());
  console.error(`ITER15 convergence: ${tasks.length} runs of ${base.t_end} s on ${Math.min(threads, tasks.length)} threads …`);
  const t0 = performance.now();
  const res = await runPool<ConvTask, ConvResult>(tasks, new URL('./convergence.worker.ts', import.meta.url), {
    threads,
    onTaskError: (e, t) => ({ id: t.id, ok: false, error: e.message }),
    onProgress: (p) => console.error(`  ${p.done}/${p.total} ${p.id} ${p.ok ? `done (${(p.ms / 1000).toFixed(1)} s)` : 'FAILED'}`),
  });
  const byId = new Map(res.map((r) => [r.id, r]));

  const series = (parameter: Series['parameter'], values: [number, number, number]): Series => {
    // coarse → fine: grids ascend in nRho (h = 1/nRho descends), dts descend
    const h = values.map((v) => (parameter === 'nRho' ? 1 / v : v)) as [number, number, number];
    const runs = values.map((v) => {
      const r = byId.get(`${parameter}=${v}`)!;
      const metrics = Object.fromEntries(METRICS.map((m) => [m.key, r.avg?.[m.key] ?? NaN]));
      return { value: v, ok: r.ok, ...(r.error ? { error: r.error } : {}), ms: r.ms, steps: r.steps, metrics };
    });
    const rich = Object.fromEntries(METRICS.map((m) => [m.key, richardson(h, runs.map((r) => r.metrics[m.key]) as [number, number, number])]));
    return { parameter, values, h, runs, richardson: rich };
  };
  const out = {
    schema: 1,
    preset: 'ITER15',
    t_end_s: base.t_end,
    baseGrid: args['base-grid'],
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    date: new Date().toISOString(),
    wall_s: (performance.now() - t0) / 1000,
    series: [series('nRho', grids), series('dtMax', dts)],
  };
  console.log(markdown(out.series, out.t_end_s, out.baseGrid));
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(out, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2) + '\n');
    console.error(`results written to ${args.out}`);
  }
  if (res.some((r) => !r.ok)) process.exitCode = 1;
}

const f4 = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : 'n/a');
const pct = (v: number) => (Number.isFinite(v) ? `${(100 * v).toPrecision(2)} %` : 'n/a');

function markdown(all: Series[], tEnd: number, baseGrid: number): string {
  const L: string[] = [`### ITER15 numerical convergence (flat-top averages, ${tEnd} s discharge)`, ''];
  for (const s of all) {
    const name = s.parameter === 'nRho' ? 'radial cells nRho' : `time-step limit dtMax [s] (nRho = ${baseGrid})`;
    L.push(`**${name}**`, '');
    const head = ['Metric', ...s.values.map((v) => `${s.parameter}=${v}`), 'order p', 'extrapolated', `error of ${s.parameter}=${s.values[2]}`, 'GCI'];
    L.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
    for (const m of METRICS) {
      const r = s.richardson[m.key];
      const note = r.kind === 'monotone' ? '' : ` (${r.kind})`;
      L.push(`| ${m.label}${m.unit ? ` [${m.unit}]` : ''} | ${s.runs.map((x) => f4(x.metrics[m.key])).join(' | ')} | ${f4(r.p)}${note} | ${f4(r.extrapolated)} | ${f4(r.error)} | ${pct(r.gci)} |`);
    }
    L.push(`| wall time [s] | ${s.runs.map((x) => (x.ms !== undefined ? (x.ms / 1000).toFixed(1) : 'failed')).join(' | ')} | | | | |`);
    L.push(`| steps | ${s.runs.map((x) => x.steps ?? 'n/a').join(' | ')} | | | | |`, '');
    for (const x of s.runs) if (!x.ok) L.push(`> ${s.parameter}=${x.value} failed: ${x.error}`, '');
  }
  L.push('Error: Richardson estimate |f_fine − f_extrapolated| of the finest run; GCI with safety factor 1.25 (3 when not in the asymptotic range).');
  return L.join('\n');
}

main().catch((e) => {
  if (e instanceof PoolConfigError) exitUsage(CLI.name, e.message);
  if (e instanceof PoolAbortError) { console.error(e.message); process.exitCode = 130; return; }
  console.error(e);
  process.exitCode = 1;
});
