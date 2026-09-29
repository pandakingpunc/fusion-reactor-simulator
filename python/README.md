# fusion_sim: Python front end

A thin, standard-library-only wrapper around the `fusion-sim` command line (`src/cli/fusion-sim.ts`). The
simulator is the Node.js program of this repository; nothing is reimplemented in Python, so a Python result is the
result of the same code, deterministic and reproducible from its provenance block.

```python
import fusion_sim as fs

doc = fs.run("ITER", set={"heating.P_NBI_MW": 20}, t_end=100)   # dict: report, flatTop, burn, events, config, provenance
doc["report"]["Q_sci_max"], doc["flatTop"]["Q"]

fs.run("JET", format="csv", series=["Q", "Ti"])                 # str
fs.run("ITER15", format="netcdf")                               # bytes of a NetCDF-3 file: xarray.open_dataset(io.BytesIO(...))
fs.run("ITER15", format="imas", out="iter15.imas.json")         # writes the file, returns its Path

fs.scan({"heating.P_NBI_MW": "10:50:10", "H98": [0.9, 1.0, 1.1]}, preset="ITER",
        metrics=["flatTop.Q", "report.E_fusion_MJ"])["points"]  # one dict per grid point

fs.validate(cfg)            # [] or ["geometry.a: must be smaller than geometry.R (6.2), got 9: ..."]
fs.presets(); fs.preset_config("ITER"); fs.schema(); fs.version()
```

Errors: `ConfigError` (exit code 2, an invalid configuration; `.issues` lists every problem with its dotted
path), `UsageError` (exit code 2, anything else the command rejected), `FusionSimError` (a failed run, or the
command was not found: `.returncode`, `.stderr`).

## Finding the command

In this order: the environment variable `FUSION_SIM_CLI` (the command as one string, e.g.
`node /path/to/build/lib/fusion-sim.js`, or in a checkout `node --import tsx src/cli/fusion-sim.ts`; put a path with spaces in double quotes), `fusion-sim` on the
`PATH`, `node` with `build/lib/fusion-sim.js` of this repository (`node scripts/build-lib.mjs` builds it). Node.js 20 or
newer is required.

## Tests

`python -m unittest discover -s tests -v` from this directory (the calls of the real command line are skipped when
it cannot be found). `src/cli/python.test.ts` runs them from vitest against the sources when Python is available.

## Scope

A subprocess wrapper: every call starts a Node process (about half a second), which suits scans and scripts, not
inner loops; `fusion_sim.scan` runs its grid on worker threads inside one process. A long-lived server mode and a
NumPy/xarray convenience layer are not part of it. The wrapper's version (0.1.0) is independent of the
simulator's; `fusion_sim.version()` asks the simulator. `pyproject.toml` has no dependencies; nothing is published.
