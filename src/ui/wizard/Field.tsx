import React, { useEffect, useState } from 'react';
import { FieldDef } from './schema';

interface Props { def: FieldDef; value: unknown; onChange: (v: unknown) => void }

/** Tek yapılandırma alanı: sayı (ölçekli), seçim veya onay kutusu. */
export function Field({ def, value, onChange }: Props) {
  const type = def.type ?? 'number';
  if (type === 'bool') {
    return (
      <label className="field">
        <span className="lbl"><span>{def.label}</span></span>
        <span className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="small muted">{value ? 'açık' : 'kapalı'}</span>
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
  return <NumberField def={def} value={typeof value === 'number' ? value : NaN} onChange={onChange} />;
}

function NumberField({ def, value, onChange }: { def: FieldDef; value: number; onChange: (v: number) => void }) {
  const scale = def.scale ?? 1;
  const shown = isFinite(value) ? value / scale : NaN;
  const [text, setText] = useState(fmtEdit(shown));
  // dışarıdan (preset yükleme) değişince metni tazele
  useEffect(() => { setText(fmtEdit(shown)); }, [shown]);
  const commit = (s: string) => {
    const v = parseFloat(s.replace(',', '.'));
    if (isFinite(v)) onChange(v * scale);
    else setText(fmtEdit(shown));
  };
  const out = isFinite(shown) && ((def.min !== undefined && shown < def.min) || (def.max !== undefined && shown > def.max));
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
          value={isFinite(shown) ? Math.min(def.max, Math.max(def.min, shown)) : def.min}
          onChange={(e) => { const v = parseFloat(e.target.value); setText(fmtEdit(v)); onChange(v * scale); }} />
      )}
      {(def.hint || out) && <span className={`hint ${out ? 'warn' : ''}`}>{out ? `Önerilen aralık dışında (${def.min}–${def.max})` : def.hint}</span>}
    </label>
  );
}

function fmtEdit(x: number): string {
  if (!isFinite(x)) return '';
  const ax = Math.abs(x);
  if (ax !== 0 && (ax >= 1e7 || ax < 1e-4)) return x.toExponential(3).replace(/\.?0+e/, 'e');
  return parseFloat(x.toPrecision(6)).toString();
}
