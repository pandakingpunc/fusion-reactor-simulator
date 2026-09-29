/// <reference types="node" />
/**
 * `fusion-sim run`: one shot from a preset or a configuration file, written as JSON, CSV, NDJSON, NetCDF-3,
 * IMAS-like JSON or a text summary.
 */
import { runShot } from '../../physics/config/run';
import { sourceFromSimulation, type RunMeta } from '../../io/table';
import { writeCsv } from '../../io/csv';
import { writeRunNdjson } from '../../io/ndjson';
import { writeRunNetcdf } from '../../io/netcdf3';
import { writeImasJson } from '../../io/imas';
import { defineCli, parseArgs } from '../args';
import {
  CONFIG_EPILOG, CONFIG_FLAGS, CliContext, CliInputError, emit, extensionOf, provenanceBlock, resolveConfig, runFailureOf, takeRepeated,
} from './common';

const FORMATS = ['json', 'csv', 'ndjson', 'netcdf', 'imas', 'text'] as const;
type Format = (typeof FORMATS)[number];

const EXT_FORMAT: Readonly<Record<string, Format>> = { json: 'json', csv: 'csv', ndjson: 'ndjson', jsonl: 'ndjson', nc: 'netcdf', cdf: 'netcdf', imas: 'imas', txt: 'text' };

export const RUN_CLI = defineCli({
  name: 'fusion-sim run',
  summary: 'Runs one shot to its end and writes the result. Give a preset (--preset ITER) or a configuration file (--config FILE), then\n' +
    'optionally change properties with --set. The output is deterministic: the same configuration gives the same bytes.',
  flags: {
    ...CONFIG_FLAGS,
    format: { type: 'string', choices: FORMATS, help: 'json (report, averages, events, provenance), csv (time traces), ndjson (typed records), netcdf (CF arrays, needs --out), imas (IMAS-like JSON, magnetic runs), text (summary); default: from the --out extension, else json' },
    out: { type: 'string', metavar: 'FILE', help: 'write here instead of stdout (`-` is stdout)' },
    series: { type: 'list', metavar: 'KEY,…', help: 'diagnostics to include (`all` for every one); csv, ndjson, netcdf: default all; json: default none' },
    every: { type: 'int', min: 1, help: 'keep every N-th frame (csv, ndjson, imas)' },
    profiles: { type: 'bool', help: 'ndjson and json: include the radial profiles of a 1.5D run (they are always in netcdf and imas)' },
    'no-profiles': { type: 'bool', help: 'netcdf and imas: leave the radial profiles out' },
    indent: { type: 'int', min: 0, max: 8, default: 2, help: 'JSON indentation (json and imas)' },
  },
  epilog: `${CONFIG_EPILOG}\n\nExit codes: 0 done; 1 the run failed; 2 usage or input error (invalid configuration: every problem is listed with its path).`,
});

/** The keys asked for by --series: undefined for none given, [] for `all`. */
function seriesKeys(series: string[] | undefined): { keys: string[] | undefined; all: boolean } {
  if (series === undefined) return { keys: undefined, all: false };
  if (series.includes('all')) return { keys: undefined, all: true };
  return { keys: series, all: false };
}

export function textSummary(cfgName: string, r: ReturnType<typeof runShot>): string {
  const rep = r.report, t = rep.termination;
  const f = (x: number): string => (!Number.isFinite(x) ? 'n/a' : x !== 0 && (Math.abs(x) >= 1e6 || Math.abs(x) < 1e-3) ? x.toExponential(3) : Number(x.toPrecision(4)).toString());
  const lines = [
    `${cfgName} (${rep.method}, ${(r.sim.cfg as { fidelity?: string }).fidelity ?? '0D'})`,
    `  ended        ${t.reason}${t.natural ? '' : ` (not a planned end): ${t.diagnosis}`}`,
    `  duration     ${f(rep.duration)} ${rep.timeUnit}`,
    `  T_max        ${f(rep.Tmax_keV)} keV`,
    `  Q (max/avg)  ${f(rep.Q_sci_max)} / ${f(rep.Q_sci_avg)}`,
    `  E_fusion     ${f(rep.E_fusion_MJ)} MJ (in: ${f(rep.E_input_MJ)} MJ)`,
    `  Q_eng        ${f(rep.Q_eng)}`,
    `  neutrons     ${f(rep.neutronYield)}`,
    `  Lawson       ${f(rep.lawson_ratio)}`,
    `  score        ${f(rep.score)} / 100`,
    `  steps        ${r.steps}, frames ${r.frames}`,
  ];
  if (Number.isFinite(r.flatTop.Q)) lines.push(`  flat-top     Q ${f(r.flatTop.Q)}, P_fus ${f(r.flatTop.P_fus)} MW`);
  if (rep.warnings.length) lines.push(`  warnings     ${rep.warnings.length}: ${rep.warnings.slice(0, 3).join('; ')}${rep.warnings.length > 3 ? '; ...' : ''}`);
  return lines.join('\n') + '\n';
}

export async function runCommand(argv: readonly string[], ctx: CliContext): Promise<number> {
  const { rest, values } = takeRepeated(argv, ['set']);
  const args = parseArgs(RUN_CLI, rest);
  const { cfg, preset } = resolveConfig(args, values.set, ctx.io);
  const format: Format = (args.format as Format | undefined) ?? EXT_FORMAT[extensionOf(args.out)] ?? 'json';
  if (format === 'netcdf' && (args.out === undefined || args.out === '-') && ctx.io.stdout.isTTY) {
    throw new CliInputError('netcdf is a binary format: give --out FILE (or `--out -` to write it to a pipe)');
  }
  let result: ReturnType<typeof runShot>;
  try {
    result = runShot(cfg, { validate: false });
  } catch (e) {
    throw runFailureOf(e) ?? e;
  }
  const prov = provenanceBlock(ctx, cfg, preset);
  const meta: RunMeta = {
    version: prov.version as string, ...(prov.git ? { commit: (prov.git as { sha: string }).sha } : {}), ...(preset ? { preset } : {}),
    fingerprint: prov.fingerprint as string, configSha256: prov.configSha256 as string,
  };
  const src = { ...sourceFromSimulation(result.sim, meta, { report: false }), report: result.report };
  const { keys, all } = seriesKeys(args.series);
  switch (format) {
    case 'json': {
      const doc: Record<string, unknown> = {
        schema: 1, tool: 'fusion-sim run', provenance: prov, config: cfg,
        summary: {
          method: cfg.method, fidelity: (cfg as { fidelity?: string }).fidelity ?? '0D', endReason: result.report.termination.reason,
          natural: result.report.termination.natural, duration: result.report.duration, timeUnit: result.report.timeUnit, steps: result.steps, frames: result.frames,
        },
        report: result.report, flatTop: result.flatTop, burn: result.burn, events: result.events,
      };
      if (all || keys) {
        const every = args.every ?? 1;
        const idx = result.sim.history.map((_, i) => i).filter((i, k, a) => i % every === 0 || k === a.length - 1);
        const cols = keys ?? [...new Set(result.sim.history.flatMap((h) => Object.keys(h.d)))];
        doc.series = { t: idx.map((i) => result.sim.history[i].t), ...Object.fromEntries(cols.map((k) => [k, idx.map((i) => result.sim.history[i].d[k] ?? null)])) };
        if (args.profiles) doc.profiles = idx.filter((i) => result.sim.history[i].prof).map((i) => ({ t: result.sim.history[i].t, ...result.sim.history[i].prof }));
      }
      emit(ctx.io, args.out, JSON.stringify(doc, null, args.indent) + '\n');
      break;
    }
    case 'csv':
      emit(ctx.io, args.out, writeCsv(src, { ...(keys ? { keys } : {}), ...(args.every ? { every: args.every } : {}) }));
      break;
    case 'ndjson':
      emit(ctx.io, args.out, writeRunNdjson(src, { ...(keys ? { keys } : {}), ...(args.every ? { every: args.every } : {}), profiles: args.profiles }));
      break;
    case 'netcdf':
      emit(ctx.io, args.out, writeRunNetcdf(src, { ...(keys ? { keys } : {}), profiles: !args['no-profiles'] }));
      break;
    case 'imas':
      try {
        emit(ctx.io, args.out, writeImasJson(src, { indent: args.indent, profiles: !args['no-profiles'], ...(args.every ? { every: args.every } : {}) }) + '\n');
      } catch (e) {
        throw new CliInputError((e as Error).message);
      }
      break;
    case 'text':
      emit(ctx.io, args.out, textSummary(preset ?? cfg.method, result));
      break;
  }
  return 0;
}
