# JSON Schema of a reactor configuration

`fusion-sim.schema.json` is the JSON Schema (draft 2020-12) of the configuration that `new Simulation(cfg)` takes.
It is generated, not written by hand:

```
npx tsx scripts/gen-schema.ts           # rewrite this file
npx tsx scripts/gen-schema.ts --check   # exit 1 if it is out of date
npx tsx src/cli/fusion-sim.ts schema    # print it (fusion-sim schema once the package is built)
```

The source is `src/physics/config/schema.ts`; `src/physics/config/schema.test.ts` fails if this file differs from
what the emitter writes. The `$id` is a URN (`urn:fusion-reactor-simulator:schema:reactor-config`): the schema is
not hosted anywhere.

`method` selects one of six definitions (`magneticConfig`, `icfConfig`, `mtfConfig`, `frcConfig`, `mirrorConfig`,
`muonConfig`) by `if` / `then`, so a validator reports the problems of the branch that applies. Every property
is described (`description`, `x-unit`, and `default` where the model has one); unknown properties are rejected.

Not expressible in JSON Schema, and therefore only in `x-rules` annotations (the runtime validator, `fusion-sim
run` and `fusion-sim schema --check` enforce them): `geometry.a < geometry.R`, and `Ip_MA > 0` unless the
method is `stellarator`.

Editor use (VS Code, `.vscode/settings.json` or user settings):

```json
{ "json.schemas": [{ "fileMatch": ["*.reactor.json"], "url": "./schema/fusion-sim.schema.json" }] }
```

Check a file from the command line: `fusion-sim schema --check my.reactor.json` (exit 0 valid, 1 invalid with every
problem and its path, 2 unreadable).
