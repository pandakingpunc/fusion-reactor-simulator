/// <reference types="node" />
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RNG } from '../rng';
import { Sha256, sha256Hex, toHex, utf8Encode } from './sha256';

describe('SHA-256 (FIPS 180-4)', () => {
  // NIST example values (csrc.nist.gov, "Cryptographic Standards and Guidelines: Examples with
  // Intermediate Values", SHA-256) and the FIPS 180-2 appendix B long message
  const vectors: [string, string][] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ];
  it.each(vectors)('test vector %#', (msg, hex) => {
    expect(sha256Hex(msg)).toBe(hex);
  });

  it('one million times "a" (FIPS 180-2 B.3), fed in uneven pieces', () => {
    const h = new Sha256();
    const chunk = new Uint8Array(997).fill(0x61);
    let left = 1_000_000;
    while (left > 0) { const n = Math.min(left, chunk.length); h.update(chunk.subarray(0, n)); left -= n; }
    expect(h.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('matches node:crypto for every length across the padding boundaries and random data', () => {
    const rng = new RNG(20260928);
    for (let len = 0; len <= 300; len++) {
      const b = new Uint8Array(len);
      for (let i = 0; i < len; i++) b[i] = Math.floor(rng.next() * 256);
      expect(sha256Hex(b)).toBe(createHash('sha256').update(b).digest('hex'));
      // the same bytes split at a random point
      const cut = Math.floor(rng.next() * (len + 1));
      expect(new Sha256().update(b.subarray(0, cut)).update(b.subarray(cut)).hex()).toBe(sha256Hex(b));
    }
  });

  it('hashes doubles by their little-endian bit pattern', () => {
    const b = new Uint8Array(new Float64Array([1.5, -0, NaN, Infinity]).buffer);
    const h = new Sha256().updateFloat64(1.5).updateFloat64(-0).updateFloat64(NaN).updateFloat64(Infinity);
    expect(h.hex()).toBe(createHash('sha256').update(b).digest('hex'));
    expect(new Sha256().updateFloat64(0).hex()).not.toBe(new Sha256().updateFloat64(-0).hex());
  });

  it('rejects use after digest()', () => {
    const h = new Sha256().update('x');
    h.digest();
    expect(() => h.update('y')).toThrow();
    expect(() => h.digest()).toThrow();
  });
});

describe('utf8Encode', () => {
  it('matches TextEncoder, including astral characters and lone surrogates', () => {
    const te = new TextEncoder();
    for (const s of ['', 'ascii', 'füzyon tokomak — Δt, τ_E, ρ²', '€', '𝜏 🔥 \u{10FFFF}', 'a\uD800b', '\uDC00', 'x\uD83D']) {
      expect(Array.from(utf8Encode(s))).toEqual(Array.from(te.encode(s)));
    }
  });
  it('toHex pads bytes', () => {
    expect(toHex(Uint8Array.from([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });
});
