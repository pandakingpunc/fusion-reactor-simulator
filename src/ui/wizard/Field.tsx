import React, { useEffect, useState } from 'react';
import { FieldDef, fieldHint, fieldLabel, isRequired } from './schema';
import { useApp, useT } from '../state/store';
import { localizeDecimals } from '../../i18n';
import { useWizText } from './wizText';

interface Props { def: FieldDef; value: unknown; onChange: (v: unknown) => void }

/** Tek yapılandırma alanı: sayı (ölçekli), seçim veya onay kutusu. */
export function Field({ def, value, onChange }: Props) {
  const t = useT();
  const wt = useWizText();
  const type = def.type ?? 'number';
  const label = fieldLabel(def, t, wt), hint = fieldHint(def, t, wt);
  if (type === 'bool') {
    return (
      <label className="field">
        <span className="lbl"><span>{label}</span></span>
        <span className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="small muted">{value ? t('field.on') : t('field.off')}</span>
        </span>
        {hint && <span className="hint">{hint}</span>}
      </label>
    );
  }
  if (type === 'select') {
    return (
      <label className="field">
        <span className="lbl"><span>{label}</span></span>
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
          {def.options?.map((o) => <option key={o.value} value={o.value}>{wt(o.label)}</option>)}
        </select>
        {hint && <span className="hint">{hint}</span>}
      </label>
    );
  }
  return <NumberField def={def} value={typeof value === 'number' && isFinite(value) ? value : undefined} onChange={onChange} />;
}

/**
 * Parse a number typed by the user (a decimal comma is accepted, and so are thousands separators as the Turkish interface shows them).
 * Blank → undefined (the value is unset); unparseable → null (the edit is rejected).
 *
 * One separator, once, is the decimal mark ('1,5' and '1.5' are 1.5). Both marks: the last one is the decimal mark and the other one
 * groups thousands ('1.234,5' and '1,234.5' are 1234.5). A mark that repeats is a thousands separator ('1.234.567'). Grouping that is not
 * in threes ('1,2,3', '1.2.3,4') is rejected instead of guessed.
 */
export function parseNumberInput(text: string): number | undefined | null {
  const s = text.trim();
  if (s === '') return undefined;
  const plain = normalizeSeparators(s);
  if (plain === null) return null;
  const v = parseFloat(plain);
  return Number.isFinite(v) ? v : null;
}

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** The text with a '.' decimal mark and no thousands separators, or null when its separators make no sense. */
function normalizeSeparators(s: string): string | null {
  const m = /^([+-]?[\d.,]*)([eE][+-]?\d+)?$/.exec(s);
  if (!m) return s.replace(',', '.'); // not a plain number: parseFloat decides (as before)
  const mant = m[1];
  const exp = m[2] ?? '';
  const dots = count(mant, '.');
  const commas = count(mant, ',');
  if (dots && commas) {
    const decimal = mant.lastIndexOf('.') > mant.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    const parts = mant.split(decimal);
    if (parts.length !== 2) return null;
    const [int, frac] = parts;
    if (!/^\d*$/.test(frac) || !groupedInt(int, group)) return null;
    return `${int.split(group).join('')}.${frac}${exp}`;
  }
  const mark = dots ? '.' : ',';
  if (dots + commas > 1) return groupedInt(mant, mark) ? mant.split(mark).join('') + exp : null;
  return mant.replace(',', '.') + exp;
}

/** an integer part whose `group` marks split it in threes from the right: 1,234,567 */
function groupedInt(int: string, group: string): boolean {
  const [head, ...rest] = int.replace(/^[+-]/, '').split(group);
  return /^\d{1,3}$/.test(head) && rest.length > 0 && rest.every((p) => /^\d{3}$/.test(p));
}

function NumberField({ def, value, onChange }: { def: FieldDef; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const t = useT();
  const wt = useWizText();
  const locale = useApp((s) => s.locale);
  const scale = def.scale ?? 1;
  const shown = value === undefined ? undefined : value / scale;
  const [text, setText] = useState(fmtEdit(shown));
  // bumped on every commit so the text re-syncs with the committed value (even when it is unchanged)
  const [rev, setRev] = useState(0);
  // dışarıdan (preset yükleme) değişince metni tazele
  useEffect(() => { setText(fmtEdit(shown)); }, [shown, rev, locale]);
  const commit = (s: string) => {
    // untouched text: keep the exact value (the text is rounded to 6 digits) and the preset unmodified
    if (s.trim() === fmtEdit(shown)) return;
    const v = parseNumberInput(s);
    if (v !== null) onChange(v === undefined ? undefined : v * scale);
    setRev((r) => r + 1);
  };
  const out = shown !== undefined && ((def.min !== undefined && shown < def.min) || (def.max !== undefined && shown > def.max));
  // blank: a required field blocks the run (warning); where blank is a documented setting, its hint explains it
  const missing = shown === undefined && isRequired(def);
  const warn = out || missing;
  const own = fieldHint(def, t, wt);
  const hint = out ? t('field.outOfRange', { min: def.min!, max: def.max! })
    : missing ? t('field.required')
    : shown === undefined ? own ?? t('field.empty')
    : own;
  return (
    <label className="field">
      <span className="lbl">
        <span>{fieldLabel(def, t, wt)}</span>
        {def.unit && <span className="unit">{wt(def.unit)}</span>}
      </span>
      <input type="text" inputMode="decimal" className="num" value={text} style={warn ? { borderColor: 'var(--warn)' } : undefined}
        aria-invalid={missing || undefined} aria-required={isRequired(def) || undefined}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
      {def.min !== undefined && def.max !== undefined && !def.noSlider && (
        <input type="range" aria-label={t('field.slider', { label: fieldLabel(def, t, wt) })} min={def.min} max={def.max} step={def.step ?? (def.max - def.min) / 200}
          value={shown !== undefined ? Math.min(def.max, Math.max(def.min, shown)) : def.min}
          onChange={(e) => { const v = parseFloat(e.target.value); setText(fmtEdit(v)); onChange(v * scale); }} />
      )}
      {hint && <span className={`hint ${warn ? 'warn' : ''}`}>{hint}</span>}
    </label>
  );
}

function fmtEdit(x: number | undefined): string {
  if (x === undefined || !isFinite(x)) return '';
  const ax = Math.abs(x);
  if (ax !== 0 && (ax >= 1e7 || ax < 1e-4)) return localizeDecimals(x.toExponential(3).replace(/\.?0+e/, 'e'));
  return localizeDecimals(parseFloat(x.toPrecision(6)).toString());
}
