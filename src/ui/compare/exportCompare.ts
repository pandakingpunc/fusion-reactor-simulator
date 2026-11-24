/**
 * CSV export of the Compare side-by-side table (headline metrics, counts, and engineering rows).
 * Pure builder + browser download helper.
 */
import type { SavedShot } from '../state/types';

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CompareCsvRow {
  label: string;
  unit?: string;
  values: (string | number)[];
}

/** Build a UTF-8 CSV string (with BOM for Excel) from the comparison table rows. */
export function buildCompareCSV(quantityHeader: string, shots: readonly SavedShot[], rows: readonly CompareCsvRow[]): string {
  const header = [quantityHeader, ...shots.map((s) => s.name)].map(csvCell).join(',');
  const body = rows.map((r) => {
    const name = r.unit ? `${r.label} [${r.unit}]` : r.label;
    return [name, ...r.values].map(csvCell).join(',');
  });
  return '\uFEFF' + [header, ...body].join('\r\n') + '\r\n';
}

export function downloadCompareCSV(quantityHeader: string, shots: readonly SavedShot[], rows: readonly CompareCsvRow[]): void {
  const csv = buildCompareCSV(quantityHeader, shots, rows);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `fusion-compare-${shots.length}shots.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
