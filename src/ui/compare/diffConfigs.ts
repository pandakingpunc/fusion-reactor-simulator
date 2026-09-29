/**
 * Difference between two reactor configurations: both are flattened to dotted paths ("heating.P_NBI_MW") and the
 * paths whose values differ are listed, grouped by the first path segment. Pure, no DOM.
 */
export type Scalar = number | string | boolean | null | undefined;

export interface DiffRow {
  path: string;
  /** first segment of the path ('general' for a top-level field) */
  group: string;
  a: Scalar;
  b: Scalar;
  kind: 'changed' | 'added' | 'removed';
  /** b / a − 1 for two non-zero numbers (the relative change) */
  change?: number;
}

/** every leaf of an object as path → value (arrays contribute `path[i]`); undefined leaves are skipped */
export function flattenConfig(cfg: unknown, prefix = '', out: Map<string, Scalar> = new Map()): Map<string, Scalar> {
  if (cfg === null || cfg === undefined || typeof cfg !== 'object') {
    if (prefix && cfg !== undefined) out.set(prefix, cfg as Scalar);
    return out;
  }
  if (Array.isArray(cfg)) {
    cfg.forEach((v, i) => flattenConfig(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) flattenConfig(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const groupOf = (path: string): string => (path.includes('.') ? path.slice(0, path.indexOf('.')) : 'general');

/** two numbers are the same when they agree to 12 significant digits (so 1e20 written twice is not a change) */
function sameNumber(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));
}

/** the fields in which `b` differs from `a`, sorted by group ('general' first) and path */
export function diffConfigs(a: unknown, b: unknown): DiffRow[] {
  const fa = flattenConfig(a), fb = flattenConfig(b);
  const rows: DiffRow[] = [];
  for (const path of new Set([...fa.keys(), ...fb.keys()])) {
    const inA = fa.has(path), inB = fb.has(path);
    const va = fa.get(path), vb = fb.get(path);
    if (inA && inB) {
      if (typeof va === 'number' && typeof vb === 'number' ? sameNumber(va, vb) : va === vb) continue;
      const row: DiffRow = { path, group: groupOf(path), a: va, b: vb, kind: 'changed' };
      if (typeof va === 'number' && typeof vb === 'number' && va !== 0 && Number.isFinite(va) && Number.isFinite(vb)) row.change = vb / va - 1;
      rows.push(row);
    } else rows.push({ path, group: groupOf(path), a: va, b: vb, kind: inA ? 'removed' : 'added' });
  }
  const rank = (g: string) => (g === 'general' ? '' : g);
  return rows.sort((x, y) => (rank(x.group) === rank(y.group) ? x.path.localeCompare(y.path) : rank(x.group).localeCompare(rank(y.group))));
}
