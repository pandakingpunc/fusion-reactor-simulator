import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { MagneticConfig } from '../../physics/types';
import { UiFrame } from '../../worker/protocol';
import { SimApi } from '../useSim';
import { useT } from '../state/store';
import { DEFAULT_CHART_GROUPS } from './controls';
import { TransportBar } from './panels/TransportBar';
import { LiveValuesPanel } from './panels/LiveValuesPanel';
import { ControlsPanel } from './panels/ControlsPanel';
import { EventLogPanel } from './panels/EventLogPanel';
import { ChartsPanel } from './panels/ChartsPanel';
import { CrossSectionPanel } from './panels/CrossSectionPanel';
import { PopconPanel } from './panels/PopconPanel';
import { GeometryPanel } from './panels/GeometryPanel';
import { Viz3DPanel } from '../viz3d/Viz3DPanel';
import { ErrorBoundary } from '../ErrorBoundary';

// Panels that only some runs show are chunks of their own, loaded when such a run opens (the first-load bundle keeps the panels every run has):
// the radial profiles (1.5D), the implosion view (pulsed devices), and the scenario lanes with the record button (a run with a scenario or a live intervention).
const ProfilesPanel = lazy(() => import('./panels/ProfilesPanel').then((m) => ({ default: m.ProfilesPanel })));
const ImplosionPanel = lazy(() => import('./panels/ImplosionPanel').then((m) => ({ default: m.ImplosionPanel })));
const ScenarioPanel = lazy(() => import('../scenario/ScenarioPanel'));

/** `embedded`: the chrome-less embed page, which has no Setup: the scenario panel then only shows the lanes */
interface Props { sim: SimApi; onReport: () => void; onSetup: () => void; embedded?: boolean }

/** 1.5D: son profil karesi ve son denge anlık görüntüsü */
export function latestProfileFrames(frames: UiFrame[]): { profFrame: UiFrame | null; eqFrame: UiFrame | null } {
  let profFrame: UiFrame | null = null, eqFrame: UiFrame | null = null;
  for (let i = frames.length - 1; i >= 0 && (!profFrame || !eqFrame); i--) {
    if (!profFrame && frames[i].prof) profFrame = frames[i];
    if (!eqFrame && frames[i].eq) eqFrame = frames[i];
  }
  return { profFrame, eqFrame };
}

/** Live run screen: layout only; each panel lives in ./panels. */
export function RunScreen({ sim, onReport, onSetup, embedded = false }: Props) {
  const t = useT();
  const { state } = sim;
  const { meta, frames, events, status } = state;
  const last = frames.length ? frames[frames.length - 1] : null;
  const [groupsOn, setGroupsOn] = useState<ReadonlySet<string>>(() => new Set(DEFAULT_CHART_GROUPS));
  const toggleGroup = useCallback((name: string) => setGroupsOn((s) => {
    const n = new Set(s);
    if (n.has(name)) n.delete(name); else n.add(name);
    return n;
  }), []);
  const { profFrame, eqFrame } = useMemo(() => latestProfileFrames(frames), [frames]);

  if (!meta) {
    return (
      <div className="panel">
        {status === 'error' ? (
          <div className="diag-box bad" role="alert">
            <b>{t('run.errTitle')}</b>
            <pre className="err" style={{ margin: '4px 0 6px' }}>{state.error}</pre>
            <button className="btn sm" onClick={onSetup}>{t('app.tab.setup')}</button>
          </div>
        ) : <span className="muted">{t('run.loading')}</span>}
      </div>
    );
  }

  const isMag = meta.kind === 'magnetic' && (meta.method === 'tokamak' || meta.method === 'spherical_tokamak' || meta.method === 'stellarator');
  const isPulsed = meta.kind === 'pulsed';
  const is15 = (meta.geometry.profiles ?? 0) > 0;
  const cfg = state.cfg!;
  const canSeek = status === 'ready' || status === 'paused' || status === 'done';

  const seekTo = (idx: number) => sim.rewind(Math.max(0, Math.min(idx, frames.length - 1)));
  // frame times do not strictly increase: the terminal frame of a failed 1.5D step repeats the time of the frame before it;
  // the first frame at or after `time` is then the last good one, which is the state worth rewinding to
  const seekT = (time: number) => { let lo = 0; while (lo < frames.length - 1 && frames[lo].t < time) lo++; seekTo(lo); };
  // each panel fails on its own: a drawing error shows in that panel, the rest of the run screen goes on
  const keys = [state.runId, state.branchId];
  const guard = (panel: React.ReactNode) => <ErrorBoundary variant="panel" resetKeys={keys}>{panel}</ErrorBoundary>;
  const lazyGuard = (panel: React.ReactNode) => guard(<Suspense fallback={null}>{panel}</Suspense>);

  return (
    <div className="run">
      {guard(<TransportBar sim={sim} seekTo={seekTo} onReport={onReport} onSetup={onSetup} />)}

      <div className="left">
        {guard(<LiveValuesPanel meta={meta} last={last} report={state.report} frames={frames} />)}
        {guard(<ControlsPanel controls={state.controls} defaults={meta.controls} disabled={status === 'done'} onChange={sim.control} />)}
        {guard(<EventLogPanel events={events} timeUnit={meta.timeUnit} cfg={cfg} />)}
      </div>

      <div className="center">
        {guard(<ChartsPanel meta={meta} frames={frames} events={events} groupsOn={groupsOn} onToggleGroup={toggleGroup}
          live={status === 'running'} resetKey={state.runId} onSeek={canSeek ? seekT : undefined} />)}
        {(state.scenario || state.interventions > 0) && lazyGuard(<ScenarioPanel sim={sim} embedded={embedded} />)}
      </div>

      <div className="right">
        {isMag && last && guard(
          <CrossSectionPanel meta={meta} cfg={cfg as MagneticConfig} last={last} events={events}
            disrupted={status === 'done' && !!state.report?.termination?.disruption} eqFrame={eqFrame} profFrame={profFrame} />,
        )}
        {isMag && last && guard(
          <Viz3DPanel meta={meta} cfg={cfg as MagneticConfig} last={last} events={events}
            disrupted={status === 'done' && !!state.report?.termination?.disruption} eqFrame={eqFrame} profFrame={profFrame} />,
        )}
        {is15 && lazyGuard(<ProfilesPanel profFrame={profFrame} timeUnit={meta.timeUnit} />)}
        {isMag && guard(<PopconPanel cfg={cfg as MagneticConfig} last={last} frames={frames} controls={state.controls} onSteer={sim.control} steerable={status !== 'done'} />)}
        {isPulsed && lazyGuard(<ImplosionPanel meta={meta} cfg={cfg} frames={frames} t={state.t} />)}
        {guard(<GeometryPanel geometry={meta.geometry} />)}
      </div>
    </div>
  );
}
