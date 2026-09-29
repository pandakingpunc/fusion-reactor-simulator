# Data formats of a run (src/io)

Browser-safe writers and readers: no DOM, no Node API (bytes are `Uint8Array`, text is `string`), so the same
code serves a download button, a worker and the command line. The library entry is `formats.ts`
(`fusion-reactor-simulator/io` in the exports patch). `geqdsk.ts` (equilibrium files) belongs to workstream WS4.

Every writer takes a `RunSource` (`sourceFromSimulation(sim, meta)` builds one from a `Simulation`): the history,
the events, the model's diagnostics table (`DiagSpec`: key, label, unit, group), the report, the configuration and
optional provenance (`RunMeta`: version, commit, preset, fingerprint, configuration hash; a creation date only if
you pass one, so the same run always gives the same bytes). A diagnostic a frame lacks is NaN there.

| Format | Writer | Reader | What it holds |
|---|---|---|---|
| CSV (RFC 4180) | `writeCsv` | `parseCsv` | one row per frame: `t` and the chosen diagnostics; NaN is an empty field; shortest round-trip numbers; optional `# ` comment lines |
| NDJSON | `writeRunNdjson` | `parseNdjson` | typed records `meta`, `frame` (t, d, optional prof), `event`, `report`; non-finite numbers as `null` or, losslessly, as "NaN"/"Infinity" strings |
| NetCDF-3 (CDF-1, CDF-2) | `writeRunNetcdf` | `readNetcdf3` | CF-1.8 arrays, see below; also a general `writeNetcdf3(dataset)` |
| IMAS-like JSON | `writeImasJson` | `readImasSummary`, `readImasProfiles` | `summary`, `core_profiles`, `equilibrium` IDSs in SI units, COCOS 11 |

## NetCDF layout

Dimensions `time` (one per history frame) and, for a 1.5D run, `profile_time` and `rho`. Variables `time(time)`,
one `double key(time)` per diagnostic (`Q`, `P_fus`, `Ti`, ...), and `time_profiles(profile_time)`, `rho(rho)`,
`profile_<key>(profile_time, rho)` for the radial profiles (`profile_Te` and the scalar `Te` are different
variables). Each has `long_name` and `units` in UDUNITS spelling (`keV`, `1e20 m-3`, `MW m-2`, `1` for
dimensionless; the model's own spelling is kept in `units_original` when it differs), diagnostics also `group` and
`diagnostic_key`. Global attributes: `Conventions = "CF-1.8"`, `title`, `source`, `comment`, `simulation_method`,
`simulation_preset`, `simulation_version`, `simulation_fingerprint`, `simulation_seed`, `simulation_end_reason`,
`simulation_natural_end`, and every finite number of the shot report as `report_<name>`. The time axis is model
time (no calendar), so it carries `axis = "T"` and no reference date. NaN marks a missing value.

The writer emits fixed dimensions only (a run is complete when it is written) and picks CDF-2 when an offset
would pass 2 GiB. The reader also reads record variables, so files from other tools can be read; CDF-5 and
netCDF-4/HDF5 are refused with a message that says what they are. **Verification:** the writer is checked byte
for byte against a file worked out by hand from the Unidata format specification, and against the reader
(including record variables, which the writer never emits). No third-party reader (ncdump, netCDF4, scipy) was
available on the machine this was written on; open a file with xarray or ncdump once before relying on it.

Sizes (ITER 1.5D, 400 s): CSV 2.2 MB, NetCDF-3 6.8 MB, NDJSON 3.4 MB (no profiles), IMAS-like JSON 16 MB with
profiles and 1.4 MB without.

## IMAS-like JSON

"IMAS-like" is deliberate: the field names follow the IMAS Data Dictionary (3.x spelling) and the units are the
dictionary's (eV, m^-3, A, W, J, s), but the document is not produced by, or validated against, an IMAS
installation; no Data Dictionary release was available to check it against. It is meant to be loaded into IMAS
tooling by a short adapter, and to be readable on its own. What the model does not compute is left out, never
filled with a placeholder; missing samples are `null`.

- `summary`: one `time` base [s]; quantities as `{ value: [...] }` (`global_quantities.ip`, `.beta_tor_norm`,
  `.q_95`, `.tau_energy`, `.fusion_gain`, `.energy_thermal`, ...; `fusion.power`; `volume_average.t_e`,
  `.t_i_average`, `.n_e`; `line_average.n_e`; `local.magnetic_axis.*`). The mapping is `SUMMARY_MAP` in `imas.ts`.
- `core_profiles` (1.5D runs): `profiles_1d[k]` per output frame: `grid.rho_tor_norm`, `electrons.temperature`
  and `.density`, `t_i_average`, `q`, `magnetic_shear`, `zeff`, `pressure_thermal`, `j_total`, `j_bootstrap`,
  `j_non_inductive`, `j_ohmic`.
- `equilibrium` (1.5D runs): `time_slice[k]` where the equilibrium was updated: the outermost traced flux surface
  as `boundary.outline`, its `minor_radius`, `elongation` and `geometric_axis`, and `global_quantities`
  (`magnetic_axis`, `ip`, `q_95`, `li_3`, `beta_pol`). No poloidal-flux map is exported: the frames carry flux
  surfaces, not a psi grid (the GEQDSK writer of WS4 has the full equilibrium).
- **COCOS 11** (Sauter and Medvedev, Comput. Phys. Commun. 184 (2013) 293): the model's plasma current and
  toroidal field are positive and parallel, so q, the current densities and the shear are positive.
- Only magnetic-confinement runs (tokamak, spherical tokamak, stellarator) can be exported.

The unit conversions are inverted by `readImasSummary` / `readImasProfiles`; the round-trip tests compare to
1e-14 relative (a multiplication by 1e6 and back is not exact in floating point).
