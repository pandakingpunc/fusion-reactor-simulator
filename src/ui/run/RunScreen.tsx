import React, { useCallback, useMemo, useState } from 'react';
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
import { ProfilesPanel } from './panels/ProfilesPanel';
import { PopconPanel } from './panels/PopconPanel';
import { ImplosionPanel } from './panels/ImplosionPanel';
import { GeometryPanel } from './panels/GeometryPanel';

interface Props { sim: SimApi; onReport: () => void; onSetup: () => void }

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
export function RunScreen({ sim, onReport, onSetup }: Props) {
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
    return <div className="panel">{status === 'error' ? <pre className="err" role="alert">{state.error}</pre> : <span className="muted">{t('run.loading')}</span>}</div>;
  }

  const isMag = meta.kind === 'magnetic' && (meta.method === 'tokamak' || meta.method === 'spherical_tokamak' || meta.method === 'stellarator');
  const isPulsed = meta.kind === 'pulsed';
  const is15 = (meta.geometry.profiles ?? 0) > 0;
  const cfg = state.cfg!;
  const canSeek = status === 'ready' || status === 'paused' || status === 'done';

  const seekTo = (idx: number) => sim.rewind(Math.max(0, Math.min(idx, frames.length - 1)));
  const seekT = (time: number) => { let lo = 0; while (lo < frames.length - 1 && frames[lo].t < time) lo++; seekTo(lo); };

  return (
    <div className="run">
      <TransportBar sim={sim} seekTo={seekTo} onReport={onReport} onSetup={onSetup} />

      <div className="left">
        <LiveValuesPanel meta={meta} last={last} report={state.report} />
        <ControlsPanel controls={state.controls} defaults={meta.controls} disabled={status === 'done'} onChange={sim.control} />
        <EventLogPanel events={events} timeUnit={meta.timeUnit} />
      </div>

      <div className="center">
        <ChartsPanel meta={meta} frames={frames} events={events} groupsOn={groupsOn} onToggleGroup={toggleGroup}
          live={status === 'running'} resetKey={state.runId} onSeek={canSeek ? seekT : undefined} />
      </div>

      <div className="right">
        {isMag && last && (
          <CrossSectionPanel meta={meta} cfg={cfg as MagneticConfig} last={last} events={events}
            disrupted={status === 'done' && !!state.report?.termination?.disruption} eqFrame={eqFrame} profFrame={profFrame} />
        )}
        {is15 && <ProfilesPanel profFrame={profFrame} timeUnit={meta.timeUnit} />}
        {isMag && <PopconPanel cfg={cfg as MagneticConfig} last={last} />}
        {isPulsed && <ImplosionPanel meta={meta} cfg={cfg} frames={frames} t={state.t} />}
        <GeometryPanel geometry={meta.geometry} />
      </div>
    </div>
  );
}
