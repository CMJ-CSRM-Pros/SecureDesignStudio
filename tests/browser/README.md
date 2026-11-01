# Application regression and usability checks

These checks exercise the current working tree in a real, isolated browser.
They complement, not replace, the production build, version preflight, and
immutable-PR9 structural regression guard.

## Run the automated checks

Prerequisites: the repository's supported Node.js LTS (at least Node 20 for
the browser driver), restored npm dependencies, an installed Microsoft Edge
browser, and free localhost port 5173 on IPv4 and IPv6.
`playwright-core` is a browser driver; the test runner is Node's built-in
runner. No browser binary is downloaded by these commands.

```powershell
npm run test:browser:unit
npm run test:regression
npm run test:usability
```

Use `npm run test:browser` instead of the last two commands to run their union
in one browser/server lifecycle. Do not run browser suites in parallel: they
intentionally share the application's strict port 5173.

For evidence in a chosen location, supply a **new directory outside the
worktree** whose parent already exists:

```powershell
$env:SDS_TEST_OUTPUT_DIR = "C:\review-artifacts\browser-checks-run-1"
npm run test:browser
```

Without that variable, the runner prints a newly created OS temporary
directory. To use an already installed Chrome instead, set
`SDS_TEST_BROWSER_CHANNEL=chrome`; supported channels are `msedge` and
`chrome`. Record the actual channel/version, not an assumed browser version.
Do not install a browser or change a user's profile as an implicit repair.

The runner refuses an occupied port instead of stopping/reusing another
session's server. It starts only this checkout's Vite process, verifies that
process's ready address and HTTP response, and stops its owned process in
cleanup. It never launches `dev:ai`, an API, Azure services, or deployment.
Do not bypass startup failures or silently choose another port.
Initial navigation has a bounded 20-second startup budget for cold Vite module
transformation; ordinary UI actions retain their six-second timeout. Runtime,
network and dialog failures are still recorded, not retried or suppressed.

Each case gets a fresh browser context and imports a synthetic `.tma` via the
application's real file input. HTTP and WebSocket routes allow only the exact
local origin and block even local `/api/` calls. Unexpected attempts, browser
dialogs, console errors, and runtime exceptions fail the case. The offline
case starts with an inert synthetic room fragment, disconnects the browser,
then checks editing and autosave. No personal browser profile or real model
data is used.

The context retains up to 2,000 resource-timing entries. The application module
graph exceeds the browser's default 250-entry buffer; the larger bounded buffer
preserves the actual loaded Yjs URL for synthetic peer checks without importing
a guessed second module instance.

## What is actually covered

### Local AI provider selection

`npm run test:ai:local` starts only an owned Vite process in explicit AI mode;
the localhost API and all provider responses are intercepted with synthetic
fixtures. It never starts a Function host, invokes Claude/Codex, accesses a
consumer account, or performs inference. Run it separately from other browser
suites because it owns strict port 5173. It covers the launcher default, shared
Assistant/Designer selection, review/design provider IDs, unavailable choices,
pending-request selection lock, conversation reset, local preference reload,
readiness failure/recovery, model-state isolation and narrow layout.
The pure `ai-launcher.test.mjs` and `local-ai-setup.test.mjs` cases exercise
startup branches with mocked tools and verify subscription setup needs no Azure
configuration. API-provider cases cover dispatch/process handling separately.
These synthetic checks do not prove live CLI compatibility, subscription
entitlements, model quality, consumer data handling, or participant usability.

Boundary interaction checks cover security/privacy in both themes: empty-center
dragging leaves document/history unchanged, all four borders move the boundary
and members together, contained nodes/flows remain reachable, title editing and
resize handles still work, nested borders remain reachable, and Undo/Redo
restores exact document state.

### Prompt-to-diagram authoring

`tests/authentication/threat-model-designer.test.mjs` exercises the strict
authoring contract, catalog/target-policy validation, unrelated and shared
scenario preservation, strict optional scenario-field validation, required
creation text, directional data, boundary geometry, semantic
fingerprinting, normalization and synthetic Yjs materialization. Its API test
transpiles the actual Function source with a synthetic credential/fetch:
authoring and review policies remain separate and truncated responses fail.
Full-edit contracts cover explicit global deletion/cascade cleanup, shared
rerouting/endpoint membership, exact selected-scenario data replacement, boundary
member removal/geometry and legacy merge behavior. A gateway-insertion regression
asserts that the direct browser-to-origin bypass is removed, not merely discussed.
Real-store and configured UI cases require one-step full-model Undo/Redo,
deletion-only responses, native/autosave round trips and unchanged unrelated data.
An in-memory API compilation check resolves both Function entrypoints and their
shared contract within the deployable `api/` folder without acquiring credentials.

`designer-contracts.mjs` registers local-only dialog/zero-service behavior and
real StrictMode StoreProvider atomic response history in the browser union.
The configured sequence-order regression reproduces correct endpoints but an
incorrect backend-first timeline, then checks explicit AI ordering updates both
call order/labels and participant columns, stays in Sequence view, preserves
other scenarios and geometry, and survives Undo/Redo, native Open and reload.
The configured privacy-data regression verifies that AI request attachments
immediately populate the receiving node's Privacy table without Analyze, retain
existing retention, label new retention Not specified, and survive one-step
Undo/Redo and native/autosave reload. A General-tab link makes recorded data
discoverable without turning inferred retention into a storage claim.
File-menu checks place **Design with AI** directly after Open, remove the former
Model entry, and verify keyboard activation and focus return to File.
It verifies Vite loads `/shared/designContract.ts` without any `/api/` source
requests; the harness continues to reject every genuine API request.
Configured `test:assistant:production` additionally exercises actual production
UI authoring: first-scenario creation, refinement, separate greenfield Undo/Redo,
long-description and saved-assumption preservation through node-only patches,
no-op history,
clarification, malformed output/retry, filter visibility, Show all/IME/newline
guards, bounded history, Stop/Close/scenario/timeout late-response rejection,
semantic-change rejection, focus preservation, 320px/short-height control
reachability, native save/open, autosave/reload and standalone export/reopen.
Designer movement checks use title-bar pointer dragging and keyboard movement
on the focused title bar, assert the separate Move button is absent, retain
position on reopen, and clamp after viewport changes. Conversation
checks retain successful turns and unfinished/retry prompts across Close/Open
without saving them, and clear them on scenario changes, model replacement
(even with matching IDs), and reload. Closed requests cannot apply late responses.
Default-off standalone also retains manual first-scenario onboarding with zero
AI requests. Existing review/chat assertions still execute.

Build separately with only the explicit
`VITE_DESIGN_ASSISTANT_ENDPOINT=/api/design-assistant`, then run
`npm run test:assistant:production`. Hosted files and responses are fulfilled
in an isolated browser; no API listener, Azure credentials, live inference or
collaboration room is used. The standalone persistence portion needs no AI
endpoint. Restore the intended final service configuration with a fresh full
build afterward. Do not edit source during an evidence-producing browser run.
Passing these synthetic contracts does **not** establish live design quality,
participant usability, screen-reader behavior, native-picker behavior or actual
high-browser-zoom usability; report those gates separately.

| Suite | Executed contracts |
|---|---|
| `test:regression` | Scenario visibility; parallel directional flows; custom edge numbers; request/response data attachments; graph/sequence switching; native `.tma` export/reopen; title editing; undo/redo; autosave/reload; inert startup room fragment; offline editing without collaboration caches. |
| `test:usability` | File menu keyboard navigation and focus return; Filter staging/Cancel/Enter/Clear all; inspector keyboard tabs, pinning, selection behavior and ARIA/rendered resize agreement; viewport reflow and reachable navigation/scenario/inspector/zoom controls at 320, 375, 480, 768, 1024 and 1366 CSS pixels in light and dark themes. |
| Unified inspector presentation | The browser union moves every generally available inspector tab through docked, floating and popup modes, checks the same mounted DOM identity, popup tab switching, comment-reply draft preservation, close/reopen and popup-origin workbook download containing all model scenarios and comparison changes. Workbook pure contracts separately check complete records, safe text and long-text overflow. Configured Assistant production checks retain in-flight analysis, caret/reading place, blocked popup, move/resize and both-document export coverage. These are synthetic browser checks, not participant usability or native Excel verification. |
| `test:browser:unit` | Harness network policy, ANSI-safe owned-server readiness, and refusal to take over an occupied port. |
| Sample gallery cases in `test:regression` | All five actual `.tma` samples and 11 scenarios: current authentication badges, exact scenario membership, node/label overlap and viewport clipping, Sequence order, model/view save/reopen and no omitted retention introduced by Analyze. Screenshots capture the authored diagrams; this is not human usability research. |
| Unavailable-catalog case in `test:browser` | Synthetic unfamiliar classification, tenant, boundary and deviation IDs; unresolved canvas/inspector/filter labels; node-policy preservation; explicit classification change with Undo/Redo; full native save/reopen; autosave/reload. It does not install a library or run unavailable rules. |
| Analyzer evidence cases in `test:browser` | Unavailable-rule and unspecified-policy findings retain status/replies/guidance; available obsolete findings clear; shared/global issue warnings, search, narrow layout, native files, Undo/Redo, autosave, review report and atomic evaluator-failure diagnostic. The production standalone case also checks retained evidence through export/reopen. |
| Custom Libraries cases | Default browser union checks empty-selection disclosure, keyboard/focus and 320px layout. `test:libraries:browser` separately selects a complete synthetic package plus a missing directory and checks metadata/rules/history/reload. `test:libraries:production` requires a configured build; it fulfills hosted files in an isolated browser without a network server, checks missing/HTML manifest fallback, and exports/reopens embedded packages and metadata in standalone HTML. |
| Endpoint guidance and import cases | Default and configured suites check generic/optional help, effective provenance, keyboard/focus/320px layout, clipboard success and denied-access selection fallback. Synthetic text imports cover URL/request-line parsing, most-specific matching, deduplication, unknown-line downloads, active-scenario membership and existing Undo/Redo. Configured production checks the same help slots in hosted and exported standalone artifacts, including generic fallback when the manifest is rejected. No test executes a telemetry query. |
| Authentication extraction | Core tests require 18 definitions (the original 14 plus four owner-specific methods promoted to core for both builds by explicit user decision) and Customer/Other tenants. Historical snapshots remain data fixtures, not defaults. The unconfigured browser case checks that promoted methods are offered without any library, fresh/cached profiles, historical saved snapshots resolving against core, node-catalog/native export and findings; the production standalone case reports a retained conflicting snapshot as a contract conflict. Configured tests create a temporary synthetic historical package (tenants, inventory field, rule and node only; never the private checkout) and check authoring, conflict repair, minimal preference imports and history. Pure and CLI tests use the same registry, reject packages that re-contribute promoted core methods, keep the missing-library branch only for a synthetic reduced runtime, and reject forged authority in operation arguments. The companion-only suite separately verifies actual package content and the pre-promotion fingerprint. |
| Node metadata and inventory | Pure cases cover legacy-shaped package IDs, absent versus saved definitions, optional text Inventory ID versus selected GUID validation, report/TM7/VSDX labels, icon allowlist and retained findings. Browser cases verify non-mutating selection, explicit metadata application, inventory edit/history/export, configured required-value checks and endpoint matching before first use. Actual 13-type companion content is verified separately by `test:libraries:internal`. |
| AI design guidance | `tests/authentication/ai-design-guidance.test.mjs` covers strict optional fields, saved-first/clear, exact no-policy mutation, endpoint-only scope, 177 populated compact types, overflow, native/history/embedded/Yjs portability and synthetic API prompt separation. Browser-union cases cover Properties/catalog editing, Cancel/no-op/Undo/Redo, inert text, recovery and narrow keyboard flow. The synthetic Assistant production suite checks both real request contexts and accepted issue/work-item provenance; no live AI or source-URL fetch is used. Human understanding of type-wide scope and unverified provenance still requires participant evidence. |
| Public Power Platform/Dynamics catalog | `tests/authentication/public-power-platform.test.mjs` checks the five neutral core identities, 27 scoped guidance records, product variants, saved-first/missing-library behavior and real Designer/reviewer projections using the exact Power Pages/Copilot/Dataverse request. The browser union adds an atomic StoreProvider design/Undo/Redo/New/Open case; the production Assistant suite captures the actual request and applies only a synthetic PowerPages/CopilotStudio/Dataverse response, then checks persistence and review context. The internal library suite separately verifies three explicit private overlays and unchanged private fields; no live model-selection quality is claimed. |
| DFD role/scope | `dfd-contracts.mjs` exercises independent roles, per-scenario reasons, field-only clearing and exceptional imported-evidence recovery, sequential typing/deletion and same-focus selected replacement through app Undo/Redo, editor-context preservation without reselection, gesture/target/scenario boundaries, full-document/geometry invariants, duplicate isolation, native save/reopen, autosave, keyboard and narrow presentation. Its isolated real StoreProvider cases use StrictMode for same-turn queued size/scope writes, inverse-order serial controls, multiple queued mutations, same-target view echoes, ordinary compound grouping, history branching/cap, Open/New, target removal, queued-filter autosave/reload and profile-backed history, authoring defaults/enabled choices and storage failures. These synthetic cases are not participant retests, live remote-provider proof or proof of the reported clipping being resolved; registered coverage is not evidence of execution on a particular candidate. The pure `tests/authentication/dfd-semantics.test.mjs` covers all 25 endpoint pairs in both directions, legacy-before-hydration, bounded recovery, snapshots, report/HTML/history, unchanged deterministic findings and atomic-map synthetic Yjs convergence. The separately configured Assistant production suite captures the actual scoped POST with synthetic responses; no live inference is performed. |
| Boundary/evidence taxonomy | Core and selected-library cases retain historical labels, descriptions, IDs and resolved deviations while limiting new boundary/default-policy/evidence choices to the installed catalog. Native export/reopen, Undo, autosave, reports and synthetic Yjs/CLI writes are covered. Classification defaults and profile preferences are not changed. |
| Saved-catalog cases in `test:browser` | Saved-first labels, document-only metadata/conflict disclosure, profile isolation, native/history/recovery preservation, 320px disclosure layout, atomic invalid import and non-overwriting corrupt-snapshot recovery. The production standalone case also exercises taxonomy snapshots and script-closing text. |
| Classification Library foundation cases in `test:browser` | Twelve shared types with public Purview guidance, unchanged original IDs/default/presentation, new Administrator Data/Customer Data authoring, native/history/reload preservation, alternate-profile defaults and enabled choices, saved/inactive value preservation, no implicit list union, New/Open/reload profile isolation, safe corrupt-profile fallback, 320px status layout, and recognized PMEXP mapping/Undo with an alternate list. |
| Classification editor cases in `test:browser` | CRUD/default protection, referenced/history delete guards, saved-meaning pinning, explicit diagram resolution, reloadable library history, Merge/Replace preview and export, atomic quota/stale-draft failure, raw-backup/guarded corrupt-profile repair, invalid/cancelled asynchronous import, and 320px focus/Escape/shortcut behavior. |
| PMEXP import cases in core and configured suites | Renamed File command, `.pmexp` filter and simulated picker cancellation, both JSON envelopes, invalid/empty diagnostics, unique versus ambiguous inventory matching, create/map/ignore and bulk decisions, preserved samples/retention/scenario edges, repeated-import deduplication, one-step Undo/Redo, native/recovery persistence, and labeled keyboard-trapped mapping at 320px/desktop. Source provenance is retained; no acquisition service is called. |
| Scenario/DFD JSON import cases in core and configured suites | Import JSON format naming/schema guidance, keyboard command and simulated confirmation/picker cancellation, rejection of invalid/native/inventory JSON without mutation, GUID-based joins, distinct same-label nodes, relative boundary coordinates, split/directional flow ordering, skipped-record summaries, stable reimport, single-step replacement Undo/Redo, native save/reopen and reload. No portal or acquisition skill is used; native Open remains separate. |
| Service configuration | Pure contracts validate absent/invalid addresses, independent capabilities, local guards, standalone sharing prerequisites and rejected-value non-disclosure. Core browser checks show local disabled status in About/Assistant. The production matrix below checks real built startup before room persistence and synthetic configured service requests. |
| Guidance and provenance | Core/configured cases verify identical deprecated-auth findings with optional package-sourced remediation, Undo/Redo, keyboard-readable BSD template notice at 320px, and VSDX downloads with attribution and regenerated properties. Pure tests verify template byte identity, package relationship integrity and retained unavailable-policy evidence. Automation does not certify Visio desktop rendering or asset redistribution approval. |
| Authentication cases in `test:browser` | Two-field library authoring, stable IDs, visible description, profile New/Open/reload/offline persistence, native full model/view/definition round-trip, library Undo/Redo, strict import/preview/conflict resolution, disabled/unresolved/legacy values, target policy/filter/canvas indicators, safe deletion/reset, node-catalog dependencies, 320px keyboard/focus, storage-failure/stale-tab atomicity, and browser-local Yjs peers with concurrent fields, no-op reconciliation, deletion and encoded-state reconnect. Compatibility cases distinguish neutral current-build information from definition warnings, verify whole-diagram method/flow/policy inventory and live refresh, and cover long/many items at 320px in both themes with disclosure and resolution focus return. |

After `npm run build`, `npm run test:authentication:production` separately opens
the fresh single-file production output in isolated Edge, checks the displayed
version, exports a model with authentication definitions and reopens the
embedded HTML. HTTP/WebSocket traffic is blocked; it starts no server or cloud
service. Its console/test result is separate evidence; it does not rewrite the
Vite harness's `productionBuildBehavior: not-run` field. Neither suite certifies
human usability or live mixed-version collaboration.
`tests/authentication/issue-reconciliation.test.mjs` separately covers explicit
runtime rule coverage, missing/unspecified policies, partial directional/scenario
coverage, unverified identity semantics, rule restoration, zero-findings success,
safe normalization and synthetic Yjs propagation/marker removal. Geo/retention
catalog extraction remains deferred: raw unknown-setting guards are not a claim
that those IDs survive the current strict schema.
The synthetic peer case uses the application's already-loaded Yjs module and
real browser reconciliation functions, but no Web PubSub provider, room key or
room IndexedDB persistence. File > New confirmation is an exact-message test
double for the synthetic fixture; native-dialog experience remains a manual check.

Edges intentionally stays on its tab when selection changes; the pin/follow
case uses Issues to test ordinary unpinned selection behavior. Assertions use
accessible controls and wait for specific observable state transitions rather
than arbitrary sleeps, forced clicks, or hidden legacy controls.

Assistant layout cases append ten synthetic finding cards to the real mounted
AI Analysis panel without enabling AI or changing request guards. They check
wheel scrolling, Tab reachability of the last action, hidden-tab subtree/scroll
preservation, content-sized short results, and Chat composer reachability at
1366x900, 1366x600, 768x700, 320x900 and 320x640 in both themes. Roomy panels keep
mode/context headers and the composer fixed. Panels with at most 440px of
content height use a single focusable Assistant scroller, retaining the
inspector title/tabs instead of collapsing the results or conversation.
The cases drag the native textarea resize handle and check its vertical-only
growth, bounds and reachability. Separate bottom-sheet checks exercise
keyboard Expand/Restore, findings retention, viewport bounds, canvas zoom
clearance and focus recovery when the toggle disappears on desktop.
This is layout coverage, not inference, finding-action execution, or React
result-state coverage. The narrow cases remain required, not skipped or
treated as expected passes.

Theme cases verify a fresh profile starts in light mode, explicit dark/light
choices survive reloads, resetting preferences restores light mode, and missing
or malformed saved theme preferences fall back to light without changing the
preference namespace.

For Assistant selection/navigation behavior, first build with an explicit
`VITE_DESIGN_ASSISTANT_ENDPOINT=/api/design-assistant` and no service-file
selection, then run `npm run test:assistant:production`. A plain build has no
Assistant service and is not the input for this configured-response suite.
Restore the intended final artifact configuration afterward.
The `production review:` cases exercise floating and separate-window review,
pointer/keyboard resizing, re-docking and popup blocking, retained reading
position/draft/caret, pending responses and document replacement, and real
`.xlsx` downloads including filtered-out saved issues. Popup pages share the
same request interception and runtime-error checks; no live service is used.
`test:ai:local` also checks the provider-heavy review at 900x600 and 320x480,
including readable floating content and access to the last finding.
The suite opens the normal built frontend in isolated
Edge, fulfilling every asset request from `dist` and only the exact Assistant
POST from a synthetic response. No server, Function host, live inference or
external request is used; the credential-free Vite harness's API-blocking
policy is unchanged. It compares issue navigation with real Assistant finding
buttons, checks node/flow/boundary selection and canvas focus, scenario changes,
keyboard activation, pinned/unpinned inspector behavior, selected-card feedback,
detached/deleted/missing references, valid issue creation and Chat preservation.
This covers UI consumption of synthetic AI output, not the inference service.

The export case explicitly disables the native OS save picker to exercise the
supported download fallback. Native picker acceptance/cancellation remains a
manual check. Viewport reflow is **not** an actual 400% browser-zoom test.
No automated claim is made about screen-reader experience, contrast compliance,
all WCAG requirements, every model operation/importer, deployed collaboration,
AI/API behavior, production/single-file runtime behavior, or real users' ease
of use. Add a focused case when changing an uncovered behavior.

The separate `npm run test:assistant:production` suite also checks the
scenario-required notice after importing a saved Show all view, an unavailable
saved scenario ID, or a model without scenarios. It verifies that choosing a
valid scenario enables Chat/AI Analysis and removes the notice without silently
changing the imported view. All Assistant responses are synthetic; no model
content is sent to a live service.

## Evidence and readiness

For service-configuration changes, build each matrix row with the listed
process environment and run
`node --test tests/browser/service-configuration-production.test.mjs` with
`SDS_SERVICE_TEST_MODE` set to its mode. Do not run alongside other browser
suites. These tests serve built assets by interception; they start no server
or API and never contact configured services.

| Mode | `VITE_COLLAB_TOKEN_ENDPOINT` | `VITE_COLLAB_APP_URL` | `VITE_DESIGN_ASSISTANT_ENDPOINT` |
|---|---|---|---|
| `disabled` | Explicit empty string | Explicit empty string | Explicit empty string |
| `invalid` | `https://services.example.invalid/api?key=SYNTHETIC_REJECTED_MARKER` | `https://diagram.example.invalid/app/` | `https://services.example.invalid/api#SYNTHETIC_REJECTED_MARKER` |
| `configured` | `https://services.example.invalid/api/collab-token` | `https://diagram.example.invalid/app/` | `https://services.example.invalid/api/design-assistant` |
| `defaults` | Unset | Unset | Unset |

For file-selection cases, unset all three endpoint overrides:

| Mode | `SDS_SERVICE_CONFIG` |
|---|---|
| `profile` | `examples\service-configuration\example.json` (synthetic configured services) |
| `missing` | A nonexistent local JSON filename |
| `conflict` | The example file, plus an explicit empty `VITE_COLLAB_TOKEN_ENDPOINT` override |
| `selected` | A reviewed file with collaboration configured, hosted Assistant configured, standalone Assistant empty; disclosure only, no requests |

The `defaults` row must also unset `SDS_SERVICE_CONFIG`; it now proves both
services are disabled in both formats, including inert room fragments.
`disabled` explicitly supplies empty endpoint strings with no file. Invalid
environment/file settings fail closed with no fallback. The fixture file is
generic; actual private destinations are checked only in the companion tests.

Use a process launcher that preserves explicitly empty environment entries
(for example Node `spawn` with an `env` object); older PowerShell versions
remove empty variables instead. Each row requires a fresh full build of both
formats. Restore the intended artifact configuration afterward.
The configured row verifies synthetic Assistant POST/context and token-request
failure reporting without a key in the token URL. It does not certify a live
Web PubSub connection or a deployment. Verify `service-build.json` against the
selected configuration and output files after each build. Include a plain build
with Custom Libraries selected to prove library selection cannot enable services.

`results.json` records each exercised case as passed/failed (startup can be
blocked), timestamps, faults, measurements, source commit, working-tree digest,
dirty state, app version, and browser identity. `server.log` records startup
diagnostics; failed cases get a screenshot when possible. A screenshot failure
is recorded, not hidden. Cases are registered before context setup and pass
only after successful cleanup; setup, context/browser/server cleanup, and late
runtime failures cannot produce a passing report. Native round-trip validation
clears the displayed model before reopening and compares the complete restored
model/view, so a no-op import cannot pass from an already populated canvas.
The source digest combines the committed SHA with
tracked diff and nonignored untracked files; it does not fingerprint ignored
local configuration. Do not change source while a run is active: that
invalidates its evidence and fails the run.

Keep the terminal output too: it identifies selection/skips and setup failures
that occur before evidence can be created. Filtered runs prove only the named
suite. Within a failed case, later assertions were **not run**. A responsive
failure at one width does not suppress tests at the other widths.

- A nonzero exit blocks the corresponding application-readiness gate. Never
  skip, weaken, or mark a failing assertion as passing to make the suite green.
- Distinguish a test defect, a baseline application issue, an introduced
  regression, and an environment blocker. Use source and reproduction evidence.
- For a confirmed pre-existing defect, keep the failing gate visible and link
  its separate fix PR when requested; do not silently expand a testing-only PR.
- Browser passes mean the covered contracts passed, not that the entire
  application or usability is certified.
- `humanUsability` and `productionBuildBehavior` remain `not-run` in automated
  evidence. Record separate human/production results without rewriting the
  automated report to claim it performed them.

## Local pull request validation

*Updated: 2026-09-15 - Replaced remote execution requirements with local evidence.*

Follow the [contributor checklist](../../docs/contributing.md) to select
the required suites for the changed surfaces. Run the
standalone commands above from an isolated worktree; a browser-harness change
requires `test:browser:unit` and the complete `test:browser` union once.
Do not start competing suites, reuse an occupied port, or download a browser
as an implicit repair.

Attach the command/exit code, source and actual target identities, and
synthetic JSON/logs/failure screenshots to the PR or session artifacts.
Browser failures block the corresponding local readiness gate and require
correction and revalidation; do not add expected-failure exceptions. Source
or target changes invalidate affected evidence. Maintainers review current
results before merging; a local pass is not an enforced GitHub status.
Neither automated checks nor maintainer review perform the human protocol below.

## Human usability protocol

Run this separately for a new workflow or a material navigation, layout,
terminology, or destructive-action change. A build or automation agent cannot
act as representative users and declare human usability complete.

1. Agree on the target users, representative participants, changed tasks,
   release-blocking outcomes, and any time/ease targets **before** the session.
   Do not invent universal task-time thresholds or claim that a convenience
   sample proves usability for everyone.
2. Use a fresh profile and synthetic model only. Obtain consent for recordings;
   otherwise retain anonymized notes. Record participant role/experience and
   input/assistive technology without unnecessary identifying information.
3. Give the participant the goal, not the menu/button sequence. Observe without
   coaching; record every hint or intervention as assistance.
4. Run the applicable tasks below. Record completion, errors, time, assistance,
   navigation backtracks, participant explanations, and a 1-7 ease rating.
5. Separate observations from hypotheses. Reproduce reported defects, classify
   severity/impact, and agree on fixes/retests with the owner. A critical task
   blocked or model data lost is a release blocker, not a cosmetic concern.
6. Recheck the changed tasks after fixes. Report absent participants, untested
   input modes, or incomplete tasks as not-run/blocked, not passed.

| Participant goal | Observable outcome |
|---|---|
| Open a model and explain a scenario's flow order | Correct scenario selected; hidden members understood; graph and sequence communicate the same directed flow/order. |
| Find and temporarily isolate one process | Filter is discovered; staged versus active state is understood; cancellation and Clear all recover the complete scenario. |
| Change a process and recover a mistake | Properties is found; edit is reflected on canvas; Undo/Redo and reload preserve the intended state. |
| Review findings while navigating the model | Inspector tabs, pinning, close/reopen and selection context are understood without losing work. |
| Save a portable model and recover from cancellation | File/Save as is discoverable; name/extension are understood; native picker cancellation returns usable focus; reopening retains expected data. |
| Delete or replace a scenario without unintended loss | Impact copy is understood; Cancel is safe; shared members/custom numbering remain correct after an approved synthetic deletion. |

Include keyboard-only navigation, visible focus, Escape/topmost-surface
behavior, modal focus trapping, browser zoom at 200% and 400%, short-height
layouts, and a screen-reader pass for the changed workflow. These are separate
from automated narrow-viewport tests. Test the same high-risk flow in both
light and dark themes when color/state presentation changes.

Use this evidence shape in the PR or session artifacts:

| Task / input mode | Participant role | Completed unassisted? | Errors / hints | Time / ease | Observed issue | Severity | Retest |
|---|---|---|---|---|---|---|---|

The owner decides human-usability readiness against the agreed outcomes.
Explicitly report `not-run` until actual participant evidence exists.
