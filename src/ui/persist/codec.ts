/**
 * Share links: a configuration (with the scenario and the actuator log of a run, when it has them) as one
 * URL-safe code.
 *
 *   code  = base64url( header || body )
 *   header = [ format version : 1 byte ][ flags : 1 byte ][ CRC-32 of the JSON text : 4 bytes, big endian ]
 *   body   = the payload's JSON (see json.ts for the numbers JSON has no form for), UTF-8, deflate-raw
 *            compressed when flag 1 is set (CompressionStream; stored uncompressed where the browser has none)
 *
 * The version byte comes first so that a code from a future format is refused by name instead of being
 * mis-read; the CRC catches a link that was truncated or mangled on its way (deflate has no check of its
 * own); the decoder caps the inflated size, so a few hundred bytes of link cannot expand into memory.
 * Decoding validates the payload (validate.ts): a code either yields a usable configuration or a
 * ShareError that says why not.
 *
 * Nothing here leaves the browser: the link is the data, there is no server.
 */
import { ActuatorEntry, ReactorConfig } from '../../physics/types';
import { fromBase64Url, toBase64Url } from './base64url';
import { parseJson, stringifyJson } from './json';
import { checkRunInputs, isFingerprint, LIMITS } from './validate';

/** Version of the link format written by encodeShare. */
export const SHARE_VERSION = 1;
const FLAG_DEFLATE = 1;
const KNOWN_FLAGS = FLAG_DEFLATE;
const HEADER_BYTES = 6;
/** Largest inflated payload accepted (the biggest legitimate one, a configuration with a long actuator log, is far below). */
export const MAX_JSON_BYTES = 1 << 20;
/** Longest code decoded. */
export const MAX_CODE_CHARS = 400_000;
/** Length above which some chat and mail clients cut a link. */
export const SAFE_LINK_CHARS = 2000;

export interface SharePayload {
  cfg: ReactorConfig;
  /** what to call the configuration in the wizard */
  name?: string;
  /** live interventions of the run being shared (Simulation.actuatorLog) */
  actuatorLog?: ActuatorEntry[];
  breakpoints?: number[];
  /** ScenarioSpec of the run (plain JSON; the scenario engine interprets it) */
  scenario?: unknown;
  /** simulator version that wrote the link */
  appVersion?: string;
  /** runFingerprint of the shared run, so that the receiver can tell it reproduces */
  fingerprint?: string;
}

export type ShareErrorCode = 'malformed' | 'checksum' | 'version' | 'too-large' | 'invalid' | 'unsupported';

/** A share code that cannot be turned into a payload (or a payload that cannot be turned into a code). */
export class ShareError extends Error {
  constructor(readonly code: ShareErrorCode, message: string, readonly issues: string[] = []) {
    super(message);
    this.name = 'ShareError';
  }
}

export interface DecodedShare {
  payload: SharePayload;
  /** format version of the code */
  version: number;
  /** usable-but-odd findings of the validation (unknown fields, out-of-range values) */
  warnings: string[];
}

// ── CRC-32 (IEEE 802.3) ──────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── deflate-raw through the platform's stream API ────────────────────────────

/** Whether this environment can compress and decompress (CompressionStream: Chrome 80, Safari 16.4, Firefox 113, Node 18). */
export function compressionAvailable(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function through(bytes: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }, maxOut: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // feed and read concurrently: reading only after the write completes would deadlock on back-pressure
  const fed = (async () => { await writer.write(bytes); await writer.close(); })();
  fed.catch(() => { /* the read side reports the failure */ });
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxOut) {
        await reader.cancel().catch(() => undefined);
        throw new ShareError('too-large', 'the link expands to more data than a configuration can be');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const deflate = (b: Uint8Array) => through(b, new CompressionStream('deflate-raw') as never, Infinity);
const inflate = (b: Uint8Array) => through(b, new DecompressionStream('deflate-raw') as never, MAX_JSON_BYTES);

// ── encode ───────────────────────────────────────────────────────────────────

/** Errors that stop a payload from being shared, or [] when it is fine. */
export function checkPayload(payload: SharePayload): { errors: string[]; warnings: string[] } {
  const holder = payload as unknown as Record<string, unknown>;
  const c = checkRunInputs(holder);
  const errors = [...c.errors];
  if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.length > LIMITS.nameChars)) errors.push('the name is not a text of at most 200 characters');
  if (payload.appVersion !== undefined && (typeof payload.appVersion !== 'string' || payload.appVersion.length > 32)) errors.push('the version is not a short text');
  if (payload.fingerprint !== undefined && !isFingerprint(payload.fingerprint)) errors.push('the fingerprint is not 64 hexadecimal digits');
  return { errors, warnings: c.warnings };
}

/** The code of a payload. Throws ShareError('invalid') for a payload decodeShare would refuse. */
export async function encodeShare(payload: SharePayload, opts: { compress?: boolean } = {}): Promise<string> {
  const { errors } = checkPayload(payload);
  if (errors.length) throw new ShareError('invalid', `cannot share: ${errors[0]}`, errors);
  const json = new TextEncoder().encode(stringifyJson(payload));
  if (json.length > MAX_JSON_BYTES) throw new ShareError('too-large', 'the payload is too large to share');
  const compress = (opts.compress ?? true) && compressionAvailable();
  const body = compress ? await deflate(json) : json;
  const out = new Uint8Array(HEADER_BYTES + body.length);
  out[0] = SHARE_VERSION;
  out[1] = compress ? FLAG_DEFLATE : 0;
  new DataView(out.buffer).setUint32(2, crc32(json), false);
  out.set(body, HEADER_BYTES);
  return toBase64Url(out);
}

// ── decode ───────────────────────────────────────────────────────────────────

/** The payload of a code. Throws ShareError: 'malformed', 'checksum', 'version', 'too-large', 'unsupported' or 'invalid'. */
export async function decodeShare(code: string): Promise<DecodedShare> {
  if (typeof code !== 'string' || !code.length) throw new ShareError('malformed', 'the link has no data');
  if (code.length > MAX_CODE_CHARS) throw new ShareError('too-large', 'the link is too long');
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(code);
  } catch {
    throw new ShareError('malformed', 'the link is not valid base64url text (was it cut or altered?)');
  }
  if (raw.length < HEADER_BYTES) throw new ShareError('malformed', 'the link is too short');
  const version = raw[0];
  if (version !== SHARE_VERSION) {
    throw new ShareError('version', `the link uses format ${version}; this version of the simulator reads format ${SHARE_VERSION}`);
  }
  const flags = raw[1];
  if (flags & ~KNOWN_FLAGS) throw new ShareError('unsupported', 'the link uses features this version does not know');
  let json: Uint8Array;
  if (flags & FLAG_DEFLATE) {
    if (!compressionAvailable()) throw new ShareError('unsupported', 'this browser cannot decompress the link (no DecompressionStream)');
    try {
      json = await inflate(raw.subarray(HEADER_BYTES));
    } catch (e) {
      if (e instanceof ShareError) throw e;
      throw new ShareError('malformed', 'the link data is corrupt (was it cut or altered?)');
    }
  } else {
    json = raw.subarray(HEADER_BYTES);
    if (json.length > MAX_JSON_BYTES) throw new ShareError('too-large', 'the link expands to more data than a configuration can be');
  }
  if (new DataView(raw.buffer, raw.byteOffset).getUint32(2, false) !== crc32(json)) {
    throw new ShareError('checksum', 'the link is damaged: its checksum does not match (was it cut or altered?)');
  }
  let parsed: unknown;
  try {
    parsed = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    throw new ShareError('malformed', 'the link does not contain valid data');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ShareError('malformed', 'the link does not contain a configuration');
  const payload = parsed as unknown as SharePayload;
  const { errors, warnings } = checkPayload(payload);
  if (errors.length) throw new ShareError('invalid', `the configuration in the link is not valid: ${errors[0]}`, errors);
  return { payload, version, warnings };
}

/** decodeShare without the exception: the error is returned. */
export async function tryDecodeShare(code: string): Promise<{ ok: true; value: DecodedShare } | { ok: false; error: ShareError }> {
  try {
    return { ok: true, value: await decodeShare(code) };
  } catch (e) {
    if (e instanceof ShareError) return { ok: false, error: e };
    throw e;
  }
}

/** A complete link to `code` for the page at `base` (its URL without any fragment), and whether it is long enough for some clients to cut it. */
export function shareUrl(code: string, base: string): { url: string; length: number; long: boolean } {
  const url = `${base.replace(/#.*$/, '')}#/share/${code}`;
  return { url, length: url.length, long: url.length > SAFE_LINK_CHARS };
}
