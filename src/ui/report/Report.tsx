import React, { useState } from 'react';
import { HistoryFrame, METHOD_LABELS } from '../../physics/types';
import { SavedShot } from '../state/types';
import { fmtNum, fmtTime } from '../format';
import { TimeChart } from '../charts/TimeChart';
import { PALETTE } from '../format';
import { exportCSV, exportJSON, exportReportCSV } from './exportShot';

interface Props { shot: SavedShot | null; onRerun: () => void; onEdit: () => void }

type FigKind = 'traces' | 'profiles' | 'cross';
const FIG_LABEL: Record<FigKind, string> = { traces: 'Figure: time traces', profiles: 'Figure: radial profiles (1.5D)', cross: 'Figure: GS cross-section (1.5D)' };

export function Report({ shot, onRerun, onEdit }: Props) {
  const [figKind, setFigKind] = useState<FigKind>('traces');
  const [figBusy, setFigBusy] = useState(false);
  if (!shot) return <div className="panel muted">No completed shots yet.</div>;
  const { report: r, meta, frames, events, cfg, name } = shot;
  const term = r.termination;
  const termCls = term.disruption ? 'bad' : term.natural ? 'ok' : '';
  const scoreCls = r.score >= 70 ? 'ok' : r.score >= 35 ? 'warn' : 'bad';
  const tUnit = r.timeUnit;
  const secs = (x: number) => (tUnit === 's' ? fmtTime(x, 's') : `${fmtNum(x * (tUnit === 'ns' ? 1e9 : 1e6))} ${tUnit}`);

  const keyList = ['Ti', 'P_fus', 'Q'].filter((k) => meta.diagSpecs.some((s) => s.key === k));
  const series = keyList.map((k, i) => { const s = meta.diagSpecs.find((x) => x.key === k)!; return { key: k, label: s.label, unit: s.unit, color: PALETTE[i], log: s.log }; });
  const figKinds: FigKind[] = ['traces', ...(frames.some((f) => f.prof) ? ['profiles' as const] : []), ...(frames.some((f) => f.eq) ? ['cross' as const] : [])];
  // yayın figürü: grafik kütüphanesi yalnız tıklamada yüklenir (dinamik import)
  const exportFig = async (format: 'svg' | 'pdf') => {
    setFigBusy(true);
    try {
      const m = await import('./exportFigures');
      // The UI keeps frames without the worker-only rewind state; the figure code reads t, d, prof and eq only.
      const hist: HistoryFrame[] = frames.map((f) => ({ ...f, y: [], internal: {} }));
      m.exportFigure({ name, cfg, frames: hist, events, diagSpecs: meta.diagSpecs, timeUnit: meta.timeUnit }, figKinds.includes(figKind) ? figKind : 'traces', format);
    } finally { setFigBusy(false); }
  };

  return (
    <div className="report">
      <div className="panel full">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{name} <span className="muted">— {METHOD_LABELS[r.method]}</span></h2>
            <div className="muted small">Shot duration {fmtTime(r.duration, tUnit)} · {frames.length}  frames · {events.length}  events</div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => exportJSON(name, cfg, r, events)}>JSON ↓</button>
            <button className="btn sm" onClick={() => exportReportCSV(name, r)}>Summary CSV ↓</button>
            <button className="btn sm" onClick={() => exportCSV(name, frames, meta.diagSpecs, meta.timeUnit)}>Time series CSV ↓</button>
            <select value={figKinds.includes(figKind) ? figKind : 'traces'} onChange={(e) => setFigKind(e.target.value as FigKind)} title="Publication-quality vector figure (SVG for web, PDF for papers)">
              {figKinds.map((k) => <option key={k} value={k}>{FIG_LABEL[k]}</option>)}
            </select>
            <button className="btn sm" disabled={figBusy} onClick={() => exportFig('svg')}>SVG ↓</button>
            <button className="btn sm" disabled={figBusy} onClick={() => exportFig('pdf')}>PDF ↓</button>
            <button className="btn sm" onClick={onEdit}>Edit</button>
            <button className="btn sm primary" onClick={onRerun}>Run again</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Results summary</h3>
        <table className="kv"><tbody>
          <tr><td>Max. temperature</td><td className="num">{fmtNum(r.Tmax_keV)} keV = <b>{fmtNum(r.Tmax_MC)}  million °C</b></td></tr>
          <tr><td>Max. T_i / T_e</td><td className="num">{fmtNum(r.Timax_keV)} / {fmtNum(r.Temax_keV)} keV</td></tr>
          <tr><td>Ignition time</td><td className="num">{secs(r.ignitionTime_s)}</td></tr>
          <tr><td>Burn time</td><td className="num">{secs(r.burnTime_s)}</td></tr>
          <tr><td>Stable operating time</td><td className="num">{secs(r.stableTime_s)}</td></tr>
          <tr><td colSpan={2} className="small muted">"Stable" definition: {r.stableDefinition}</td></tr>
          <tr><td>Q_sci max / avg.</td><td className="num"><b>{fmtNum(r.Q_sci_max)}</b> / {fmtNum(r.Q_sci_avg)}</td></tr>
          <tr><td>Q_eng (engineering)</td><td className="num">{fmtNum(r.Q_eng)} <span className={r.Q_eng >= 1 ? 'ok' : 'bad'}>{r.Q_eng >= 1 ? '● net electricity' : '○ net consumer'}</span></td></tr>
          <tr><td colSpan={2} className="small muted">{r.Q_eng_note}</td></tr>
          <tr><td>Total fusion energy</td><td className="num">{fmtNum(r.E_fusion_MJ)} MJ</td></tr>
          <tr><td>Total input energy</td><td className="num">{fmtNum(r.E_input_MJ)} MJ</td></tr>
          <tr><td>Neutron yield</td><td className="num">{fmtNum(r.neutronYield)}</td></tr>
          <tr><td>Neutron fluence (wall)</td><td className="num">{fmtNum(r.neutronFluence_m2)} n/m²</td></tr>
          <tr><td>Max. triple product nTτ</td><td className="num">{fmtNum(r.tripleProduct_max)} keV·s·m⁻³</td></tr>
          <tr><td>Lawson ratio</td><td className="num"><b className={r.lawson_ratio >= 1 ? 'ok' : 'warn'}>{fmtNum(r.lawson_ratio)}</b></td></tr>
          <tr><td colSpan={2} className="small muted">{r.lawsonNote}</td></tr>
        </tbody></table>
      </div>

      <div className="panel">
        <h3>Termination diagnosis</h3>
        <div className={`diag-box ${termCls}`}>
          <div><b>{term.reason}</b> <span className="muted small">@ {fmtTime(term.t, meta.timeUnit)}</span></div>
          <p style={{ margin: '6px 0' }}>{term.diagnosis}</p>
          <div><span className="accent">How to fix:</span> {term.fix}</div>
        </div>
        {term.disruption && (
          <>
            <h3 style={{ marginTop: 10 }}>Disruption physics</h3>
            <table className="kv"><tbody>
              <tr><td>Cause</td><td>{term.disruption.cause}</td></tr>
              <tr><td>W_th / W_mag</td><td className="num">{fmtNum(term.disruption.W_th_MJ)} / {fmtNum(term.disruption.W_mag_MJ)} MJ</td></tr>
              <tr><td>τ_TQ / τ_CQ</td><td className="num">{fmtNum(term.disruption.tau_TQ_ms)} / {fmtNum(term.disruption.tau_CQ_ms)} ms</td></tr>
              <tr><td>Halo fraction × TPF</td><td className="num">{fmtNum(term.disruption.halo_fraction)} × {fmtNum(term.disruption.TPF)} = {fmtNum(term.disruption.halo_TPF_product)}</td></tr>
              <tr><td>Runaway e⁻ avalanche e-folds / current</td><td className="num">{fmtNum(term.disruption.runaway_avalanche_efolds)} / {fmtNum(term.disruption.runaway_current_MA)} MA</td></tr>
              <tr><td>Wall energy density</td><td className="num">{fmtNum(term.disruption.wall_energy_density_MJm2)} MJ/m² {term.disruption.melt_risk && <span className="badge bad">melting risk</span>}</td></tr>
              <tr><td>Vertical force</td><td className="num">{fmtNum(term.disruption.vertical_force_MN)} MN</td></tr>
            </tbody></table>
          </>
        )}
        {r.warnings.length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>Warnings</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.warnings.map((w, i) => <li key={i} className="warn">{w}</li>)}</ul>
          </>
        )}
      </div>

      <div className="panel">
        <h3>Score</h3>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className={`score-big ${scoreCls}`}>{Math.round(r.score)}</span><span className="muted">/ 100</span>
        </div>
        <table className="kv"><tbody>
          {r.scoreBreakdown.map((s) => {
            const frac = s.ref > 0 ? Math.min(1, Math.max(0, s.value / s.ref)) : 0;
            return (
              <tr key={s.label}>
                <td>{s.label}<div className="small muted">{s.note}</div></td>
                <td className="num">{fmtNum(s.value)} / {fmtNum(s.ref)} {s.unit}<div className="bar" style={{ marginTop: 3 }}><div style={{ width: `${frac * 100}%` }} /></div></td>
              </tr>
            );
          })}
        </tbody></table>
        <h3 style={{ marginTop: 10 }}>Historical comparison</h3>
        <table className="kv"><tbody>
          {r.historical.map((h) => (
            <tr key={h.label}><td>{h.label}<div className="small muted">{h.note}</div></td><td className="num"><span className={`badge ${h.ratio >= 1 ? 'ok' : h.ratio >= 0.3 ? 'warn' : 'bad'}`}>{fmtNum(h.ratio)}×</span></td></tr>
          ))}
        </tbody></table>
      </div>

      <div className="panel">
        <h3>Engineering</h3>
        <table className="kv"><tbody>
          {Object.entries(r.engineering).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{typeof v === 'number' ? fmtNum(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v}</td></tr>)}
        </tbody></table>
        {Object.keys(r.extras).length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>Additional values</h3>
            <table className="kv"><tbody>
              {Object.entries(r.extras).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{typeof v === 'number' ? fmtNum(v) : v}</td></tr>)}
            </tbody></table>
          </>
        )}
      </div>

      {series.length > 0 && (
        <div className="panel full">
          <h3>Time series (summary)</h3>
          <TimeChart frames={frames} series={series} timeUnit={meta.timeUnit} tEnd={meta.tEnd} events={events} height={220} />
        </div>
      )}
    </div>
  );
}
