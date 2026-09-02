import React from 'react';
import { METHOD_LABELS } from '../../physics/types';
import { SavedShot } from '../../App';
import { fmtNum, fmtTime } from '../format';
import { TimeChart } from '../charts/TimeChart';
import { PALETTE } from '../format';
import { exportCSV, exportJSON, exportReportCSV } from './exportShot';

interface Props { shot: SavedShot | null; onRerun: () => void; onEdit: () => void }

export function Report({ shot, onRerun, onEdit }: Props) {
  if (!shot) return <div className="panel muted">Henüz tamamlanmış atış yok.</div>;
  const { report: r, meta, frames, events, cfg, name } = shot;
  const term = r.termination;
  const termCls = term.disruption ? 'bad' : term.natural ? 'ok' : '';
  const scoreCls = r.score >= 70 ? 'ok' : r.score >= 35 ? 'warn' : 'bad';
  const tUnit = r.timeUnit;
  const secs = (x: number) => (tUnit === 's' ? fmtTime(x, 's') : `${fmtNum(x * (tUnit === 'ns' ? 1e9 : 1e6))} ${tUnit}`);

  const keyList = ['Ti', 'P_fus', 'Q'].filter((k) => meta.diagSpecs.some((s) => s.key === k));
  const series = keyList.map((k, i) => { const s = meta.diagSpecs.find((x) => x.key === k)!; return { key: k, label: s.label, unit: s.unit, color: PALETTE[i], log: s.log }; });

  return (
    <div className="report">
      <div className="panel full">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{name} <span className="muted">— {METHOD_LABELS[r.method]}</span></h2>
            <div className="muted small">Atış süresi {secs(r.duration)} · {frames.length} kare · {events.length} olay</div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => exportJSON(name, cfg, r, events)}>JSON ↓</button>
            <button className="btn sm" onClick={() => exportReportCSV(name, r)}>Özet CSV ↓</button>
            <button className="btn sm" onClick={() => exportCSV(name, frames, meta.diagSpecs, meta.timeUnit)}>Zaman serisi CSV ↓</button>
            <button className="btn sm" onClick={onEdit}>Düzenle</button>
            <button className="btn sm primary" onClick={onRerun}>Tekrar çalıştır</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Sonuç özeti</h3>
        <table className="kv"><tbody>
          <tr><td>Maks. sıcaklık</td><td className="num">{fmtNum(r.Tmax_keV)} keV = <b>{fmtNum(r.Tmax_MC)} milyon °C</b></td></tr>
          <tr><td>Maks. T_i / T_e</td><td className="num">{fmtNum(r.Timax_keV)} / {fmtNum(r.Temax_keV)} keV</td></tr>
          <tr><td>Ateşleme süresi</td><td className="num">{secs(r.ignitionTime_s)}</td></tr>
          <tr><td>Yanma süresi</td><td className="num">{secs(r.burnTime_s)}</td></tr>
          <tr><td>Kararlı çalışma süresi</td><td className="num">{secs(r.stableTime_s)}</td></tr>
          <tr><td colSpan={2} className="small muted">"Kararlı" tanımı: {r.stableDefinition}</td></tr>
          <tr><td>Q_sci maks / ort.</td><td className="num"><b>{fmtNum(r.Q_sci_max)}</b> / {fmtNum(r.Q_sci_avg)}</td></tr>
          <tr><td>Q_eng (mühendislik)</td><td className="num">{fmtNum(r.Q_eng)} <span className={r.Q_eng >= 1 ? 'ok' : 'bad'}>{r.Q_eng >= 1 ? '● net elektrik' : '○ net tüketici'}</span></td></tr>
          <tr><td colSpan={2} className="small muted">{r.Q_eng_note}</td></tr>
          <tr><td>Toplam füzyon enerjisi</td><td className="num">{fmtNum(r.E_fusion_MJ)} MJ</td></tr>
          <tr><td>Toplam girdi enerjisi</td><td className="num">{fmtNum(r.E_input_MJ)} MJ</td></tr>
          <tr><td>Nötron verimi</td><td className="num">{fmtNum(r.neutronYield)}</td></tr>
          <tr><td>Nötron akıncısı (duvar)</td><td className="num">{fmtNum(r.neutronFluence_m2)} n/m²</td></tr>
          <tr><td>Maks. üçlü çarpım nTτ</td><td className="num">{fmtNum(r.tripleProduct_max)} keV·s·m⁻³</td></tr>
          <tr><td>Lawson oranı</td><td className="num"><b className={r.lawson_ratio >= 1 ? 'ok' : 'warn'}>{fmtNum(r.lawson_ratio)}</b></td></tr>
          <tr><td colSpan={2} className="small muted">{r.lawsonNote}</td></tr>
        </tbody></table>
      </div>

      <div className="panel">
        <h3>Sonlanma tanısı</h3>
        <div className={`diag-box ${termCls}`}>
          <div><b>{term.reason}</b> <span className="muted small">@ {fmtTime(term.t, meta.timeUnit)}</span></div>
          <p style={{ margin: '6px 0' }}>{term.diagnosis}</p>
          <div><span className="accent">Nasıl düzeltilir:</span> {term.fix}</div>
        </div>
        {term.disruption && (
          <>
            <h3 style={{ marginTop: 10 }}>Disruption fiziği</h3>
            <table className="kv"><tbody>
              <tr><td>Neden</td><td>{term.disruption.cause}</td></tr>
              <tr><td>W_th / W_mag</td><td className="num">{fmtNum(term.disruption.W_th_MJ)} / {fmtNum(term.disruption.W_mag_MJ)} MJ</td></tr>
              <tr><td>τ_TQ / τ_CQ</td><td className="num">{fmtNum(term.disruption.tau_TQ_ms)} / {fmtNum(term.disruption.tau_CQ_ms)} ms</td></tr>
              <tr><td>Halo oranı × TPF</td><td className="num">{fmtNum(term.disruption.halo_fraction)} × {fmtNum(term.disruption.TPF)} = {fmtNum(term.disruption.halo_TPF_product)}</td></tr>
              <tr><td>Kaçak e⁻ çığ e-kat / akım</td><td className="num">{fmtNum(term.disruption.runaway_avalanche_efolds)} / {fmtNum(term.disruption.runaway_current_MA)} MA</td></tr>
              <tr><td>Duvar enerji yoğunluğu</td><td className="num">{fmtNum(term.disruption.wall_energy_density_MJm2)} MJ/m² {term.disruption.melt_risk && <span className="badge bad">erime riski</span>}</td></tr>
              <tr><td>Düşey kuvvet</td><td className="num">{fmtNum(term.disruption.vertical_force_MN)} MN</td></tr>
            </tbody></table>
          </>
        )}
        {r.warnings.length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>Uyarılar</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.warnings.map((w, i) => <li key={i} className="warn">{w}</li>)}</ul>
          </>
        )}
      </div>

      <div className="panel">
        <h3>Puan</h3>
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
        <h3 style={{ marginTop: 10 }}>Tarihsel karşılaştırma</h3>
        <table className="kv"><tbody>
          {r.historical.map((h) => (
            <tr key={h.label}><td>{h.label}<div className="small muted">{h.note}</div></td><td className="num"><span className={`badge ${h.ratio >= 1 ? 'ok' : h.ratio >= 0.3 ? 'warn' : 'bad'}`}>{fmtNum(h.ratio)}×</span></td></tr>
          ))}
        </tbody></table>
      </div>

      <div className="panel">
        <h3>Mühendislik</h3>
        <table className="kv"><tbody>
          {Object.entries(r.engineering).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{typeof v === 'number' ? fmtNum(v) : typeof v === 'boolean' ? (v ? 'evet' : 'hayır') : v}</td></tr>)}
        </tbody></table>
        {Object.keys(r.extras).length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>Ek değerler</h3>
            <table className="kv"><tbody>
              {Object.entries(r.extras).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{typeof v === 'number' ? fmtNum(v) : v}</td></tr>)}
            </tbody></table>
          </>
        )}
      </div>

      {series.length > 0 && (
        <div className="panel full">
          <h3>Zaman serisi (özet)</h3>
          <TimeChart frames={frames} series={series} timeUnit={meta.timeUnit} tEnd={meta.tEnd} events={events} height={220} />
        </div>
      )}
    </div>
  );
}
