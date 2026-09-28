import React, { useEffect, useState } from 'react';
import { SimApi } from '../../useSim';
import { fmtNum, fmtTime } from '../../format';
import { useT } from '../../state/store';
import { SPEEDS } from '../controls';

interface Props { sim: SimApi; seekTo: (index: number) => void; onReport: () => void; onSetup: () => void }

/** Play/pause/step/rewind, speed, clock, timeline scrubber and the run error banner. */
export function TransportBar({ sim, seekTo, onReport, onSetup }: Props) {
  const t = useT();
  const { state } = sim;
  const { meta, frames, status } = state;
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  useEffect(() => { setScrubIdx(null); }, [state.runId, state.branchId]);
  if (!meta) return null;

  const canPlay = status === 'ready' || status === 'paused';
  const stepDt = meta.tEnd / 200;
  const release = () => { if (scrubIdx !== null) { seekTo(scrubIdx); setScrubIdx(null); } };

  return (
    <div className="panel tight controls">
      <div className="row" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 4 }}>
          {status === 'running'
            ? <button className="btn icon" onClick={sim.pause} title={t('run.pause')}>❚❚</button>
            : <button className="btn icon primary" onClick={sim.play} disabled={!canPlay} title={t('run.play')}>▶</button>}
          <button className="btn icon" onClick={() => sim.step(stepDt)} disabled={!canPlay} title={t('run.step', { dt: fmtTime(stepDt, meta.timeUnit) })}>▶❚</button>
          <button className="btn icon" onClick={() => seekTo(0)} disabled={frames.length < 2 || status === 'loading'} title={t('run.toStart')}>⏮</button>
          <button className="btn icon" onClick={sim.restart} title={t('run.restart')}>⟲</button>
        </div>
        <div className="speed-btns">
          {SPEEDS.map((s) => <button key={s} className={`btn ${state.speed === s ? 'active' : ''}`} onClick={() => sim.setSpeed(s)}>{s}×</button>)}
        </div>
        <span className="muted small">{meta.timeUnit === 's' ? t('run.realtime') : t('run.pulsedScale', { unit: meta.timeUnit })}</span>
        <div className="spacer" />
        <span className="mono small">
          t = <b>{fmtTime(state.t, meta.timeUnit)}</b> / {fmtTime(meta.tEnd, meta.timeUnit)} · dt = {fmtNum(state.dt, 2)} · {t('run.stats', { steps: state.nSteps, frames: frames.length, ms: state.wallMs.toFixed(0) })}
        </span>
        {status === 'done' && <button className="btn primary sm" onClick={onReport}>{t('run.report')}</button>}
        <button className="btn sm" onClick={onSetup}>{t('app.tab.setup')}</button>
      </div>
      <div className="timeline" style={{ marginTop: 6 }}>
        <input type="range" aria-label={t('run.timeline')} min={0} max={Math.max(frames.length - 1, 1)} value={scrubIdx ?? frames.length - 1}
          onChange={(e) => setScrubIdx(parseInt(e.target.value))} onMouseUp={release} onKeyUp={release} />
      </div>
      {scrubIdx !== null && frames[scrubIdx] && <div className="small accent">{t('run.rewindTo', { t: fmtTime(frames[scrubIdx].t, meta.timeUnit) })}</div>}
      {status === 'error' && (
        <div className="diag-box bad" role="alert" style={{ marginTop: 6 }}>
          <b>{t('run.errTitle')}</b> <span className="small muted">{t('run.errHint')}</span>
          <pre className="err" style={{ margin: '4px 0 0', maxHeight: 160, overflow: 'auto' }}>{state.error}</pre>
        </div>
      )}
    </div>
  );
}
