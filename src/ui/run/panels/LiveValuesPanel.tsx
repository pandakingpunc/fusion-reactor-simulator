import React, { useMemo } from 'react';
import { ShotReport } from '../../../physics/types';
import { SimMeta, UiFrame } from '../../../worker/protocol';
import { fmtNum, keVtoMC } from '../../format';
import { useT } from '../../state/store';
import { Kpi, KPI_FLAGS, selectKpis } from '../controls';
import { TerminationBox } from '../TerminationBox';

interface Props { meta: SimMeta; last: UiFrame | null; report: ShotReport | null }

/** Headline diagnostics of the latest frame, the power balance below them, and, once the run ends, the termination verdict. */
export function LiveValuesPanel({ meta, last, report }: Props) {
  const t = useT();
  const { headline, detail } = useMemo(() => (last ? selectKpis(meta.diagSpecs, last.d) : { headline: [], detail: [] }), [meta, last]);
  const term = report?.termination;

  const tile = ({ key, spec, v }: Kpi) => (
    <div className="kpi" key={key} title={spec.label}>
      <div className="k">{spec.label}</div>
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
      {term && <TerminationBox term={term} timeUnit={meta.timeUnit} style={{ marginTop: 8 }} />}
    </div>
  );
}
