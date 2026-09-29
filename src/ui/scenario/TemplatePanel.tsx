/** The scenario editor's templates: drop a control, ramp a control, a gas puff, an interlock. Each one is a few parameters and an "Add" button. */
import React, { useEffect, useState } from 'react';
import { ScenarioError } from '../../physics/kernel/errors';
import type { TriggerOp } from '../../physics/scenario';
import { NumberBox } from './NumberBox';
import { TEMPLATE_KINDS, controlInfo, defaultTemplate, laneKeys, type EditorContext, type TemplateKind, type TemplateParams } from './model';
import { useScenarioT } from './useScenarioT';

const OPS: TriggerOp[] = ['>', '>=', '<', '<='];

interface Props {
  ctx: EditorContext;
  /** applies the template to the scenario; may throw a ScenarioError (its message is shown) */
  onAdd(p: TemplateParams): void;
}

export function TemplatePanel({ ctx, onAdd }: Props) {
  const t = useScenarioT();
  const [kind, setKind] = useState<TemplateKind>('drop');
  const [p, setP] = useState<TemplateParams>(() => defaultTemplate('drop', ctx));
  const [error, setError] = useState<string | null>(null);
  // a different model: the control and the diagnostic of the old parameters may not exist
  useEffect(() => { setP(defaultTemplate(kind, ctx)); setError(null); }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (k: TemplateKind) => { setKind(k); setP(defaultTemplate(k, ctx)); setError(null); };
  const set = (patch: Partial<TemplateParams>) => setP((old) => ({ ...old, ...patch }));
  const keys = laneKeys(ctx);
  const ctl = (value: string, on: (v: string) => void, label: string) => (
    <label className="field"><span className="lbl">{label}</span>
      <select value={value} onChange={(e) => on(e.target.value)} aria-label={label}>
        {keys.map((k) => <option key={k} value={k}>{controlInfo(k).label === k ? k : `${controlInfo(k).label} (${k})`}</option>)}
      </select>
    </label>
  );
  const num = (label: string, v: number, on: (x: number) => void, unit?: string) => (
    <label className="field"><span className="lbl"><span>{label}</span>{unit && <span className="unit">{unit}</span>}</span>
      <NumberBox value={v} onCommit={(x) => x !== null && on(x)} aria-label={label} />
    </label>
  );
  const tu = ctx.timeUnit;
  const unitOf = (key: string) => controlInfo(key).unit;

  return (
    <div className="scn-templates">
      <div className="row" role="tablist" aria-label={t('scn.templates')}>
        {TEMPLATE_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={`btn sm${kind === k ? ' primary' : ''}`} onClick={() => pick(k)}>{t(`scn.tpl.${k}` as const)}</button>
        ))}
      </div>
      <p className="hint">{t(`scn.tpl.${kind}.hint` as const)}</p>
      <div className="fields">
        {kind === 'drop' && <>
          {ctl(p.key, (key) => set({ key }), t('scn.tpl.control'))}
          {num(t('scn.tpl.at'), p.t, (x) => set({ t: x }), tu)}
          {num(t('scn.tpl.to'), p.to, (x) => set({ to: x }), unitOf(p.key))}
        </>}
        {kind === 'ramp' && <>
          {ctl(p.key, (key) => set({ key }), t('scn.tpl.control'))}
          {num(t('scn.tpl.from'), p.t, (x) => set({ t: x }), tu)}
          {num(t('scn.tpl.until'), p.t1, (x) => set({ t1: x }), tu)}
          {num(t('scn.tpl.to'), p.to, (x) => set({ to: x }), unitOf(p.key))}
        </>}
        {kind === 'gasPuff' && <>
          {num(t('scn.tpl.at'), p.t, (x) => set({ t: x }), tu)}
          {num(t('scn.tpl.duration'), p.t1, (x) => set({ t1: x }), tu)}
          {num(t('scn.tpl.peak'), p.to, (x) => set({ to: x }), unitOf('n_target_1e20'))}
          {num(t('scn.tpl.rise'), p.rise, (x) => set({ rise: x }), tu)}
        </>}
        {kind === 'interlock' && <>
          <label className="field"><span className="lbl">{t('scn.tpl.when')}</span>
            <select value={p.diag} onChange={(e) => set({ diag: e.target.value })} aria-label={t('scn.trg.diag')}>
              {ctx.diagSpecs.map((d) => <option key={d.key} value={d.key}>{d.label ? `${d.label} (${d.key})` : d.key}</option>)}
            </select>
          </label>
          <label className="field"><span className="lbl">{t('scn.trg.op')}</span>
            <select value={p.op} onChange={(e) => set({ op: e.target.value as TriggerOp })} aria-label={t('scn.trg.op')}>{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          </label>
          {num(t('scn.trg.value'), p.value, (x) => set({ value: x }))}
          {ctl(p.setKey, (setKey) => set({ setKey }), t('scn.tpl.sets'))}
          {num(t('scn.tpl.to'), p.setValue, (x) => set({ setValue: x }), unitOf(p.setKey))}
        </>}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm primary" onClick={() => {
          try { onAdd(p); setError(null); } catch (e) { setError(e instanceof ScenarioError ? e.message : e instanceof Error ? e.message : String(e)); }
        }}>{t('scn.tpl.add')}</button>
        {error && <span className="warn small" role="alert">{t('scn.tpl.failed', { reason: error })}</span>}
      </div>
    </div>
  );
}
