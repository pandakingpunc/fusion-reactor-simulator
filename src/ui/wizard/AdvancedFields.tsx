/**
 * The Advanced section of the wizard (systems pulse length, edge model options, 1.5D solver settings), in a chunk of its own: the wizard loads it
 * when the section is opened, or, for the run summary, when the configuration carries one of these settings. The fields and their defaults are in
 * advanced.ts.
 */
import React from 'react';
import type { ReactorConfig } from '../../physics/types';
import { fmtNum } from '../format';
import { useT } from '../state/store';
import { ADVANCED_FIELDS } from './advanced';
import { Field } from './Field';
import { ADVANCED_STEPS, AdvancedStep, advancedOverrides, fieldHint, fieldLabel, fieldVisible, getPath } from './schema';
import { useWizText } from './wizText';

interface Props { step: AdvancedStep; cfg: ReactorConfig; update: (path: string, v: unknown) => void }

/** The fields of one step's Advanced section that apply to the configuration. */
export default function AdvancedFields({ step, cfg, update }: Props) {
  const fields = ADVANCED_FIELDS[step].filter((f) => fieldVisible(cfg.method, f.path, cfg));
  return (
    <div className="fields" data-testid={`advanced-${step}`}>
      {fields.map((f) => <Field key={f.path} def={f} value={getPath(cfg, f.path) ?? f.def} onChange={(v) => update(f.path, v)} />)}
    </div>
  );
}

/** The Advanced settings the configuration carries, for the run summary (nothing when they are all blank, i.e. at the model's defaults). */
export function AdvancedSummary({ cfg }: { cfg: ReactorConfig }) {
  const t = useT();
  const wt = useWizText();
  const set = advancedOverrides(cfg);
  if (!set.length) return null;
  return (
    <div className="panel tight" style={{ background: 'var(--bg2)', marginTop: 8 }} data-testid="advanced-summary">
      <h3>{t('wiz.advanced')}</h3>
      <table className="kv">
        <tbody>
          {ADVANCED_STEPS.flatMap((step) => ADVANCED_FIELDS[step]).filter((f) => set.some((s) => s.path === f.path)).map((f) => {
            const v = getPath(cfg, f.path);
            const shown = typeof v === 'number' ? fmtNum(v / (f.scale ?? 1)) : typeof v === 'boolean' ? (v ? t('field.on') : t('field.off')) : (f.options?.find((o) => o.value === v)?.label ?? String(v));
            return <tr key={f.path} title={fieldHint(f, t, wt)}><td>{fieldLabel(f, t, wt)}</td><td className="num">{typeof v === 'string' && f.options ? wt(shown) : shown} <span className="muted small">{f.unit ? wt(f.unit) : ''}</span></td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
