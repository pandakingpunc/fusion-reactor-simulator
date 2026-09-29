/** The trigger editor of the scenario: a condition on a diagnostic of the frames, a dwell time, and the control values it writes. */
import React from 'react';
import type { ScenarioIssue, TriggerOp, TriggerSpec } from '../../physics/scenario';
import { NumberBox } from './NumberBox';
import { controlInfo, issuesAt, laneKeys, type EditorContext } from './model';
import { useScenarioT } from './useScenarioT';

const OPS: TriggerOp[] = ['>', '>=', '<', '<='];

interface Props {
  ctx: EditorContext;
  triggers: readonly TriggerSpec[];
  issues: readonly ScenarioIssue[];
  onUpdate(i: number, patch: Partial<TriggerSpec>): void;
  onRemove(i: number): void;
  onAdd(): void;
}

export function TriggerEditor({ ctx, triggers, issues, onUpdate, onRemove, onAdd }: Props) {
  const t = useScenarioT();
  const keys = laneKeys(ctx);
  const tu = ctx.timeUnit;

  /** the control values of a patch (`set` or `release`) as rows: control, value, remove */
  const patchRows = (tr: TriggerSpec, i: number, field: 'set' | 'release') => {
    const patch = tr[field] ?? {};
    const entries = Object.entries(patch);
    const write = (next: Record<string, number>) => onUpdate(i, { [field]: Object.keys(next).length ? next : undefined } as Partial<TriggerSpec>);
    const free = keys.find((k) => !(k in patch));
    return (
      <div className="scn-patch">
        {entries.map(([k, v]) => (
          <div key={k} className="row" style={{ gap: 6 }}>
            <select value={k} aria-label={t('scn.trg.control')} onChange={(e) => { const { [k]: _gone, ...rest } = patch; write({ ...rest, [e.target.value]: v }); }}>
              {[k, ...keys.filter((x) => x !== k && !(x in patch))].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <NumberBox value={v} aria-label={t('scn.trg.setValue', { key: k })} onCommit={(x) => x !== null && write({ ...patch, [k]: x })} />
            <span className="muted small">{controlInfo(k).unit}</span>
            <button type="button" className="btn sm" aria-label={t('scn.trg.removeSet', { key: k })} onClick={() => { const { [k]: _gone, ...rest } = patch; write(rest); }}>×</button>
          </div>
        ))}
        {free !== undefined && (
          <button type="button" className="btn sm" onClick={() => write({ ...patch, [free]: ctx.controls[free] ?? 0 })}>{t('scn.trg.addSet')}</button>
        )}
      </div>
    );
  };

  return (
    <div className="scn-triggers">
      {triggers.length === 0 && <p className="muted small">{t('scn.noTriggers')}</p>}
      {triggers.map((tr, i) => {
        const bad = issuesAt(issues, `triggers[${i}]`);
        const repeat = tr.mode === 'repeat';
        return (
          <div key={i} className={`scn-trigger${bad.length ? ' invalid' : ''}`} data-testid={`trigger-${i}`}>
            <div className="fields">
              <label className="field"><span className="lbl">{t('scn.trg.diag')}</span>
                <select value={tr.diag} aria-label={t('scn.trg.diag')} onChange={(e) => onUpdate(i, { diag: e.target.value })}>
                  {!ctx.diagSpecs.some((d) => d.key === tr.diag) && <option value={tr.diag}>{tr.diag}</option>}
                  {ctx.diagSpecs.map((d) => <option key={d.key} value={d.key}>{d.label ? `${d.label} (${d.key})` : d.key}</option>)}
                </select>
              </label>
              <label className="field"><span className="lbl">{t('scn.trg.op')}</span>
                <select value={tr.op} aria-label={t('scn.trg.op')} onChange={(e) => onUpdate(i, { op: e.target.value as TriggerOp })}>{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              </label>
              <label className="field"><span className="lbl">{t('scn.trg.value')}</span>
                <NumberBox value={tr.value} aria-label={t('scn.trg.value')} onCommit={(x) => x !== null && onUpdate(i, { value: x })} />
              </label>
              <label className="field"><span className="lbl"><span>{t('scn.trg.hold')}</span><span className="unit">{tu}</span></span>
                <NumberBox value={tr.hold ?? 0} aria-label={t('scn.trg.hold')} onCommit={(x) => x !== null && onUpdate(i, { hold: x > 0 ? x : undefined })} />
              </label>
              <label className="field"><span className="lbl"><span>{t('scn.trg.after')}</span><span className="unit">{tu}</span></span>
                <NumberBox value={tr.after ?? 0} aria-label={t('scn.trg.after')} onCommit={(x) => x !== null && onUpdate(i, { after: x > 0 ? x : undefined })} />
              </label>
              <label className="field"><span className="lbl">{t('scn.trg.mode')}</span>
                <select value={repeat ? 'repeat' : 'once'} aria-label={t('scn.trg.mode')}
                  onChange={(e) => onUpdate(i, e.target.value === 'repeat' ? { mode: 'repeat' } : { mode: undefined, hysteresis: undefined, release: undefined })}>
                  <option value="once">{t('scn.trg.once')}</option>
                  <option value="repeat">{t('scn.trg.repeat')}</option>
                </select>
              </label>
              {repeat && (
                <label className="field"><span className="lbl">{t('scn.trg.hysteresis')}</span>
                  <NumberBox value={tr.hysteresis ?? 0} aria-label={t('scn.trg.hysteresis')} onCommit={(x) => x !== null && onUpdate(i, { hysteresis: x > 0 ? x : undefined })} />
                </label>
              )}
              <label className="field"><span className="lbl">{t('scn.trg.id')}</span>
                <input type="text" value={tr.id ?? ''} maxLength={64} aria-label={t('scn.trg.id')} onChange={(e) => onUpdate(i, { id: e.target.value || undefined })} />
              </label>
            </div>
            <div className="scn-patches">
              <div><span className="lbl">{t('scn.trg.set')}</span>{patchRows(tr, i, 'set')}</div>
              {repeat && <div><span className="lbl">{t('scn.trg.release')}</span>{patchRows(tr, i, 'release')}</div>}
            </div>
            {bad.map((b, k) => <div key={k} className="warn small">{b.path}: {b.message}</div>)}
            <button type="button" className="btn sm" onClick={() => onRemove(i)}>{t('scn.trg.remove')}</button>
          </div>
        );
      })}
      <button type="button" className="btn sm" onClick={onAdd}>{t('scn.addTrigger')}</button>
    </div>
  );
}
