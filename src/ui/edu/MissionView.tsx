import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePopcon } from '../../physics/popcon';
import { MagneticConfig } from '../../physics/types';
import type { EduKey } from '../../edu/i18n';
import { termKeys } from '../../edu/glossary';
import { METRIC_UNITS, Outcome, PopconReading, RunData, judge, popconMetrics, readPopcon, runMetrics, solveMission } from '../../edu/missionEval';
import { Edits, Lever, Mission, buildConfig, leverStart, leverValues, missionKey, operatingPoint } from '../../edu/missions';
import { Popcon } from '../charts/Popcon';
import { fmtNum } from '../format';
import { AbortError, RunPool } from '../pool/pool';
import { Explain } from './Explain';
import { PowerFlow } from './PowerFlow';
import { useEduT } from './useEduT';
import './edu.css';

interface Props {
  mission: Mission;
  pool: RunPool;
  solved: boolean;
  onSolved: (id: Mission['id']) => void;
  onBack: () => void;
  onOpenGlossary?: (termId: string) => void;
}

type Status = 'idle' | 'running' | 'done' | 'cancelled' | 'error';
interface Result { outcome: Outcome; run?: RunData; reading?: PopconReading }

const OP = { '>=': '≥', '<=': '≤' } as const;

/** slider position of a lever value (log levers use the exponent) */
const toPos = (l: Lever, v: number) => (l.log ? Math.log10(v) : v);
const fromPos = (l: Lever, p: number) => (l.log ? 10 ** p : p);

export function MissionView({ mission, pool, solved, onSolved, onBack, onOpenGlossary }: Props) {
  const t = useEduT();
  const [edits, setEdits] = useState<Edits>({});
  const [hints, setHints] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [solutionSet, setSolutionSet] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [pct, setPct] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const ctl = useRef<AbortController | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; ctl.current?.abort(); };
  }, []);

  const values = useMemo(() => leverValues(mission, edits), [mission, edits]);
  const running = status === 'running';
  const popcon = mission.kind === 'popcon';

  // the POPCON map depends on the configuration only (not on the operating point): compute it once per H98
  const cfg = useMemo(() => buildConfig(mission, edits), [mission, edits]);
  const grid = useMemo(() => (popcon ? computePopcon(cfg as MagneticConfig) : null), [popcon, cfg]);
  const point = useMemo(() => operatingPoint(mission, edits), [mission, edits]);
  const reading = useMemo(() => (grid && point ? readPopcon(grid, point) : null), [grid, point]);

  const setEdit = useCallback((id: string, v: number | string) => {
    setEdits((e) => ({ ...e, [id]: v }));
    setSolutionSet(false);
  }, []);

  const reset = () => { setEdits({}); setSolutionSet(false); setResult(null); setStatus('idle'); setError(''); };

  const finish = (r: Result) => {
    setResult(r);
    setStatus('done');
    if (r.outcome.passed) onSolved(mission.id);
  };

  const run = async () => {
    if (popcon) {
      if (!reading) return;
      finish({ outcome: judge(mission, popconMetrics(cfg as MagneticConfig, reading)), reading });
      return;
    }
    const c = new AbortController();
    ctl.current = c;
    setStatus('running'); setPct(0); setResult(null); setError('');
    try {
      const res = await pool.run(cfg, { keepFrames: true, signal: c.signal, onProgress: (p) => { if (alive.current) setPct(p.tEnd > 0 ? p.t / p.tEnd : 0); } });
      if (!alive.current) return;
      const data: RunData = { report: res.report, frames: res.frames ?? [], events: res.events ?? [], tEnd: res.meta.tEnd };
      finish({ outcome: judge(mission, runMetrics(data)), run: data });
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof AbortError) setStatus('cancelled');
      else { setError(e instanceof Error ? e.message : String(e)); setStatus('error'); }
    } finally {
      if (ctl.current === c) ctl.current = null;
    }
  };

  const cancel = () => ctl.current?.abort();

  const showSolution = () => {
    setEdits(solveMission(mission));
    setShowAnswer(true);
    setSolutionSet(true);
    setResult(null);
    setStatus('idle');
  };

  const unit = (l: Lever) => (l.unit ? ` ${l.unit}` : '');

  return (
    <div className="edu">
      <div className="edu-head">
        <div>
          <button type="button" className="btn sm" onClick={onBack}>← {t('edu.back')}</button>
          <h2 style={{ marginTop: 8 }}>{t(missionKey(mission.id, 'title'))} {solved && <span className="badge ok">{t('edu.solved')}</span>}</h2>
          <div className="muted small">{t('edu.machine', { name: mission.machine })} · <span className="level">{'●'.repeat(mission.level)}</span> {t(`lvl.${mission.level}` as EduKey)}</div>
        </div>
      </div>

      <div className="mission">
        <div className="col">
          <section className="panel">
            <h3>{t('edu.situation')}</h3>
            <p>{t(missionKey(mission.id, 'brief'))}</p>
            <div className="term-chips" aria-label={t('edu.terms')}>
              {mission.terms.map((id) => <Explain key={id} term={id} onOpenGlossary={onOpenGlossary}><span className="chip">{t(termKeys(id).name)}</span></Explain>)}
            </div>
          </section>

          <section className="panel">
            <h3>{t('edu.controls')}</h3>
            {running && <div className="muted small">{t('edu.controlsLocked')}</div>}
            {mission.levers.map((l) => {
              const v = values[l.id];
              const start = leverStart(mission, l);
              const changed = v !== start;
              const name = t(`lever.${l.id}` as EduKey);
              const inputId = `lever-${mission.id}-${l.id}`;
              return (
                <div className="lever" key={l.id}>
                  <label htmlFor={inputId}>{name}</label>
                  <output htmlFor={inputId} className={changed ? 'changed' : ''}>{l.type === 'choice' ? String(v) : `${fmtNum(Number(v))}${unit(l)}`}</output>
                  {l.type === 'choice' ? (
                    <select id={inputId} value={String(v)} disabled={running} onChange={(e) => setEdit(l.id, e.target.value)}>
                      {l.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input id={inputId} type="range" disabled={running}
                      min={toPos(l, l.min!)} max={toPos(l, l.max!)} step={l.log ? 0.05 : l.step}
                      value={toPos(l, Number(v))} onChange={(e) => setEdit(l.id, +fromPos(l, Number(e.target.value)).toPrecision(6))} />
                  )}
                  {changed && <span className="start">{t('edu.start', { value: l.type === 'choice' ? String(start) : `${fmtNum(Number(start))}${unit(l)}` })}</span>}
                </div>
              );
            })}
            <div className="mission-actions">
              {running ? (
                <>
                  <button type="button" className="btn danger" onClick={cancel}>{t('edu.cancel')}</button>
                  <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>
                  <span className="muted small">{t('edu.running', { pct: Math.round(pct * 100) })}</span>
                </>
              ) : (
                <>
                  <button type="button" className="btn primary" onClick={() => { void run(); }}>{t(popcon ? 'edu.readMap' : 'edu.run')}</button>
                  <button type="button" className="btn" onClick={reset}>{t('edu.reset')}</button>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="mission-actions">
              <button type="button" className="btn sm" disabled={hints >= 2} onClick={() => setHints((h) => Math.min(h + 1, 2))}>{hints ? t('edu.hintOf', { n: Math.min(hints + 1, 2) }) : t('edu.hint')}</button>
              <button type="button" className="btn sm" disabled={running} onClick={showSolution}>{t('edu.showSolution')}</button>
            </div>
            {hints >= 1 && <div className="hint-box" style={{ marginTop: 8 }}>{t(missionKey(mission.id, 'hint1'))}</div>}
            {hints >= 2 && <div className="hint-box" style={{ marginTop: 6 }}>{t(missionKey(mission.id, 'hint2'))}</div>}
            {solutionSet && <div className="muted small" style={{ marginTop: 6 }}>{t('edu.solutionApplied')}</div>}
            {showAnswer && (
              <div className="lesson-box" style={{ marginTop: 8 }}><b>{t('edu.answer')}.</b> {t(missionKey(mission.id, 'answer'))}</div>
            )}
          </section>
        </div>

        <div className="col">
          <section className="panel" aria-live="polite">
            <h3>{t('edu.goals')}</h3>
            <ul className="goals">
              {mission.goals.map((g, i) => {
                const r = result?.outcome.results[i];
                const cls = r ? (r.ok ? 'ok' : 'bad') : '';
                const u = METRIC_UNITS[g.metric];
                return (
                  <li key={g.metric} className={cls}>
                    <span className="mark" aria-hidden="true">{r ? (r.ok ? '✓' : '✗') : '○'}</span>
                    <span>{t(`metric.${g.metric}` as EduKey)}</span>
                    <span className="num">
                      {OP[g.op]} {fmtNum(g.target)}{u ? ` ${u}` : ''}
                      {r && <> · <b className={cls}>{fmtNum(r.value)}</b></>}
                    </span>
                  </li>
                );
              })}
            </ul>
            {status === 'cancelled' && <div className="muted small" style={{ marginTop: 6 }}>{t('edu.cancelled')}</div>}
            {status === 'error' && <div className="bad small" role="alert" style={{ marginTop: 6 }}>{t('edu.runError', { msg: error })}</div>}
            {result && (
              <div className={`verdict ${result.outcome.passed ? 'pass' : 'fail'}`} style={{ marginTop: 8 }}>
                <b className={result.outcome.passed ? 'ok' : 'warn'}>{t(result.outcome.passed ? 'edu.pass' : 'edu.fail')}</b>
                {result.run && <span className="small">{t('edu.ended', { reason: result.run.report.termination.reason })}</span>}
                {result.run && !result.run.report.termination.natural && <div className="small muted">{result.run.report.termination.diagnosis}</div>}
                {result.reading && (
                  <div className="small">
                    {t('edu.popcon.reading', { p: fmtNum(result.reading.Paux_MW), b: fmtNum(result.reading.betaN), g: fmtNum(result.reading.nGfrac) })}
                  </div>
                )}
              </div>
            )}
            {result?.outcome.passed && <div className="lesson-box" style={{ marginTop: 8 }}><b>{t('edu.lesson')}.</b> {t(missionKey(mission.id, 'lesson'))}</div>}
          </section>

          {popcon && grid && (
            <section className="panel">
              <h3>{t('edu.popcon.map')}</h3>
              <Popcon cfg={cfg as MagneticConfig} point={point} height={300} />
              {reading && (
                <div className="small" style={{ marginTop: 6 }}>
                  {t('edu.popcon.reading', { p: fmtNum(reading.Paux_MW), b: fmtNum(reading.betaN), g: fmtNum(reading.nGfrac) })}{' '}
                  {reading.Paux_MW <= 0 ? t('edu.popcon.ignited') : t('edu.popcon.needs', { p: fmtNum(reading.Paux_MW) })}
                </div>
              )}
            </section>
          )}

          {result?.run && result.run.frames.length > 1 && (
            <section className="panel"><PowerFlow frames={result.run.frames} /></section>
          )}
        </div>
      </div>
    </div>
  );
}
