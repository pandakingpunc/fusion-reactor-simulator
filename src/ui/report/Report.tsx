import React, { useMemo, useState } from 'react';
import { HistoryFrame, METHOD_LABELS } from '../../physics/types';
import { MessageKey } from '../../i18n';
import { SavedShot } from '../state/types';
import { useApp, useT } from '../state/store';
import { fmtNum, fmtTime } from '../format';
import { TimeChart } from '../charts/TimeChart';
import { PALETTE } from '../format';
import { exportCSV, exportJSON, exportReportCSV } from './exportShot';
import { TerminationBox } from '../run/TerminationBox';
import { Explain } from '../edu/Explain';
import { useOpenGlossary } from '../edu/useOpenGlossary';
import { PowerFlow } from '../edu/PowerFlow';
import { pickDiag, powerBalance } from '../../edu/powerFlow';
import { describeReportKey, describeReportValue } from './keys';
import { localizeWarning } from '../settingsNotes';

interface Props {
  shot: SavedShot | null;
  onRerun: () => void;
  onEdit: () => void;
  /** the chrome-less view of an <iframe> (#/embed/report/...): the results without the toolbar of exports and buttons */
  embedded?: boolean;
}

type FigKind = 'traces' | 'profiles' | 'cross';
const FIG_LABEL: Record<FigKind, MessageKey> = { traces: 'rep.fig.traces', profiles: 'rep.fig.profiles', cross: 'rep.fig.cross' };

export function Report({ shot, onRerun, onEdit, embedded }: Props) {
  const t = useT();
  const locale = useApp((s) => s.locale);
  const openGlossary = useOpenGlossary();
  const [figKind, setFigKind] = useState<FigKind>('traces');
  const [figBusy, setFigBusy] = useState(false);
  // the power balance needs the power channels of a magnetic run (a hook: before the early return)
  const shotFrames = shot?.frames;
  const hasPowerFlow = useMemo(() => !!shotFrames && powerBalance(pickDiag(shotFrames, 'shot')) !== null, [shotFrames]);
  if (!shot) return <div className="panel muted">{t('rep.empty')}</div>;
  const { report: r, meta, frames, events, cfg, name } = shot;
  const term = r.termination;
  const scoreCls = r.score >= 70 ? 'ok' : r.score >= 35 ? 'warn' : 'bad';
  const tUnit = r.timeUnit;
  const secs = (x: number) => (tUnit === 's' ? fmtTime(x, 's') : `${fmtNum(x * (tUnit === 'ns' ? 1e9 : 1e6))} ${tUnit}`);

  // a table of the report's engineering or extras block: the label and unit in the interface language (keys.ts), the raw key as the tooltip
  const kvRows = (block: Record<string, number | string | boolean>) => Object.entries(block).map(([k, v]) => {
    const d = describeReportKey(k, locale);
    const label = d.term ? <Explain term={d.term} onOpenGlossary={openGlossary}><span>{d.label}</span></Explain> : d.label;
    const value = typeof v === 'number' ? fmtNum(v) : typeof v === 'boolean' ? t(v ? 'common.yes' : 'common.no') : describeReportValue(v, locale);
    return <tr key={k} title={k}><td>{label}</td><td className="num">{value}{typeof v === 'number' && d.unit ? <span className="muted small"> {d.unit}</span> : null}</td></tr>;
  });
  const ex = (term: string, label: React.ReactNode) => <Explain term={term} onOpenGlossary={openGlossary}><span>{label}</span></Explain>;

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
      await m.exportFigure({ name, cfg, frames: hist, events, diagSpecs: meta.diagSpecs, timeUnit: meta.timeUnit }, figKinds.includes(figKind) ? figKind : 'traces', format);
    } finally { setFigBusy(false); }
  };

  return (
    <div className="report">
      <div className="panel full">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>{name} <span className="muted">— {METHOD_LABELS[r.method]}</span></h2>
            <div className="muted small">{t('rep.subtitle', { duration: fmtTime(r.duration, tUnit), frames: frames.length, events: events.length })}</div>
          </div>
          {!embedded && <div className="row">
            <button className="btn sm" onClick={() => void exportJSON(name, cfg, r, events, shot.prov)}>JSON ↓</button>
            <button className="btn sm" onClick={() => exportReportCSV(name, r, locale)}>{t('rep.csvSummary')}</button>
            <button className="btn sm" onClick={() => exportCSV(name, frames, meta.diagSpecs, meta.timeUnit)}>{t('rep.csvSeries')}</button>
            <select value={figKinds.includes(figKind) ? figKind : 'traces'} onChange={(e) => setFigKind(e.target.value as FigKind)} title={t('rep.figTitle')}>
              {figKinds.map((k) => <option key={k} value={k}>{t(FIG_LABEL[k])}</option>)}
            </select>
            <button className="btn sm" disabled={figBusy} onClick={() => exportFig('svg')}>SVG ↓</button>
            <button className="btn sm" disabled={figBusy} onClick={() => exportFig('pdf')}>PDF ↓</button>
            <button className="btn sm" onClick={onEdit}>{t('rep.edit')}</button>
            <button className="btn sm primary" onClick={onRerun}>{t('rep.rerun')}</button>
          </div>}
        </div>
      </div>

      <div className="panel">
        <h3>{t('rep.summary')}</h3>
        <table className="kv"><tbody>
          <tr><td>{t('rep.maxT')}</td><td className="num">{fmtNum(r.Tmax_keV)} keV = <b>{fmtNum(r.Tmax_MC)} {t('rep.millionC')}</b></td></tr>
          <tr><td>{t('rep.maxTiTe')}</td><td className="num">{fmtNum(r.Timax_keV)} / {fmtNum(r.Temax_keV)} keV</td></tr>
          <tr><td>{ex('ignition', t('rep.ignition'))}</td><td className="num">{secs(r.ignitionTime_s)}</td></tr>
          <tr><td>{t('rep.burn')}</td><td className="num">{secs(r.burnTime_s)}</td></tr>
          <tr><td>{t('rep.stable')}</td><td className="num">{secs(r.stableTime_s)}</td></tr>
          <tr><td colSpan={2} className="small muted">{t('rep.stableDef', { def: r.stableDefinition })}</td></tr>
          <tr><td>{ex('qSci', t('rep.qsci'))}</td><td className="num"><b>{fmtNum(r.Q_sci_max)}</b> / {fmtNum(r.Q_sci_avg)}</td></tr>
          <tr><td>{ex('qEng', t('rep.qeng'))}</td><td className="num">{fmtNum(r.Q_eng)} <span className={r.Q_eng >= 1 ? 'ok' : 'bad'}>{t(r.Q_eng >= 1 ? 'rep.netElec' : 'rep.netCons')}</span></td></tr>
          <tr><td colSpan={2} className="small muted">{r.Q_eng_note}</td></tr>
          <tr><td>{t('rep.efus')}</td><td className="num">{fmtNum(r.E_fusion_MJ)} MJ</td></tr>
          <tr><td>{t('rep.ein')}</td><td className="num">{fmtNum(r.E_input_MJ)} MJ</td></tr>
          <tr><td>{t('rep.nYield')}</td><td className="num">{fmtNum(r.neutronYield)}</td></tr>
          <tr><td>{t('rep.nFluence')}</td><td className="num">{fmtNum(r.neutronFluence_m2)} n/m²</td></tr>
          <tr><td>{ex('triple', t('rep.triple'))}</td><td className="num">{fmtNum(r.tripleProduct_max)} keV·s·m⁻³</td></tr>
          <tr><td>{ex('lawson', t('rep.lawson'))}</td><td className="num"><b className={r.lawson_ratio >= 1 ? 'ok' : 'warn'}>{fmtNum(r.lawson_ratio)}</b></td></tr>
          <tr><td colSpan={2} className="small muted">{r.lawsonNote}</td></tr>
        </tbody></table>
      </div>

      <div className="panel">
        <h3>{t('rep.termination')}</h3>
        <TerminationBox term={term} timeUnit={meta.timeUnit} full />
        {term.disruption && (
          <>
            <h3 style={{ marginTop: 10 }}>{t('rep.disruption')}</h3>
            <table className="kv"><tbody>
              <tr><td>{t('rep.cause')}</td><td>{term.disruption.cause}</td></tr>
              <tr><td>W_th / W_mag</td><td className="num">{fmtNum(term.disruption.W_th_MJ)} / {fmtNum(term.disruption.W_mag_MJ)} MJ</td></tr>
              <tr><td>τ_TQ / τ_CQ</td><td className="num">{fmtNum(term.disruption.tau_TQ_ms)} / {fmtNum(term.disruption.tau_CQ_ms)} ms</td></tr>
              <tr><td>{t('rep.halo')}</td><td className="num">{fmtNum(term.disruption.halo_fraction)} × {fmtNum(term.disruption.TPF)} = {fmtNum(term.disruption.halo_TPF_product)}</td></tr>
              <tr><td>{t('rep.runaway')}</td><td className="num">{fmtNum(term.disruption.runaway_avalanche_efolds)} / {fmtNum(term.disruption.runaway_current_MA)} MA</td></tr>
              <tr><td>{t('rep.wallE')}</td><td className="num">{fmtNum(term.disruption.wall_energy_density_MJm2)} MJ/m² {term.disruption.melt_risk && <span className="badge bad">{t('rep.melt')}</span>}</td></tr>
              <tr><td>{t('rep.vforce')}</td><td className="num">{fmtNum(term.disruption.vertical_force_MN)} MN</td></tr>
            </tbody></table>
          </>
        )}
        {r.warnings.length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>{t('rep.warnings')}</h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.warnings.map((w, i) => <li key={i} className="warn">{localizeWarning(w, cfg, t)}</li>)}</ul>
          </>
        )}
      </div>

      <div className="panel">
        <h3>{t('rep.score')}</h3>
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
        <h3 style={{ marginTop: 10 }}>{t('rep.historical')}</h3>
        <table className="kv"><tbody>
          {r.historical.map((h) => (
            <tr key={h.label}><td>{h.label}<div className="small muted">{h.note}</div></td><td className="num"><span className={`badge ${h.ratio >= 1 ? 'ok' : h.ratio >= 0.3 ? 'warn' : 'bad'}`}>{fmtNum(h.ratio)}×</span></td></tr>
          ))}
        </tbody></table>
      </div>

      <div className="panel">
        <h3>{t('rep.engineering')}</h3>
        <table className="kv"><tbody>
          {kvRows(r.engineering)}
        </tbody></table>
        {Object.keys(r.extras).length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>{t('rep.extras')}</h3>
            <table className="kv"><tbody>
              {kvRows(r.extras)}
            </tbody></table>
          </>
        )}
      </div>

      {hasPowerFlow && (
        <div className="panel full">
          <PowerFlow frames={frames} />
        </div>
      )}

      {series.length > 0 && (
        <div className="panel full">
          <h3>{t('rep.series')}</h3>
          <TimeChart frames={frames} series={series} timeUnit={meta.timeUnit} tEnd={meta.tEnd} events={events} height={220} />
        </div>
      )}
    </div>
  );
}
