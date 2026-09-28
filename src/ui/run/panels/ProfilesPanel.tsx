import React from 'react';
import { UiFrame } from '../../../worker/protocol';
import { ProfileChart } from '../../charts/ProfileChart';
import { fmtTime } from '../../format';
import { useT } from '../../state/store';

interface Props { profFrame: UiFrame | null; timeUnit: string }

/** Radial profiles of the latest profile frame (1.5D transport). */
export function ProfilesPanel({ profFrame, timeUnit }: Props) {
  const t = useT();
  return (
    <div className="panel tight">
      <div className="panel-title"><h3>{t('run.profiles')}</h3><span className="muted small">{t('run.profilesSub')}</span></div>
      <ProfileChart prof={profFrame?.prof} t={profFrame ? `t = ${fmtTime(profFrame.t, timeUnit)}` : undefined} height={230} />
    </div>
  );
}
