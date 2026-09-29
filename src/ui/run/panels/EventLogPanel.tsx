import React from 'react';
import { useMemo } from 'react';
import { ReactorConfig, SimEvent } from '../../../physics/types';
import { fmtTime } from '../../format';
import { useT } from '../../state/store';
import { withStepNotes } from '../../settingsNotes';

interface Props { events: SimEvent[]; timeUnit: string; /** the run's configuration: its step-control notes are shown in the interface language and survive a rewind to the start */ cfg?: ReactorConfig }

/** Most recent 200 events, newest first. */
export function EventLogPanel({ events, timeUnit, cfg }: Props) {
  const t = useT();
  const shown = useMemo(() => (cfg ? withStepNotes(events, cfg, t) : events), [events, cfg, t]);
  return (
    <div className="panel">
      <div className="panel-title"><h3>{t('run.events')}</h3><span className="muted small">{shown.length}</span></div>
      <div className="event-log">
        {shown.length === 0 && <span className="muted">{t('run.noEvents')}</span>}
        {shown.slice(-200).reverse().map((ev, i) => (
          <div key={i} className={`event ${ev.kind}`}><span className="t">{fmtTime(ev.t, timeUnit)}</span><span>{ev.msg}</span></div>
        ))}
      </div>
    </div>
  );
}
