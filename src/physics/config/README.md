# Configuration, validation and the public API

`src/physics/index.ts` is the library's public surface; this directory is the part of it that describes and
checks a configuration. Everything here is pure TypeScript (no DOM, no Node), like the rest of `src/physics`.

## Using the library

```ts
import { Simulation, presets, validateConfig, runShot, formatIssue } from 'fusion-reactor-simulator';

const cfg = { ...presets.find((p) => p.id === 'JET')!.cfg, t_end: 2 };

const check = validateConfig(cfg);                    // { ok: true, config } | { ok: false, issues }
if (!check.ok) for (const i of check.issues) console.error(formatIssue(i));   // geometry.kappa: must be >= 1 and <= 5, got 0.5

const { report, flatTop, burn, events, sim } = runShot(cfg);   // validates, runs to the end, summarises
sim.history;                                                    // every frame: t, y, diagnostics d, profiles prof (1.5D)
sim.fingerprint('4.0.0');                                       // names the run by its inputs
```

`node scripts/build-lib.mjs` (Vite + tsc, no new dependency) writes ESM and CJS bundles, the type declarations,
the compiled preset-runner worker and the `fusion-sim` binary to `dist/lib`; `lib.test.ts` (src/cli) builds it
into a temporary directory and runs it under plain Node. The exports/bin/files patch for `package.json` is in
the WS8 lane report (the file stays `"private": true`).

## Stability tags

Each export statement of `index.ts` carries a TSDoc tag. `@public` is the supported API (semantic versioning
applies from v4.0.0). `@experimental` is usable but may change in a minor release: the 1.5D model classes, the
reactivity and confinement-scaling building blocks, the literature validation table. `index.test.ts` locks the
list of runtime names, checks that every export has a tag, and walks the import graph: the barrel reaches only
`src/physics` files (no package, no `node:` module, no browser global). `tsconfig.lib.json` compiles the same
files with `lib: ["ES2022"]` and no ambient types, so a use of `window`, `document`, `console`, `performance`
or `Buffer` in the core is a compile error, and `build-lib.mjs` greps the bundles for the same.

Adding or removing an export is deliberate: edit `index.ts`, then the `EXPECTED` list in `index.test.ts`.

## The schema

`dsl.ts` is a small declarative language (numbers with ranges, integers, booleans, string enumerations, objects
with required and optional properties and cross-field rules). `schema.ts` describes the six configuration
families (`MagneticConfig`, `ICFConfig`, `MTFConfig`, `FRCConfig`, `MirrorConfig`, `MuonConfig`) once, and that
one description drives

- `validateConfig(input)`: every problem at once, each with the dotted `path` of the offending property
  (`heating.P_NBI_MW`), an RFC 6901 `pointer`, a `code` (`type`, `required`, `unknown_key`, `range`,
  `non_finite`, `integer`, `enum`, `cross_field`), a message and, for a misspelt name, a suggestion;
- `assertValidConfig` / `ConfigValidationError` for code that prefers exceptions;
- `configJsonSchema()`: the same description as JSON Schema draft 2020-12 (`schema/fusion-sim.schema.json`,
  written by `npx tsx scripts/gen-schema.ts`, checked by `--check` and by `schema.test.ts`);
- `fieldInfo(method, path)`: range, unit, enum values and default of one property, for editors and tests.

**Types tie it to `types.ts`.** Each family is a `Shape<T>` of its interface: one `Field<T[K]>` per property,
`opt(...)` exactly where the property is optional, `oneOf([...])` with exactly the union of its type. Adding,
removing or retyping a property in `types.ts` is a compile error here until the schema follows.

**What the bounds mean.** They are the domain of the model, not an operating envelope: a quantity that must be
positive is exclusive at 0, fractions are in [0, 1], and the upper limits are far beyond any device (they catch
unit slips such as metres for millimetres). A value inside the bounds can still end a run early (a
disruption, a magnet quench): that is physics, not a configuration error. The two cross-field rules are the
relations the model cannot survive: `geometry.a < geometry.R`, and `Ip_MA > 0` unless the method is a
stellarator. Every preset and golden case validates, and every range the web wizard offers lies inside the
bounds (`schema.test.ts`); 100 broken configurations are rejected with the right path.

**JSON Schema limits.** Cross-field rules cannot be written in JSON Schema; they are listed in `x-rules`
annotations and `validateConfig` enforces them. `x-unit` carries the unit of a number, `default` the value a
1.5D setting takes when it is absent.

## Other modules

- `paths.ts`: `getPath`, `setPath` (copying), `mergeConfig` (deep merge of a patch), `parseAssignment` /
  `applyAssignments` (`heating.P_NBI_MW=20`; the value is JSON or plain text). A path segment that would reach
  the prototype chain is refused.
- `registry.ts`: `getPreset`, `requirePreset` (throws with the valid ids and the closest one), `presetIds`.
- `run.ts`: `runShot(cfg)` and `summarizeRun(sim)`: validate, run to the end, return the shot report, the
  flat-top and burn-weighted averages, the event counts and the simulation; the in-process counterpart of
  `src/cli/presetRunner.worker.ts`, with the same numbers.
