"""Subprocess wrapper around the ``fusion-sim`` command line. Standard library only.

Every function builds the argument list of one ``fusion-sim`` command, runs it, and parses the answer. The
simulator itself is the Node.js program of this repository; nothing is reimplemented here.

Finding the command, in this order:

1. the ``FUSION_SIM_CLI`` environment variable: the command as one string, split like a shell would
   (``node /path/to/dist/lib/fusion-sim.js``, or ``node --import tsx src/cli/fusion-sim.ts`` in a checkout);
2. ``fusion-sim`` on the ``PATH`` (an installed package);
3. ``node`` and ``dist/lib/fusion-sim.js`` of the repository this file lives in (``node scripts/build-lib.mjs``
   builds it).
"""
from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Union

__all__ = [
    "FusionSimError", "ConfigError", "UsageError", "cli_command", "run", "scan", "presets", "preset_config",
    "schema", "validate", "version",
]

Value = Union[int, float, bool, str, None]


class FusionSimError(RuntimeError):
    """The command failed. ``returncode`` is its exit code, ``stderr`` what it said."""

    def __init__(self, message: str, returncode: int, stderr: str = "", command: Sequence[str] = ()) -> None:
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr
        self.command = list(command)


class UsageError(FusionSimError):
    """Exit code 2: a bad flag or argument (or a configuration the command could not read)."""


class ConfigError(UsageError):
    """Exit code 2: the configuration is invalid. ``issues`` are the problems, one ``path: message`` string each."""

    def __init__(self, message: str, returncode: int, stderr: str, command: Sequence[str], issues: List[str]) -> None:
        super().__init__(message, returncode, stderr, command)
        self.issues = issues


def cli_command() -> List[str]:
    """The command that starts fusion-sim (see the module docstring for how it is found)."""
    env = os.environ.get("FUSION_SIM_CLI")
    if env:
        return _split_windows(env) if os.name == "nt" else shlex.split(env)
    exe = shutil.which("fusion-sim")
    if exe:
        return [exe]
    node = shutil.which("node")
    built = Path(__file__).resolve().parents[2] / "dist" / "lib" / "fusion-sim.js"
    if node and built.is_file():
        return [node, str(built)]
    raise FusionSimError(
        "cannot find fusion-sim: set FUSION_SIM_CLI, put fusion-sim on the PATH, or run `node scripts/build-lib.mjs` in the repository",
        127,
    )


def _split_windows(text: str) -> List[str]:
    """Splits a command line the way a Windows user writes it: whitespace separated, double quotes group, no escapes."""
    out: List[str] = []
    cur = ""
    quoted = False
    have = False
    for ch in text:
        if ch == '"':
            quoted = not quoted
            have = True
        elif ch.isspace() and not quoted:
            if have:
                out.append(cur)
                cur, have = "", False
        else:
            cur += ch
            have = True
    if have:
        out.append(cur)
    return out


def _json_value(v: Value) -> str:
    return json.dumps(v)


def _spec(v: Any) -> str:
    """The SPEC of a ``--param``: a string is taken as is (a range ``10:50:10`` or a list ``a,b``), a sequence is joined."""
    if isinstance(v, str):
        return v
    if isinstance(v, Iterable):
        return ",".join(x if isinstance(x, str) else _json_value(x) for x in v)
    return _json_value(v)


def _config_args(
    preset: Optional[str], config: Optional[Union[str, os.PathLike, Mapping[str, Any]]], set: Optional[Mapping[str, Value]],
    t_end: Optional[float], seed: Optional[int], fidelity: Optional[str], fuel: Optional[str], validate_config: bool,
    tmp: List[str],
) -> List[str]:
    args: List[str] = []
    if preset is not None:
        args += ["--preset", preset]
    if config is not None:
        if isinstance(config, Mapping):
            fd, path = tempfile.mkstemp(suffix=".json", prefix="fusion-sim-")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(config, f)
            tmp.append(path)
            args += ["--config", path]
        else:
            args += ["--config", os.fspath(config)]
    if t_end is not None:
        args += ["--t-end", repr(float(t_end))]
    if seed is not None:
        args += ["--seed", str(int(seed))]
    if fidelity is not None:
        args += ["--fidelity", fidelity]
    if fuel is not None:
        args += ["--fuel", fuel]
    for path, value in (set or {}).items():
        args += ["--set", f"{path}={_json_value(value)}"]
    if not validate_config:
        args.append("--no-validate")
    return args


def _exec(args: Sequence[str], timeout: Optional[float]) -> "subprocess.CompletedProcess[str]":
    cmd = cli_command() + list(args)
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout, text=True, encoding="utf-8")
    except subprocess.TimeoutExpired as e:
        raise FusionSimError(f"fusion-sim did not finish within {timeout} s", -1, "", cmd) from e
    except FileNotFoundError as e:
        raise FusionSimError(f"cannot start {cmd[0]}: {e}", 127, "", cmd) from e
    if r.returncode != 0:
        raise _error(cmd, r.returncode, r.stderr)
    return r


def _error(cmd: Sequence[str], code: int, stderr: str) -> FusionSimError:
    first = stderr.strip().splitlines()[0] if stderr.strip() else f"fusion-sim exited with code {code}"
    if code == 2:
        if "invalid configuration" in stderr or "the scan has invalid points" in stderr:
            issues = [ln.strip() for ln in stderr.splitlines() if ln.startswith("  ") or ln.startswith("    ")]
            return ConfigError(stderr.strip(), code, stderr, cmd, issues)
        return UsageError(stderr.strip() or first, code, stderr, cmd)
    return FusionSimError(stderr.strip() or first, code, stderr, cmd)


def _cleanup(paths: Iterable[str]) -> None:
    for p in paths:
        try:
            os.unlink(p)
        except OSError:
            pass


def run(
    preset: Optional[str] = None,
    config: Optional[Union[str, os.PathLike, Mapping[str, Any]]] = None,
    *,
    set: Optional[Mapping[str, Value]] = None,
    t_end: Optional[float] = None,
    seed: Optional[int] = None,
    fidelity: Optional[str] = None,
    fuel: Optional[str] = None,
    format: str = "json",
    series: Optional[Sequence[str]] = None,
    every: Optional[int] = None,
    profiles: bool = False,
    out: Optional[Union[str, os.PathLike]] = None,
    validate_config: bool = True,
    timeout: Optional[float] = None,
) -> Any:
    """Runs one shot (``fusion-sim run``).

    ``preset`` and/or ``config`` (a dict, or the path of a JSON file; with a preset it is a patch over it) give the
    configuration, ``set`` maps dotted paths to values (``{"heating.P_NBI_MW": 20}``) and is applied last; the
    shorthand arguments ``t_end``, ``seed``, ``fidelity`` and ``fuel`` come before ``set``.

    ``format`` decides the return value: ``"json"`` (default) the parsed document (report, flat-top and burn
    averages, events, resolved configuration, provenance; with ``series`` also the time series), ``"csv"`` and ``"text"``
    a string, ``"ndjson"`` a list of records, ``"imas"`` the parsed IMAS-like document, ``"netcdf"`` the bytes of a
    NetCDF-3 file. With ``out`` the result is written to that file and its path is returned instead.

    Raises :class:`ConfigError` for an invalid configuration, :class:`FusionSimError` for a failed run.
    """
    if format not in ("json", "csv", "ndjson", "netcdf", "imas", "text"):
        raise ValueError(f"unknown format {format!r}")
    tmp: List[str] = []
    try:
        args = ["run"] + _config_args(preset, config, set, t_end, seed, fidelity, fuel, validate_config, tmp) + ["--format", format]
        if series is not None:
            args += ["--series", ",".join(series)]
        if every is not None:
            args += ["--every", str(int(every))]
        if profiles:
            args.append("--profiles")
        if out is not None:
            _exec(args + ["--out", os.fspath(out)], timeout)
            return Path(os.fspath(out))
        if format == "netcdf":
            fd, path = tempfile.mkstemp(suffix=".nc", prefix="fusion-sim-")
            os.close(fd)
            tmp.append(path)
            _exec(args + ["--out", path], timeout)
            return Path(path).read_bytes()
        r = _exec(args, timeout)
        if format in ("json", "imas"):
            return json.loads(r.stdout)
        if format == "ndjson":
            return [json.loads(line) for line in r.stdout.splitlines() if line.strip()]
        return r.stdout
    finally:
        _cleanup(tmp)


def scan(
    params: Mapping[str, Any],
    preset: Optional[str] = None,
    config: Optional[Union[str, os.PathLike, Mapping[str, Any]]] = None,
    *,
    metrics: Optional[Sequence[str]] = None,
    set: Optional[Mapping[str, Value]] = None,
    t_end: Optional[float] = None,
    seed: Optional[int] = None,
    fidelity: Optional[str] = None,
    fuel: Optional[str] = None,
    series: Optional[Sequence[str]] = None,
    threads: Optional[int] = None,
    point_timeout: Optional[float] = None,
    validate_config: bool = True,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """Runs a grid of parameter values on worker threads (``fusion-sim scan``) and returns the parsed JSON document.

    ``params`` maps dotted paths to values: a list (``[10, 20, 30]``), a comma string (``"DT,DD"``) or a range string
    (``"10:50:10"``, inclusive). The document's ``points`` list holds one entry per grid point, in row-major order (the
    first parameter varies slowest): ``params``, ``status`` (``ok``, ``ended`` or ``error``), ``endReason``, ``metrics``
    (a dict from metric path to value; ``None`` where the metric is not finite), ``fingerprint`` and, with ``series``, the
    kept time series.
    """
    if not params:
        raise ValueError("scan needs at least one parameter")
    tmp: List[str] = []
    try:
        args = ["scan"] + _config_args(preset, config, set, t_end, seed, fidelity, fuel, validate_config, tmp) + ["--format", "json"]
        for path, spec in params.items():
            args += ["--param", f"{path}={_spec(spec)}"]
        if metrics is not None:
            args += ["--metric", ",".join(metrics)]
        if series is not None:
            args += ["--series", ",".join(series)]
        if threads is not None:
            args += ["--threads", str(int(threads))]
        if point_timeout is not None:
            args += ["--timeout", repr(float(point_timeout))]
        return json.loads(_exec(args, timeout).stdout)
    finally:
        _cleanup(tmp)


def presets() -> List[Dict[str, Any]]:
    """The built-in presets: id, name, method, fidelity, duration, description."""
    return json.loads(_exec(["presets", "--json"], None).stdout)


def preset_config(preset_id: str) -> Dict[str, Any]:
    """The configuration of a preset, as the dict ``run(config=...)`` takes."""
    return json.loads(_exec(["presets", "--show", preset_id], None).stdout)


def schema() -> Dict[str, Any]:
    """The JSON Schema (draft 2020-12) of a reactor configuration."""
    return json.loads(_exec(["schema"], None).stdout)


def validate(config: Union[str, os.PathLike, Mapping[str, Any]]) -> List[str]:
    """Checks a configuration (dict or file path); returns the problems (``[]`` if it is valid), one ``path: message`` each."""
    tmp: List[str] = []
    try:
        if isinstance(config, Mapping):
            fd, path = tempfile.mkstemp(suffix=".json", prefix="fusion-sim-")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(config, f)
            tmp.append(path)
        else:
            path = os.fspath(config)
        cmd = cli_command() + ["schema", "--check", path]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if r.returncode == 0:
            return []
        if r.returncode == 1:
            return [ln.strip() for ln in r.stderr.splitlines() if ln.startswith("  ")]
        raise _error(cmd, r.returncode, r.stderr)
    finally:
        _cleanup(tmp)


def version() -> str:
    """The version of the simulator behind the command line."""
    return _exec(["--version"], None).stdout.strip()
