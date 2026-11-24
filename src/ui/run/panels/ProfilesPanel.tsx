import React, { useState } from 'react';
import type { SimEvent } from '../../../physics/types';
import { UiFrame } from '../../../worker/protocol';
import { ProfileChart } from '../../charts/ProfileChart';
import { RhoTHeatmap } from '../../charts/RhoTHeatmap';
import { fmtTime } from '../../format';
import { useT } from '../../state/store';

interface Props {
  profFrame: UiFrame | null;
  timeUnit: string;
  /** all frames of the run (for the live radius-time heatmap) */
  frames?: readonly UiFrame[];
  events?: readonly SimEvent[];
  onSeek?: (t: number) => void;
}

/** Radial profiles of the latest profile frame and optional radius-time heat map (1.5D transport). */
export function ProfilesPanel({ profFrame, timeUnit, frames = [], events = [], onSeek }: Props) {
  const t = useT();
  const [mode, setMode] = useState<'prof' | 'rhot'>('prof');
  const canMap = frames.filter((f) => f.prof?.rho?.length).length >= 2;
  const active = mode === 'rhot' && canMap ? 'rhot' : 'prof';
  return (
    <div className="panel tight">
      <div className="panel-title">
        <h3>{t('run.profiles')}</h3>
        <div className="row" style={{ gap: 4 }}>
          {canMap && (
            <span className="speed-btns" role="group" aria-label={t('run.profilesMode')}>
              <button type="button" className={`btn sm ${active === 'prof' ? 'active' : ''}`} aria-pressed={active === 'prof'} onClick={() => setMode('prof')}>{t('run.profilesTab')}</button>
              <button type="button" className={`btn sm ${active === 'rhot' ? 'active' : ''}`} aria-pressed={active === 'rhot'} onClick={() => setMode('rhot')}>ρ–t</button>
            </span>
          )}
          <span className="muted small">{t('run.profilesSub')}</span>
        </div>
      </div>
      {active === 'rhot'
        ? <RhoTHeatmap frames={frames} events={events} timeUnit={timeUnit} cursorT={profFrame?.t} onSelectT={onSeek} height={230} />
        : <ProfileChart prof={profFrame?.prof} t={profFrame ? `t = ${fmtTime(profFrame.t, timeUnit)}` : undefined} height={230} />}
    </div>
  );
}
