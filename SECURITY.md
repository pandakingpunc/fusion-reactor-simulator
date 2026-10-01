# Security policy

## Supported versions

Security fixes are made for the current 4.x release line. Older lines (3.x and earlier) are not maintained;
please update to the latest 4.x release before reporting.

| Version | Supported |
|---|---|
| 4.x | yes |
| 3.x and earlier | no |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it privately through GitHub's private
vulnerability reporting (security advisories) of the repository:

1. Open <https://github.com/pandakingpunc/fusion-reactor-simulator/security/advisories/new>
   (or the repository's **Security** tab, then **Report a vulnerability**).
2. Describe the problem, the affected version or commit, the steps to reproduce it and, if you can, its impact.
   A minimal configuration, scenario or share link that triggers it is the most useful attachment.

If the form is not available to you, open a public issue that says only that you have a security concern and ask
a maintainer for a private way to send the details. Do not include the details in the public issue.

You can expect an acknowledgement within about a week and a status update when the problem has been reproduced
and assessed. This is a volunteer, research-software project, so these are intentions and not guarantees. Valid
reports are fixed in a new patch release and credited in the advisory and the changelog unless you prefer to stay
anonymous.

## Scope

In scope: the code in this repository, including

- the browser application: parsing of shared links and of imported files (configuration, scenario, EQDSK, IMAS-like
  JSON, NetCDF), stored data, and anything that could run script in a page;
- the command-line tools and the library (`fusion-sim`, `src/cli`, `src/io`): file and path handling, argument
  parsing, worker threads;
- the build and CI configuration (`.github`, `scripts`).

Out of scope:

- the physics results themselves: the simulator is an educational and research tool, its results are not
  engineering predictions, and a wrong or inaccurate number is a bug to report in the normal issue tracker;
- a denial of service that only needs an unreasonable input on your own machine (a very long simulation you
  started yourself), unless it can be triggered through a shared link or file that a victim merely opens;
- vulnerabilities in third-party dependencies that do not affect this project (report them upstream; Dependabot
  tracks the dependencies here).

The application has no server and no account system: configurations, scenarios and results stay in the browser.
(The page loads its web fonts from Google Fonts.)
