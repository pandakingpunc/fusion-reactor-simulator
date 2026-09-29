/**
 * The run view's scenario panel: for every control that the scenario drives (or that changed during the run) a lane with the programmed
 * waveform and the value the control actually had at each frame, a cursor at the simulated time, and the record button that turns
 * the live interventions into a scenario (applied to the next run, edited in Setup).
 *
 * Recording asks the simulation worker for the actuator log of the run as it stands (`getLog`; the answer arrives in the run state as
 * `logAnswer`) and builds the scenario with scenarioFromActuatorLog against the configured values of the model's controls.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { SimApi } from '../useSim';
import { useAppStore } from '../state/store';
import './scenario.css';
import { WaveformLane, type LaneSeries } from './WaveformLane';
import { controlInfo, editorContext, laneKeys, scenarioFromActuatorLog } from './model';
import { probeOnce } from './useModel';
import { useScenarioT } from './useScenarioT';

type Note = { kind: 'busy' } | { kind: 'ok'; n: number } | { kind: 'none' } | { kind: 'fail'; reason: string };

let lastToken = 0;

export default function ScenarioPanel({ sim }: { sim: SimApi }) {
  const t = useScenarioT();
  const { actions } = useAppStore();
  const s = sim.state;
  const { meta, frames, trace, scenario, logAnswer } = s;
  const [note, setNote] = useState<Note | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);

  // a different run: an answer that has not come will not come
  useEffect(() => { setWaiting(null); setNote(null); }, [s.runId]);

  useEffect(() => {
    if (waiting === null || !logAnswer || logAnswer.token !== waiting || !meta) return;
    setWaiting(null);
    const log = logAnswer.provenance.actuatorLog;
    if (!log.length) { setNote({ kind: 'none' }); return; }
    // the configured values of the controls (the meta of a run with a scenario already has its t = 0 values applied)
    void (s.cfg ? probeOnce(s.cfg, sim.createWorker).catch(() => meta) : Promise.resolve(meta)).then(
      (base) => { actions.setScenario(scenarioFromActuatorLog(log, scenario, editorContext(base))); setNote({ kind: 'ok', n: log.length }); },
      (e: unknown) => setNote({ kind: 'fail', reason: e instanceof Error ? e.message : String(e) }),
    );
  }, [waiting, logAnswer]); // eslint-disable-line react-hooks/exhaustive-deps

  const lanes = useMemo(() => {
    if (!meta) return [];
    const driven = new Set<string>(Object.keys(scenario?.waveforms ?? {}));
    for (const tr of scenario?.triggers ?? []) for (const k of [...Object.keys(tr.set), ...Object.keys(tr.release ?? {})]) driven.add(k);
    // controls whose value changed during the run (a live intervention, a trigger)
    const keys = Object.keys(meta.controls);
    if (trace) keys.forEach((k, j) => { const v0 = trace[0]?.[j]; if (trace.some((r) => r[j] !== v0)) driven.add(k); });
    return laneKeys({ controls: meta.controls, diagSpecs: [], tEnd: meta.tEnd, timeUnit: meta.timeUnit }).filter((k) => driven.has(k));
  }, [meta, scenario, trace]);

  const times = useMemo(() => frames.map((f) => f.t), [frames]);
  if (!meta) return null;
  const keys = Object.keys(meta.controls);

  const record = () => {
    setNote({ kind: 'busy' });
    const token = ++lastToken;
    setWaiting(token);
    sim.post({ type: 'getLog', token });
  };

  return (
    <div className="panel scn" data-testid="scenario-panel">
      <div className="panel-title">
        <h3>{t('scn.run.title')}{scenario?.name ? ` · ${scenario.name}` : ''}</h3>
        <button type="button" className="btn sm" onClick={() => actions.setTab('setup')}>{t('scn.run.edit')}</button>
      </div>
      {lanes.length > 0 && <p className="hint">{t('scn.run.legend')}</p>}
      {lanes.map((key) => {
        const info = controlInfo(key);
        const j = keys.indexOf(key);
        const actual: LaneSeries | undefined = trace ? { t: times, v: trace.map((r) => r[j]) } : undefined;
        return (
          <div key={key} className="scn-card" data-testid={`run-lane-${key}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{info.label === key ? key : `${info.label} (${key})`}{info.unit && <span className="muted"> [{info.unit}]</span>}</b>
              <span className="scn-legend"><span><i className="sw" />{t('scn.run.programmed')}</span><span><i className="sw actual" />{t('scn.run.actual')}</span></span>
            </div>
            <WaveformLane ctlKey={key} label={info.label} unit={info.unit} wf={scenario?.waveforms?.[key] ?? null} base={meta.controls[key] ?? 0} tEnd={meta.tEnd}
              timeUnit={meta.timeUnit} actual={actual} now={s.t} />
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm primary" disabled={s.interventions === 0 || waiting !== null} title={t('scn.run.recordHint')} onClick={record}>{t('scn.run.record')}</button>
        <span className="muted small">{s.interventions ? t('scn.run.interventions', { n: s.interventions }) : t('scn.run.none')}</span>
      </div>
      {note && (
        <p role="status" className={`small ${note.kind === 'fail' ? 'warn' : note.kind === 'ok' ? 'ok' : 'muted'}`}>
          {note.kind === 'busy' ? t('scn.run.recording') : note.kind === 'ok' ? t('scn.run.recorded', { n: note.n }) : note.kind === 'none' ? t('scn.run.none') : t('scn.run.recordFailed', { reason: note.reason })}
        </p>
      )}
    </div>
  );
}
