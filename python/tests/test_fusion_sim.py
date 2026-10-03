"""Tests of the fusion_sim wrapper: argument construction (no simulator needed) and calls of the real command line
(skipped if it cannot be found). Run from the ``python`` directory: ``python -m unittest discover -s tests -v``;
set FUSION_SIM_CLI to reach the command (see fusion_sim.cli_command)."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import fusion_sim as fs  # noqa: E402
from fusion_sim import _cli  # noqa: E402


def _cli_available() -> bool:
    try:
        fs.cli_command()
        return True
    except fs.FusionSimError:
        return False


class ArgumentTests(unittest.TestCase):
    def test_config_args_in_order(self):
        tmp = []
        args = _cli._config_args("ITER", None, {"heating.P_NBI_MW": 20, "fuel": "DD", "events.elms": False, "impurity.seedSpecies": None},
                                 t_end=100, seed=5, fidelity="1.5D", fuel="DT", validate_config=False, tmp=tmp)
        self.assertEqual(args, ["--preset", "ITER", "--t-end", "100.0", "--seed", "5", "--fidelity", "1.5D", "--fuel", "DT",
                                "--set", "heating.P_NBI_MW=20", "--set", 'fuel="DD"', "--set", "events.elms=false",
                                "--set", "impurity.seedSpecies=null", "--no-validate"])
        self.assertEqual(tmp, [])

    def test_a_config_dict_goes_to_a_temporary_file(self):
        tmp = []
        try:
            args = _cli._config_args(None, {"method": "muon"}, None, None, None, None, None, True, tmp)
            self.assertEqual(args[0], "--config")
            self.assertEqual(json.loads(Path(args[1]).read_text(encoding="utf-8")), {"method": "muon"})
            self.assertEqual(tmp, [args[1]])
        finally:
            _cli._cleanup(tmp)
        self.assertFalse(Path(tmp[0]).exists())

    def test_a_config_path_is_passed_as_is(self):
        tmp = []
        self.assertEqual(_cli._config_args(None, Path("a.json"), None, None, None, None, None, True, tmp), ["--config", "a.json"])

    def test_param_specs(self):
        self.assertEqual(_cli._spec("10:50:10"), "10:50:10")
        self.assertEqual(_cli._spec("DT,DD"), "DT,DD")
        self.assertEqual(_cli._spec([10, 20.5, True]), "10,20.5,true")
        self.assertEqual(_cli._spec(("DT", "DD")), "DT,DD")
        self.assertEqual(_cli._spec(7), "7")

    def test_windows_command_splitting(self):
        self.assertEqual(_cli._split_windows('node --import tsx "C:\\a b\\x.ts"'), ["node", "--import", "tsx", "C:\\a b\\x.ts"])
        self.assertEqual(_cli._split_windows('  a   ""  b '), ["a", "", "b"])

    def test_cli_command_from_the_environment(self):
        old = os.environ.get("FUSION_SIM_CLI")
        try:
            os.environ["FUSION_SIM_CLI"] = "node x.js --flag"
            self.assertEqual(fs.cli_command(), ["node", "x.js", "--flag"])
        finally:
            if old is None:
                os.environ.pop("FUSION_SIM_CLI", None)
            else:
                os.environ["FUSION_SIM_CLI"] = old

    def test_errors_are_classified_by_exit_code(self):
        cfg = _cli._error(["x"], 2, "fusion-sim run: error: invalid configuration (2 problems):\n  B0: must be > 0\n  fuel: must be one of 'DT'\n")
        self.assertIsInstance(cfg, fs.ConfigError)
        self.assertEqual(cfg.issues, ["B0: must be > 0", "fuel: must be one of 'DT'"])
        self.assertIsInstance(cfg, fs.UsageError)
        self.assertIsInstance(_cli._error(["x"], 2, "fusion-sim run: error: unknown flag --bogus\n"), fs.UsageError)
        self.assertNotIsInstance(_cli._error(["x"], 2, "unknown flag\n"), fs.ConfigError)
        e = _cli._error(["x"], 1, "fusion-sim run: the run failed: boom\n")
        self.assertEqual(type(e), fs.FusionSimError)
        self.assertEqual(e.returncode, 1)
        self.assertIn("boom", str(e))
        self.assertEqual(str(_cli._error(["x"], 3, "")), "fusion-sim exited with code 3")

    def test_run_rejects_an_unknown_format_and_scan_an_empty_grid(self):
        with self.assertRaises(ValueError):
            fs.run("JET", format="xml")
        with self.assertRaises(ValueError):
            fs.scan({}, preset="JET")


@unittest.skipUnless(_cli_available(), "the fusion-sim command line was not found (set FUSION_SIM_CLI)")
class CommandLineTests(unittest.TestCase):
    def test_run_json(self):
        doc = fs.run("JET", t_end=0.5)
        self.assertEqual(doc["tool"], "fusion-sim run")
        self.assertEqual(doc["summary"]["method"], "tokamak")
        self.assertGreater(doc["report"]["Q_sci_max"], 0)
        self.assertEqual(doc["config"]["t_end"], 0.5)
        self.assertEqual(doc["provenance"]["preset"], "JET")

    def test_set_and_seed(self):
        a = fs.run("JET", t_end=0.5, set={"heating.P_NBI_MW": 10})
        b = fs.run("JET", t_end=0.5, set={"heating.P_NBI_MW": 20})
        self.assertLess(a["report"]["Q_sci_max"], b["report"]["Q_sci_max"])
        self.assertEqual(a["config"]["heating"]["P_NBI_MW"], 10)
        self.assertEqual(fs.run("JET", t_end=0.5, seed=99)["config"]["seed"], 99)

    def test_a_config_dict_and_a_patch_over_a_preset(self):
        cfg = fs.preset_config("MIRROR")
        cfg["t_end"] = 0.05
        doc = fs.run(config=cfg)
        self.assertEqual(doc["summary"]["method"], "mirror")
        patched = fs.run("JET", config={"t_end": 0.3, "heating": {"P_NBI_MW": 5}})
        self.assertEqual(patched["config"]["heating"]["P_NBI_MW"], 5)
        self.assertEqual(patched["config"]["heating"]["P_ICRH_MW"], 4)

    def test_series_in_json(self):
        doc = fs.run("JET", t_end=0.3, series=["Q", "P_fus"], every=10)
        self.assertEqual(sorted(doc["series"]), ["P_fus", "Q", "t"])
        self.assertEqual(len(doc["series"]["t"]), len(doc["series"]["Q"]))

    def test_csv_ndjson_text_imas_netcdf(self):
        csv = fs.run("JET", t_end=0.3, format="csv", series=["Q"])
        self.assertTrue(csv.startswith("t,Q\n"))
        records = fs.run("JET", t_end=0.3, format="ndjson")
        self.assertEqual(records[0]["type"], "meta")
        self.assertEqual(records[-1]["type"], "report")
        self.assertIn("Q (max/avg)", fs.run("JET", t_end=0.3, format="text"))
        imas = fs.run("JET", t_end=0.3, format="imas")
        self.assertEqual(imas["format"]["cocos"], 11)
        nc = fs.run("JET", t_end=0.3, format="netcdf")
        self.assertIsInstance(nc, bytes)
        self.assertEqual(nc[:3], b"CDF")

    def test_out_writes_a_file_and_returns_its_path(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / "q.csv"
            r = fs.run("JET", t_end=0.3, format="csv", series=["Q"], out=target)
            self.assertEqual(r, target)
            self.assertTrue(target.read_text(encoding="utf-8").startswith("t,Q\n"))

    def test_scan(self):
        doc = fs.scan({"heating.P_NBI_MW": "10:20:10", "fuel": ["DT", "DD"]}, preset="JET", t_end=0.3, metrics=["report.Q_sci_max"], threads=2)
        pts = doc["points"]
        self.assertEqual([(p["params"]["heating.P_NBI_MW"], p["params"]["fuel"]) for p in pts], [(10, "DT"), (10, "DD"), (20, "DT"), (20, "DD")])
        self.assertTrue(all(p["status"] == "ok" for p in pts))
        self.assertGreater(pts[2]["metrics"]["report.Q_sci_max"], pts[0]["metrics"]["report.Q_sci_max"])

    def test_presets_schema_version(self):
        ids = [p["id"] for p in fs.presets()]
        self.assertIn("ITER", ids)
        self.assertGreaterEqual(len(ids), 21)
        self.assertEqual(fs.schema()["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertRegex(fs.version(), r"^\d+\.\d+\.\d+")

    def test_validate(self):
        self.assertEqual(fs.validate(fs.preset_config("NIF")), [])
        bad = fs.preset_config("ITER")
        bad["B0"] = -1
        bad["geometry"]["a"] = 9
        problems = fs.validate(bad)
        self.assertEqual(len(problems), 2)
        self.assertTrue(any(p.startswith("B0:") for p in problems))
        self.assertTrue(any(p.startswith("geometry.a:") for p in problems))

    def test_an_invalid_configuration_raises_config_error_with_the_issues(self):
        with self.assertRaises(fs.ConfigError) as cm:
            fs.run("ITER", set={"geometry.kappa": 0.5, "heating.P_NBI_mw": 3})
        self.assertEqual(cm.exception.returncode, 2)
        self.assertEqual(len(cm.exception.issues), 2)
        self.assertTrue(any(i.startswith("geometry.kappa:") for i in cm.exception.issues))
        with self.assertRaises(fs.ConfigError):
            fs.scan({"B0": [3.7, -1]}, preset="JET")

    def test_an_unknown_preset_is_a_usage_error(self):
        with self.assertRaises(fs.UsageError) as cm:
            fs.run("NOPE")
        self.assertIn("unknown preset", str(cm.exception))

    def test_a_missing_command_is_reported(self):
        old = os.environ.get("FUSION_SIM_CLI")
        try:
            os.environ["FUSION_SIM_CLI"] = "definitely-not-a-command-xyz"
            with self.assertRaises(fs.FusionSimError) as cm:
                fs.version()
            self.assertEqual(cm.exception.returncode, 127)
            # validate() starts the command itself (exit code 1 is its answer, not an error): the same error, not FileNotFoundError
            with self.assertRaises(fs.FusionSimError) as cm:
                fs.validate({"t_end": 1})
            self.assertEqual(cm.exception.returncode, 127)
        finally:
            if old is None:
                os.environ.pop("FUSION_SIM_CLI", None)
            else:
                os.environ["FUSION_SIM_CLI"] = old


if __name__ == "__main__":
    unittest.main()
