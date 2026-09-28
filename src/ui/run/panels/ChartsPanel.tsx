import React, { useMemo } from 'react';
import { SimEvent } from '../../../physics/types';
import { SimMeta, UiFrame } from '../../../worker/protocol';
import { Series, TimeChart } from '../../charts/TimeChart';
import { PALETTE } from '../../format';
import { useT } from '../../state/store';

interface Props {
  meta: SimMeta;
  frames: UiFrame[];
  events: SimEvent[];
  /** chart groups currently shown (kept by the run screen so the choice survives restarts) */
  groupsOn: ReadonlySet<string>;
  onToggleGroup: (name: string) => void;
  live: boolean;
  /** changes on every new run: resets chart zoom */
  resetKey: number;
  onSeek?: (t: number) => void;
}

/** Diagnostic group toggles and one time chart per enabled group. */
export function ChartsPanel({ meta, frames, events, groupsOn, onToggleGroup, live, resetKey, onSeek }: Props) {
  const t = useT();
  const groups = useMemo(() => {
    const m = new Map<string, Series[]>();
    meta.diagSpecs.forEach((s, i) => {
      const arr = m.get(s.group) ?? [];
      arr.push({ key: s.key, label: s.label, unit: s.unit, color: PALETTE[i % PALETTE.length], log: s.log });
      m.set(s.group, arr);
    });
    return [...m.entries()].map(([name, series]) => ({ name, series }));
  }, [meta]);

  return (
    <>
      <div className="panel tight">
        <div className="row" style={{ gap: 6 }}>
          <span className="muted small">{t('run.charts')}</span>
          {groups.map((g) => (
            <button key={g.name} className={`btn sm ${groupsOn.has(g.name) ? 'active' : ''}`} style={groupsOn.has(g.name) ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              onClick={() => onToggleGroup(g.name)}>{g.name}</button>
          ))}
          <span className="spacer" />
          <span className="muted small">{t('run.chartHelp')}</span>
        </div>
      </div>
      {groups.filter((g) => groupsOn.has(g.name)).map((g) => (
        <TimeChart key={g.name} title={g.name} frames={frames} series={g.series} timeUnit={meta.timeUnit} tEnd={meta.tEnd} events={events}
          live={live} resetKey={resetKey} height={200} onSeek={onSeek} />
      ))}
    </>
  );
}
