import React from 'react';
import { useMemo, useState } from 'react';
import { ReactorConfig, SimEvent } from '../../../physics/types';
import { isMessageKey } from '../../../i18n';
import { fmtTime } from '../../format';
import { usePhysicsText, useT } from '../../state/store';
import { withStepNotes } from '../../settingsNotes';

interface Props { events: SimEvent[]; timeUnit: string; /** the run's configuration: its step-control notes are shown in the interface language and survive a rewind to the start */ cfg?: ReactorConfig }

/** Chip order: the kinds the physics can emit, in the order of the dictionary; a kind not listed follows in order of appearance. */
const KIND_ORDER = ['ELM', 'sawtooth', 'NTM_onset', 'NTM_gone', 'LH', 'HL', 'disruption', 'quench', 'ignition', 'burn_start', 'burn_end', 'warning', 'stagnation', 'end', 'info'];

/** Most recent 200 events of the kinds that are switched on, newest first. */
export function EventLogPanel({ events, timeUnit, cfg }: Props) {
  const t = useT();
  const px = usePhysicsText(); // the model's sentences in the interface language (i18n/physicsText.ts); the step notes are already translated and pass through
  const shown = useMemo(() => (cfg ? withStepNotes(events, cfg, t) : events), [events, cfg, t]);
  // Hidden kinds are kept by kind name, not by run or by list: the choice survives new events and a restart.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const ev of shown) m.set(ev.kind, (m.get(ev.kind) ?? 0) + 1);
    const rank = (k: string) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  }, [shown]);
  // With a single kind present there are no chips, so a stale hidden choice (after a rewind) must not empty the list.
  const filterable = counts.length >= 2;
  const active = filterable && counts.some(([k]) => hidden.has(k));
  const visible = useMemo(() => (active ? shown.filter((ev) => !hidden.has(ev.kind)) : shown), [shown, hidden, active]);
  const list = useMemo(() => visible.slice(-200).reverse(), [visible]);
  const kindName = (k: string) => { const key = `ev.kind.${k}`; return isMessageKey(key) ? t(key) : k; };
  const toggle = (k: string) => setHidden((h) => { const n = new Set(h); if (!n.delete(k)) n.add(k); return n; });
  return (
    <div className="panel">
      <div className="panel-title"><h3>{t('run.events')}</h3><span className="muted small">{active ? `${visible.length} / ${shown.length}` : shown.length}</span></div>
      {filterable && (
        <div className="event-filter" role="group" aria-label={t('run.eventFilter')}>
          {counts.map(([k, n]) => (
            <button key={k} type="button" className={`chip event-chip ${k}`} aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}>{kindName(k)} {n}</button>
          ))}
        </div>
      )}
      <div className="event-log">
        {shown.length === 0 && <span className="muted">{t('run.noEvents')}</span>}
        {list.map((ev, i) => (
          <div key={i} className={`event ${ev.kind}`}><span className="t">{fmtTime(ev.t, timeUnit)}</span><span>{px(ev.msg)}</span></div>
        ))}
      </div>
    </div>
  );
}
