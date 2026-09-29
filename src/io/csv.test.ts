import { describe, expect, it } from 'vitest';
import { csvField, csvFromRows, parseCsv, parseCsvRows, writeCsv } from './csv';
import { columnsFor, tableFromSource } from './table';
import { jet, nif, sparc15 } from './testdata/fixtures';

describe('CSV fields and rows', () => {
  it('quotes what needs quoting and doubles the quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('cr\rhere')).toBe('"cr\rhere"');
    expect(csvField(' padded')).toBe('" padded"');
    expect(csvField('a;b', ';')).toBe('"a;b"');
    expect(csvField('a,b', ';')).toBe('a,b');
  });
  it('writes numbers in shortest round-trip form, NaN as an empty field, -0 as -0', () => {
    expect(csvField(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(csvField(1e21)).toBe('1e+21');
    expect(csvField(NaN)).toBe('');
    expect(csvField(Infinity)).toBe('Infinity');
    expect(csvField(-Infinity)).toBe('-Infinity');
    expect(csvField(-0)).toBe('-0');
  });
  it('terminates every row, with the requested line ending', () => {
    expect(csvFromRows([['a', 'b'], [1, 2]])).toBe('a,b\n1,2\n');
    expect(csvFromRows([['a', 'b'], [1, 2]], { newline: '\r\n' })).toBe('a,b\r\n1,2\r\n');
    expect(csvFromRows([[1, 2]], { delimiter: ';' })).toBe('1;2\n');
  });
});

describe('the CSV reader', () => {
  it('splits quoted fields with embedded delimiters, quotes and line breaks', () => {
    const rows = parseCsvRows('a,"b,c","d ""q""","x\ny"\n1,2,3,4\n');
    expect(rows).toEqual([['a', 'b,c', 'd "q"', 'x\ny'], ['1', '2', '3', '4']]);
  });
  it('accepts CRLF, a missing final line ending and an empty quoted field', () => {
    expect(parseCsvRows('a,b\r\n1,""\r\n2,3')).toEqual([['a', 'b'], ['1', ''], ['2', '3']]);
    expect(parseCsvRows('')).toEqual([]);
  });
  it('rejects an unterminated quote', () => {
    expect(() => parseCsvRows('a,"b\n')).toThrow(/unterminated/);
  });
  it('rejects a ragged row and an empty document', () => {
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(/row 2 has 3 fields, the header has 2/);
    expect(() => parseCsv('')).toThrow(/no header/);
  });
  it('reads numeric columns (empty is NaN, Infinity, exponents, -0) and keeps other columns as text', () => {
    const p = parseCsv('t,x,name\n0,1e-3,a\n1,,b\n2,Infinity,c\n3,-0,d\n4,NaN,e\n');
    expect(p.header).toEqual(['t', 'x', 'name']);
    expect(p.columns.t).toEqual([0, 1, 2, 3, 4]);
    expect(p.columns.x[0]).toBe(0.001);
    expect(p.columns.x[1]).toBeNaN();
    expect(p.columns.x[2]).toBe(Infinity);
    expect(Object.is(p.columns.x[3], -0)).toBe(true);
    expect(p.columns.x[4]).toBeNaN();
    expect(p.text.name).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(p.columns.name).toBeUndefined();
  });
  it('collects the comment lines before the header', () => {
    const p = parseCsv('# first\n# second: x\nt\n1\n');
    expect(p.comments).toEqual(['first', 'second: x']);
    expect(p.columns.t).toEqual([1]);
  });
});

describe('writeCsv round trip', () => {
  it('a 0D run: write, parse, equal to the history (bitwise, every diagnostic of every frame)', () => {
    const { src } = jet();
    const tab = tableFromSource(src);
    const parsed = parseCsv(writeCsv(src));
    expect(parsed.header).toEqual(['t', ...tab.columns.map((c) => c.key)]);
    expect(parsed.columns.t).toEqual(tab.t);
    tab.columns.forEach((c, i) => {
      const got = parsed.columns[c.key];
      expect(got, c.key).toBeDefined();
      expect(got.length).toBe(tab.t.length);
      for (let k = 0; k < got.length; k++) expect(Object.is(got[k], tab.values[i][k]) || (Number.isNaN(got[k]) && Number.isNaN(tab.values[i][k])), `${c.key}[${k}]`).toBe(true);
    });
  });
  it('a 1.5D run', () => {
    const { src } = sparc15();
    const parsed = parseCsv(writeCsv(src));
    expect(parsed.columns.t.length).toBe(src.history.length);
    expect(parsed.columns.q0).toEqual(src.history.map((f) => f.d.q0));
  });
  it('a pulsed run (nanosecond time)', () => {
    const { src } = nif();
    const parsed = parseCsv(writeCsv(src));
    expect(parsed.columns.t).toEqual(src.history.map((f) => f.t));
  });
  it('is deterministic', () => {
    const { src } = jet();
    expect(writeCsv(src)).toBe(writeCsv(src));
  });
  it('selects and orders columns, keeps unknown keys as empty fields', () => {
    const { src } = jet();
    const p = parseCsv(writeCsv(src, { keys: ['Q', 'P_fus', 'nonexistent'], timeKey: 'time' }));
    expect(p.header).toEqual(['time', 'Q', 'P_fus', 'nonexistent']);
    expect(p.columns.nonexistent.every(Number.isNaN)).toBe(true);
    expect(p.columns.Q).toEqual(src.history.map((f) => f.d.Q));
  });
  it('writes every n-th frame, always the first', () => {
    const { src } = jet();
    const p = parseCsv(writeCsv(src, { every: 100, keys: ['Q'] }));
    expect(p.columns.t).toEqual(src.history.filter((_, i) => i % 100 === 0).map((f) => f.t));
    expect(p.columns.t[0]).toBe(0);
  });
  it('writes comment lines first (single-line, prefixed) and a CRLF file reads back the same', () => {
    const { src } = jet();
    const text = writeCsv(src, { comments: ['run: JET', 'two\nlines'], newline: '\r\n', keys: ['Q'] });
    expect(text.startsWith('# run: JET\r\n# two lines\r\nt,Q\r\n')).toBe(true);
    const p = parseCsv(text);
    expect(p.comments).toEqual(['run: JET', 'two lines']);
    expect(p.columns.Q).toEqual(src.history.map((f) => f.d.Q));
  });
  it('columns follow the model table order, then the other keys sorted', () => {
    const { src } = jet();
    const cols = columnsFor(src.history, src.diagSpecs).map((c) => c.key);
    const spec = src.diagSpecs.map((s) => s.key).filter((k) => cols.includes(k));
    expect(cols.slice(0, spec.length)).toEqual(spec);
    const rest = cols.slice(spec.length);
    expect(rest).toEqual([...rest].sort());
  });
});
