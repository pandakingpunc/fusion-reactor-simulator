import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactorConfig, ShotReport } from '../../physics/types';
import { PRESETS, Preset } from '../../physics/presets';
import { WorkerFactory } from '../state/sim';
import { fmtNum } from '../format';
import { useEduT } from '../edu/useEduT';
import { useWizText } from '../wizard/wizText';
import '../edu/edu.css';
import { AbortError, RunPool } from './pool';

interface Props {
  /** simulation worker factory (tests inject a fake worker) */
  createWorker: WorkerFactory;
  /** pool to run on (a pool of the screen's own by default) */
  pool?: RunPool;
  /** the tests and the presets of the scan (the published set by default; tests use small ones) */
  tests?: TestDef[];
  presets?: Preset[];
}

/** Bir doğrulama ölçütü: rapordan bir sayı çek, [lo, hi] aralığında mı bak. */
export interface Criterion { label: string; get: (r: ShotReport) => number; lo: number; hi: number; unit: string; source: string }
/**
 * A test of the panel. `knownMiss`: the model is documented to miss this one (a known failure of npm run validate, references.ts): when it
 * misses, the badge says so instead of FAIL, and the panel points at the documentation. It is a statement about a result that exists, never a
 * reason to move a range.
 */
export interface TestDef { id: string; presetId: string; title: string; criteria: Criterion[]; knownMiss?: boolean }

// Beklenen değerler yayınlanmış deney/tasarım sonuçlarından (eğitsel toleranslarla).
// The NIF ranges are those of the literature table (src/physics/validation/references.ts, rows NIF210808.G and NIF.G; the yield of N210808 by the
// factor 3 of the yield tolerance): Validation.test.tsx compares them with the table, so the panel cannot drift from `npm run validate`.
export const TESTS: TestDef[] = [
  {
    id: 'iter', presetId: 'ITER', title: 'ITER — Q ≈ 10 (design point)',
    criteria: [
      { label: 'Q_sci max', get: (r) => r.Q_sci_max, lo: 8, hi: 20, unit: '', source: 'ITER Physics Basis 1999; Q=10 target, 0D model accepts up to 20' },
      { label: 'T_i max', get: (r) => r.Timax_keV, lo: 8, hi: 20, unit: 'keV', source: '⟨T_i⟩ ≈ 8–10 keV, peak ≈ 20 keV' },
      { label: 'No disruption', get: (r) => (r.termination.disruption ? 1 : 0), lo: 0, hi: 0, unit: '', source: 'Design point within all limits' },
    ],
  },
  {
    id: 'jet', presetId: 'JET', title: 'JET DTE2 (2021) — 59 MJ',
    criteria: [
      { label: 'E_fusion', get: (r) => r.E_fusion_MJ, lo: 45, hi: 75, unit: 'MJ', source: 'JET DTE2 record shot #99971: 59 MJ / 5 s' },
      { label: 'Q_sci avg.', get: (r) => r.Q_sci_avg, lo: 0.2, hi: 0.6, unit: '', source: 'Q ≈ 0.33' },
    ],
  },
  {
    id: 'iter15', presetId: 'ITER15', title: 'ITER 1.5D — profiles, equilibrium, MHD',
    criteria: [
      { label: 'Q_sci avg. (E_fus/E_in)', get: (r) => r.Q_sci_avg, lo: 5, hi: 20, unit: '', source: 'ITER Q = 10 baseline (Shimada et al., NF 47 (2007) S1)' },
      { label: 'Bootstrap fraction', get: (r) => Number(r.engineering['Bootstrap fraction (avg.)']), lo: 0.1, hi: 0.4, unit: '', source: 'Inductive scenario f_bs ≈ 0.15–0.25 (Sips 2005)' },
      { label: 'ℓ_i(3)', get: (r) => Number(r.engineering['ℓ_i(3) (avg.)']), lo: 0.6, hi: 1.1, unit: '', source: 'ITER flat-top ℓ_i(3) ≈ 0.7–1.0' },
      { label: 'T_e pedestal', get: (r) => Number(r.extras['T_ped (final, keV)']), lo: 2, hi: 7, unit: 'keV', source: 'EPED prediction T_ped ≈ 4–5 keV' },
      { label: 'No disruption', get: (r) => (r.termination.disruption ? 1 : 0), lo: 0, hi: 0, unit: '', source: 'Sawteeth/ELMs/NTMs must not terminate the baseline' },
    ],
  },
  {
    // the calibration shot: the ICF model's one constant is fitted to this yield, so a pass here is by construction and not a validation
    id: 'nif210808', presetId: 'NIF210808', title: 'NIF N210808 — gain 0.72 (calibration shot)',
    criteria: [
      { label: 'Gain (Q)', get: (r) => r.Q_sci_max, lo: 0.36, hi: 1.44, unit: '', source: '1.917 MJ laser → 1.37 MJ fusion (Aug 2021); the ICF model is fitted to this yield' },
      { label: 'E_fusion', get: (r) => r.E_fusion_MJ, lo: 0.456, hi: 4.11, unit: 'MJ', source: '1.37 MJ (the calibration target)' },
    ],
  },
  {
    // predicted without re-fitting: the model runs the calibration capsule, G = 0.67, and misses (npm run validate: NIF.G, a documented known failure)
    id: 'nif', presetId: 'NIF', title: 'NIF N221204 — gain ≈ 1.5', knownMiss: true,
    criteria: [
      { label: 'Gain (Q)', get: (r) => r.Q_sci_max, lo: 1, hi: 3, unit: '', source: '2.05 MJ laser → 3.15 MJ fusion (Dec 2022)' },
      { label: 'E_fusion', get: (r) => r.E_fusion_MJ, lo: 2, hi: 4.5, unit: 'MJ', source: '3.15 MJ' },
    ],
  },
];

type Status = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled';
interface Item { status: Status; pct: number; report?: ShotReport; error?: string; ms?: number }

const IDLE: Item = { status: 'idle', pct: 0 };
const testKey = (id: string) => `test:${id}`;
const presetKey = (id: string) => `preset:${id}`;
const pending = (s: Status) => s === 'queued' || s === 'running';

function inRange(c: Criterion, r: ShotReport): boolean { const v = c.get(r); return isFinite(v) && v >= c.lo && v <= c.hi; }

/**
 * The validation view: the model is run against published experiments and design points. The runs (four tests and
 * the scan of every preset) are queued on a pool of background workers, so they go in parallel; a cancel button
 * (and the per-run progress) stops the whole batch, terminating the workers that are in the middle of a run.
 */
export function Validation({ createWorker, pool: given, tests = TESTS, presets = PRESETS }: Props) {
  const t = useEduT();
  const wt = useWizText();
  const [own] = useState(() => (given ? null : new RunPool(createWorker)));
  const pool = given ?? own!;
  const [items, setItems] = useState<Record<string, Item>>({});
  const [batch, setBatch] = useState({ total: 0, finished: 0 });
  const ctl = useRef<AbortController | null>(null);
  /** runs of the current batch that have not settled yet */
  const active = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ctl.current?.abort(); pool.dispose(); };
  }, [pool]);

  const patch = useCallback((key: string, p: Partial<Item>) => {
    if (alive.current) setItems((s) => ({ ...s, [key]: { ...(s[key] ?? IDLE), ...p } }));
  }, []);

  /** queue one run under the current batch's abort controller */
  const submit = useCallback((key: string, cfg: ReactorConfig): Promise<void> => {
    // the first run of a new batch starts a fresh abort controller and a fresh progress count
    if (active.current === 0) { ctl.current = new AbortController(); if (alive.current) setBatch({ total: 0, finished: 0 }); }
    active.current++;
    const signal = ctl.current!.signal;
    let t0 = performance.now();
    patch(key, { status: 'queued', pct: 0, report: undefined, error: undefined, ms: undefined });
    if (alive.current) setBatch((b) => ({ ...b, total: b.total + 1 }));
    const settle = () => { active.current--; if (alive.current) setBatch((b) => ({ ...b, finished: b.finished + 1 })); };
    return pool.run(cfg, {
      signal,
      onStart: () => { t0 = performance.now(); patch(key, { status: 'running' }); },
      onProgress: (p) => patch(key, { pct: p.tEnd > 0 ? Math.min(p.t / p.tEnd, 1) : 0 }),
    }).then(
      (res) => { patch(key, { status: 'done', pct: 1, report: res.report, ms: performance.now() - t0 }); settle(); },
      (e: unknown) => {
        if (e instanceof AbortError) patch(key, { status: 'cancelled' });
        else patch(key, { status: 'error', error: e instanceof Error ? e.message : String(e) });
        settle();
      },
    );
  }, [pool, patch]);

  const runTest = (def: TestDef) => {
    const preset = presets.find((p) => p.id === def.presetId);
    if (preset) void submit(testKey(def.id), preset.cfg);
  };
  const runTests = () => { for (const def of tests) runTest(def); };
  const runScan = () => { for (const p of presets) void submit(presetKey(p.id), p.cfg); };
  const runEverything = () => { runTests(); runScan(); };
  const cancel = () => ctl.current?.abort();

  const anyPending = Object.values(items).some((i) => pending(i.status));
  const get = (key: string): Item => items[key] ?? IDLE;

  const finished = tests.filter((d) => get(testKey(d.id)).report);
  const passed = (d: TestDef): boolean => d.criteria.every((c) => inRange(c, get(testKey(d.id)).report!));
  const passCount = finished.filter(passed).length;
  /** tests that missed, but are documented to */
  const knownCount = finished.filter((d) => !passed(d) && d.knownMiss).length;
  const sweepRows = presets.filter((p) => get(presetKey(p.id)).status !== 'idle');

  const stateText = (i: Item): string => (i.status === 'queued' ? t('val.queued') : i.status === 'running' ? t('val.running', { pct: Math.round(i.pct * 100) })
    : i.status === 'cancelled' ? t('val.cancelled') : '');

  return (
    <div className="report">
      <div className="panel full">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('val.title')}</h2>
            <div className="muted small">{t('val.sub', { n: pool.size })}</div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={runTests} disabled={anyPending}>{t('val.runTests', { n: tests.length })}</button>
            <button className="btn" onClick={runScan} disabled={anyPending}>{t('val.scan')}</button>
            <button className="btn" onClick={runEverything} disabled={anyPending}>{t('val.runAll')}</button>
            {anyPending && <button className="btn danger" onClick={cancel}>{t('val.cancel')}</button>}
          </div>
        </div>
        {(anyPending || batch.total > 0) && (
          <div role="status" aria-live="polite">
            <div className="val-bar" aria-hidden="true"><span style={{ width: `${batch.total ? (100 * batch.finished) / batch.total : 0}%` }} /></div>
            <div className="val-state">{t('val.progress', { done: batch.finished, total: batch.total })}</div>
          </div>
        )}
        {finished.length > 0 && <div style={{ marginTop: 6 }}><span className={`badge ${passCount === finished.length ? 'ok' : passCount + knownCount === finished.length ? 'warn' : 'bad'}`}>{t('val.passed', { n: passCount, m: finished.length })}</span></div>}
      </div>

      {tests.map((def) => {
        const it = get(testKey(def.id));
        const row = it.report;
        const ok = row ? def.criteria.every((c) => inRange(c, row)) : undefined;
        const known = ok === false && def.knownMiss === true;
        return (
          <div className="panel" key={def.id}>
            <div className="panel-title">
              <h3>{wt(def.title)}</h3>
              <span className="row" style={{ gap: 6 }}>
                {ok !== undefined && <span className={`badge ${ok ? 'ok' : known ? 'warn' : 'bad'}`}>{t(ok ? 'val.pass' : known ? 'val.known' : 'val.fail')}</span>}
                {stateText(it) && <span className="val-state">{stateText(it)}</span>}
                <button className="btn sm" onClick={() => runTest(def)} disabled={pending(it.status)}>{t('val.run')}</button>
              </span>
            </div>
            {pending(it.status) && <div className="val-bar" aria-hidden="true"><span style={{ width: `${Math.round(it.pct * 100)}%` }} /></div>}
            {it.error && <pre className="err">{it.error}</pre>}
            {known && <div className="small muted">{t('val.knownNote')}</div>}
            <table className="kv"><tbody>
              {def.criteria.map((c) => {
                const v = row ? c.get(row) : undefined;
                const pass = row ? inRange(c, row) : undefined;
                return (
                  <tr key={c.label}>
                    <td>{wt(c.label)}<div className="small muted">{wt(c.source)}</div></td>
                    <td className="num">
                      <span className="muted">[{fmtNum(c.lo)} … {fmtNum(c.hi)}] {c.unit}</span><br />
                      {v === undefined ? <span className="muted">—</span> : <b className={pass ? 'ok' : 'bad'}>{fmtNum(v)} {c.unit}</b>}
                    </td>
                  </tr>
                );
              })}
              {row && (
                <tr><td className="small muted">{t('val.termination')}</td><td className="small muted">{row.termination.reason} · {it.ms?.toFixed(0)} ms</td></tr>
              )}
            </tbody></table>
          </div>
        );
      })}

      {sweepRows.length > 0 && (
        <div className="panel full" style={{ overflowX: 'auto' }}>
          <h3>{t('val.scanTitle')}</h3>
          <table className="cmp">
            <thead><tr><th>{t('val.col.preset')}</th><th>{t('val.col.expected')}</th><th>{t('val.col.qmax')}</th><th>{t('val.col.tmax')}</th><th>{t('val.col.efus')}</th><th>{t('val.col.term')}</th><th>{t('val.col.score')}</th></tr></thead>
            <tbody>
              {sweepRows.map((p) => {
                const it = get(presetKey(p.id)), r = it.report;
                return (
                  <tr key={p.id}>
                    <td>{wt(p.name)}</td>
                    <td className="small muted">{p.validation ?? '—'}</td>
                    {r ? (
                      <>
                        <td>{fmtNum(r.Q_sci_max)}</td><td>{fmtNum(r.Tmax_keV)}</td><td>{fmtNum(r.E_fusion_MJ)}</td>
                        <td className={r.termination.disruption ? 'bad' : ''}>{r.termination.reason}</td><td>{Math.round(r.score)}</td>
                      </>
                    ) : it.error ? <td colSpan={5} className="bad">{it.error}</td>
                      : <td colSpan={5} className="muted small">{stateText(it)}{pending(it.status) && <div className="val-bar"><span style={{ width: `${Math.round(it.pct * 100)}%` }} /></div>}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

