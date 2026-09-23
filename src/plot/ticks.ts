/**
 * Eksen işaretleri: doğrusal "güzel" adımlar {1, 2, 2.5, 5}×10^k ve logaritmik on-luk çentikler.
 * Etiketler: gereken en az ondalık, Unicode eksi işareti; log eksende 10^{k} matematik etiketi.
 */
export interface Ticks { major: number[]; minor: number[]; labels: string[] }

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(target, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag * 1.0001) return m * mag;
  return 10 * mag;
}

function decimalsFor(step: number): number {
  for (let d = 0; d < 8; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6 * 10 ** d) return d;
  return 8;
}

export function formatTick(v: number, dec: number): string {
  if (Math.abs(v) < 1e-12) return '0';
  const av = Math.abs(v);
  if (av >= 1e5 || (av < 1e-3 && av > 0)) {
    const e = Math.floor(Math.log10(av));
    const m = v / 10 ** e;
    const ms = Math.abs(m - 1) < 1e-9 ? '' : `${Math.abs(m - Math.round(m)) < 1e-9 ? Math.round(m) : m.toFixed(1)}\\times`;
    return `$${ms}10^{${e}}$`;
  }
  return v.toFixed(dec).replace('-', '−');
}

export function linearTicks(lo: number, hi: number, target = 5): Ticks {
  if (!(hi > lo)) return { major: [lo], minor: [], labels: [formatTick(lo, 2)] };
  const step = niceStep(hi - lo, target);
  const dec = decimalsFor(step);
  const major: number[] = [];
  // k·adım (birikimli toplam yerine) + 12 anlamlı basamak: 0.6000000000000001 gibi kalıntılar olmasın
  const clean = (v: number) => (Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) major.push(clean(k * step));
  const sub = Math.abs(step / 10 ** Math.floor(Math.log10(step)) - 2.5) < 1e-9 ? 5 : Math.abs(step / 10 ** Math.floor(Math.log10(step)) - 2) < 1e-9 ? 4 : 5;
  const minor: number[] = [];
  const ms = step / sub;
  for (let k = Math.ceil(lo / ms - 1e-9); k * ms <= hi + ms * 1e-9; k++) {
    const v = clean(k * ms);
    if (major.every((m) => Math.abs(m - v) > ms * 1e-6)) minor.push(v);
  }
  return { major, minor, labels: major.map((v) => formatTick(v, dec)) };
}

export function logTicks(lo: number, hi: number): Ticks {
  const e0 = Math.floor(Math.log10(lo) + 1e-9), e1 = Math.ceil(Math.log10(hi) - 1e-9);
  const span = e1 - e0;
  const every = span > 12 ? 3 : span > 7 ? 2 : 1;
  const major: number[] = [], minor: number[] = [], labels: string[] = [];
  for (let e = e0; e <= e1; e++) {
    const v = 10 ** e;
    if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) {
      if ((e - e0) % every === 0) { major.push(v); labels.push(e === 0 ? '1' : e === 1 ? '10' : `$10^{${e}}$`); }
      else minor.push(v);
    }
    if (every === 1 && span < 6) for (let k = 2; k <= 9; k++) { const m = k * v; if (m > lo && m < hi) minor.push(m); }
  }
  return { major, minor, labels };
}
