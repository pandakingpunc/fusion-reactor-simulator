import { Fragment, useMemo } from 'react';
import { SavedShot } from '../state/types';
import { useT } from '../state/store';
import { fmtNum } from '../format';
import { localizeDecimals } from '../../i18n';
import { Explain } from '../edu/Explain';
import { useEduT } from '../edu/useEduT';
import { DiffRow, Scalar, diffConfigs } from './diffConfigs';

interface Props { a: SavedShot; b: SavedShot }

/** glossary term of a configuration field, for the Explain popover next to its path */
const TERM_OF_PATH: Record<string, string> = {
  H98: 'h98', Ip_MA: 'ip', fuelFracA: 'fuelMix', scaling: 'scaling', asymmetry_rms: 'asymmetry', adiabat: 'adiabat',
  'heating.P_NBI_MW': 'nbi', 'heating.P_ICRH_MW': 'icrh', 'heating.P_ECRH_MW': 'ecrh',
  'limits.betaN_limit': 'betaN', 'limits.greenwald_limit': 'greenwald', 'limits.q95_limit': 'q95',
  'profiles.elmFraction': 'elm', 'profiles.alphaCritFactor': 'pedestal', 'impurity.concentration': 'zeff',
};

/** Table of the configuration fields in which two archived shots differ. */
export function ConfigDiff({ a, b }: Props) {
  const t = useT();
  const te = useEduT();
  const rows = useMemo(() => diffConfigs(a.cfg, b.cfg), [a.cfg, b.cfg]);

  const show = (v: Scalar, other: Scalar): string => {
    if (v === undefined && other !== undefined) return te('cmp2.onlyOne');
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'boolean') return t(v ? 'common.yes' : 'common.no');
    return v === undefined || v === null ? '—' : String(v);
  };
  const change = (r: DiffRow): string => {
    if (r.change === undefined) return '';
    const pct = r.change * 100;
    return localizeDecimals(`${pct > 0 ? '+' : ''}${Math.abs(pct) >= 100 ? pct.toFixed(0) : pct.toFixed(1)} %`);
  };

  if (!rows.length) return <div className="muted">{te('cmp2.diffSame')}</div>;
  let group = '';
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="muted small" style={{ marginBottom: 4 }}>{te('cmp2.diffCount', { n: rows.length })}</div>
      <table className="cmp cmp2-diff">
        <thead><tr><th>{te('cmp2.field')}</th><th>{a.name}</th><th>{b.name}</th><th>{te('cmp2.change')}</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const header = r.group !== group;
            group = r.group;
            const term = TERM_OF_PATH[r.path];
            return (
              <Fragment key={r.path}>
                {header && <tr className="group"><td colSpan={4}>{r.group}</td></tr>}
                <tr>
                  <td className="path">{term ? <Explain term={term}><span>{r.path}</span></Explain> : r.path}</td>
                  <td className="val">{show(r.a, r.b)}</td>
                  <td className="val">{show(r.b, r.a)}</td>
                  <td className="val muted">{change(r)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
