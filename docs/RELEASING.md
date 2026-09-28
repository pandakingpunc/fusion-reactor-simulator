# Releasing

Releases are made by the repository owner. Everything that leaves the machine — pushing, tagging,
creating the GitHub release, and therefore the Zenodo archive and its DOI — is done by the owner by
hand.

> **Agents never push or release.** Coding agents (and any automation acting for them) may prepare a
> release locally: run the checks, bump the version fields, draft the changelog and commit on a local
> branch. They never run `git push`, `git tag`, `gh release`, `npm publish`, and never change GitHub or
> Zenodo settings. The steps marked **owner** below are the owner's alone.

## Checklist

1. **Local CI is green.** `npm run ci:local` (type check, unit tests, literature validation, golden
   regression) must pass on Node 24, the version the golden snapshots are recorded with. Useful
   extras: `npm run build`, `npm run coverage` (per-directory thresholds), `npm run typecheck:strict`
   (no file above its baseline).

2. **Pre-flight consistency check.** `npm run release:check` verifies that package.json,
   CITATION.cff, .zenodo.json and the top released CHANGELOG section name the same version, that
   `date-released` is an ISO date, that the concept DOI `10.5281/zenodo.22259861` is in CITATION.cff,
   that no `TODO` is left in CITATION.cff or .zenodo.json, that every "N presets" in the README matches
   `src/physics/presets.ts`, that `engines.node` is declared and that a LICENSE exists. Fix whatever it
   reports before bumping.

3. **Bump the version** to `X.Y.Z` (SemVer) in all four places:
   - `package.json` and `package-lock.json`: `npm version X.Y.Z --no-git-tag-version` (changes both, no tag);
   - `CITATION.cff`: `version: "X.Y.Z"` and `date-released: "YYYY-MM-DD"`;
   - `.zenodo.json`: `"version": "X.Y.Z"`;
   - `CHANGELOG.md`: rename `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD` (same date as `date-released`).

   Then `npm run release:check -- --no-allow-unreleased` must pass: all four versions agree and no
   `[Unreleased]` section is left above the release.

4. **Commit** locally, e.g. `git commit -m "Release vX.Y.Z"`. No tag: the GitHub release creates it.

5. **Push** (**owner**): `git push origin main`, and wait for the CI workflow
   (`.github/workflows/ci.yml`) to pass on every OS and Node version.

6. **Create the GitHub release** (**owner**):
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <the CHANGELOG section as a file>`.
   This creates the tag `vX.Y.Z` on the pushed commit.

7. **Zenodo archives it automatically.** The GitHub–Zenodo integration picks up the published
   release, archives the tagged source with the metadata in `.zenodo.json` and mints a new *version*
   DOI. The concept DOI `10.5281/zenodo.22259861` stays the same and always resolves to the latest
   version.

8. **Record the version DOI** (commit locally, **owner** pushes):
   - `CITATION.cff`: set `doi:` to the new version DOI and add it to `identifiers` as
     "DOI of version X.Y.Z" (keep the concept DOI entry);
   - `README.md`: update the citation section/badge to the new version DOI;
   - add a fresh `## [Unreleased]` section at the top of `CHANGELOG.md` for the next cycle.

A release is never re-tagged or edited after Zenodo has archived it; fix mistakes in a new patch
release `X.Y.(Z+1)`.
