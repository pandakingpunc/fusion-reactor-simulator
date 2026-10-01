/**
 * Deterministik PRNG (mulberry32). Aynı seed -> aynı ELM/jitter dizisi.
 * Durumu kaydedilip geri yüklenebilir (geri sarma + müdahale için).
 *
 * The state is the 32-bit accumulator of mulberry32 (Tommy Ettinger's public-domain generator), always reduced modulo
 * 2^32, so getState() returns a uint32 and setState(getState()) changes nothing. The accumulator used to be left
 * unreduced (it grew by 0x6d2b79f5 per draw while setState() reduced it): the sequence was the same, but a rewound run
 * stored smaller numbers in frame.internal.rng than the uninterrupted one, and the run digest was not rewind invariant.
 */
export class RNG {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Standart normal (Box-Muller) */
  normal(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Üstel dağılım, ortalama mu */
  exponential(mu: number): number {
    return -mu * Math.log(1 - this.next());
  }
  getState(): number {
    return this.s;
  }
  setState(s: number) {
    this.s = s >>> 0;
  }
}
