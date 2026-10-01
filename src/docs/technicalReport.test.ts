/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { fileSources, findMarkers, compute, checkValidateRecord, checkConvergenceRecord } from '../../scripts/paper-numbers';
import { REFERENCE_CHECKS } from '../physics/validation/references';

const src = fileSources();
const files = ['docs/technical-report.md', 'docs/tr/technical-report.md'];
const numeric = (s: string) => Number(s.replace(/<!--.*?-->/g, ''));
const round = (x: number) => Number(x.toPrecision(6));

function rows(md: string, name: string): string[][] {
  const start = md.indexOf(`<!-- table: ${name} -->`);
  if (start < 0) throw new Error(`missing table ${name}`);
  return md.slice(start).split('\n').slice(3).map(l => l.trim()).filter((l, i, lines) => l.startsWith('|') && lines.slice(0, i).every(x => x.startsWith('|'))).map(l => l.split('|').slice(1, -1).map(s => s.trim()));
}

/** Compare displayed tables to independent committed records and live reference definitions. */
function verify(md: string): void {
  for (const marker of findMarkers(md)) expect(marker.shown, marker.key).toBe(compute(marker.key, src).text);
  const v = rows(md, 'validation');
  const record = src.validate();
  expect(v.length).toBe(REFERENCE_CHECKS.length);
  expect(v.map(r => r[0].split(' ')[0])).toEqual(record.checks.map(c => c.id));
  for (const [i, c] of record.checks.entries()) {
    const ref = REFERENCE_CHECKS.find(r => r.id === c.id)!;
    expect(v[i].slice(1, 4).map(numeric), c.id).toEqual([ref.value, c.value, c.value / ref.value].map(round));
    expect(v[i][4]).toBe(`${round(ref.accept[0])}..${round(ref.accept[1])}`);
    expect(v[i].slice(5, 8)).toEqual([c.status, c.wording, ref.role ?? 'comparison']);
    if (ref.doi) expect(v[i][8]).toContain(`https://doi.org/${ref.doi}`);
    if (ref.knownFailure) expect(md).toContain(`**${ref.id}:**`);
    if (ref.sourceLimitation) expect(md).toContain(ref.sourceLimitation.replaceAll('|', '/').replaceAll('\n', ' '));
  }
  const conv = JSON.parse(src.text('src/docs/testdata/convergence-record.json'));
  const expected = conv.series.flatMap((s: { parameter: string; runs: { value: number; metrics: Record<string, number>; steps: number; nElm: number }[] }) => s.runs.map(r => [s.parameter, r.value, ...['Q', 'f_bs', 'li', 'Tped'].map(k => round(r.metrics[k])), r.steps, r.nElm]));
  expect(rows(md, 'convergence').map(r => [r[0], ...r.slice(1).map(numeric)])).toEqual(expected);
  const golden = src.golden('ITER15').flatTop;
  const base = conv.series[0].runs.find((r: { value: number }) => r.value === 50);
  for (const k of ['Q', 'f_bs', 'li', 'Tped']) expect(base.metrics[k]).toBe(golden[k]);
  const perf = JSON.parse(src.text('bench/perf-baseline.json'));
  expect(rows(md, 'performance').map(r => [r[0], numeric(r[1])])).toEqual(Object.entries(perf.medianMs).map(([id, ms]) => [id, Number(ms) / 1000]));
  const pause = JSON.parse(src.text('bench/records/pause-latency-v4.json'));
  expect(rows(md, 'pause').map(r => [r[0], r[1], ...r.slice(2).map(numeric)])).toEqual(pause.wait.map((r: { preset: string; speed: string; requests: number; waitMs: Record<string, number> }) => [r.preset, r.speed, r.requests, ...['p50', 'p95', 'p99', 'max'].map(k => r.waitMs[k])]));
  expect(rows(md, 'verification').map(r => numeric(r[1]))).toEqual(['VER.GS', 'VER.FV', 'VER.BE'].map(k => Number(compute(k, src).text)));
  expect(findMarkers(md).length).toBeGreaterThan(30);
}

describe('v4 technical reports', () => {
  it('uses current validation and convergence records', () => {
    expect(checkValidateRecord(src.validate(), src)).toEqual([]);
    expect(checkConvergenceRecord(src.convergence(), src)).toEqual([]);
  });
  for (const file of files) {
    it(`${file}: numbers and all reference roles match their sources`, () => verify(src.text(file)));
    it(`${file}: detects falsified results and omitted reference rows`, () => {
      const md = src.text(file);
      expect(() => verify(md.replace('<!--num:CONV.Q-->0.57', '<!--num:CONV.Q-->0.01'))).toThrow();
      expect(() => verify(md.replace(/\| ITER\.Q .*\n/, ''))).toThrow();
      expect(() => verify(md.replace('| 0.719487 |', '| 9.719487 |'))).toThrow();
    });
  }
  it('keeps numeric tables and claim keys identical in both languages', () => {
    const [en, tr] = files.map(f => src.text(f));
    for (const key of ['validation', 'convergence', 'performance', 'pause', 'verification']) expect(rows(en, key)).toEqual(rows(tr, key));
    expect(findMarkers(en).map(m => [m.key, m.shown])).toEqual(findMarkers(tr).map(m => [m.key, m.shown]));
  });
});
