/** CSV / JSON dışa aktarma (Blob indirme). */
import { ReactorConfig, ShotReport, SimEvent } from '../../physics/types';
import { UiFrame } from '../../worker/protocol';
import { DiagSpec } from '../../physics/types';
import type { RunProvenance } from '../persist/types';

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

export function exportReportCSV(name: string, report: ShotReport) {
  const rows: [string, string | number][] = [
    ['method', report.method], ['duration', report.duration], ['timeUnit', report.timeUnit],
    ['Tmax_keV', report.Tmax_keV], ['Tmax_MC', report.Tmax_MC], ['Timax_keV', report.Timax_keV], ['Temax_keV', report.Temax_keV],
    ['stableTime_s', report.stableTime_s], ['burnTime_s', report.burnTime_s], ['ignitionTime_s', report.ignitionTime_s],
    ['Q_sci_max', report.Q_sci_max], ['Q_sci_avg', report.Q_sci_avg], ['Q_eng', report.Q_eng],
    ['E_fusion_MJ', report.E_fusion_MJ], ['E_input_MJ', report.E_input_MJ], ['neutronYield', report.neutronYield], ['neutronFluence_m2', report.neutronFluence_m2],
    ['tripleProduct_max', report.tripleProduct_max], ['lawson_ratio', report.lawson_ratio], ['score', report.score],
    ['termination', report.termination.reason],
    ...Object.entries(report.engineering).map(([k, v]) => [`eng.${k}`, String(v)] as [string, string]),
    ...Object.entries(report.extras).map(([k, v]) => [`extra.${k}`, v] as [string, string | number]),
  ];
  download(`${safe(name)}_summary.csv`, ['key,value', ...rows.map(([k, v]) => `${k},${csvCell(v)}`)].join('\n'), 'text/csv');
}

function csvCell(v: string | number): string { return typeof v === 'number' ? String(v) : `"${v.replace(/"/g, '""')}"`; }
function safe(s: string): string { return s.replace(/[^\w\-]+/g, '_').slice(0, 60) || 'shot'; }
