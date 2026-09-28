/**
 * SHA-256 in plain TypeScript (no Web Crypto, no Node crypto: the physics core runs unchanged in
 * the browser, a web worker and Node, and synchronously).
 *
 * Reference: NIST FIPS PUB 180-4, "Secure Hash Standard (SHS)", August 2015,
 * doi:10.6028/NIST.FIPS.180-4 — §4.1.2 (functions), §4.2.2 (constants), §5.1.1 (padding),
 * §5.3.3 (initial hash value), §6.2.2 (hash computation).
 */

/** First 32 bits of the fractional parts of the cube roots of the first 64 primes (§4.2.2). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** First 32 bits of the fractional parts of the square roots of the first 8 primes (§5.3.3). */
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/**
 * UTF-8 encoding of a JavaScript string (WHATWG Encoding: a lone surrogate becomes U+FFFD,
 * exactly as TextEncoder does).
 */
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      else c = 0xfffd;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** Incremental SHA-256: update() any number of times, then digest() once. */
export class Sha256 {
  private readonly h = Uint32Array.from(H0);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private fill = 0;
  /** message length so far in bytes (exact up to 2^53) */
  private length = 0;
  private finished = false;
  private readonly num = new DataView(new ArrayBuffer(8));

  /** Appends bytes, or a string as UTF-8. */
  update(data: Uint8Array | string): this {
    if (this.finished) throw new Error('Sha256: update() after digest()');
    const bytes = typeof data === 'string' ? utf8Encode(data) : data;
    this.length += bytes.length;
    let i = 0;
    while (i < bytes.length) {
      const take = Math.min(64 - this.fill, bytes.length - i);
      this.block.set(bytes.subarray(i, i + take), this.fill);
      this.fill += take; i += take;
      if (this.fill === 64) { this.compress(); this.fill = 0; }
    }
    return this;
  }

  /** Appends the 8 bytes of an IEEE-754 double, little-endian (so −0 and every NaN payload differ). */
  updateFloat64(x: number): this {
    this.num.setFloat64(0, x, true);
    return this.update(new Uint8Array(this.num.buffer));
  }

  /** Finishes the hash (§5.1.1 padding) and returns the 32-byte digest. */
  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256: digest() called twice');
    const bits = this.length * 8;
    const pad = new Uint8Array(((this.fill < 56 ? 56 : 120) - this.fill) + 8);
    pad[0] = 0x80;
    const v = new DataView(pad.buffer);
    v.setUint32(pad.length - 8, Math.floor(bits / 0x100000000));
    v.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    this.finished = true;
    const out = new Uint8Array(32);
    const o = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) o.setUint32(4 * i, this.h[i]);
    return out;
  }

  /** digest() as lowercase hexadecimal. */
  hex(): string {
    return toHex(this.digest());
  }

  private compress(): void {
    const { w, h, block } = this;
    for (let t = 0; t < 16; t++) w[t] = (block[4 * t] << 24) | (block[4 * t + 1] << 16) | (block[4 * t + 2] << 8) | block[4 * t + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
}

/** Lowercase hexadecimal of bytes. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** SHA-256 of bytes, or of a string as UTF-8, as lowercase hexadecimal. */
export function sha256Hex(data: Uint8Array | string): string {
  return new Sha256().update(data).hex();
}
