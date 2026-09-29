import { describe, expect, it } from 'vitest';
import { cfTimeUnit, cfUnit, columnsFor, formatNumber, profilesFromSource, secondsPer, strictTimeSource, tableFromSource, utf8, utf8Decode } from './table';
import { jet, nif, sparc15 } from './testdata/fixtures';

describe('cfUnit: model units in UDUNITS spelling', () => {
  it.each([
    ['', '1'],
    ['keV', 'keV'],
    ['MW', 'MW'],
    ['%', 'percent'],
    ['1e20 m⁻³', '1e20 m-3'],
    ['keV s m⁻³', 'keV s m-3'],
    ['MW/m²', 'MW m-2'],
    ['MW/m³', 'MW m-3'],
    ['m²/s', 'm2 s-1'],
    ['1e20 /s', '1e20 s-1'],
    ['1e20 s⁻¹', '1e20 s-1'],
    ['µm', 'um'],
    ['V', 'V'],
  ])('%s -> %s', (a, b) => expect(cfUnit(a)).toBe(b));
  it('time units', () => {
    expect(cfTimeUnit('µs')).toBe('us');
    expect(cfTimeUnit('ns')).toBe('ns');
    expect(secondsPer('s')).toBe(1);
    expect(secondsPer('ns')).toBe(1e-9);
    expect(secondsPer('µs')).toBe(1e-6);
    expect(secondsPer('us')).toBe(1e-6);
  });
  it('every unit the models declare converts to something without unicode or slashes', () => {
    const { src } = jet();
    const { src: p } = sparc15();
    for (const s of [...src.diagSpecs, ...p.diagSpecs]) expect(cfUnit(s.unit), s.key).toMatch(/^[\x20-\x7e]+$/);
    for (const s of [...src.diagSpecs, ...p.diagSpecs]) expect(cfUnit(s.unit), s.key).not.toMatch(/\//);
  });
});

describe('formatNumber', () => {
  it('shortest round trip, -0 kept', () => {
    expect(formatNumber(0.1)).toBe('0.1');
    expect(formatNumber(-0)).toBe('-0');
    expect(formatNumber(1 / 3)).toBe('0.3333333333333333');
    for (const x of [1e-300, 1.7976931348623157e308, 5e-324, 123456789.123456789]) expect(Number(formatNumber(x))).toBe(x);
  });
});

describe('UTF-8 without TextEncoder', () => {
  it('agrees with the platform encoder and decodes it back', () => {
    for (const s of ['', 'abc', 'é', 'µs', 'ρ_tor', '¹²³', '€', '\u{1F600}', 'a\u0000b']) {
      expect(Array.from(utf8(s))).toEqual(Array.from(new TextEncoder().encode(s)));
      expect(utf8Decode(utf8(s))).toBe(s);
    }
  });
  it('a lone surrogate becomes U+FFFD; malformed input decodes to U+FFFD, not an exception', () => {
    expect(utf8Decode(utf8('a\ud800b'))).toBe('a�b');
    expect(utf8Decode(Uint8Array.of(0x61, 0xff, 0x62))).toBe('a�b');
    expect(utf8Decode(Uint8Array.of(0xe2, 0x82))).toBe('��');
  });
});

describe('tables of a run', () => {
  it('scalar traces: one value per frame per column, NaN where a frame lacks the key', () => {
    const { src } = jet();
    const tab = tableFromSource(src, ['Q', 'nonexistent']);
    expect(tab.t).toEqual(src.history.map((f) => f.t));
    expect(tab.values[0]).toEqual(src.history.map((f) => f.d.Q));
    expect(tab.values[1].every(Number.isNaN)).toBe(true);
    expect(tab.columns[1]).toEqual({ key: 'nonexistent', label: 'nonexistent', unit: '', group: '' });
    expect(tab.timeUnit).toBe('s');
  });
  it('columns carry the model labels, units and groups', () => {
    const { src } = jet();
    const c = columnsFor(src.history, src.diagSpecs).find((x) => x.key === 'P_fus')!;
    expect(c).toEqual({ key: 'P_fus', label: 'P_fusion', unit: 'MW', group: 'Power' });
  });
  it('a pulsed model keeps its time unit', () => {
    expect(tableFromSource(nif().src).timeUnit).toBe(nif().sim.model.timeUnit);
  });
  it('profiles: only for runs that have them, on the frames that carry them', () => {
    expect(profilesFromSource(jet().src)).toBeUndefined();
    const { src } = sparc15();
    const p = profilesFromSource(src)!;
    expect(p.rho).toHaveLength(30);
    expect(p.t).toHaveLength(src.history.filter((f) => f.prof).length);
    expect(p.frameIndex[0]).toBe(0);
    const iTe = p.columns.findIndex((c) => c.key === 'Te');
    expect(p.columns[iTe]).toMatchObject({ unit: 'keV', group: 'profile' });
    expect(p.values[iTe][5]).toEqual(src.history[p.frameIndex[5]].prof!.Te);
    expect(p.columns.map((c) => c.key)).not.toContain('rho');
  });
  it('profiles: every n-th frame and a key selection', () => {
    const { src } = sparc15();
    const all = profilesFromSource(src)!;
    const p = profilesFromSource(src, { every: 10, keys: ['q', 'Te', 'missing'] })!;
    expect(p.t).toEqual(all.t.filter((_, i) => i % 10 === 0));
    expect(p.columns.map((c) => c.key)).toEqual(['q', 'Te']);
  });
});

describe('strictTimeSource: the terminal frame of a failed step', () => {
  const again = <T extends { history: readonly unknown[] }>(src: T): T => ({ ...src, history: [...src.history, src.history[src.history.length - 1]] });
  it('drops frames whose time does not increase, and says how many', () => {
    const { src } = jet();
    const same = strictTimeSource(src);
    expect(same.dropped).toBe(0);
    expect(same.src).toBe(src);
    const r = strictTimeSource(again(src));
    expect(r.dropped).toBe(1);
    expect(r.src.history).toHaveLength(src.history.length);
    expect(strictTimeSource(again(again(src))).dropped).toBe(2);
  });
});
