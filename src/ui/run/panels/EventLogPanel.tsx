import React from 'react';
import { SimEvent } from '../../../physics/types';
import { fmtTime } from '../../format';
import { useT } from '../../state/store';

interface Props { events: SimEvent[]; timeUnit: string }

/** Most recent 200 events, newest first. */
export function EventLogPanel({ events, timeUnit }: Props) {
  const t = useT();
  return (
    <div className="panel">
      <div className="panel-title"><h3>{t('run.events')}</h3><span className="muted small">{events.length}</span></div>
      <div className="event-log">
        {events.length === 0 && <span className="muted">{t('run.noEvents')}</span>}
        {events.slice(-200).reverse().map((ev, i) => (
          <div key={i} className={`event ${ev.kind}`}><span className="t">{fmtTime(ev.t, timeUnit)}</span><span>{ev.msg}</span></div>
        ))}
      </div>
    </div>
  );
}
