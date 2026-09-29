import { describe, expect, it } from 'vitest';
import { RNG } from './rng';

/** mulberry32 as published (Tommy Ettinger), with the accumulator left unreduced as this file's RNG did before it was reduced */
function reference(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    let t = (a += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('RNG (mulberry32)', () => {
  // values of the generator as it was before its state was reduced: the sequences of every recorded run depend on them
  it('gives the sequence recorded before the state was reduced', () => {
    const pins: [number, number[], number][] = [
      [1, [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741], 0.16243944154120982],
      [42, [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693], 0.13964619883336127],
      [0, [0.3588899802416563, 0.10590326134115458, 0.675290479324758, 0.9179345588199794], 0.2896739293355495],
      [4294967295, [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677], 0.16115584666840732],
    ];
    for (const [seed, first, draw10000] of pins) {
      const r = new RNG(seed);
      expect([r.next(), r.next(), r.next(), r.next()]).toEqual(first);
      for (let i = 0; i < 9996; i++) r.next();
      expect(r.next()).toBe(draw10000);
    }
  });

  it('equals the published generator draw for draw', () => {
    for (const seed of [1, 7, 20260928, 0xdeadbeef]) {
      const r = new RNG(seed), ref = reference(seed);
      for (let i = 0; i < 20000; i++) if (r.next() !== ref()) throw new Error(`seed ${seed} differs at draw ${i}`);
    }
  });

  it('keeps its state a uint32: getState() never leaves [0, 2^32)', () => {
    const r = new RNG(3);
    for (let i = 0; i < 5000; i++) {
      r.next();
      const s = r.getState();
      if (!(Number.isInteger(s) && s >= 0 && s < 4294967296)) throw new Error(`state ${s} after draw ${i + 1}`);
    }
    r.normal(); r.exponential(2);
    expect(r.getState()).toBeLessThan(4294967296);
  });

  it('setState(getState()) changes nothing, and a restored generator continues the sequence', () => {
    const r = new RNG(11);
    for (let i = 0; i < 1234; i++) r.next();
    const s = r.getState();
    const a = new RNG(999);
    a.setState(s);
    expect(a.getState()).toBe(s);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(r.next());
    expect(a.getState()).toBe(r.getState());
  });

  it('a state from a run of an older version (unreduced) is reduced by setState() and gives the same sequence', () => {
    const r = new RNG(5);
    for (let i = 0; i < 100; i++) r.next();
    const old = r.getState() + 7 * 4294967296; // what the unreduced accumulator would have held
    const a = new RNG(1);
    a.setState(old);
    expect(a.getState()).toBe(r.getState());
    expect(a.next()).toBe(r.next());
  });

  it('a zero seed falls back to the fixed default, and 0 is a legal state', () => {
    expect(new RNG(0).getState()).toBe(0x9e3779b9);
    const r = new RNG(1);
    r.setState(0);
    expect(r.getState()).toBe(0);
    expect(Number.isFinite(r.next())).toBe(true);
  });
});
