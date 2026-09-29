import { describe, expect, it } from 'vitest';
import { jsonLine, ndjsonRecords, parseNdjson, writeNdjson, writeRunNdjson } from './ndjson';
import { jet, sparc15 } from './testdata/fixtures';

type Rec = Record<string, any>;

describe('NDJSON lines', () => {
  it('one compact JSON value per line, each terminated', () => {
    expect(writeNdjson([{ a: 1 }, [1, 2], 'x', null])).toBe('{"a":1}\n[1,2]\n"x"\nnull\n');
    expect(writeNdjson([])).toBe('');
  });
  it('a string with a line break stays on one line', () => {
    const text = writeNdjson([{ msg: 'a\nb' }]);
    expect(text).toBe('{"msg":"a\\nb"}\n');
    expect(parseNdjson(text)).toEqual([{ msg: 'a\nb' }]);
  });
  it('non-finite numbers: null by default, strings on request, revived on demand', () => {
    const rec = { a: NaN, b: Infinity, c: -Infinity, d: 1.5 };
    expect(jsonLine(rec)).toBe('{"a":null,"b":null,"c":null,"d":1.5}');
    expect(jsonLine(rec, 'string')).toBe('{"a":"NaN","b":"Infinity","c":"-Infinity","d":1.5}');
    const back = parseNdjson(writeNdjson([rec], { nonFinite: 'string' }), { revive: true })[0] as Rec;
    expect(back.a).toBeNaN();
    expect(back.b).toBe(Infinity);
    expect(back.c).toBe(-Infinity);
    expect(back.d).toBe(1.5);
    expect((parseNdjson(writeNdjson([rec], { nonFinite: 'string' }))[0] as Rec).a).toBe('NaN');
  });
  it('the reader skips blank lines and tolerates CRLF, and names the line of a syntax error', () => {
    expect(parseNdjson('{"a":1}\r\n\r\n{"a":2}\n\n')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(() => parseNdjson('{"a":1}\n{oops}\n')).toThrow(/NDJSON line 2/);
  });
});

describe('the records of a run', () => {
  it('meta first, then frames, then events, then the report', () => {
    const { src } = jet();
    const recs = ndjsonRecords(src) as Rec[];
    expect(recs[0].type).toBe('meta');
    expect(recs[0].format).toBe('fusion-sim-ndjson');
    expect(recs[0].method).toBe('tokamak');
    expect(recs[0].timeUnit).toBe('s');
    expect(recs[0].config.method).toBe('tokamak');
    expect(recs[0].provenance.version).toBe('4.0.0-test');
    expect(recs[0].diagnostics.find((d: Rec) => d.key === 'Q')).toMatchObject({ label: 'Scientific Q', unit: '', group: 'Performance' });
    const types = recs.map((r) => r.type);
    expect(types.filter((t) => t === 'frame')).toHaveLength(src.history.length);
    expect(types.filter((t) => t === 'event')).toHaveLength(src.events.length);
    expect(types.filter((t) => t === 'report')).toHaveLength(1);
    expect(types[types.length - 1]).toBe('report');
    expect(types.indexOf('event')).toBeGreaterThan(types.lastIndexOf('frame') - 1);
    expect(recs[recs.length - 1].Q_sci_max).toBe(src.report!.Q_sci_max);
  });
  it('write, parse, equal: frames carry the diagnostics of the history exactly', () => {
    const { src } = jet();
    const parsed = parseNdjson(writeRunNdjson(src)) as Rec[];
    const frames = parsed.filter((r) => r.type === 'frame');
    expect(frames).toHaveLength(src.history.length);
    src.history.forEach((h, i) => {
      expect(frames[i].t).toBe(h.t);
      for (const [k, v] of Object.entries(h.d)) {
        if (Number.isFinite(v)) expect(frames[i].d[k], `${k}@${i}`).toBe(v);
        else expect(frames[i].d[k], `${k}@${i}`).toBeNull();
      }
    });
    const events = parsed.filter((r) => r.type === 'event');
    expect(events.map((e) => ({ t: e.t, kind: e.kind, msg: e.msg }))).toEqual(src.events.map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })));
  });
  it('lossless with nonFinite: string', () => {
    const { src } = jet();
    const parsed = parseNdjson(writeRunNdjson(src, { nonFinite: 'string' }), { revive: true }) as Rec[];
    const frames = parsed.filter((r) => r.type === 'frame');
    src.history.forEach((h, i) => {
      for (const [k, v] of Object.entries(h.d)) expect(Object.is(frames[i].d[k], v) || (Number.isNaN(v) && Number.isNaN(frames[i].d[k])), `${k}@${i}`).toBe(true);
    });
  });
  it('the profiles of a 1.5D run are written when asked, and equal the history', () => {
    const { src } = sparc15();
    const off = (ndjsonRecords(src) as Rec[]).filter((r) => r.type === 'frame');
    expect(off.every((f) => f.prof === undefined)).toBe(true);
    const on = parseNdjson(writeRunNdjson(src, { profiles: true })) as Rec[];
    const frames = on.filter((r) => r.type === 'frame');
    expect(frames[10].prof.Te).toEqual(src.history[10].prof!.Te);
    expect(frames[10].prof.rho).toEqual(src.history[10].prof!.rho);
  });
  it('selects keys, decimates frames (keeping the last), and can leave out events and meta', () => {
    const { src } = jet();
    const recs = ndjsonRecords(src, { keys: ['Q', 'P_fus'], every: 100, events: false, meta: false }) as Rec[];
    expect(recs.every((r) => r.type === 'frame')).toBe(true);
    expect(Object.keys(recs[0].d).sort()).toEqual(['P_fus', 'Q']);
    expect(recs.map((r) => r.t)).toEqual(src.history.filter((_, i) => i % 100 === 0 || i === src.history.length - 1).map((f) => f.t));
  });
  it('is deterministic', () => {
    const { src } = jet();
    expect(writeRunNdjson(src)).toBe(writeRunNdjson(src));
  });
});
