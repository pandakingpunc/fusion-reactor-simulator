/**
 * The public surface of the simulator as a library: everything a program needs to configure, run, verify
 * and reproduce a shot, without a browser and without Node-specific APIs. `node scripts/build-lib.mjs`
 * bundles this file (ESM and CJS); the exports patch in package.json points at the bundle.
 *
 * Stability tags (TSDoc), one per export statement below:
 *   @public        the supported API: semantic versioning applies from v4.0.0 (a change of these names or
 *                  signatures needs a major version; the numbers a run returns may move between releases
 *                  when the CHANGELOG announces a physics change, which is why every run has a fingerprint
 *                  tied to the version)
 *   @experimental  usable, but the shape may change in a minor release; building blocks of the models and
 *                  the validation table, exposed for notebooks, teaching and cross-checks
 *
 * The API surface is locked by src/physics/index.test.ts: adding, removing or renaming an export there is a
 * deliberate act. Nothing in the modules behind this file touches window, document or a `node:` module
 * (tsconfig.lib.json compiles them with neither the DOM nor the Node typings; the library build is grepped
 * for both).
 *
 * Quick start:
 * ```ts
 * import { Simulation, presets, validateConfig } from 'fusion-reactor-simulator';
 * const cfg = presets.find((p) => p.id === 'JET')!.cfg;
 * const sim = new Simulation(cfg);
 * const report = sim.runAll();        // ShotReport
 * sim.history;                        // one HistoryFrame per output step (t, y, diagnostics d, profiles)
 * sim.fingerprint('4.0.0');           // names the run by its inputs; equal fingerprints, equal runs
 * ```
 *
 * @packageDocumentation
 */

// ── the simulation kernel ───────────────────────────────────────────────────────────────────────────

/**
 * The deterministic kernel: `new Simulation(cfg)`, then `advance(dt)` in chunks or `runAll()`; live
 * `applyControl`, exact `rewindTo`, actuator-log replay, `fingerprint`. Chunking never changes the result.
 * @public
 */
export { Simulation, createModel, SYNC_INTERVALS } from './simulation';
/** @public */
export type { SimulationOptions } from './simulation';

/**
 * Configuration, results and model-interface types.
 * @public
 */
export type {
  ReactorConfig, MagneticConfig, ICFConfig, MTFConfig, FRCConfig, MirrorConfig, MuonConfig, ProfileSettings, EdgeOptions,
  Method, Fidelity, MagnetTech, BlanketType, FuelingMethod,
  HistoryFrame, SimEvent, EventKind, ShotReport, ScoreEntry, TerminationInfo, DiagSpec, EqSnapshot,
  ActuatorEntry, SimCheckpoint, SimModel,
} from './types';
/** @public */
export { METHOD_LABELS } from './types';
/** @public */
export type { Geometry } from './geometry';
/** @public */
export type { FuelType } from './reactivity';
/** @public */
export type { ImpuritySpecies } from './constants';

// ── scenarios ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The deterministic scenario engine (`new Simulation(cfg, { scenario })`): per-control piecewise-linear or step waveforms and
 * conditional triggers on the recorded diagnostics, as plain JSON (`ScenarioSpec`, schema 1). `validateScenario` / `parseScenario`
 * report every problem with its path (`ScenarioError`); `scenarioToJSON` / `scenarioFromJSON` give one canonical text per scenario
 * (share links, files). A run with a scenario is chunk invariant and rewinds exactly, and the scenario is part of `runFingerprint`.
 * @public
 */
export {
  validateScenario, parseScenario, scenarioFromJSON, scenarioToJSON, dropTemplate, rampTemplate, gasPuffTemplate, interlockTemplate,
  mergeScenarios, MIN_RAMP_STEP, MAX_RAMP_GRID,
} from './scenario';
/** @public */
export type {
  ScenarioSpec, WaveformSpec, WaveformPoint, WaveformKind, TriggerSpec, TriggerOp, TriggerMode, ScenarioContext, ScenarioState,
} from './scenario';
/**
 * The engine itself (state save and restore, the step-boundary and trigger evaluation the kernel calls); the kernel is its only
 * client, so the class is exposed for plug-in work and tests and may change.
 * @experimental
 */
export { Scenario } from './scenario';

// ── presets ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The built-in machines (ITER, JET, SPARC, NIF, ...): `presets` is the catalogue, the named exports are the
 * configurations. `defaultMagnetic` builds a magnetic configuration from the few required fields.
 * @public
 */
export {
  PRESETS, PRESETS as presets, defaultMagnetic,
  ITER, JET, SPARC, DIIID, JT60SA, MASTU, W7X, DEMO, ITER_15D, JET_15D, SPARC_15D, DEMO_15D,
  NIF, DIRECT_DRIVE, ZMACHINE, GF_PISTON, MTF_LINER, ZAP, TAE, MIRROR, MUON,
} from './presets';
/** @public */
export type { Preset } from './presets';
/** @public */
export { getPreset, presetIds, requirePreset } from './config/registry';

// ── configuration: validation, JSON Schema, settings, whole-shot helper ────────────────────────────

/**
 * Runtime validation with path-specific errors (`heating.P_NBI_MW: must be >= 0, got -3`) and the JSON
 * Schema (draft 2020-12) of a configuration.
 * @public
 */
export {
  validateConfig, assertValidConfig, ConfigValidationError, configJsonSchema, CONFIG_SCHEMA_ID, formatIssue, fieldInfo, leafPaths,
  METHODS, METHOD_FAMILY,
} from './config/schema';
/** @public */
export type { ConfigValidation, ValidateOptions, ValidationIssue, IssueCode, JsonSchema, FieldInfo, ConfigFamily, ConfigPath } from './config/schema';
/**
 * Dotted-path access and merging of configurations (`heating.P_NBI_MW=20`).
 * @public
 */
export { getPath, setPath, mergeConfig, parseAssignment, parseSettingValue, applyAssignments, ConfigPathError } from './config/paths';
/**
 * Runs a validated configuration to its end and summarises it.
 * @public
 */
export { runShot, summarizeRun } from './config/run';
/** @public */
export type { RunSummary, RunShotOptions } from './config/run';

// ── reproducibility ─────────────────────────────────────────────────────────────────────────────────

/**
 * `runFingerprint` names a run by its inputs, `runDigest` by its outputs; `canonicalString` and `sha256Hex`
 * are the primitives (key-order-independent serialisation, SHA-256).
 * @public
 */
export { runFingerprint, runDigest, FINGERPRINT_SCHEMA } from './kernel/fingerprint';
/** @public */
export { canonicalString } from './kernel/canonical';
/** @public */
export { sha256Hex } from './kernel/sha256';

// ── analysis ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Flat-top averaging of a history (the definition behind every published number) and the burn-weighted
 * ion and electron temperature.
 * @public
 */
export { flatTopAverages, flatTopMean, FLAT_TOP_START } from './analysis/flatTop';
/** @public */
export type { FlatTopOptions, FlatTopWeighting, FlatTopSamples } from './analysis/flatTop';
/** @public */
export { burnAverages } from './validation/metrics';

// ── errors ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Typed errors of the kernel: catch these with `instanceof` instead of parsing messages.
 * @public
 */
export { SimulationError, UnknownMethodError, NonFiniteStateError, ModelContractError, ScenarioError } from './kernel/errors';
/** @public */
export type { ScenarioIssue } from './kernel/errors';

// ── experimental: models and building blocks ────────────────────────────────────────────────────────

/**
 * The 1.5D radial profile model and its settings (used through `fidelity: '1.5D'` in a configuration; the
 * classes are exposed for plug-in work and may change).
 * @experimental
 */
export { ProfileModel, supportsProfiles, DEFAULT_PROFILE_SETTINGS, PROFILE_DIAGS } from './profiles/model';
/** @experimental */
export { MAGNETIC_DIAGS } from './confinement/magnetic';

/**
 * Fusion reactivity and cross sections (Bosch-Hale, Nevins-Swain), fuel channels.
 * @experimental
 */
export { sigmav, crossSection, FUEL_CHANNELS } from './reactivity';

/**
 * Confinement scalings, the L-H threshold, limits and geometry helpers.
 * @experimental
 */
export {
  tauIPB98y2, tauITPA20, tauITPA20IL, tauITER89P, tauISS04, tauSTValovic, pLH_Martin, CONFINEMENT_SCALINGS,
} from './transport';
/** @experimental */
export { greenwaldDensity, betaNormalized } from './limits';
/** @experimental */
export { plasmaVolume, plasmaSurface, aspectRatio, q95 } from './geometry';
/** @experimental */
export { C as CONSTANTS, IMPURITIES } from './constants';

/**
 * The literature validation table and its evaluation (what `npm run validate` uses).
 * @experimental
 */
export { REFERENCE_CHECKS } from './validation/references';
/** @experimental */
export { evaluateCheck } from './validation/evaluate';
/** @experimental */
export { readMetric } from './validation/metrics';
