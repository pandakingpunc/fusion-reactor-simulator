import React from 'react';
import { METHOD_LABELS, ShotReport } from '../../physics/types';
import { SavedShot } from '../../App';
import { fmtNum } from '../format';

interface Props { shots: SavedShot[]; onRemove: (id: number) => void; onLoad: (s: SavedShot) => void }

const ROWS: { label: string; get: (r: ShotReport) => number | string; unit?: string; best?: 'max' | 'min' }[] = [
  { label: 'Yöntem', get: (r) => METHOD_LABELS[r.method] },
  { label: 'Süre', get: (r) => `${fmtNum(r.duration)} ${r.timeUnit}` },
  { label: 'T_max', get: (r) => r.Tmax_keV, unit: 'keV', best: 'max' },
  { label: 'T_max', get: (r) => r.Tmax_MC, unit: 'M°C', best: 'max' },
  { label: 'Q_sci maks', get: (r) => r.Q_sci_max, best: 'max' },
  { label: 'Q_sci ort.', get: (r) => r.Q_sci_avg, best: 'max' },
  { label: 'Q_eng', get: (r) => r.Q_eng, best: 'max' },
  { label: 'E_füzyon', get: (r) => r.E_fusion_MJ, unit: 'MJ', best: 'max' },
  { label: 'E_girdi', get: (r) => r.E_input_MJ, unit: 'MJ', best: 'min' },
  { label: 'Ateşleme süresi', get: (r) => r.ignitionTime_s, unit: 's', best: 'max' },
  { label: 'Yanma süresi', get: (r) => r.burnTime_s, unit: 's', best: 'max' },
  { label: 'Kararlı süre', get: (r) => r.stableTime_s, unit: 's', best: 'max' },
  { label: 'nTτ maks', get: (r) => r.tripleProduct_max, unit: 'keV·s·m⁻³', best: 'max' },
  { label: 'Lawson oranı', get: (r) => r.lawson_ratio, best: 'max' },
  { label: 'Nötron verimi', get: (r) => r.neutronYield, best: 'max' },
  { label: 'Sonlanma', get: (r) => r.termination.reason },
  { label: 'Puan', get: (r) => r.score, best: 'max' },
];

export function Compare({ shots, onRemove, onLoad }: Props) {
  if (!shots.length) return <div className="panel muted">Karşılaştırmak için önce bir atış tamamlayın. Tamamlanan her atış otomatik olarak buraya eklenir.</div>;
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <div className="panel-title"><h3>Yan yana karşılaştırma</h3><span className="muted small">{shots.length} atış · en iyi değer vurgulu</span></div>
      <table className="cmp">
        <thead>
          <tr>
            <th>Büyüklük</th>
            {shots.map((s) => (
              <th key={s.id}>
                <div>{s.name}</div>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
                  <button className="btn sm" onClick={() => onLoad(s)} title="Yapılandırmayı sihirbaza yükle">yükle</button>
                  <button className="btn sm danger" onClick={() => onRemove(s.id)} title="Listeden çıkar">×</button>
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
            <td>Uyarı sayısı</td>
            {shots.map((s) => <td key={s.id}>{s.report.warnings.length}</td>)}
          </tr>
          <tr>
            <td>Olay sayısı</td>
            {shots.map((s) => <td key={s.id}>{s.events.length}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
