/**
 * En küçük PNG kodlayıcı (8-bit RGB, filtre 0) ve zlib sarmalayıcı. deflate verilmezse
 * sıkıştırmasız "stored" bloklar kullanılır (tarayıcıda da bağımlılıksız çalışır).
 * Kaynak: RFC 2083 (PNG), RFC 1950 (zlib), RFC 1951 (deflate stored blocks).
 */
export type Deflate = (data: Uint8Array) => Uint8Array; // zlib biçimli (başlık + adler32) çıktı

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** zlib akışı, sıkıştırmasız (stored) bloklarla */
export function zlibStored(data: Uint8Array): Uint8Array {
  const nBlocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + nBlocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let p = 2;
  for (let b = 0; b < nBlocks; b++) {
    const s = b * 65535, len = Math.min(65535, data.length - s);
    out[p++] = b === nBlocks - 1 ? 1 : 0;
    out[p++] = len & 255; out[p++] = len >> 8;
    out[p++] = ~len & 255; out[p++] = (~len >> 8) & 255;
    out.set(data.subarray(s, s + len), p); p += len;
  }
  const ad = adler32(data);
  out[p++] = ad >>> 24; out[p++] = (ad >>> 16) & 255; out[p++] = (ad >>> 8) & 255; out[p++] = ad & 255;
  return out;
}

export function encodePNG(rgb: Uint8Array, w: number, h: number, deflate?: Deflate): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1); }
  const idat = deflate ? deflate(raw) : zlibStored(raw);
  const chunks: Uint8Array[] = [];
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    chunks.push(c);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', new Uint8Array(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const total = sig.length + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  out.set(sig, 0);
  let p = sig.length;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

export function base64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    s += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (i + 1 < bytes.length ? chars[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? chars[n & 63] : '=');
  }
  return s;
}
