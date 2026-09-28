/**
 * Axis ticks: linear "nice" steps {1, 2, 2.5, 5}×10^k and logarithmic decade / sub-decade ticks.
 *
 * Linear labels use the fewest decimals the step needs and a Unicode minus. When the values are
 * very large or small (|v| ≥ 10⁵ or < 10⁻³) the labels share one power of ten, and when the span is
 * tiny compared with the values (labels would need ≥ 5 significant digits) a common offset is
 * subtracted; both are returned as `offset` (mathtext, e.g. "$\times10^{5}$" or "+101320") for the
 * axes to print once at the axis end (the ScalarFormatter convention of matplotlib).
 * Log axes spanning less than two decade ticks fall back to {1, 2, 5}×10^k, then 1…9×10^k, then
 * linear positions, so a narrow log axis always has at least two labelled ticks.
 */
export interface Ticks {
  major: number[];
  minor: number[];
  labels: string[];
  /** common multiplier and/or offset of the labels (mathtext), printed once at the axis end */
  offset?: string;
}

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(target, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag * 1.0001) return m * mag;
  return 10 * mag;
}

function decimalsFor(step: number): number {
  for (let d = 0; d < 12; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6 * 10 ** d) return d;
  return 12;
}

const minus = (s: string) => s.replace('-', '−');

/** fixed-point label; "-0.00" becomes "0.00" */
function fixed(v: number, dec: number): string {
  const s = v.toFixed(dec);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : minus(s);
}

/** mantissa with up to `sig` significant digits (trailing zeros dropped), carrying 9.995 → 10 into the exponent */
function mantissa(v: number, sig: number): { m: number; e: number } {
  let e = Math.floor(Math.log10(Math.abs(v)));
  let m = +(v / 10 ** e).toPrecision(sig);
  if (Math.abs(m) >= 10) { e += 1; m = +(v / 10 ** e).toPrecision(sig); }
  if (Math.abs(m) < 1) { e -= 1; m = +(v / 10 ** e).toPrecision(sig); }
  return { m, e };
}

/** "$2.5\times10^{-4}$", "$10^{6}$", "$-10^{6}$" */
export function sciLabel(v: number, sig = 3): string {
  if (v === 0) return '0';
  const { m, e } = mantissa(v, sig);
  if (m === 1) return `$10^{${e}}$`;
  if (m === -1) return `$-10^{${e}}$`;
  return `$${minus(String(m))}\\times10^{${e}}$`;
}

/** One tick value: fixed decimals in 10⁻³ ≤ |v| < 10⁵, otherwise mantissa × power of ten (3 significant digits). */
export function formatTick(v: number, dec: number): string {
  if (Number.isNaN(v)) return '';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (Math.abs(v) < 1e-12) return '0';
  const av = Math.abs(v);
  if (av >= 1e5 || av < 1e-3) return sciLabel(v);
  return fixed(v, dec);
}

/** plain decimal for an offset or log label: up to 12 significant digits, no float residue */
function plain(v: number): string {
  const av = Math.abs(v);
  if (av >= 1e5 || (av < 1e-3 && av > 0)) return sciLabel(v, 12);
  return minus(String(+v.toPrecision(12)));
}

/** Labels for evenly spaced ticks, with a shared multiplier / offset when plain labels would be unwieldy. */
export function tickLabels(major: number[], step: number): { labels: string[]; offset?: string } {
  if (!major.length) return { labels: [] };
  const eStep = Math.floor(Math.log10(step) + 1e-9);
  const amax = Math.max(...major.map(Math.abs));
  const eMax = amax > 0 ? Math.floor(Math.log10(amax) + 1e-9) : eStep;
  let off = 0;
  if (eMax - eStep >= 4) {
    // offset notation: remove the leading digits all ticks share (≥ 5 significant digits otherwise)
    const span = major[major.length - 1] - major[0];
    const unit = 10 ** (Math.floor(Math.log10(Math.max(span, step)) + 1e-9) + 1);
    off = +(Math.floor(major[0] / unit + 1e-9) * unit).toPrecision(15);
  }
  const w = major.map((v) => v - off);
  const wmax = Math.max(...w.map(Math.abs));
  let e = 0;
  if (wmax >= 1e5 || (wmax > 0 && wmax < 1e-3)) e = Math.floor(Math.log10(wmax) + 1e-9);
  const dec = decimalsFor(+(step / 10 ** e).toPrecision(12));
  const labels = w.map((v) => {
    const s = v / 10 ** e;
    return Math.abs(s) < step * 1e-9 / 10 ** e ? '0' : fixed(s, dec);
  });
  const parts: string[] = [];
  if (e !== 0) parts.push(`$\\times10^{${e}}$`);
  if (off !== 0) parts.push(`${off > 0 ? '+' : '−'}${plain(Math.abs(off))}`);
  return parts.length ? { labels, offset: parts.join(' ') } : { labels };
}

export function linearTicks(lo: number, hi: number, target = 5): Ticks {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { major: [], minor: [], labels: [] };
  if (!(hi > lo)) return { major: [lo], minor: [], labels: [formatTick(lo, 2)] };
  const step = niceStep(hi - lo, target);
  const major: number[] = [];
  // k·step (not a running sum) rounded to 12 significant digits: no 0.6000000000000001 residue
  const clean = (v: number) => (Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) major.push(clean(k * step));
  const lead = step / 10 ** Math.floor(Math.log10(step));
  const sub = Math.abs(lead - 2) < 1e-9 ? 4 : 5;
  const minor: number[] = [];
  const ms = step / sub;
  for (let k = Math.ceil(lo / ms - 1e-9); k * ms <= hi + ms * 1e-9; k++) {
    const v = clean(k * ms);
    if (major.every((m) => Math.abs(m - v) > ms * 1e-6)) minor.push(v);
  }
  const { labels, offset } = tickLabels(major, step);
  return offset ? { major, minor, labels, offset } : { major, minor, labels };
}

/** decade label: "1", "10", "$10^{k}$" */
function decadeLabel(e: number): string { return e === 0 ? '1' : e === 1 ? '10' : `$10^{${e}}$`; }

export function logTicks(lo: number, hi: number): Ticks {
  if (!(lo > 0) || !Number.isFinite(lo)) return { major: [], minor: [], labels: [] };
  if (!(hi > lo) || !Number.isFinite(hi)) return { major: [lo], minor: [], labels: [plain(lo)] };
  const e0 = Math.floor(Math.log10(lo) + 1e-9), e1 = Math.ceil(Math.log10(hi) - 1e-9);
  const inRange = (v: number) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9);
  const pow = (e: number) => +(10 ** e).toPrecision(15);
  let nDecades = 0;
  for (let e = e0; e <= e1; e++) if (inRange(pow(e))) nDecades++;
  const major: number[] = [], minor: number[] = [], labels: string[] = [];
  if (nDecades >= 2) {
    const span = e1 - e0;
    const every = span > 12 ? 3 : span > 7 ? 2 : 1;
    let first = true, eFirst = 0;
    for (let e = e0; e <= e1; e++) {
      const v = pow(e);
      if (inRange(v)) {
        if (first) { first = false; eFirst = e; }
        if ((e - eFirst) % every === 0) { major.push(v); labels.push(decadeLabel(e)); } else minor.push(v);
      }
      if (every === 1 && span < 6) for (let k = 2; k <= 9; k++) { const m = +(k * v).toPrecision(12); if (m > lo && m < hi) minor.push(m); }
    }
    return { major, minor, labels };
  }
  // sub-decade axis: {1,2,5}×10^k, then 1…9×10^k, then linear positions
  for (const subs of [[1, 2, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
    const cand: number[] = [];
    for (let e = e0 - 1; e <= e1; e++) for (const k of subs) { const v = +(k * 10 ** e).toPrecision(12); if (inRange(v)) cand.push(v); }
    if (cand.length >= 2) {
      for (let e = e0 - 1; e <= e1; e++) for (let k = 1; k <= 9; k++) {
        const v = +(k * 10 ** e).toPrecision(12);
        if (v > lo && v < hi && !cand.some((c) => Math.abs(c - v) <= 1e-9 * v)) minor.push(v);
      }
      return { major: cand, minor, labels: cand.map(plain) };
    }
  }
  const lin = linearTicks(lo, hi, 4);
  const keep = lin.major.map((v, k) => [v, lin.labels[k]] as const).filter(([v]) => v > 0);
  const t: Ticks = { major: keep.map((x) => x[0]), minor: [], labels: keep.map((x) => x[1]) };
  if (lin.offset) t.offset = lin.offset;
  return t;
}
