import React, { useMemo, useState } from 'react';
import { METHOD_LABELS, ShotReport } from '../../physics/types';
import type { EduKey } from '../../edu/i18n';
import { MessageKey } from '../../i18n';
import { SavedShot } from '../state/types';
import { useT } from '../state/store';
import { PALETTE, fmtNum } from '../format';
import { Explain } from '../edu/Explain';
import { PowerFlow } from '../edu/PowerFlow';
import { useEduT } from '../edu/useEduT';
import '../edu/edu.css';
import { ConfigDiff } from './ConfigDiff';
import { OverlayChart } from './OverlayChart';
import { RadarChart } from './RadarChart';
import { RADAR_AXES, RadarScale, radarValues } from './radar';
import { TimeAxis, commonChannels, overlayTraces, timeAxisAllowed } from './overlay';

interface Props { shots: SavedShot[]; onRemove: (id: number) => void; onLoad: (s: SavedShot) => void }

/** A row label is either an i18n key or an untranslated physics symbol; `term` is the glossary entry it explains. */
const ROWS: { label: MessageKey | { sym: string }; get: (r: ShotReport) => number | string; unit?: string; best?: 'max' | 'min'; term?: string }[] = [
  { label: 'cmp.method', get: (r) => METHOD_LABELS[r.method] },
  { label: 'cmp.duration', get: (r) => `${fmtNum(r.duration)} ${r.timeUnit}` },
  { label: { sym: 'T_max' }, get: (r) => r.Tmax_keV, unit: 'keV', best: 'max' },
  { label: { sym: 'T_max' }, get: (r) => r.Tmax_MC, unit: 'M°C', best: 'max' },
  { label: 'cmp.qsciMax', get: (r) => r.Q_sci_max, best: 'max', term: 'qSci' },
  { label: 'cmp.qsciAvg', get: (r) => r.Q_sci_avg, best: 'max', term: 'qSci' },
  { label: { sym: 'Q_eng' }, get: (r) => r.Q_eng, best: 'max', term: 'qEng' },
  { label: 'cmp.efus', get: (r) => r.E_fusion_MJ, unit: 'MJ', best: 'max' },
  { label: 'cmp.ein', get: (r) => r.E_input_MJ, unit: 'MJ', best: 'min' },
  { label: 'rep.ignition', get: (r) => r.ignitionTime_s, unit: 's', best: 'max', term: 'ignition' },
  { label: 'rep.burn', get: (r) => r.burnTime_s, unit: 's', best: 'max' },
  { label: 'cmp.stable', get: (r) => r.stableTime_s, unit: 's', best: 'max' },
  { label: 'cmp.triple', get: (r) => r.tripleProduct_max, unit: 'keV·s·m⁻³', best: 'max', term: 'triple' },
  { label: 'rep.lawson', get: (r) => r.lawson_ratio, best: 'max', term: 'lawson' },
  { label: 'rep.nYield', get: (r) => r.neutronYield, best: 'max' },
  { label: 'cmp.termination', get: (r) => r.termination.reason },
  { label: 'rep.score', get: (r) => r.score, best: 'max' },
];

/**
 * Compare 2.0: the headline table of the archived shots, a radar chart of the headline metrics, an overlay of one
 * diagnostic channel of the shots, the difference between two shot configurations and the power flow of a shot.
 */
export function Compare({ shots, onRemove, onLoad }: Props) {
  const t = useT();
  const te = useEduT();
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [scale, setScale] = useState<RadarScale>('lin');
  const [channel, setChannel] = useState('');
  const [axisPref, setAxisPref] = useState<TimeAxis>('abs');
  const [diffA, setDiffA] = useState<number | null>(null);
  const [diffB, setDiffB] = useState<number | null>(null);
  const [flowShot, setFlowShot] = useState<number | null>(null);

  const shown = useMemo(() => shots.filter((s) => !hidden.has(s.id)), [shots, hidden]);
  const color = (s: SavedShot) => PALETTE[shots.indexOf(s) % PALETTE.length];

  const channels = useMemo(() => commonChannels(shown), [shown]);
  const chosen = channels.find((c) => c.key === channel) ?? channels.find((c) => c.key === 'Q') ?? channels[0];
  const absOk = timeAxisAllowed(shown);
  const axis: TimeAxis = absOk ? axisPref : 'norm';
  const traces = useMemo(() => (chosen ? overlayTraces(shown, chosen.key, axis) : []), [shown, chosen, axis]);

  const radii = useMemo(() => radarValues(shown.map((s) => s.report), scale), [shown, scale]);

  // the two shots of the configuration diff: the first and the last unless the player chose others (a removed shot falls back)
  const shotById = (id: number | null) => shots.find((s) => s.id === id);
  const a = shotById(diffA) ?? shots[0];
  const b = shotById(diffB) ?? shots[shots.length - 1];
  const flow = shotById(flowShot) ?? shown[0] ?? shots[0];

  if (!shots.length) return <div className="panel muted">{t('cmp.empty')}</div>;

  const toggle = (id: number) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="cmp2">
      <div className="panel" style={{ overflowX: 'auto' }}>
        <div className="panel-title"><h3>{t('cmp.title')}</h3><span className="muted small">{t('cmp.sub', { n: shots.length })}</span></div>
        <table className="cmp">
          <thead>
            <tr>
              <th>{t('cmp.quantity')}</th>
              {shots.map((s) => (
                <th key={s.id}>
                  <div><span className="sw" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color(s), marginRight: 5 }} />{s.name}</div>
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
                    <button className="btn sm" onClick={() => onLoad(s)} title={t('cmp.loadTitle')}>{t('cmp.load')}</button>
                    <button className="btn sm danger" onClick={() => onRemove(s.id)} title={t('cmp.removeTitle')}>×</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, r) => {
              const label = typeof row.label === 'string' ? t(row.label) : row.label.sym;
              const vals = shots.map((s) => row.get(s.report));
              let bestIdx = -1;
              if (row.best) {
                const nums = vals.map((v) => (typeof v === 'number' && isFinite(v) ? v : row.best === 'max' ? -Infinity : Infinity));
                const best = row.best === 'max' ? Math.max(...nums) : Math.min(...nums);
                bestIdx = isFinite(best) ? nums.indexOf(best) : -1;
                if (shots.length < 2) bestIdx = -1;
              }
              return (
                <tr key={r}>
                  <td>{row.term ? <Explain term={row.term}><span>{label}</span></Explain> : label}{row.unit ? <span className="muted small"> [{row.unit}]</span> : ''}</td>
                  {vals.map((v, i) => (
                    <td key={shots[i].id} className={i === bestIdx ? 'ok' : ''} style={i === bestIdx ? { fontWeight: 600 } : undefined}>
                      {typeof v === 'number' ? fmtNum(v) : v}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr><td>{t('cmp.warnCount')}</td>{shots.map((s) => <td key={s.id}>{s.report.warnings.length}</td>)}</tr>
            <tr><td>{t('cmp.eventCount')}</td>{shots.map((s) => <td key={s.id}>{s.events.length}</td>)}</tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="cmp2-shots" role="group" aria-label={te('cmp2.show')}>
          <b className="muted small">{te('cmp2.show')}</b>
          {shots.map((s) => (
            <label key={s.id}>
              <input type="checkbox" checked={!hidden.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="sw" style={{ background: color(s) }} />{s.name}
            </label>
          ))}
        </div>
        {!shown.length && <div className="muted" style={{ marginTop: 6 }}>{te('cmp2.none')}</div>}
      </div>

      {shown.length > 0 && (
        <div className="cmp2-grid">
          <div className="panel">
            <div className="panel-title">
              <h3>{te('cmp2.radar')}</h3>
              <span className="seg" role="group">
                {(['lin', 'log'] as const).map((sc) => (
                  <button key={sc} type="button" className={scale === sc ? 'active' : ''} aria-pressed={scale === sc} onClick={() => setScale(sc)}>{te(sc === 'lin' ? 'cmp2.scaleLin' : 'cmp2.scaleLog')}</button>
                ))}
              </span>
            </div>
            <RadarChart title={te('cmp2.radar')} labels={RADAR_AXES.map((ax) => te(`cmp2.ax.${ax.id}` as EduKey))}
              series={shown.map((s, i) => ({ id: s.id, name: s.name, color: color(s), radii: radii[i] }))} />
            <div className="muted small">{te('cmp2.radarSub')}</div>
          </div>

          <div className="panel">
            <div className="panel-title"><h3>{te('cmp2.overlay')}</h3></div>
            {chosen ? (
              <>
                <div className="row" style={{ marginBottom: 6 }}>
                  <label className="row" style={{ gap: 6 }}>{te('cmp2.channel')}
                    <select value={chosen.key} onChange={(e) => setChannel(e.target.value)} style={{ width: 'auto', maxWidth: 260 }} aria-label={te('cmp2.channel')}>
                      {channels.map((c) => <option key={c.key} value={c.key}>{c.label}{c.unit ? ` [${c.unit}]` : ''}</option>)}
                    </select>
                  </label>
                  <span className="seg" role="group" aria-label={te('cmp2.time')}>
                    {(['abs', 'norm'] as const).map((ax) => (
                      <button key={ax} type="button" disabled={ax === 'abs' && !absOk} className={axis === ax ? 'active' : ''} aria-pressed={axis === ax} onClick={() => setAxisPref(ax)}>
                        {te(ax === 'abs' ? 'cmp2.timeAbs' : 'cmp2.timeNorm')}
                      </button>
                    ))}
                  </span>
                </div>
                <OverlayChart title={`${te('cmp2.overlay')}: ${chosen.label}`} log={!!chosen.log}
                  xLabel={axis === 'norm' ? te('cmp2.timeNorm') : `t [${shown[0].meta.timeUnit}]`} yLabel={`${chosen.label}${chosen.unit ? ` [${chosen.unit}]` : ''}`}
                  series={shown.map((s, i) => ({ id: s.id, name: s.name, color: color(s), trace: traces[i] }))} />
              </>
            ) : <div className="muted">{te('cmp2.noChannel')}</div>}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-title"><h3>{te('cmp2.diff')}</h3></div>
        {shots.length < 2 ? <div className="muted">{te('cmp2.needTwo')}</div> : (
          <>
            <div className="row" style={{ marginBottom: 8 }}>
              <label className="row" style={{ gap: 6 }}>{te('cmp2.diffBase')}
                <select value={a.id} onChange={(e) => setDiffA(Number(e.target.value))} style={{ width: 'auto' }} aria-label={te('cmp2.diffBase')}>
                  {shots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="row" style={{ gap: 6 }}>{te('cmp2.diffWith')}
                <select value={b.id} onChange={(e) => setDiffB(Number(e.target.value))} style={{ width: 'auto' }} aria-label={te('cmp2.diffWith')}>
                  {shots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <ConfigDiff a={a} b={b} />
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-title">
          <h3>{te('cmp2.flow')}</h3>
          <label className="row" style={{ gap: 6 }}>{te('cmp2.flowShot')}
            <select value={flow.id} onChange={(e) => setFlowShot(Number(e.target.value))} style={{ width: 'auto' }} aria-label={te('cmp2.flowShot')}>
              {shots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <PowerFlow key={flow.id} frames={flow.frames} />
      </div>
    </div>
  );
}
