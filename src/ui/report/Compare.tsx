import React from 'react';
import { METHOD_LABELS, ShotReport } from '../../physics/types';
import { MessageKey } from '../../i18n';
import { SavedShot } from '../state/types';
import { useT } from '../state/store';
import { fmtNum } from '../format';

interface Props { shots: SavedShot[]; onRemove: (id: number) => void; onLoad: (s: SavedShot) => void }

/** A row label is either an i18n key or an untranslated physics symbol. */
const ROWS: { label: MessageKey | { sym: string }; get: (r: ShotReport) => number | string; unit?: string; best?: 'max' | 'min' }[] = [
  { label: 'cmp.method', get: (r) => METHOD_LABELS[r.method] },
  { label: 'cmp.duration', get: (r) => `${fmtNum(r.duration)} ${r.timeUnit}` },
  { label: { sym: 'T_max' }, get: (r) => r.Tmax_keV, unit: 'keV', best: 'max' },
  { label: { sym: 'T_max' }, get: (r) => r.Tmax_MC, unit: 'M°C', best: 'max' },
  { label: 'cmp.qsciMax', get: (r) => r.Q_sci_max, best: 'max' },
  { label: 'cmp.qsciAvg', get: (r) => r.Q_sci_avg, best: 'max' },
  { label: { sym: 'Q_eng' }, get: (r) => r.Q_eng, best: 'max' },
  { label: 'cmp.efus', get: (r) => r.E_fusion_MJ, unit: 'MJ', best: 'max' },
  { label: 'cmp.ein', get: (r) => r.E_input_MJ, unit: 'MJ', best: 'min' },
  { label: 'rep.ignition', get: (r) => r.ignitionTime_s, unit: 's', best: 'max' },
  { label: 'rep.burn', get: (r) => r.burnTime_s, unit: 's', best: 'max' },
  { label: 'cmp.stable', get: (r) => r.stableTime_s, unit: 's', best: 'max' },
  { label: 'cmp.triple', get: (r) => r.tripleProduct_max, unit: 'keV·s·m⁻³', best: 'max' },
  { label: 'rep.lawson', get: (r) => r.lawson_ratio, best: 'max' },
  { label: 'rep.nYield', get: (r) => r.neutronYield, best: 'max' },
  { label: 'cmp.termination', get: (r) => r.termination.reason },
  { label: 'rep.score', get: (r) => r.score, best: 'max' },
];

export function Compare({ shots, onRemove, onLoad }: Props) {
  const t = useT();
  if (!shots.length) return <div className="panel muted">{t('cmp.empty')}</div>;
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <div className="panel-title"><h3>{t('cmp.title')}</h3><span className="muted small">{t('cmp.sub', { n: shots.length })}</span></div>
      <table className="cmp">
        <thead>
          <tr>
            <th>{t('cmp.quantity')}</th>
            {shots.map((s) => (
              <th key={s.id}>
                <div>{s.name}</div>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
                  <button className="btn sm" onClick={() => onLoad(s)} title={t('cmp.loadTitle')}>{t('cmp.load')}</button>
                  <button className="btn sm danger" onClick={() => onRemove(s.id)} title={t('cmp.removeTitle')}>×</button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const label = typeof row.label === 'string' ? t(row.label) : row.label.sym;
            const vals = shots.map((s) => row.get(s.report));
            let bestIdx = -1;
            if (row.best) {
              const nums = vals.map((v) => (typeof v === 'number' && isFinite(v) ? v : row.best === 'max' ? -Infinity : Infinity));
              const b = row.best === 'max' ? Math.max(...nums) : Math.min(...nums);
              bestIdx = isFinite(b) ? nums.indexOf(b) : -1;
              if (shots.length < 2) bestIdx = -1;
            }
            return (
              <tr key={label + (row.unit ?? '')}>
                <td>{label}{row.unit ? <span className="muted small"> [{row.unit}]</span> : ''}</td>
                {vals.map((v, i) => (
                  <td key={shots[i].id} className={i === bestIdx ? 'ok' : ''} style={i === bestIdx ? { fontWeight: 600 } : undefined}>
                    {typeof v === 'number' ? fmtNum(v) : v}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <td>{t('cmp.warnCount')}</td>
            {shots.map((s) => <td key={s.id}>{s.report.warnings.length}</td>)}
          </tr>
          <tr>
            <td>{t('cmp.eventCount')}</td>
            {shots.map((s) => <td key={s.id}>{s.events.length}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
