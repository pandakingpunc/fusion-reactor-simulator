import React from 'react';
import { METHOD_LABELS, ShotReport } from '../../physics/types';
import { SavedShot } from '../state/types';
import { fmtNum } from '../format';

interface Props { shots: SavedShot[]; onRemove: (id: number) => void; onLoad: (s: SavedShot) => void }

const ROWS: { label: string; get: (r: ShotReport) => number | string; unit?: string; best?: 'max' | 'min' }[] = [
  { label: 'Method', get: (r) => METHOD_LABELS[r.method] },
  { label: 'Duration', get: (r) => `${fmtNum(r.duration)} ${r.timeUnit}` },
  { label: 'T_max', get: (r) => r.Tmax_keV, unit: 'keV', best: 'max' },
  { label: 'T_max', get: (r) => r.Tmax_MC, unit: 'M°C', best: 'max' },
  { label: 'Q_sci max', get: (r) => r.Q_sci_max, best: 'max' },
  { label: 'Q_sci avg.', get: (r) => r.Q_sci_avg, best: 'max' },
  { label: 'Q_eng', get: (r) => r.Q_eng, best: 'max' },
  { label: 'E_fusion', get: (r) => r.E_fusion_MJ, unit: 'MJ', best: 'max' },
  { label: 'E_input', get: (r) => r.E_input_MJ, unit: 'MJ', best: 'min' },
  { label: 'Ignition time', get: (r) => r.ignitionTime_s, unit: 's', best: 'max' },
  { label: 'Burn time', get: (r) => r.burnTime_s, unit: 's', best: 'max' },
  { label: 'Stable time', get: (r) => r.stableTime_s, unit: 's', best: 'max' },
  { label: 'nTτ max', get: (r) => r.tripleProduct_max, unit: 'keV·s·m⁻³', best: 'max' },
  { label: 'Lawson ratio', get: (r) => r.lawson_ratio, best: 'max' },
  { label: 'Neutron yield', get: (r) => r.neutronYield, best: 'max' },
  { label: 'Termination', get: (r) => r.termination.reason },
  { label: 'Score', get: (r) => r.score, best: 'max' },
];

export function Compare({ shots, onRemove, onLoad }: Props) {
  if (!shots.length) return <div className="panel muted">Complete a shot first to compare results. Every completed shot is added here automatically.</div>;
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <div className="panel-title"><h3>Side-by-side comparison</h3><span className="muted small">{shots.length}  shots · best value highlighted</span></div>
      <table className="cmp">
        <thead>
          <tr>
            <th>Quantity</th>
            {shots.map((s) => (
              <th key={s.id}>
                <div>{s.name}</div>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
                  <button className="btn sm" onClick={() => onLoad(s)} title="Load configuration into the wizard">load</button>
                  <button className="btn sm danger" onClick={() => onRemove(s.id)} title="Remove from list">×</button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const vals = shots.map((s) => row.get(s.report));
            let bestIdx = -1;
            if (row.best) {
              const nums = vals.map((v) => (typeof v === 'number' && isFinite(v) ? v : row.best === 'max' ? -Infinity : Infinity));
              const b = row.best === 'max' ? Math.max(...nums) : Math.min(...nums);
              bestIdx = isFinite(b) ? nums.indexOf(b) : -1;
              if (shots.length < 2) bestIdx = -1;
            }
            return (
              <tr key={row.label + (row.unit ?? '')}>
                <td>{row.label}{row.unit ? <span className="muted small"> [{row.unit}]</span> : ''}</td>
                {vals.map((v, i) => (
                  <td key={shots[i].id} className={i === bestIdx ? 'ok' : ''} style={i === bestIdx ? { fontWeight: 600 } : undefined}>
                    {typeof v === 'number' ? fmtNum(v) : v}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr>
            <td>Warning count</td>
            {shots.map((s) => <td key={s.id}>{s.report.warnings.length}</td>)}
          </tr>
          <tr>
            <td>Event count</td>
            {shots.map((s) => <td key={s.id}>{s.events.length}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
