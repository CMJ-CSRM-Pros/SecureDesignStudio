# Contributing and local validation

SecureDesignStudio uses TypeScript, React, Vite and Node's built-in test runner.
Use Node 24 LTS, npm and an installed Microsoft Edge browser for browser tests.
Ordinary editing/building requires no cloud credentials or agent tooling.

## Development

Run `npm ci` for a fresh checkout, then `npm run dev`. The frontend binds
strictly to `http://localhost:5173/`; it does not start an API or enable
collaboration. Do not stop another user's listener or silently choose a new
port. The optional AI workflow is separate; see
[advanced configuration](advanced-configuration.md).

Before changing behavior, inspect the current source and existing tests.
Preserve stable IDs, scenario ownership, saved definitions, old-file
compatibility and one-step Undo. Keep private data, credentials and real
customer/service exports out of fixtures.

## Check a change

| Surface | Command |
|---|---|
| Frontend runtime, dependencies or build configuration | `npm run build` (typecheck, normal and standalone output) |
| Model, import/export, catalogs or pure helpers | `npm run test:runtime` |
| UI and current application behavior | `npm run test:browser` (regression and automated usability union) |
| Browser runner | `npm run test:browser:unit` plus the browser union |
| Optional library behavior | `npm run test:libraries:browser`; configured production checks as described in the browser guide |
| API implementation | `npm --prefix api run build`, plus relevant frontend/request-contract checks |
| Standalone persistence | `npm run test:authentication:production` after building |
| Service configuration | The explicit configuration matrix in the browser guide and `service-build.json` verification |

`test:runtime` is the agent-independent pure application suite. In the public
package, `test:authentication` is an alias for it. Shared runtime tests require
no optional integrations.
There is no generic `npm test` or lint script.

See the [browser guide](../tests/browser/README.md) for exact coverage,
configuration-specific production tests, synthetic fixtures and output paths.
Run browser suites serially; they own and stop only their own server.
Assistant production navigation tests require an explicitly configured
same-origin endpoint and intercept responses rather than calling a live API.
Restore the intended service configuration after testing.

## Review and release boundaries

Record the source/target commits, dirty input, commands and exit codes,
selected service/library configuration, and artifact hashes. Missing, failing,
skipped or stale required checks cannot count as passing. Review test,
dependency and build-policy changes independently of their own results.
Automated layout/focus checks are not human-usability research, a screen-reader
audit or proof of deployed behavior.

Keep generated output, dependencies, TypeScript build metadata, local settings
and test evidence outside commits. Inspect `git diff --check` and the complete
diff. Keep the application versions in `package.json` and both root lockfile
fields synchronized; use `npm version <version> --no-git-tag-version
--ignore-scripts` only for an intended version change, not every build.
Release maintainers review version intent and approval separately from builds.

No build or test command authorizes deployment, repository publication,
license selection or asset redistribution. Preserve component notices and
check [third-party provenance](third-party-notices.md). Root licensing and
other release clearances are not implied by those component notices.
