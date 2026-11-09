# Changelog

Notable changes to SecureDesignStudio, newest first. Version numbers match the
`version` field in `package.json`. Work that is merged but not yet part of a
numbered version sits under **Unreleased**.

## Unreleased

Changes since 1.0.40, mostly macOS and Linux support plus fixes from the
cross-platform and security audit. The audit's dependency findings were
already fixed on `main`: Vite 8.3.5 (#22) and `@azure/identity` 4.14.1 (#24).

### Security

- **Exported review report: stored XSS fixed.** A work-item link such as
  `java<TAB>script:…` got past the scheme denylist and became a live
  `javascript:` link in the exported HTML review report. The report now links
  only `http`, `https` and `mailto` URLs, using the same allow-list as the app,
  and shows anything else as plain text. Import also tests the denylist after
  removing control and whitespace characters. The report carries a restrictive
  Content Security Policy (`default-src 'none'`, no scripts, no forms). A
  regression test covers the bypass payloads.
- **Standalone export keeps its model.** A model description containing
  `<!--<script>` made an exported standalone HTML file open without its
  model. The embedded model now escapes every `<` and the U+2028/U+2029
  line separators. A regression test covers it.
- **A crafted model can no longer blank the app.** `normalizeDoc` now accepts
  only strings for rendered text (node, edge, boundary, scenario and data
  names and descriptions, comment and issue text, edge handles and notes) and
  only finite numbers for positions, waypoints, boundary sizes, edge numbers
  and timestamps. A top-level error
  boundary replaces a blank page with Reload, Download the autosaved model,
  and a confirmed Discard, so a damaged autosave can't lock users out.
- **Content Security Policy for the hosted app and the standalone file.**
  `staticwebapp.config.json` sends a CSP (`script-src 'self'`,
  `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`. The standalone build gets a meta CSP that
  allows only its own inline script, pinned by SHA-256. The build fails
  instead of emitting a standalone file without that CSP. The local Vite dev
  server is unchanged.

### macOS and Linux support

- `start-securedesignstudio.sh` and `start-securedesignstudio-with-ai.sh`
  start the app on macOS and Linux. They are the counterparts of the
  PowerShell launchers and accept matching options (`--provider`,
  `--diagnose-provider`, `--help`).
- `scripts/launch.mjs` holds the shared checks (Node version, free port 5173,
  direct-dependency checks and `npm ci` repair, AI provider readiness) and uses only Node built-ins. Run
  it on any OS with `npm run start`, or `npm run start:ai` for the AI
  assistant.
- Stopping the launcher with `SIGTERM` or closing its terminal (`SIGHUP`) now
  stops the dev server too. Before, the server could be left running and keep
  port 5173 busy. Where `ps` lacks the needed options (BusyBox), the launcher
  reads `/proc` instead.
- Local Claude and Codex CLIs installed through npm now start on macOS and
  Linux. Those CLIs are `#!/usr/bin/env node` scripts and failed with no
  `PATH`. The bridge now gives the CLI a `PATH` holding only the running
  Node's directory and the CLI's own directory, never the caller's full
  `PATH`, plus `TMPDIR`, `USER` and `LOGNAME`. Windows is unchanged.
- `package.json` declares `engines.node` (`>=22.12.0`, the launcher's minimum)
  and `.nvmrc` selects Node 24 for version managers and CI.
- `docs/custom-libraries.md` shows the macOS/Linux form of
  `SDS_LIBRARY_PATHS` (forward slashes).
- The separate line-ending PR #30 proposes `.gitattributes` to store text as LF,
  keep PowerShell scripts CRLF and shell scripts LF, and leave `.tma`/`.tm7`
  bytes untouched; those changes are not part of this CI/documentation update.

### User experience

- The first-run **Create your first scenario** dialog now offers **Open model
  (.tma)…**, **Import TM7…** and **Import JSON…**. The dialog blocks the menu
  bar and file shortcuts, so before, opening existing work meant creating a
  throwaway scenario first. The actions reuse the File menu commands, so
  open and import behavior is unchanged. A browser test covers the actions,
  cancelled pickers and the 320px layout.

### Build and test

- Runtime tests build file paths with `path.join`, so the suite passes on
  macOS and Linux. Before, 14 tests failed there on Windows-style paths.
- New GitHub Actions workflow (`.github/workflows/ci.yml`) on Windows x64,
  macOS arm64, Linux x64 and Linux arm64: install without install scripts,
  `npm audit` at high severity, build, API build, runtime tests and a launcher
  smoke test on macOS and Linux. Browser tests block Windows, macOS and Linux
  x64; Linux ARM has no supported preinstalled Chrome/Edge channel and is
  covered by the build/runtime/launcher gates, not a browser pass. Actions
  are pinned to commit SHAs, the token is read-only, and every step runs in
  bash so a failing command can't be masked on Windows.
- New release workflow (`.github/workflows/release.yml`) for `v*.*.*` tags.
  It checks the tag against `package.json`, builds and tests, then attaches
  the standalone HTML, a static-hosting zip, a CycloneDX SBOM and
  `SHA256SUMS` to a **draft** release, with a GitHub build-provenance
  attestation. Building runs in a job with a read-only token; only a
  separate job that runs no project code can write releases and request
  the attestation token, after re-checking `SHA256SUMS`. A maintainer
  publishes the draft by hand.
- New tests for the launcher (including signal handling), the local CLI
  environment on macOS and Linux, model normalization, the error boundary,
  embedded-model escaping, the report link allow-list and both CSPs.

### Documentation

- README: a "Get started on macOS or Linux" section.
- [Verifying a release download](docs/release-verification.md): checksum and
  attestation checks on each OS.
- Contributor guide: Chrome works for browser tests
  (`SDS_TEST_BROWSER_CHANNEL=chrome`), and a corrected note on how
  `shell-quote` is kept patched (there is no `overrides` block).
- New [threat model of the tool itself](docs/tool-threat-model.md).

## Earlier changes

These predate versioned entries. They are summarized from the README's
"Recent changes" list, which records no versions or dates.

- Windows launchers in the repository root check prerequisites, and AI
  features start only through a separate, opt-in launcher.
- Custom Libraries add optional catalogs, metadata, checks and help text
  without granting the library any extra access.
- Editors for the Authentication and Classification Libraries manage
  reusable vocabularies that teams can customize.
- Inventory ID takes ordinary text, and stored node metadata is kept unless
  someone changes it on purpose.
- Native models carry their saved catalog definitions and custom metadata,
  and comparisons show them.
- Scenario/DFD JSON import and local PMEXP import make it easier to reuse
  existing models.
- **Compare to previous** reviews a saved snapshot of a model without
  replacing the current work.
- When a rule is unavailable, its findings are kept and marked
  **Not re-evaluated** instead of disappearing as if the review were clean.
- Collaboration and AI services stay off until they are explicitly configured.
