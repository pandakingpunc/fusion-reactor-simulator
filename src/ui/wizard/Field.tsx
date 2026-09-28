import React, { useEffect, useState } from 'react';
import { FieldDef } from './schema';
import { useT } from '../state/store';

interface Props { def: FieldDef; value: unknown; onChange: (v: unknown) => void }

/** Tek yapılandırma alanı: sayı (ölçekli), seçim veya onay kutusu. */
export function Field({ def, value, onChange }: Props) {
  const t = useT();
  const type = def.type ?? 'number';
  if (type === 'bool') {
    return (
      <label className="field">
        <span className="lbl"><span>{def.label}</span></span>
        <span className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="small muted">{value ? t('field.on') : t('field.off')}</span>
        </span>
        {def.hint && <span className="hint">{def.hint}</span>}
      </label>
    );
  }
  if (type === 'select') {
    return (
      <label className="field">
        <span className="lbl"><span>{def.label}</span></span>
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}>
          {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {def.hint && <span className="hint">{def.hint}</span>}
      </label>
    );
  }
  return <NumberField def={def} value={typeof value === 'number' && isFinite(value) ? value : undefined} onChange={onChange} />;
}

/**
 * Parse a number typed by the user (decimal comma accepted).
 * Blank → undefined (the value is unset); unparseable → null (the edit is rejected).
 */
export function parseNumberInput(text: string): number | undefined | null {
  const s = text.trim();
  if (s === '') return undefined;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

function NumberField({ def, value, onChange }: { def: FieldDef; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const t = useT();
  const scale = def.scale ?? 1;
  const shown = value === undefined ? undefined : value / scale;
  const [text, setText] = useState(fmtEdit(shown));
  // bumped on every commit so the text re-syncs with the committed value (even when it is unchanged)
  const [rev, setRev] = useState(0);
  // dışarıdan (preset yükleme) değişince metni tazele
  useEffect(() => { setText(fmtEdit(shown)); }, [shown, rev]);
  const commit = (s: string) => {
    // untouched text: keep the exact value (the text is rounded to 6 digits) and the preset unmodified
    if (s.trim() === fmtEdit(shown)) return;
    const v = parseNumberInput(s);
    if (v !== null) onChange(v === undefined ? undefined : v * scale);
    setRev((r) => r + 1);
  };
  const out = shown !== undefined && ((def.min !== undefined && shown < def.min) || (def.max !== undefined && shown > def.max));
  const hint = out ? t('field.outOfRange', { min: def.min!, max: def.max! }) : shown === undefined ? t('field.empty') : def.hint;
  return (
    <label className="field">
      <span className="lbl">
        <span>{def.label}</span>
        {def.unit && <span className="unit">{def.unit}</span>}
      </span>
      <input type="text" inputMode="decimal" className="num" value={text} style={out ? { borderColor: 'var(--warn)' } : undefined}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
      {def.min !== undefined && def.max !== undefined && (
        <input type="range" min={def.min} max={def.max} step={def.step ?? (def.max - def.min) / 200}
          value={shown !== undefined ? Math.min(def.max, Math.max(def.min, shown)) : def.min}
          onChange={(e) => { const v = parseFloat(e.target.value); setText(fmtEdit(v)); onChange(v * scale); }} />
      )}
      {hint && <span className={`hint ${out || shown === undefined ? 'warn' : ''}`}>{hint}</span>}
    </label>
  );
}

function fmtEdit(x: number | undefined): string {
  if (x === undefined || !isFinite(x)) return '';
  const ax = Math.abs(x);
  if (ax !== 0 && (ax >= 1e7 || ax < 1e-4)) return x.toExponential(3).replace(/\.?0+e/, 'e');
  return parseFloat(x.toPrecision(6)).toString();
}
