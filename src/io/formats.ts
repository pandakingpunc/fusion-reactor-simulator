/**
 * The browser-safe data formats of a run, in one place (the `io` entry of the library build):
 *
 *   CSV       time traces, RFC 4180                            writeCsv / parseCsv
 *   NDJSON    typed records, one JSON value per line          writeRunNdjson / parseNdjson
 *   NetCDF-3  CF-annotated arrays (CDF-1 and CDF-2)            writeRunNetcdf / readNetcdf3
 *   IMAS-like summary, core_profiles, equilibrium; COCOS 11    writeImasJson / readImasSummary
 *
 * Every writer takes a {@link RunSource} (`sourceFromSimulation(sim, meta)` builds one from a Simulation),
 * returns a string or a Uint8Array and touches neither the DOM nor Node, so the same code serves a download
 * button in the browser and the command line. The GEQDSK writer of the equilibrium is src/io/geqdsk.ts.
 *
 * @packageDocumentation
 */
export type {
  ColumnInfo, RunTable, ProfileTable, RunMeta, RunSource, SimulationLike,
} from './table';
export {
  sourceFromSimulation, columnsFor, tableFromSource, profilesFromSource, PROFILE_INFO, cfUnit, cfTimeUnit, formatNumber,
} from './table';

export type { CsvOptions, ParsedCsv } from './csv';
export { writeCsv, parseCsv, parseCsvRows, csvFromRows, csvField } from './csv';

export type { NdjsonOptions, NonFinite } from './ndjson';
export { writeRunNdjson, writeNdjson, ndjsonRecords, parseNdjson, jsonLine } from './ndjson';

export type {
  NcType, NcAttr, NcDimension, NcVariable, NcDataset, NetcdfOptions, RunNetcdfOptions, NcFile, NcReadAttr, NcReadDimension, NcReadVariable,
} from './netcdf3';
export { writeNetcdf3, readNetcdf3, netcdfFromRun, writeRunNetcdf, ncName } from './netcdf3';

export type { ImasOptions, ImasSummaryData, ImasProfileSlice } from './imas';
export { imasFromRun, writeImasJson, readImasSummary, readImasProfiles, SUMMARY_MAP, IMAS_FORMAT_VERSION } from './imas';
