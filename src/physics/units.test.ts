import { describe, expect, it } from 'vitest';
import { aboveLimit } from './units';

describe('aboveLimit', () => {
  it('uses no decimal when the rounded value is already above the limit', () => {
    expect(aboveLimit(46.3, 10)).toBe('46');
    expect(aboveLimit(10.6, 10)).toBe('11');
  });
  it('adds decimals until the printed value is above the limit', () => {
    expect(aboveLimit(10.2, 10)).toBe('10.2');
    expect(aboveLimit(10.04, 10)).toBe('10.04');
    expect(aboveLimit(10.004, 10)).toBe('10.004');
  });
  it('stops at three decimals for a value that is not measurably above the limit', () => {
    expect(aboveLimit(10.0000001, 10)).toBe('10.000');
    expect(aboveLimit(10, 10)).toBe('10.000');
  });
});
