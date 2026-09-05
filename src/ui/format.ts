/** Arayüz sayı/birim biçimlendirme (mono gösterim). */

export function fmtNum(x: number | undefined | null, digits = 3): string {
  if (x === undefined || x === null || !isFinite(x)) return '—';
  const ax = Math.abs(x);
  if (ax < 1e-30) return '0'; // sayısal sıfır (ör. söndükten sonra 1e-296 MW)
  if (ax >= 1e6 || ax < 1e-3) return x.toExponential(Math.max(digits - 1, 1)).replace('e+', 'e');
  if (ax >= 100) return x.toFixed(0);
  if (ax >= 10) return x.toFixed(1);
  return x.toPrecision(digits);
}

export function fmtInt(x: number): string {
  if (!isFinite(x)) return '—';
  return Math.round(x).toLocaleString('en-US');
}

export function fmtTime(t: number, unit: string): string {
  if (unit === 's') {
    if (t >= 100) return `${t.toFixed(1)} s`;
    if (t >= 1) return `${t.toFixed(2)} s`;
    return `${(t * 1e3).toFixed(1)} ms`;
  }
  return `${t.toFixed(unit === 'ns' ? 2 : 2)} ${unit}`;
}

export function fmtValue(x: number, unit: string): string {
  return unit ? `${fmtNum(x)} ${unit}` : fmtNum(x);
}

/** Eksen etiketi için kısa sayı */
export function fmtAxis(x: number): string {
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax >= 1e5 || ax < 1e-2) return x.toExponential(0).replace('e+', 'e');
  if (ax >= 100) return x.toFixed(0);
  if (ax >= 1) return parseFloat(x.toPrecision(3)).toString();
  return parseFloat(x.toPrecision(2)).toString();
}

export function keVtoMC(keV: number): number {
  return (keV * 1.1604518e7 - 273.15) / 1e6;
}

export const PALETTE = [
  '#4cc9f0', '#f72585', '#b5e48c', '#ffd166', '#f8961e', '#9d4edd', '#06d6a0', '#ef476f',
  '#8ecae6', '#ffb703', '#c77dff', '#80ed99', '#ff9e00', '#48bfe3', '#e0aaff', '#f9c74f',
];
