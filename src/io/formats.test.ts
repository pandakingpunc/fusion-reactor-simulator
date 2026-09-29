import { describe, expect, it } from 'vitest';
import * as io from './formats';

/** The runtime exports of the io entry of the library. Add a name here when you add it to formats.ts. */
const EXPECTED = [
  'IMAS_FORMAT_VERSION', 'PROFILE_INFO', 'SUMMARY_MAP', 'cfTimeUnit', 'cfUnit', 'columnsFor', 'csvField', 'csvFromRows', 'formatNumber', 'imasFromRun', 'jsonLine', 'ncName',
  'ndjsonRecords', 'netcdfFromRun', 'parseCsv', 'parseCsvRows', 'parseNdjson', 'profilesFromSource', 'readImasProfiles', 'readImasSummary', 'readNetcdf3',
  'sourceFromSimulation', 'tableFromSource', 'writeCsv', 'writeImasJson', 'writeNdjson', 'writeNetcdf3', 'writeRunNdjson', 'writeRunNetcdf',
];

describe('the io entry of the library', () => {
  it('exports exactly the locked list of runtime names', () => {
    expect(Object.keys(io).sort()).toEqual([...EXPECTED].sort());
  });
});
