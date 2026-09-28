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
import { type CheckKind, type ReferenceCheck, type Tolerance, publishedBand, widen } from './references';
import { DERIVED_METRICS, METRIC_SCOPES } from './metrics';

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
  const band = c.band ? ` (${fmt(c.band[0])}–${fmt(c.band[1])})` : '';
  return `${fmt(c.value)}${u}${band}${c.unit ? ` ${c.unit}` : ''}`;
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

const KINDS: readonly CheckKind[] = ['validation', 'benchmark', 'sanity'];
const TOLERANCES: readonly Tolerance[] = ['confinement', 'temperature', 'yield', 'gain', 'stated'];

/**
 * Structural and acceptance-policy problems of a check table (empty when it is sound): unique ids of
 * the form `<preset>.<quantity>`, known presets, metric paths with a known scope, finite ordered accept
 * ranges that contain the published band, and — for a policy tolerance — an accept range equal to
 * {@link widen}(tolerance, {@link publishedBand}), so that no range drifts from the stated policy.
 */
export function tableProblems(checks: readonly ReferenceCheck[], presetIds: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of checks) {
    const at = (msg: string) => problems.push(`${c.id}: ${msg}`);
    if (seen.has(c.id)) at('duplicate id');
    seen.add(c.id);
    if (!c.id.startsWith(`${c.preset}.`) || !/^[A-Za-z0-9_]+$/.test(c.id.slice(c.preset.length + 1))) at('id must be <preset>.<quantity>');
    if (!presetIds.includes(c.preset)) at(`unknown preset '${c.preset}'`);
    const dot = c.path.indexOf('.');
    const scope = c.path.slice(0, dot);
    if (dot < 1 || dot === c.path.length - 1 || !(METRIC_SCOPES as readonly string[]).includes(scope)) {
      at(`metric path '${c.path}' must be <scope>.<key> with scope ${METRIC_SCOPES.join(', ')}`);
    } else if (scope === 'derived' && !(DERIVED_METRICS as readonly string[]).includes(c.path.slice(dot + 1))) {
      at(`unknown derived metric '${c.path}' (known: ${DERIVED_METRICS.join(', ')})`);
    }
    if (!KINDS.includes(c.kind)) at(`kind must be one of ${KINDS.join(', ')}`);
    if (!TOLERANCES.includes(c.tolerance)) at(`tolerance must be one of ${TOLERANCES.join(', ')}`);
    const [lo, hi] = c.accept;
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo < hi)) { at('accept must be a finite range [lo, hi] with lo < hi'); continue; }
    const [bLo, bHi] = publishedBand(c);
    if (!(bLo <= c.value && c.value <= bHi) && c.band) at(`value ${c.value} outside its band ${bLo}–${bHi}`);
    if (!(lo <= bLo && bHi <= hi)) at(`accept ${lo}–${hi} does not contain the published band ${fmt(bLo)}–${fmt(bHi)}`);
    if (c.tolerance !== 'stated' && TOLERANCES.includes(c.tolerance)) {
      const [wLo, wHi] = widen(c.tolerance, [bLo, bHi]);
      if (lo !== wLo || hi !== wHi) at(`accept ${lo}–${hi} is not the ${c.tolerance} tolerance of the band ${fmt(bLo)}–${fmt(bHi)}: expected [${wLo}, ${wHi}]`);
    }
    if (c.tolerance === 'stated' && !/%|±|factor|×|bound|limit|σ|requirement/.test(c.basis)) at("tolerance 'stated' needs the widening (%, ±, factor, ×, bound, limit, σ or requirement) in basis");
    if (c.knownFailure !== undefined && c.knownFailure.trim().length === 0) at('knownFailure must explain the failure');
  }
  return problems;
}

/**
 * Reads a check table from parsed JSON (the `--checks FILE` of validate): an array of objects with the
 * fields of {@link ReferenceCheck}. Throws an Error listing every problem, including those of
 * {@link tableProblems}.
 */
export function parseChecks(data: unknown, presetIds: readonly string[]): ReferenceCheck[] {
  if (!Array.isArray(data)) throw new Error('a check table must be a JSON array of checks');
  const problems: string[] = [];
  const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
  data.forEach((e: unknown, i: number) => {
    const at = (msg: string) => problems.push(`check #${i}${e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' ? ` (${(e as { id: string }).id})` : ''}: ${msg}`);
    if (!e || typeof e !== 'object' || Array.isArray(e)) { at('must be an object'); return; }
    const o = e as Record<string, unknown>;
    for (const k of ['id', 'preset', 'metric', 'path', 'unit', 'ref', 'source', 'kind', 'tolerance', 'basis']) {
      if (typeof o[k] !== 'string') at(`'${k}' must be a string`);
    }
    for (const k of ['doi', 'knownFailure']) if (o[k] !== undefined && typeof o[k] !== 'string') at(`'${k}' must be a string`);
    if (!isNum(o.value)) at("'value' must be a finite number");
    if (o.uncertainty !== undefined && !(isNum(o.uncertainty) && o.uncertainty >= 0)) at("'uncertainty' must be a finite number >= 0");
    if (!isPair(o.accept)) at("'accept' must be [lo, hi]");
    if (o.band !== undefined && !(isPair(o.band) && o.band[0] <= o.band[1])) at("'band' must be [lo, hi] with lo <= hi");
  });
  if (problems.length) throw new Error(`invalid check table:\n  ${problems.join('\n  ')}`);
  const checks = data as ReferenceCheck[];
  const policy = tableProblems(checks, presetIds);
  if (policy.length) throw new Error(`invalid check table:\n  ${policy.join('\n  ')}`);
  return checks;
}
