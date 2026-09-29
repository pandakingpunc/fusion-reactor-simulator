import React, { useMemo, useState } from 'react';
import { ShotReport } from '../../../physics/types';
import { SimMeta, UiFrame } from '../../../worker/protocol';
import { fmtNum, keVtoMC } from '../../format';
import { useT } from '../../state/store';
import { Kpi, KPI_FLAGS, selectKpis } from '../controls';
import { TerminationBox } from '../TerminationBox';
import { termOfDiag } from '../../../edu/glossary';
import { Explain } from '../../edu/Explain';
import { PowerFlow } from '../../edu/PowerFlow';
import { useEduT } from '../../edu/useEduT';
import { useOpenGlossary } from '../../edu/useOpenGlossary';

interface Props {
  meta: SimMeta;
  last: UiFrame | null;
  report: ShotReport | null;
  /** the run's frames: the power-flow diagram below the values (magnetic runs; drawn only while it is open) */
  frames?: readonly UiFrame[];
}

/** Headline diagnostics of the latest frame, the power balance below them, and, once the run ends, the termination verdict. */
export function LiveValuesPanel({ meta, last, report, frames }: Props) {
  const t = useT();
  const te = useEduT();
  const openGlossary = useOpenGlossary();
  const [flowOpen, setFlowOpen] = useState(false);
  const { headline, detail } = useMemo(() => (last ? selectKpis(meta.diagSpecs, last.d) : { headline: [], detail: [] }), [meta, last]);
  const term = report?.termination;

  const tile = ({ key, spec, v }: Kpi) => (
    <div className="kpi" key={key} title={spec.label}>
      <div className="k">{termOfDiag(key) ? <Explain term={termOfDiag(key)!.id} onOpenGlossary={openGlossary}><span>{spec.label}</span></Explain> : spec.label}</div>
      <div className="v">
        {KPI_FLAGS.has(key) ? t(v ? 'common.yes' : 'common.no') : fmtNum(v)}<span className="u">{KPI_FLAGS.has(key) ? '' : spec.unit}</span>
      </div>
      {(key === 'Ti' || key === 'Te') && <div className="small muted mono">{fmtNum(keVtoMC(v), 3)} M°C</div>}
    </div>
  );

  return (
    <div className="panel">
      <h3>{t('run.values')}</h3>
      <div className="kpis">{headline.map(tile)}</div>
      {detail.length > 0 && (
        <details className="kpi-more">
          <summary className="small muted">{t('run.valuesMore')}</summary>
          <div className="kpis">{detail.map(tile)}</div>
        </details>
      )}
      {frames && last && last.d.P_aux !== undefined && (
        <details className="kpi-more" open={flowOpen}>
          <summary className="small muted" onClick={(e) => { e.preventDefault(); setFlowOpen((o) => !o); }}>{te('pf.title')}</summary>
          {flowOpen && <PowerFlow frames={frames} initialWindow="shot" />}
        </details>
      )}
      {term && <TerminationBox term={term} timeUnit={meta.timeUnit} style={{ marginTop: 8 }} />}
    </div>
  );
}
