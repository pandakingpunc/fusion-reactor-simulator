import React, { useMemo } from 'react';
import { ShotReport } from '../../../physics/types';
import { SimMeta, UiFrame } from '../../../worker/protocol';
import { fmtNum, keVtoMC } from '../../format';
import { useT } from '../../state/store';
import { KPI_PREF } from '../controls';

interface Props { meta: SimMeta; last: UiFrame | null; report: ShotReport | null }

/** Headline diagnostics of the latest frame and, once the run ends, the termination verdict. */
export function LiveValuesPanel({ meta, last, report }: Props) {
  const t = useT();
  const kpis = useMemo(() => {
    if (!last) return [];
    const specs = new Map(meta.diagSpecs.map((s) => [s.key, s]));
    return KPI_PREF.filter((k) => specs.has(k) && last.d[k] !== undefined).slice(0, 12).map((k) => ({ key: k, spec: specs.get(k)!, v: last.d[k] }));
  }, [meta, last]);
  const term = report?.termination;

  return (
    <div className="panel">
      <h3>{t('run.values')}</h3>
      <div className="kpis">
        {kpis.map(({ key, spec, v }) => (
          <div className="kpi" key={key}>
            <div className="k">{spec.label}</div>
            <div className="v">{fmtNum(v)}<span className="u">{spec.unit}</span></div>
            {(key === 'Ti' || key === 'Te') && <div className="small muted mono">{fmtNum(keVtoMC(v), 3)} M°C</div>}
          </div>
        ))}
      </div>
      {term && (
        <div className={`diag-box ${term.disruption ? 'bad' : term.natural ? 'ok' : ''}`} style={{ marginTop: 8 }}>
          <b>{term.reason}</b>
          <div className="small muted" style={{ marginTop: 4 }}>{term.diagnosis}</div>
        </div>
      )}
    </div>
  );
}
