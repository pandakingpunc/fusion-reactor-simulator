import React from 'react';
import { isMessageKey } from '../../../i18n';
import { fmtNum } from '../../format';
import { useT } from '../../state/store';
import { GEOM_FLAGS, GEOM_UNITS } from '../controls';

interface Props { geometry: Record<string, number> }

/** Static geometry of the device with readable labels (the raw key is kept as a tooltip). */
export function GeometryPanel({ geometry }: Props) {
  const t = useT();
  return (
    <div className="panel tight">
      <h3>{t('run.geometry')}</h3>
      <table className="kv"><tbody>
        {Object.entries(geometry).slice(0, 12).map(([k, v]) => {
          const key = `geom.${k}`;
          const unit = GEOM_UNITS[k];
          return (
            <tr key={k}>
              <td title={k}>{isMessageKey(key) ? t(key) : k}</td>
              <td className="num">{GEOM_FLAGS.has(k) ? t(v ? 'common.yes' : 'common.no') : fmtNum(v)}{unit && <span className="muted small"> {unit}</span>}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}
