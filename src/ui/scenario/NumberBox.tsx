import { useEffect, useState } from 'react';
import { parseNumberInput } from '../wizard/Field';

/** A number as typed text: the draft is committed on blur or Enter (typing "0.0" on the way to "0.02" must not clamp anything). */
export function fmtEdit(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '';
  const ax = Math.abs(x);
  if (ax !== 0 && (ax >= 1e7 || ax < 1e-4)) return x.toExponential(4).replace(/\.?0+e/, 'e');
  return parseFloat(x.toPrecision(7)).toString();
}

interface Props {
  value: number | null | undefined;
  /** called with the new number, or with null when the box is emptied and `allowEmpty` is set; an unparsable text is put back */
  onCommit(v: number | null): void;
  allowEmpty?: boolean;
  placeholder?: string;
  'aria-label': string;
  invalid?: boolean;
  min?: number;
  className?: string;
}

export function NumberBox({ value, onCommit, allowEmpty, placeholder, invalid, className, ...rest }: Props) {
  const shown = fmtEdit(value);
  const [text, setText] = useState(shown);
  const [rev, setRev] = useState(0);
  useEffect(() => { setText(shown); }, [shown, rev]);
  const commit = (s: string) => {
    if (s.trim() === shown) return;
    const v = parseNumberInput(s);
    if (v === undefined) { if (allowEmpty) onCommit(null); } else if (v !== null) onCommit(v);
    setRev((r) => r + 1);
  };
  return (
    <input type="text" inputMode="decimal" className={`num scn-num${className ? ` ${className}` : ''}`} value={text} placeholder={placeholder} aria-label={rest['aria-label']}
      aria-invalid={invalid || undefined} style={invalid ? { borderColor: 'var(--warn)' } : undefined}
      onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
  );
}
