import React from 'react';
import { MagneticConfig } from '../../../physics/types';
import { UiFrame } from '../../../worker/protocol';
import { Popcon } from '../../charts/Popcon';
import { useT } from '../../state/store';

interface Props { cfg: MagneticConfig; last: UiFrame | null }

/** POPCON map of the configuration with the live operating point. */
export function PopconPanel({ cfg, last }: Props) {
  const t = useT();
  return (
    <div className="panel tight">
      <div className="panel-title"><h3>{t('run.popcon')}</h3><span className="muted small">{t('run.popconSub')}</span></div>
      <Popcon cfg={cfg} point={last ? { n: (last.d.ne ?? 0) * 1e20, T: last.d.Ti ?? 0 } : null} height={280} />
    </div>
  );
}
