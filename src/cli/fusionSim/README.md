# fusion-sim: the command line

```
fusion-sim run           one shot -> json | csv | ndjson | netcdf | imas | text
fusion-sim scan          a grid of parameter values on worker threads -> a table of metrics
fusion-sim export-eqdsk  the equilibrium of a 1.5D run as a GEQDSK file (needs the WS4 writer)
fusion-sim presets       the built-in presets, or one configuration as JSON
fusion-sim schema        the JSON Schema of a configuration, or a check of a configuration file
```

From source: `npx tsx src/cli/fusion-sim.ts <command> ...`. Built: `node scripts/build-lib.mjs`, then
`node build/lib/fusion-sim.js <command> ...` (or `fusion-sim` once `bin` is in package.json). The compiled binary
and its worker need no tsx loader. `--help` after a command lists its flags.

## Configuration

A command that runs something takes a configuration from `--preset ID` (see `presets`) and/or `--config FILE` (the
JSON that `presets --show ID` prints; with `--preset` the file is a patch merged over the preset). Then, in this
order: the shorthand flags `--t-end`, `--seed`, `--fidelity`, `--fuel`, then `--set PATH=VALUE` (repeatable; the value
is JSON or plain text). The result is validated before anything runs; an invalid configuration lists every problem
with its path and exits 2:

```
$ fusion-sim run --preset ITER --set geometry.a=9 --set heating.P_NBI_mw=3
fusion-sim run: error: invalid configuration (2 problems):
  geometry.a: must be smaller than geometry.R (6.2), got 9: the aspect ratio R/a has to exceed 1
  heating.P_NBI_mw: is not a known property (did you mean 'P_NBI_MW'?)
```

`--no-validate` skips the check (the kernel still rejects what it cannot build).

## run

```
fusion-sim run --preset ITER15 --format netcdf --out iter15.nc
fusion-sim run --preset JET --series Q,P_fus,Ti --format csv > jet.csv
fusion-sim run --preset SPARC --set fuel=DD --format text
fusion-sim run --preset ITER15 --format imas --out iter15.imas.json --no-profiles
```

`--format` defaults to the `--out` extension (`.csv`, `.nc`, `.ndjson`, `.json`, `.txt`), else `json`: the shot
report, the flat-top and burn-weighted averages, event counts, the resolved configuration and a provenance block.
`--series KEY,...` (or `all`) adds time series to the JSON and selects columns for csv, ndjson and netcdf; `--every N`
thins frames (the first and the last frame are always kept). NetCDF is binary: it needs `--out FILE` (or `--out -` on a pipe). The formats are described in
`src/io/README.md`. IMAS-like JSON covers magnetic-confinement runs only.

`--scenario FILE` drives the controls of the shot with a scenario (`src/physics/scenario.ts`, JSON schema 1): per-control
piecewise-linear or step waveforms (`null` in a point is the configured value) and triggers on the recorded diagnostics
(`{ "diag": "H_mode", "op": ">=", "value": 1, "set": { "P_ICRH_MW": 8 } }`, with hold time, start time, hysteresis and
release). The file is checked before the run: every problem is listed with its path (an unknown property, a control or
diagnostic the model does not have, a `rampStep` finer than 1e-6 or `t_end / 10000`) and the exit code is 2. The run stays
deterministic and chunk invariant; the JSON output gains the normalised scenario (`scenario`) and `provenance.scenarioSha256`,
and the run fingerprint covers the scenario (its free `name` excluded), so every output format names the run with its scenario.
An empty scenario is no scenario.

**Output is deterministic.** The provenance block holds the software version, the concept DOI, the git commit and
dirty flag (null unless the package is the top level of its own git checkout: an installed copy under some project's node_modules never reports that project's commit), Node and V8 versions, the preset, the seed, the SHA-256 of the canonical
configuration and the run fingerprint (`runFingerprint`); no path, user name, time or duration. The same
configuration gives the same bytes.

## scan

```
fusion-sim scan --preset ITER --param heating.P_NBI_MW=10:50:10 --param H98=0.9,1.0,1.1 \
                --metric flatTop.Q,report.E_fusion_MJ --out scan.csv
```

`--param PATH=SPEC` (repeatable, at least one): a comma list (`10,20,30`, `DT,DD`) or an inclusive range
`start:stop:step`; the first parameter varies slowest. Every point is validated before any worker starts, so one bad
value does not waste a long scan. Points run on a pool of worker threads (`--threads`, `--timeout`); a crashed
or hung worker fails its point only. Metrics use the paths of the validation table: `flatTop.<diagnostic>`,
`report.<field>`, `engineering.<field>`, `burn.<Ti|Te>`, `derived.<H98y2|Ttot|alphaShare>`. The CSV has the
parameters, `status` (`ok`; `ended` when the shot ended before its planned end, e.g. a disruption, with the reason in
`end_reason`; `error` when the run crashed), then the metrics. `--format json|ndjson` adds the run fingerprint per
point, and `--series KEY,...` keeps the time series of those diagnostics (the `keepSeries` hook of the worker).

## Exit codes

0 success. 1 a run failed, a point crashed, a check failed (`schema --check`) or the command is not available
(`export-eqdsk` until WS4's writer is wired in). 2 usage or input error (unknown flag, invalid or unreadable
configuration, bad `--param`). 130 interrupted (Ctrl-C during a scan).

## export-eqdsk

Stubbed: it says so and exits 1. `CliDeps.writeEqdsk(sim, { time })` (src/cli/fusionSim/common.ts) is the
injection point: pass a function that returns the GEQDSK text of the equilibrium of a finished 1.5D `Simulation`
(COCOS 11), e.g. in `src/cli/fusion-sim.ts`: `main(argv, { deps: { writeEqdsk } })`. The command already runs the
shot (`--preset`, `--set`, ...), requires a 1.5D tokamak or spherical tokamak, and writes what the function returns to
`--out`.

## Code layout

`fusion-sim.ts` is three lines. `fusionSim/main.ts` routes commands and maps errors to exit codes; `main(argv, env)`
takes its streams, files and optional pieces as arguments, so `cli.test.ts` runs the whole program in-process.
`runCmd.ts`, `scanCmd.ts`, `otherCmds.ts` (presets, schema, export-eqdsk), `common.ts` (configuration
resolution, provenance, errors). `spawn.test.ts` runs the real process from source, `src/cli/lib.test.ts` the
compiled binary.
