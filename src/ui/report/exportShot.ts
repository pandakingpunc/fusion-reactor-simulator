/** CSV / JSON dışa aktarma (Blob indirme). */
import { ReactorConfig, ShotReport, SimEvent } from '../../physics/types';
import { UiFrame } from '../../worker/protocol';
import { DiagSpec } from '../../physics/types';
import type { RunProvenance } from '../persist/types';
import type { Locale } from '../../i18n';
import { describeReportKey, describeReportValue, reportKeyInfo } from './keys';

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/**
 * The run file (src/ui/persist/runRecord.ts): configuration, report, events and the run's fingerprint, so that importing it
 * re-simulates the run and can show a verified reproduction. Written by a separate chunk that is loaded on demand.
 */
export async function exportJSON(name: string, cfg: ReactorConfig, report: ShotReport, events: SimEvent[], prov?: RunProvenance) {
  const { buildRunRecord, serializeRunRecord } = await import('../persist/runRecord');
  download(`${safe(name)}_run.json`, serializeRunRecord(buildRunRecord({ name, cfg, report, events, prov })), 'application/json');
}

export function exportCSV(name: string, frames: UiFrame[], specs: DiagSpec[], timeUnit: string) {
  const keys = specs.map((s) => s.key);
  const extra = frames.length ? Object.keys(frames[0].d).filter((k) => !keys.includes(k)) : [];
  const cols = [...keys, ...extra];
  const header = [`t_${timeUnit}`, ...cols.map((k) => { const s = specs.find((x) => x.key === k); return s && s.unit ? `${k}_${s.unit.replace(/[^\w⁻²³¹⁰]/g, '')}` : k; })];
  const lines = [header.join(',')];
  for (const f of frames) lines.push([f.t, ...cols.map((k) => f.d[k] ?? '')].map((v) => (typeof v === 'number' ? v.toPrecision(7) : v)).join(','));
  download(`${safe(name)}_time_series.csv`, lines.join('\n'), 'text/csv');
}

/**
 * The summary CSV of a report: `key,value` as before (the engineering and extras keys are the raw ones of the report, so that the file
 * stays comparable across languages and versions), and two columns after them, `label` and `unit`, with the label and unit of those
 * keys in the interface language (empty for the fixed rows, which are named by their own keys). Text values of the engineering and
 * extras blocks are in the interface language as well.
 */
export function reportCsv(report: ShotReport, locale: Locale = 'en'): string {
  const rows: [string, string | number, string?, string?][] = [
    ['method', report.method], ['duration', report.duration], ['timeUnit', report.timeUnit],
    ['Tmax_keV', report.Tmax_keV], ['Tmax_MC', report.Tmax_MC], ['Timax_keV', report.Timax_keV], ['Temax_keV', report.Temax_keV],
    ['stableTime_s', report.stableTime_s], ['burnTime_s', report.burnTime_s], ['ignitionTime_s', report.ignitionTime_s],
    ['Q_sci_max', report.Q_sci_max], ['Q_sci_avg', report.Q_sci_avg], ['Q_eng', report.Q_eng],
    ['E_fusion_MJ', report.E_fusion_MJ], ['E_input_MJ', report.E_input_MJ], ['neutronYield', report.neutronYield], ['neutronFluence_m2', report.neutronFluence_m2],
    ['tripleProduct_max', report.tripleProduct_max], ['lawson_ratio', report.lawson_ratio], ['score', report.score],
    ['termination', report.termination.reason],
    ...Object.entries(report.engineering).map(([k, v]) => keyRow('eng', k, typeof v === 'string' ? describeReportValue(v, locale) : String(v), locale)),
    ...Object.entries(report.extras).map(([k, v]) => keyRow('extra', k, typeof v === 'string' ? describeReportValue(v, locale) : v, locale)),
  ];
  return ['key,value,label,unit', ...rows.map(([k, v, label = '', unit = '']) => `${csvKey(k)},${csvCell(v)},${csvKey(label)},${csvKey(unit)}`)].join('\n');
}

function keyRow(block: 'eng' | 'extra', key: string, value: string | number, locale: Locale): [string, string | number, string, string] {
  const d = describeReportKey(key, locale);
  return [`${block}.${key}`, value, reportKeyInfo(key) ? d.label : '', d.unit];
}

export function exportReportCSV(name: string, report: ShotReport, locale: Locale = 'en') {
  download(`${safe(name)}_summary.csv`, reportCsv(report, locale), 'text/csv');
}

/** a key, label or unit: quoted only when it holds a comma, a quote or a line break ('Loop voltage (avg., V)') */
function csvKey(s: string): string { return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

function csvCell(v: string | number): string { return typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`; }
function safe(s: string): string { return s.replace(/[^\w\-]+/g, '_').slice(0, 60) || 'shot'; }
