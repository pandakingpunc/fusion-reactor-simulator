import { describe, expect, it } from 'vitest';
import { canonicalString } from '../../physics/kernel/canonical';
import { RNG } from '../../physics/rng';
import { PRESETS } from '../../physics/presets';
import { ReactorConfig } from '../../physics/types';
import { fromBase64Url, toBase64Url } from './base64url';
import { crc32, decodeShare, encodeShare, MAX_JSON_BYTES, SAFE_LINK_CHARS, ShareError, shareUrl, SharePayload, tryDecodeShare } from './codec';
import { parseJson, stringifyJson } from './json';
import { editConfig, editPayload } from './testdata/edits';
import { checkConfig } from './validate';

const same = (a: unknown, b: unknown) => canonicalString(a) === canonicalString(b);
const roundTrip = async (p: SharePayload) => (await decodeShare(await encodeShare(p))).payload;

describe('base64url', () => {
  it('round-trips every length and rejects what is not base64url', () => {
    const rng = new RNG(1);
    for (let n = 0; n < 70; n++) {
      const bytes = Uint8Array.from({ length: n }, () => Math.floor(rng.next() * 256));
      const s = toBase64Url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect([...fromBase64Url(s)]).toEqual([...bytes]);
    }
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect([...fromBase64Url('  -__-\n')]).toEqual([0xfb, 0xff, 0xfe]);
    expect([...fromBase64Url('-__-==')]).toEqual([0xfb, 0xff, 0xfe]);
    expect([...fromBase64Url('+//+')]).toEqual([0xfb, 0xff, 0xfe]);
    expect(() => fromBase64Url('ab$d')).toThrow(RangeError);
    expect(() => fromBase64Url('abcde')).toThrow(RangeError);
    expect(() => fromBase64Url('aé')).toThrow(RangeError);
  });
});

describe('tagged JSON', () => {
  it('keeps NaN, the infinities and negative zero, and is plain JSON otherwise', () => {
    const v = { a: NaN, b: [Infinity, -Infinity, -0, 0, 1.5e-300], c: { d: 'NaN', e: null, f: true } };
    const text = stringifyJson(v);
    expect(JSON.parse(text).b[3]).toBe(0);
    const back = parseJson(text) as typeof v;
    expect(same(back, v)).toBe(true);
    expect(Object.is(back.b[2], -0)).toBe(true);
    expect(stringifyJson({ x: 1, y: 'two' })).toBe('{"x":1,"y":"two"}');
  });

  it('leaves an object that only looks like a tag alone', () => {
    expect(parseJson('{"$num":"nope"}')).toEqual({ $num: 'nope' });
    expect(parseJson('{"$num":"NaN","x":1}')).toEqual({ $num: 'NaN', x: 1 });
  });
});

describe('share codec: round trip', () => {
  it('the 21 stock presets survive unchanged, and their links are short enough to paste', async () => {
    expect(PRESETS).toHaveLength(21);
    for (const p of PRESETS) {
      const code = await encodeShare({ cfg: p.cfg, name: p.name });
      const { payload, version } = await decodeShare(code);
      expect(version, p.id).toBe(1);
      expect(same(payload.cfg, p.cfg), p.id).toBe(true);
      expect(payload.name, p.id).toBe(p.name);
      expect(code.length, p.id).toBeLessThan(1500);
    }
  });

  it('is exact for 200 random edits of each of the 21 presets (any double, blanks, NaN, infinities, -0)', async () => {
    for (const p of PRESETS) {
      const rng = new RNG(0xc0de + PRESETS.indexOf(p));
      for (let i = 0; i < 200; i++) {
        const payload = editPayload(p.cfg, rng, i);
        // every third link goes through deflate (a stream round trip costs milliseconds), all of them through the JSON, checksum and validation
        const back = (await decodeShare(await encodeShare(payload, { compress: i % 3 === 0 }))).payload;
        if (!same(back, payload)) throw new Error(`${p.id} edit ${i}: the decoded payload differs\n${canonicalString(payload)}\n${canonicalString(back)}`);
      }
    }
  }, 120_000);

  it('the order of the keys of a configuration does not change what it decodes to', async () => {
    const a = PRESETS[0].cfg as unknown as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(a).reverse()) as unknown as ReactorConfig;
    expect(same(await roundTrip({ cfg: reversed }), { cfg: a })).toBe(true);
  });

  it('works without compression (a browser with no CompressionStream) and reads both forms', async () => {
    const payload = { cfg: PRESETS[8].cfg, name: 'ITER15' };
    const plain = await encodeShare(payload, { compress: false });
    const packed = await encodeShare(payload);
    expect(plain.length).toBeGreaterThan(packed.length * 1.5);
    expect(same((await decodeShare(plain)).payload, payload)).toBe(true);
    expect(same((await decodeShare(packed)).payload, payload)).toBe(true);
  });

  it('carries a scenario and an actuator log next to the configuration', async () => {
    const payload: SharePayload = {
      cfg: PRESETS[0].cfg,
      actuatorLog: [{ t: 12.5, step: 340, patch: { P_NBI_MW: 20 } }, { t: 20, step: 512, patch: { H98: 0.9, P_ICRH_MW: 0 } }],
      breakpoints: [10, 20],
      scenario: { schema: 1, waveforms: {}, triggers: [{ id: 'a', diag: 'betaN', op: '>', value: 2.5, set: { P_NBI_MW: 0 } }] },
      appVersion: '4.0.0',
      fingerprint: 'a'.repeat(64),
    };
    expect(same(await roundTrip(payload), payload)).toBe(true);
  });

  it('shareUrl puts the code in the fragment and flags a link long enough to be cut', () => {
    const u = shareUrl('AQAA', 'https://example.org/sim/index.html#/run');
    expect(u).toEqual({ url: 'https://example.org/sim/index.html#/share/AQAA', length: 46, long: false });
    expect(shareUrl('x'.repeat(SAFE_LINK_CHARS), 'https://e.org/').long).toBe(true);
  });

  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('share codec: decoding refuses what is not a configuration', () => {
  const err = async (code: string) => {
    const r = await tryDecodeShare(code);
    if (r.ok) throw new Error('expected a failure');
    return r.error;
  };

  it('names the problem of a damaged link', async () => {
    const code = await encodeShare({ cfg: PRESETS[0].cfg });
    expect((await err('')).code).toBe('malformed');
    expect((await err('ab$')).code).toBe('malformed');
    expect((await err('AQ')).code).toBe('malformed');
    // a truncated link: the checksum or the deflate stream notices
    expect(['malformed', 'checksum']).toContain((await err(code.slice(0, code.length - 30))).code);
    // one changed character in the body
    const i = Math.floor(code.length / 2);
    const bad = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    expect(['malformed', 'checksum']).toContain((await err(bad)).code);
    // and in the header's checksum
    const bytes = fromBase64Url(code);
    bytes[3] ^= 0xff;
    expect((await err(toBase64Url(bytes))).code).toBe('checksum');
  });

  it('refuses another format version and unknown flags by name', async () => {
    const bytes = fromBase64Url(await encodeShare({ cfg: PRESETS[0].cfg }));
    const v2 = bytes.slice();
    v2[0] = 2;
    const e = await err(toBase64Url(v2));
    expect(e.code).toBe('version');
    expect(e.message).toMatch(/format 2/);
    const flagged = bytes.slice();
    flagged[1] |= 0x80;
    expect((await err(toBase64Url(flagged))).code).toBe('unsupported');
  });

  /** a code with a valid header and checksum around any JSON text */
  const codeOf = async (json: string, compress = true) => {
    const raw = new TextEncoder().encode(json);
    const body = compress ? await deflateRaw(raw) : raw;
    const out = new Uint8Array(6 + body.length);
    out[0] = 1; out[1] = compress ? 1 : 0;
    new DataView(out.buffer).setUint32(2, crc32(raw), false);
    out.set(body, 6);
    return toBase64Url(out);
  };
  async function deflateRaw(b: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter();
    void w.write(new Uint8Array(b)).then(() => w.close());
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }

  it('refuses JSON that is not a valid payload, with the reason', async () => {
    const good = JSON.parse(JSON.stringify(PRESETS[0].cfg)) as Record<string, unknown>;
    const withCfg = (mut: (c: Record<string, unknown>) => void) => { const c = structuredClone(good); mut(c); return JSON.stringify({ cfg: c }); };
    const cases: [string, string, RegExp][] = [
      ['not JSON', 'not json at all', /valid data/],
      ['an array', '[1,2,3]', /does not contain a configuration/],
      ['no cfg', '{"name":"x"}', /not an object/],
      ['unknown method', withCfg((c) => { c.method = 'warp_drive'; }), /unknown method 'warp_drive'/],
      ['method not a string', withCfg((c) => { c.method = 7; }), /unknown method a number/],
      ['a number as text', withCfg((c) => { c.fuel = 3; }), /fuel: expected a string/],
      ['text as a number', withCfg((c) => { c.B0 = '5.3'; }), /B0: expected a number/],
      ['null as a number', withCfg((c) => { c.B0 = null; }), /B0: null is not a value/],
      ['a section as a number', withCfg((c) => { c.geometry = 5; }), /geometry: expected an object|geometry:.*not a value|missing section/],
      ['a number as a section', withCfg((c) => { (c.heating as Record<string, unknown>).P_NBI_MW = { x: 1 }; }), /heating\.P_NBI_MW: expected a number, found an object/],
      ['a missing section', withCfg((c) => { delete c.heating; }), /missing section 'heating'/],
      ['a choice out of range', withCfg((c) => { c.fuel = 'antimatter'; }), /fuel: 'antimatter' is not one of 'DT', 'DD'/],
      ['a forbidden key', '{"cfg":' + JSON.stringify(good).replace('"B0"', '"__proto__":{"x":1},"B0"') + '}', /forbidden key/],
      ['an array in a configuration', withCfg((c) => { c.seed = [1]; }), /seed: an array is not a value/],
      ['an over-long name', JSON.stringify({ cfg: good, name: 'x'.repeat(201) }), /name is not a text/],
      ['a bad actuator entry', JSON.stringify({ cfg: good, actuatorLog: [{ t: 1, step: -1, patch: {} }] }), /step: not a non-negative integer/],
      ['a bad patch', JSON.stringify({ cfg: good, actuatorLog: [{ t: 1, step: 1, patch: { a: 'x' } }] }), /patch.a: not a number/],
      ['a bad fingerprint', JSON.stringify({ cfg: good, fingerprint: 'zz' }), /fingerprint/],
      ['a bad breakpoint', JSON.stringify({ cfg: good, breakpoints: ['a'] }), /breakpoint/],
    ];
    for (const [label, json, msg] of cases) {
      const e = await err(await codeOf(json));
      expect(e.code, label).toMatch(/^(invalid|malformed)$/);
      expect(e.message, label).toMatch(msg);
    }
  });

  it('the profiles section is optional in every tokamak configuration: ITER and DEMO carry their LCFS shape there (v4.0), the others have none', () => {
    for (const id of ['ITER', 'DEMO', 'JET', 'SPARC', 'DIIID', 'JT60SA', 'MASTU', 'ITER15']) {
      const c = structuredClone(PRESETS.find((p) => p.id === id)!.cfg) as unknown as Record<string, unknown>;
      expect(checkConfig(c).errors, id).toEqual([]);
      delete c.profiles;
      expect(checkConfig(c).errors, `${id} without a profiles section`).toEqual([]);
    }
    // the reference shape of the LCFS values is a known field of the section (no warning), with a number in each place
    const iter = structuredClone(PRESETS.find((p) => p.id === 'ITER')!.cfg) as unknown as { profiles: { lcfsRef95: Record<string, unknown> } };
    expect(iter.profiles.lcfsRef95).toEqual({ kappa: 1.7, delta: 0.33 });
    expect(checkConfig(iter).warnings.filter((w) => w.includes('lcfs'))).toEqual([]);
    iter.profiles.lcfsRef95.kappa = 'high';
    expect(checkConfig(iter).errors.join('; ')).toMatch(/profiles\.lcfsRef95\.kappa: expected a number/);
  });

  it('the edge model options are known settings (no warning), typed and, where the wizard offers a choice, restricted', () => {
    const c = structuredClone(PRESETS.find((p) => p.id === 'ITER15')!.cfg) as unknown as { divertor: Record<string, unknown>; profiles: Record<string, unknown> };
    c.profiles.edgeModel = 'twoPoint';
    c.divertor.edge = { outerShare: 0.7, spreadingRatio: 1.2, S_mm: 1, lambdaQ_mm: 1.5, divertorLengthFraction: 0.3, kappa0e: 2000, sheathGamma: 7, lossFit: 'body2025',
      radiation: 'lengyel', seedEnrichment: 1, detachTt_eV: 5, targetTilt: 3, strikeRadiusFraction: 0.3 };
    const ok = checkConfig(c);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings.filter((w) => /edge|divertor/.test(w))).toEqual([]);
    (c.divertor.edge as Record<string, unknown>).radiation = 'coronal';
    expect(checkConfig(c).errors.join('; ')).toMatch(/divertor\.edge\.radiation: 'coronal' is not one of/);
    (c.divertor.edge as Record<string, unknown>).radiation = 'lengyel';
    (c.divertor.edge as Record<string, unknown>).kappa0e = 'high';
    expect(checkConfig(c).errors.join('; ')).toMatch(/divertor\.edge\.kappa0e: expected a number/);
    (c.divertor.edge as Record<string, unknown>).kappa0e = 2000;
    c.profiles.edgeModel = 'threePoint';
    expect(checkConfig(c).errors.join('; ')).toMatch(/profiles\.edgeModel: 'threePoint' is not one of/);
  });

  it('the 1.5D solver settings (grid packing, tolerances, step limit, nonlinear solver, plasma-current programme) are known settings (no warning), typed and, for the programme, shaped', () => {
    const c = structuredClone(PRESETS.find((p) => p.id === 'ITER15')!.cfg) as unknown as { profiles: Record<string, unknown> };
    Object.assign(c.profiles, { gridPacking: 6, rtol: 1e-3, atol: 1e-5, dtMax: 0.1, nonlinearSolver: 'newton', IpWaveform: [[0, 12], [30, 15], [400, 15], [430, 2]] });
    const ok = checkConfig(c);
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);
    // and the share codec carries them
    expect(same(JSON.parse(JSON.stringify(c)), c)).toBe(true);
    c.profiles.nonlinearSolver = 'quasi';
    expect(checkConfig(c).errors.join('; ')).toMatch(/profiles\.nonlinearSolver: 'quasi' is not one of 'auto', 'picard', 'newton', 'pc'/);
    c.profiles.nonlinearSolver = 'pc';
    c.profiles.rtol = '1e-3';
    expect(checkConfig(c).errors.join('; ')).toMatch(/profiles\.rtol: expected a number/);
    c.profiles.rtol = 1e-3;
    // the programme: a list of [time, current] pairs of numbers; a wrong shape is unusable, an odd value only a warning
    for (const bad of [15, 'ramp', { t: 0 }, [[0, 12], [30]], [[0, 12, 1]], [[0, '12']], [12, 15], [null]]) {
      c.profiles.IpWaveform = bad;
      expect(checkConfig(c).errors.join('; '), JSON.stringify(bad)).toMatch(/profiles\.IpWaveform/);
    }
    c.profiles.IpWaveform = [[0, 12], [30, 15], [30, 16]];
    expect(checkConfig(c).errors).toEqual([]);
    expect(checkConfig(c).warnings.join('; ')).toMatch(/profiles\.IpWaveform\[2\]: the times of the points should increase/);
    c.profiles.IpWaveform = [[0, 12], [NaN, 15]];
    expect(checkConfig(c).errors).toEqual([]);
    expect(checkConfig(c).warnings.join('; ')).toMatch(/profiles\.IpWaveform\[1\] is not finite/);
    c.profiles.IpWaveform = Array.from({ length: 10001 }, (_, k) => [k, 15]);
    expect(checkConfig(c).errors.join('; ')).toMatch(/profiles\.IpWaveform: more than 10000 points/);
    // a method without profiles keeps the setting unknown
    const nif = structuredClone(PRESETS.find((p) => p.id === 'NIF')!.cfg) as unknown as { profiles?: unknown };
    nif.profiles = { IpWaveform: [[0, 1]] };
    expect(checkConfig(nif).errors.join('; ')).toMatch(/profiles\.IpWaveform: an array is not a value a configuration can hold/);
  });

  it('the systems-lite options (systems.*) are known settings of every magnetic method (no warning) and typed', () => {
    for (const id of ['ITER', 'SPARC15', 'W7X']) {
      const c = structuredClone(PRESETS.find((p) => p.id === id)!.cfg) as unknown as { systems?: Record<string, unknown> };
      c.systems = {
        pulseLength_s: 400, tf: { nCoils: 16, noseFraction: 0.4, structureFraction: 0.6, turnCurrent_A: 60000, verticalInboardFraction: 0.5 },
        cs: { currentDensity_MAm2: 13.6, B_max_T: 12, swingFraction: 0.9, pfFlux_Vs: 30, li: 0.9 }, blanket: { inboardDepth_m: 0.5, breederFraction: 0.5 },
      };
      const ok = checkConfig(c);
      expect(ok.errors, id).toEqual([]);
      expect(ok.warnings.filter((w) => /systems/.test(w)), id).toEqual([]);
      c.systems.pulseLength_s = '400 s';
      expect(checkConfig(c).errors.join('; '), id).toMatch(/systems\.pulseLength_s: expected a number/);
      c.systems.pulseLength_s = 400;
      (c.systems.tf as Record<string, unknown>).nCoils = true;
      expect(checkConfig(c).errors.join('; '), id).toMatch(/systems\.tf\.nCoils: expected a number/);
      (c.systems.tf as Record<string, unknown>).nCoils = 16;
      (c.systems.cs as Record<string, unknown>).fromTheFuture = 1;
      expect(checkConfig(c).warnings.join('; '), id).toMatch(/systems\.cs\.fromTheFuture: unknown field/);
    }
    // a configuration of a method without a magnet keeps the block unknown
    const nif = structuredClone(PRESETS.find((p) => p.id === 'NIF')!.cfg) as unknown as { systems?: unknown };
    nif.systems = { pulseLength_s: 400 };
    expect(checkConfig(nif).warnings.join('; ')).toMatch(/systems\.pulseLength_s: unknown field/);
  });

  it('a hostile scenario is refused; an odd but usable configuration is accepted with warnings', async () => {
    const good = JSON.parse(JSON.stringify(PRESETS[0].cfg)) as Record<string, unknown>;
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = { a: deep };
    expect((await err(await codeOf(JSON.stringify({ cfg: good, scenario: deep })))).message).toMatch(/nested too deeply/);
    expect((await err(await codeOf('{"cfg":' + JSON.stringify(good) + ',"scenario":{"__proto__":{"a":1}}}'))).message).toMatch(/forbidden key/);

    const odd = { ...good, futureField: 3, B0: 500 } as Record<string, unknown>;
    const r = await decodeShare(await codeOf(JSON.stringify({ cfg: odd })));
    expect(r.warnings.join('\n')).toMatch(/futureField: unknown field/);
    expect(r.warnings.join('\n')).toMatch(/B0 = 500 is outside the wizard's range/);
  });

  it('cannot be turned into a memory bomb: an inflated size above the cap is refused while streaming', async () => {
    const zeros = new Uint8Array(MAX_JSON_BYTES * 8);
    const bomb = await deflateRaw(zeros);
    expect(bomb.length).toBeLessThan(20_000);
    const out = new Uint8Array(6 + bomb.length);
    out[0] = 1; out[1] = 1;
    new DataView(out.buffer).setUint32(2, crc32(zeros), false);
    out.set(bomb, 6);
    const e = await err(toBase64Url(out));
    expect(e.code).toBe('too-large');
    expect((await err('A'.repeat(400_001))).code).toBe('too-large');
  });

  it('encoding refuses a payload that decoding would refuse', async () => {
    await expect(encodeShare({ cfg: { ...(PRESETS[0].cfg as object), method: 'nope' } as unknown as ReactorConfig })).rejects.toBeInstanceOf(ShareError);
    await expect(encodeShare({ cfg: PRESETS[0].cfg, actuatorLog: [{ t: NaN, step: 0, patch: {} }] })).rejects.toThrow(/actuatorLog\[0\]\.t/);
    await expect(encodeShare({ cfg: editConfig(PRESETS[0].cfg, new RNG(5)), scenario: { x: NaN } })).rejects.toThrow(/not finite/);
  });
});
