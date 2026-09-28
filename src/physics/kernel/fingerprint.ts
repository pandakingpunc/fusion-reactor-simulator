/**
 * Run fingerprints and run digests.
 *
 * A fingerprint names a run by its inputs: two runs with the same fingerprint are bitwise the same
 * run (same configuration, seed, live interventions, breakpoint schedule and simulator version),
 * because the kernel is deterministic and independent of how it is chunked in time.
 * A digest names a run by its outputs (every number of every history frame and every event), for
 * comparing two runs cheaply.
 */
import type { ActuatorEntry, HistoryFrame, ReactorConfig, SimEvent } from '../types';
import { canonicalString } from './canonical';
import { Sha256, sha256Hex, utf8Encode } from './sha256';

/** Version of the fingerprint payload layout; part of the hashed payload. */
export const FINGERPRINT_SCHEMA = 1;

/**
 * SHA-256 (hex) of the canonical serialisation of a run's inputs.
 * @param cfg         the reactor configuration as passed to new Simulation(cfg)
 * @param seed        RNG seed of the run (normally cfg.seed)
 * @param actuatorLog Simulation.actuatorLog: every applyControl() with its step boundary
 * @param appVersion  simulator version (e.g. package.json version) — a new version may change results
 * @param breakpoints optional user breakpoint schedule (SimulationOptions.breakpoints); an empty or
 *                    missing schedule does not enter the payload
 */
export function runFingerprint(
  cfg: ReactorConfig, seed: number, actuatorLog: readonly ActuatorEntry[], appVersion: string,
  breakpoints?: readonly number[],
): string {
  const payload: Record<string, unknown> = {
    kind: 'fusion-simulator-run',
    schema: FINGERPRINT_SCHEMA,
    appVersion,
    seed,
    cfg,
    actuatorLog: actuatorLog.map((e) => ({ t: e.t, step: e.step, patch: e.patch })),
  };
  if (breakpoints && breakpoints.length) payload.breakpoints = [...breakpoints];
  return sha256Hex(canonicalString(payload));
}

/**
 * SHA-256 (hex) of a run's outputs: every history frame (t, state, diagnostics, internal state,
 * profiles, equilibrium snapshot, kernel checkpoint) and every event, in order. Equal digests mean
 * bitwise-equal runs: numbers enter as their IEEE-754 bits (all NaNs as one), object keys sorted.
 */
export function runDigest(history: readonly HistoryFrame[], events: readonly SimEvent[]): string {
  const w = new DigestWriter();
  w.value(history);
  w.value(events);
  return w.hex();
}

/** Structural value hasher: a tagged, length-prefixed binary encoding fed to SHA-256 in blocks. */
class DigestWriter {
  private readonly sha = new Sha256();
  private readonly buf = new Uint8Array(1 << 16);
  private readonly view = new DataView(this.buf.buffer);
  private pos = 0;

  hex(): string {
    this.flush();
    return this.sha.hex();
  }

  value(v: unknown): void {
    switch (typeof v) {
      case 'number': this.num(v); return;
      case 'string': this.str(v); return;
      case 'boolean': this.tag(v ? 0x54 : 0x46); return;
      case 'undefined': this.tag(0x55); return;
      case 'object': break;
      default: throw new TypeError(`runDigest: cannot hash a ${typeof v}`);
    }
    if (v === null) { this.tag(0x5a); return; }
    if (Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView))) {
      const a = v as ArrayLike<unknown>;
      this.tag(0x5b); this.u32(a.length);
      for (let i = 0; i < a.length; i++) this.value(a[i]);
      return;
    }
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    this.tag(0x7b); this.u32(keys.length);
    for (const k of keys) { this.str(k); this.value(o[k]); }
  }

  private flush(): void {
    if (this.pos) { this.sha.update(this.buf.subarray(0, this.pos)); this.pos = 0; }
  }
  private room(n: number): void {
    if (this.pos + n > this.buf.length) this.flush();
  }
  private tag(b: number): void {
    this.room(1);
    this.buf[this.pos++] = b;
  }
  private u32(n: number): void {
    this.room(4);
    this.view.setUint32(this.pos, n, true);
    this.pos += 4;
  }
  private num(x: number): void {
    this.room(9);
    this.buf[this.pos++] = 0x4e;
    this.view.setFloat64(this.pos, Number.isNaN(x) ? NaN : x, true);
    this.pos += 8;
  }
  private str(s: string): void {
    // fast path: short ASCII strings (every diagnostic key) are written in place
    if (s.length <= 256) {
      this.room(5 + s.length);
      const start = this.pos;
      let ascii = true;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0x80) { ascii = false; break; }
        this.buf[start + 5 + i] = c;
      }
      if (ascii) {
        this.buf[start] = 0x53;
        this.view.setUint32(start + 1, s.length, true);
        this.pos = start + 5 + s.length;
        return;
      }
    }
    const b = utf8Encode(s);
    this.tag(0x53); this.u32(b.length);
    for (let i = 0; i < b.length; i += this.buf.length) {
      const part = b.subarray(i, i + this.buf.length);
      this.room(part.length);
      this.buf.set(part, this.pos);
      this.pos += part.length;
    }
  }
}
