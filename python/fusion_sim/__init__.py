"""Python front end of the Fusion Reactor Simulator: a thin subprocess wrapper around the ``fusion-sim`` command line.

    import fusion_sim as fs

    doc = fs.run("ITER", set={"heating.P_NBI_MW": 20}, t_end=100)      # dict: report, averages, events, provenance
    print(doc["report"]["Q_sci_max"], doc["flatTop"]["Q"])

    csv = fs.run("JET", format="csv", series=["Q", "Ti"])              # str
    nc = fs.run("ITER15", format="netcdf")                             # bytes of a NetCDF-3 file (xarray reads it)
    table = fs.scan({"heating.P_NBI_MW": "10:50:10", "H98": [0.9, 1.0, 1.1]}, preset="ITER",
                    metrics=["flatTop.Q", "report.E_fusion_MJ"])       # dict with a `points` list

The simulator is the Node.js program of the repository; this package needs Node.js 20 or newer and finds the
command as described in :func:`fusion_sim.cli_command`. Standard library only. The version of this package is
independent of the simulator's: ask the simulator with :func:`fusion_sim.version`.
"""
from ._cli import (
    ConfigError, FusionSimError, UsageError, cli_command, preset_config, presets, run, scan, schema, validate, version,
)

__version__ = "0.1.0"

__all__ = [
    "ConfigError", "FusionSimError", "UsageError", "cli_command", "preset_config", "presets", "run", "scan", "schema",
    "validate", "version", "__version__",
]
