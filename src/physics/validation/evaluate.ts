/**
 * Evaluation and formatting of the literature checks (references.ts), shared by the validate CLI and
 * its tests.
 *
 * Status of one check:
 *   pass        the model value lies in the accepted range
 *   fail        it does not, or it is not finite            → fails the validation
 *   error       the preset run failed                        → fails the validation
 *   known-fail  outside the range, documented by `knownFailure` → reported, does not fail
 *   xpass       a documented known failure now passes          → reported, remove the marker
 */
import type { CheckKind, ReferenceCheck } from './references';

export type CheckStatus = 'pass' | 'fail' | 'error' | 'known-fail' | 'xpass';

export interface CheckOutcome {
  check: ReferenceCheck;
  /** null when the run failed or the value is not finite */
  value: number | null;
  status: CheckStatus;
  error?: string;
}

/** Statuses that make the validation fail. */
export const isFailure = (s: CheckStatus): boolean => s === 'fail' || s === 'error';

export function inRange(check: ReferenceCheck, v: number): boolean {
  return Number.isFinite(v) && v >= check.accept[0] && v <= check.accept[1];
}

/** Classifies a model value (or a run error) against a check. */
export function evaluateCheck(check: ReferenceCheck, value: number, runError?: string): CheckOutcome {
  if (runError !== undefined) return { check, value: null, status: 'error', error: runError };
  if (!Number.isFinite(value)) return { check, value: null, status: 'fail', error: 'value not available or not finite' };
  const ok = inRange(check, value);
  const status: CheckStatus = check.knownFailure ? (ok ? 'xpass' : 'known-fail') : ok ? 'pass' : 'fail';
  return { check, value, status };
}

export interface CheckTally {
  executed: number;
  pass: number;
  fail: number;
  error: number;
  knownFail: number;
  xpass: number;
}

export function tally(outcomes: readonly CheckOutcome[]): CheckTally {
  const t: CheckTally = { executed: outcomes.length, pass: 0, fail: 0, error: 0, knownFail: 0, xpass: 0 };
  for (const o of outcomes) {
    if (o.status === 'pass') t.pass++;
    else if (o.status === 'fail') t.fail++;
    else if (o.status === 'error') t.error++;
    else if (o.status === 'known-fail') t.knownFail++;
    else t.xpass++;
  }
  return t;
}

/** Checks of the given presets and kinds, in table order. */
export function selectChecks(checks: readonly ReferenceCheck[], presets?: readonly string[], kinds?: readonly CheckKind[]): ReferenceCheck[] {
  return checks.filter((c) => (!presets || presets.includes(c.preset)) && (!kinds || kinds.includes(c.kind)));
}

/** Three significant digits; exponent form outside [1e-3, 1e5). */
export function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
  return String(Number(v.toPrecision(3)));
}

export function fmtRange(c: ReferenceCheck): string {
  return `${fmt(c.accept[0])}–${fmt(c.accept[1])}`;
}

export function fmtReference(c: ReferenceCheck): string {
  const u = c.uncertainty !== undefined ? ` ± ${fmt(c.uncertainty)}` : '';
  return `${fmt(c.value)}${u}${c.unit ? ` ${c.unit}` : ''}`;
}

const STATUS_LABEL: Record<CheckStatus, string> = { pass: 'PASS', fail: 'FAIL', error: 'FAIL', 'known-fail': 'KNOWN-FAIL', xpass: 'XPASS' };
export const statusLabel = (s: CheckStatus): string => STATUS_LABEL[s];

/** One report line, e.g. "  PASS        ITER     Q (flat-top avg.) = 14 (expected 5–20)  [Shimada 2007]" */
export function formatOutcomeLine(o: CheckOutcome): string {
  const c = o.check;
  const head = `  ${statusLabel(o.status).padEnd(10)}  ${c.preset.padEnd(8)} ${c.metric}`;
  if (o.status === 'error') return `${head} — run failed (expected ${fmtRange(c)})  [${c.ref}]`;
  return `${head} = ${fmt(o.value)}${c.unit ? ` ${c.unit}` : ''} (expected ${fmtRange(c)})  [${c.ref}]`;
}

const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const doiLink = (c: ReferenceCheck): string => (c.doi ? ` [doi:${c.doi}](https://doi.org/${c.doi})` : '');

/**
 * Markdown table of checks. With outcomes, adds the model value and status columns; notes list the
 * known failures below the table.
 */
export function markdownTable(rows: readonly (ReferenceCheck | CheckOutcome)[]): string {
  const withResults = rows.length > 0 && 'status' in rows[0];
  const head = withResults
    ? ['Check', 'Kind', 'Metric', 'Reference', 'Accepted', 'Model', 'Status', 'Source']
    : ['Check', 'Kind', 'Metric', 'Reference', 'Accepted', 'Source'];
  const L = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  const notes: string[] = [];
  for (const r of rows) {
    const o = 'status' in r ? r : undefined;
    const c = o ? o.check : (r as ReferenceCheck);
    const unit = c.unit ? ` ${c.unit}` : '';
    const cells = [`\`${c.id}\``, c.kind, c.metric, fmtReference(c), `${fmtRange(c)}${unit}`];
    if (withResults) cells.push(o && o.value !== null ? `${fmt(o.value)}${unit}` : 'n/a', o ? statusLabel(o.status) : '');
    cells.push(`${c.ref}${doiLink(c)}`);
    L.push(`| ${cells.map(mdCell).join(' | ')} |`);
    if (c.knownFailure) notes.push(`- \`${c.id}\` (known failure): ${c.knownFailure}`);
  }
  if (notes.length) L.push('', ...notes);
  return L.join('\n');
}
