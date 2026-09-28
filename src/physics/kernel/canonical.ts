/**
 * Canonical serialisation for hashing: one string per value, independent of object key order.
 *
 * JSON with sorted object keys and the shortest round-trip number representation (so every
 * double keeps all its bits), plus bare tokens where JSON has none: -0, NaN, Infinity, -Infinity
 * (JSON would turn them into 0 or null; a quoted "NaN" string stays distinguishable).
 * Object entries whose value is undefined are skipped and undefined array items become null,
 * as in JSON. Typed arrays serialise as arrays. Functions, symbols, bigints and cycles throw.
 */
export function canonicalString(value: unknown): string {
  return enc(value, new Set());
}

function num(x: number): string {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (Object.is(x, -0)) return '-0';
  return JSON.stringify(x);
}

function enc(v: unknown, seen: Set<object>): string {
  switch (typeof v) {
    case 'number': return num(v);
    case 'string': return JSON.stringify(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'undefined': return 'null';
    case 'object': break;
    default: throw new TypeError(`canonicalString: cannot serialise a ${typeof v}`);
  }
  if (v === null) return 'null';
  if (seen.has(v)) throw new TypeError('canonicalString: cyclic structure');
  seen.add(v);
  let s: string;
  if (Array.isArray(v)) s = `[${v.map((x) => enc(x, seen)).join(',')}]`;
  else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const a = v as unknown as ArrayLike<number | bigint>;
    const parts: string[] = [];
    for (let i = 0; i < a.length; i++) parts.push(enc(a[i], seen));
    s = `[${parts.join(',')}]`;
  } else {
    const o = v as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) parts.push(`${JSON.stringify(k)}:${enc(o[k], seen)}`);
    s = `{${parts.join(',')}}`;
  }
  seen.delete(v);
  return s;
}
