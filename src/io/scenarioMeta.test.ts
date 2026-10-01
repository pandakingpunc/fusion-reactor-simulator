/**
 * The run exports that carry provenance (csv comment lines, ndjson meta record, NetCDF-3 global attribute, IMAS-like code block)
 * embed the SHA-256 of the scenario of a run that had one, and stay byte-identical for a run without one.
 */
import { describe, expect, it } from 'vitest';
import { writeCsv, parseCsv } from './csv';
import { writeImasJson } from './imas';
import { parseNdjson, writeRunNdjson } from './ndjson';
import { readNetcdf3, writeRunNetcdf } from './netcdf3';
import type { RunSource } from './table';
import { jet } from './testdata/fixtures';

const HASH = 'ab'.repeat(32);

describe('scenario hash in the exports', () => {
  const { src } = jet();
  const withScenario: RunSource = { ...src, meta: { ...src.meta!, scenarioSha256: HASH } };

  it('csv: a comment line for a run with a scenario, none for a plain run', () => {
    const text = writeCsv(withScenario, { keys: ['Q'], comments: [`scenario_sha256 ${HASH}`] });
    expect(parseCsv(text).comments).toEqual([`scenario_sha256 ${HASH}`]);
    expect(parseCsv(writeCsv(src, { keys: ['Q'] })).comments).toEqual([]);
  });

  it('ndjson: the meta record carries it in its provenance', () => {
    const meta = parseNdjson(writeRunNdjson(withScenario, { every: 400 }))[0] as { provenance: Record<string, unknown> };
    expect(meta.provenance.scenarioSha256).toBe(HASH);
    const plain = parseNdjson(writeRunNdjson(src, { every: 400 }))[0] as { provenance: Record<string, unknown> };
    expect('scenarioSha256' in plain.provenance).toBe(false);
  });

  it('netcdf: a global attribute, absent for a plain run', () => {
    expect(readNetcdf3(writeRunNetcdf(withScenario)).attrs.simulation_scenario_sha256.value).toBe(HASH);
    expect(readNetcdf3(writeRunNetcdf(src)).attrs.simulation_scenario_sha256).toBeUndefined();
  });

  it('imas: in the code block, absent for a plain run', () => {
    expect(JSON.parse(writeImasJson(withScenario)).summary.code.scenario_sha256).toBe(HASH);
    expect(JSON.parse(writeImasJson(src)).summary.code.scenario_sha256).toBeUndefined();
  });
});
