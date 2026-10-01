## What and why

<!-- What does this change, and why is it needed? Link the issue it closes, if any. -->

## How it was checked

<!-- Commands you ran and what you saw, for example: npm run ci:local, a targeted vitest file, npm run validate -- --only ITER15. -->

## Checklist

- [ ] `npm run ci:local` passes (or I say below which step I could not run and why)
- [ ] New or changed behaviour has a test; a bug fix has a regression test
- [ ] Moved golden numbers are re-recorded with `npm run golden:update -- --reason-file ...` in a separate commit; `test/golden` was not edited by hand
- [ ] A new validation reference cites a primary source (DOI) and its accept range is not fitted to the model output
- [ ] New UI strings exist in both `en` and `tr` dictionaries
- [ ] A configuration change updated `schema/fusion-sim.schema.json` and `docs/config-reference.md` (`npm run schema`, `npm run docs:config`)
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` for a user-visible change
- [ ] No new dependency, no secrets and no personal data in the diff

## Notes for the reviewer

<!-- Anything that moves numbers, a known limitation, or a part you are unsure about. -->
