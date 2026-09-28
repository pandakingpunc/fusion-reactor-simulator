import { describe, expect, it } from 'vitest';
import { JET, NIF } from '../presets';
import type { ActuatorEntry, HistoryFrame } from '../types';
import { canonicalString } from './canonical';
import { FINGERPRINT_SCHEMA, runDigest, runFingerprint } from './fingerprint';
import { sha256Hex } from './sha256';

describe('canonicalString', () => {
  it('sorts object keys at every level and keeps array order', () => {
    expect(canonicalString({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1]},"b":1}');
    expect(canonicalString({ a: { c: 'x', d: [3, 1] }, b: 1 })).toBe(canonicalString({ b: 1, a: { d: [3, 1], c: 'x' } }));
  });
  it('keeps every bit of a double and distinguishes -0, NaN and ±Infinity', () => {
    for (const x of [0.1 + 0.2, 1 / 3, 5e-324, 1.7976931348623157e308, -1e-7, 123456789.125]) {
      expect(Number(canonicalString(x))).toBe(x);
    }
    expect(canonicalString([0, -0, NaN, Infinity, -Infinity])).toBe('[0,-0,NaN,Infinity,-Infinity]');
    expect(canonicalString('NaN')).toBe('"NaN"');
  });
  it('treats undefined like JSON and typed arrays like arrays', () => {
    expect(canonicalString({ a: undefined, b: [undefined, null], c: true })).toBe('{"b":[null,null],"c":true}');
    expect(canonicalString(Float64Array.from([1, -0]))).toBe('[1,-0]');
  });
  it('throws on cycles and non-data values', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => canonicalString(o)).toThrow(TypeError);
    expect(() => canonicalString({ f: () => 1 })).toThrow(TypeError);
    expect(() => canonicalString(10n)).toThrow(TypeError);
    // shared (non-cyclic) references are fine
    const s = { v: 1 };
    expect(canonicalString([s, s])).toBe('[{"v":1},{"v":1}]');
  });
});

describe('runFingerprint', () => {
  const log: ActuatorEntry[] = [
    { t: 1.25, step: 340, patch: { P_NBI_MW: 20 } },
    { t: 2.5, step: 700, patch: { n_target_1e20: 0.8, H98: 0.9 } },
  ];

  it('is a SHA-256 of the canonical input payload', () => {
    const fp = runFingerprint(JET, JET.seed, log, '4.0.0');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    const payload = { kind: 'fusion-simulator-run', schema: FINGERPRINT_SCHEMA, appVersion: '4.0.0', seed: JET.seed, cfg: JET, actuatorLog: log };
    expect(fp).toBe(sha256Hex(canonicalString(payload)));
  });

  it('does not depend on key order', () => {
    const reverseKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(reverseKeys)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
    const reordered = reverseKeys(JET) as typeof JET;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(JET));
    const logReordered = reverseKeys(log) as ActuatorEntry[];
    expect(runFingerprint(reordered, JET.seed, logReordered, '4.0.0')).toBe(runFingerprint(JET, JET.seed, log, '4.0.0'));
  });

  it('changes with every input', () => {
    const base = runFingerprint(JET, 7, log, '4.0.0');
    const variants = [
      runFingerprint({ ...JET, t_end: 5.4 }, 7, log, '4.0.0'),
      runFingerprint(JET, 8, log, '4.0.0'),
      runFingerprint(JET, 7, log.slice(1), '4.0.0'),
      runFingerprint(JET, 7, [{ ...log[0], step: 341 }, log[1]], '4.0.0'),
      runFingerprint(JET, 7, [{ ...log[0], patch: { P_NBI_MW: 20.000000000000004 } }, log[1]], '4.0.0'),
      runFingerprint(JET, 7, log, '4.0.1'),
      runFingerprint(JET, 7, log, '4.0.0', [1, 2]),
      runFingerprint(NIF, 7, log, '4.0.0'),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
    // an empty breakpoint schedule is the same run as none
    expect(runFingerprint(JET, 7, log, '4.0.0', [])).toBe(base);
  });
});

describe('runDigest', () => {
  const frame = (t: number, x: number): HistoryFrame => ({ t, y: [x, 2], d: { W: x * 3 }, internal: { rng: 5 } });
  it('is equal for equal runs and changes with any bit of any frame or event', () => {
    const h = [frame(0, 1), frame(0.1, 1.5)];
    const ev = [{ t: 0.1, kind: 'ELM' as const, msg: 'ELM' }];
    const d = runDigest(h, ev);
    expect(runDigest([frame(0, 1), frame(0.1, 1.5)], [{ t: 0.1, kind: 'ELM', msg: 'ELM' }])).toBe(d);
    expect(runDigest([frame(0, 1), frame(0.1, 1.5000000000000002)], ev)).not.toBe(d);
    expect(runDigest([frame(0, 1), { ...frame(0.1, 1.5), d: { W: -0 } }], ev)).not.toBe(runDigest([frame(0, 1), { ...frame(0.1, 1.5), d: { W: 0 } }], ev));
    expect(runDigest(h, [])).not.toBe(d);
    expect(runDigest(h.slice(0, 1), ev)).not.toBe(d);
  });
});
