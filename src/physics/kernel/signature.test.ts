import { describe, expect, it } from 'vitest';
import { sameRecord } from './signature';

describe('sameRecord', () => {
  it('is true for records with the same keys and values, whatever the key order', () => {
    expect(sameRecord({}, {})).toBe(true);
    expect(sameRecord({ a: 1, b: 2.5 }, { b: 2.5, a: 1 })).toBe(true);
  });

  it('is false when a value differs, even by one ulp', () => {
    expect(sameRecord({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameRecord({ a: 1 }, { a: 1 + Number.EPSILON })).toBe(false);
  });

  it('is false when either record has a key the other lacks', () => {
    expect(sameRecord({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameRecord({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    // same number of keys, different names
    expect(sameRecord({ a: 1 }, { b: 1 })).toBe(false);
    // a missing key is not an undefined value
    expect(sameRecord({ a: 1, b: undefined as unknown as number }, { a: 1, c: undefined as unknown as number })).toBe(false);
  });

  it('compares bitwise: NaN equals NaN, +0 differs from −0, infinities match themselves', () => {
    expect(sameRecord({ a: NaN }, { a: NaN })).toBe(true);
    expect(sameRecord({ a: 0 }, { a: -0 })).toBe(false);
    expect(sameRecord({ a: Infinity, b: -Infinity }, { a: Infinity, b: -Infinity })).toBe(true);
    expect(sameRecord({ a: Infinity }, { a: -Infinity })).toBe(false);
  });
});
