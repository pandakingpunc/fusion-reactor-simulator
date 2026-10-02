# Contributing

Thank you for helping with the Fusion Reactor Simulator. The project is a reduced-order, educational and
research-grade simulation engine (0D power balance and a 1.5D transport model coupled to a Grad-Shafranov
equilibrium). It is not a design code, and its outputs must never be presented as engineering predictions.
Bug reports, physics corrections, tests, documentation, translations and new validation references are all
welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are reported
privately; see [SECURITY.md](SECURITY.md).

## Set-up

Requirements: Node.js 20 or newer (`.nvmrc` pins 24, the major the golden snapshots were recorded with) and npm.

```bash
git clone https://github.com/pandakingpunc/fusion-reactor-simulator.git
cd fusion-reactor-simulator
npm ci            # exact versions from package-lock.json; do not use `npm install` for a plain checkout
npm run dev       # the user interface (Vite) at http://localhost:5173
```

The only runtime dependencies are React and React DOM. Please do not add a dependency (runtime or
development) without opening an issue first; most needs are met by the existing toolchain
(TypeScript, Vite, Vitest, tsx).

## Running the checks

| Command | What it does |
|---|---|
| `npm test` | Unit, CLI and fast golden-regression tests (Vitest). |
| `npx vitest run path/to/file.test.ts` | One test file while you work. |
| `npm run build` | Type check and production build of the app. |
| `npm run validate` | Literature validation of every preset (`--only ITER15,JET15`, `--threads N`). |
| `npm run golden` | Golden regression: every case against `test/golden/*.json`. |
| `npm run figures:check` | The paper figures in `docs/figures` are the ones in `figures.manifest.json`, and regenerating them gives the same SHA-256 hashes. |
| `npm run schema:check`, `npm run schema:scenario:check`, `npm run docs:config:check` | The generated schemas and the configuration reference are current. |
| `npm run ci:local` | What CI runs, in sequence, stopping at the first failure. |

`npm run ci:local` is the check to run before you open a pull request. On a machine that is shared with other
work, limit its load with environment variables:

```bash
CI_LOCAL_WORKERS=2 CI_LOCAL_THREADS=2 npm run ci:local     # POSIX shells
$env:CI_LOCAL_WORKERS = 2; $env:CI_LOCAL_THREADS = 2; npm run ci:local     # PowerShell
```

`CI_LOCAL_WORKERS` is the number of Vitest workers, `CI_LOCAL_THREADS` the worker threads of the validation,
golden and figures steps, `CI_LOCAL_FIGURES=0` skips the figures step (it regenerates all nine figures, several minutes)
and `CI_LOCAL_BUNDLE=0` skips the build and bundle-budget steps. `npm run ci:local -- --dry-run`
lists the steps without running them.

The golden snapshots are compared at a tight tolerance and are recorded on Windows Node 24. On another OS or
Node major the unit tests, the validation and the build still apply, but a 1.5D golden difference can be a
floating-point artefact rather than a regression. CI runs `npm run golden` and `figures:check` on Windows Node 24 only.

## Golden regression policy

The golden suite (`npm run golden`) catches any numerical drift: a snapshot of every case is stored in
`test/golden/<case>.json`. A change that is *meant* to move numbers re-records them and says why:

```bash
npm run golden:update -- --reason "switch the ELM model to ..." --only ITER15,DEMO15
npm run golden:update -- --reason-file reason.txt        # a long reason; the first paragraph is the title
```

- Never edit a file in `test/golden/` by hand. Only the golden CLI writes them.
- `test/golden/CHANGES.md` is append-only: the CLI adds one dated entry per re-record. Do not edit or reorder
  past entries.
- The reason must name the physical or numerical cause of every headline move. "Re-recorded" is not a reason.
- A change that was supposed to be bit-for-bit neutral (a refactor) must not move any golden number. If it does,
  fix the change, not the snapshot.
- Keep the re-record in its own commit, after the code change that causes it.

## Validation policy

`npm run validate` compares model outputs with published values (`src/physics/validation/references.ts`).

- Accept ranges come from the literature: the published value with its published uncertainty (or the spread of
  published predictions), widened by a stated reduced-model tolerance. **A range is never fitted to the model
  output.** If you add a check, cite the primary source with its DOI and say in `basis` how the range follows
  from it.
- A check is a `validation` (a measurement), a `benchmark` (a design-scenario prediction or an integrated-modelling
  result) or a `sanity` bound. Choose the honest kind.
- A miss is reported as a miss. If the model falls outside a defensible range, keep the check and mark it with
  `knownFailure` and the reason; do not widen the range until it passes.
- Published numbers in the README, the technical report and the documentation come from the generated results
  (validation, golden, figures), not from memory.

## Commit style

- Small, logical commits. One concern per commit; a re-recorded golden set is its own commit.
- Subject line in the imperative mood, about 72 characters or fewer: "Fix the pedestal width at the ..." and not
  "Fixed" or "Fixes".
- The body says *why* the change is needed, and what it moves (numbers, files, behaviour). The diff already
  says what changed.
- Prefixes such as `fix(report):`, `test(golden):` or `docs:` are welcome but not required.

## Code and file conventions

- TypeScript, two-space indentation, LF line endings, UTF-8, final newline (see `.editorconfig`). Keep the
  existing line endings of a file you edit.
- `src/physics` is browser-safe: no Node APIs there. Node-only code lives under `src/cli`, `scripts` and `bench`.
- A new physics model is opt-in and its default reproduces the previous behaviour, so existing results and golden
  files do not move unless you intend it.
- A new configuration field is added to the schema in `src/physics/config/schema.ts` with a description, a unit
  and a default. Then run `npm run schema` and `npm run docs:config`, and commit the regenerated files.
- Add a test with every behaviour change. A bug fix starts with a test that fails for the bug.

## Translations (i18n)

The user interface is available in English and Turkish. **Every user-visible string goes into both
dictionaries**; there are no literal strings in components.

- Main dictionaries: `src/i18n/en.ts` (the reference, typed keys) and `src/i18n/tr.ts`; the wizard, persistence,
  scenario and educational texts have their own pairs (`src/i18n/wizard.tr.ts`, `persist.*.ts`, `scenario.*.ts`,
  `src/edu/i18n/`).
- Use `{name}` placeholders for values; a translation keeps exactly the placeholders of the English text.
- `src/i18n/i18n.test.ts` fails when the two dictionaries differ in their keys or placeholders, or a translation
  is empty.
- Do not build sentences by concatenating translated fragments; give the whole sentence a key.

## Pull request checklist

Before you open a pull request:

- [ ] `npm run ci:local` passes (or you say which step you could not run and why).
- [ ] New or changed behaviour has a test; a bug fix has a regression test.
- [ ] Moved golden numbers are re-recorded with `golden:update` and a reason, in a separate commit.
- [ ] A new validation reference cites a primary source (DOI) and its range is not fitted to the model.
- [ ] New UI strings exist in EN and TR.
- [ ] A configuration change updated `schema/fusion-sim.schema.json` and `docs/config-reference.md`
      (`npm run schema`, `npm run docs:config`).
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` for a user-visible change.
- [ ] No new dependency, no secrets, no personal data in the diff.

Maintainers make releases (see [docs/RELEASING.md](docs/RELEASING.md)); a pull request never needs to touch the
version, the citation metadata or the Zenodo record.

## Questions and ideas

Open an issue with the question or feature-request template. For anything that touches physics, include the
published source you have in mind: the reply will be quicker, and the answer more useful, with a citation.
