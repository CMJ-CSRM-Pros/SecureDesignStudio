# SecureDesignStudio architecture and design

*Updated: 2026-11-09 - Reviewed runtime modes, state ownership and recovery against the current implementation.*

This page explains how SecureDesignStudio (SDS) is built. It is meant for
contributors, maintainers, deployers and reviewers who need to understand the
application before changing, hosting or assessing it. For what people do with
the app, see [use cases](use-cases.md). For step-by-step instructions, see the
[user guide](user-guide.md).

This is a design description, not a feature contract. When this page and a
feature contract (for example the [Authentication Library](authentication-library.md)
or [Custom Libraries](custom-libraries.md)) disagree, the contract and the
source are authoritative. For trust boundaries and residual risks, see the
[threat model of SDS itself](tool-threat-model.md). Report vulnerabilities through
[SECURITY.md](../SECURITY.md), not through issues.

The diagrams use Mermaid, which GitHub renders in place.

## 1. Goals and constraints

| Goal or constraint | What it means for the design |
|---|---|
| **Local first** | Modeling, analysis, autosave and file operations run entirely in the browser. Normal local mode has no application backend and needs no cloud credentials. |
| **Offline after first load** | Once dependencies are installed and the page has loaded, editing, Analyze, autosave and local files keep working without a network. |
| **Opt-in services that fail closed** | Collaboration, the Design Assistant and Azure DevOps (ADO) submission are off unless a build or launcher explicitly configures them. Invalid configuration disables the service instead of falling back to a default. |
| **Durable, portable models** | The native `.tma` file is the editable source of truth. Saved definitions travel with the model so it reopens with the same meaning on another machine or build. |
| **Backward compatibility** | Supported older native files, legacy format names and unfamiliar catalog identifiers remain readable. Existing valid IDs are preserved on open and save. |
| **One-step Undo for compound model edits** | Imports, scenario deletion and AI-applied designs are grouped into single undoable changes. View changes and external writes are not model Undo operations. |
| **Bounded claims** | The app records design intent and review decisions. It does not inspect deployments, enforce boundaries or certify security or privacy compliance. User-facing text avoids implying otherwise. |

## 2. System context

```mermaid
flowchart LR
  author([Design author<br/>engineer or service owner])
  reviewer([Security or privacy reviewer])
  deployer([Deployer or library maintainer])
  recipient([Report or export recipient])

  sds[SecureDesignStudio<br/>single-page app in Edge or Chrome]

  storage[(Browser storage<br/>localStorage and IndexedDB)]
  files[(Local files<br/>.tma .tm7 .json .pmexp)]
  pubsub[Azure Web PubSub<br/>optional]
  ai[AI provider<br/>Azure OpenAI, Claude CLI or Codex CLI<br/>optional]
  ado[Azure DevOps Boards<br/>optional]
  tools[Threat Modeling Tool, Visio,<br/>Excel, web browser]

  author --> sds
  reviewer --> sds
  deployer -- build-time configuration<br/>and Custom Libraries --> sds
  sds <--> storage
  sds <--> files
  sds <-. encrypted Yjs updates .-> pubsub
  sds -. scenario context or design request .-> ai
  sds -. accepted work items .-> ado
  sds -- TM7, VSDX, HTML, XLSX, PNG --> tools
  tools --> recipient
```

Dotted arrows are optional integrations. None is contacted in normal local
mode.

## 3. Runtime modes (containers)

SDS is a React single-page app built with Vite. The same source produces
several runtime shapes. The mode is decided at **build or launch time** through
Vite `define` constants in [`vite.config.ts`](../vite.config.ts); a model file,
profile preference or URL cannot change it.

| Mode | Started by | Backend pieces | Services available |
|---|---|---|---|
| Local | `npm run dev` or `Start-SecureDesignStudio.ps1` | Vite dev server on `http://localhost:5173` only (`strictPort`) | None |
| Local AI with Claude or Codex | `npm run dev:ai:local` after provider setup, or the AI launcher with that provider | Vite plus a local `/api/design-assistant` bridge ([`scripts/local-ai-vite.mjs`](../scripts/local-ai-vite.mjs)); CLIs run through [`localProviders.ts`](../api/design-assistant/localProviders.ts) | Design Assistant only |
| Local AI with Azure | `npm run dev:ai` or the AI launcher with Azure selected | Vite proxies `/api/design-assistant` to local Azure Functions on port 7071; Functions calls the selected Azure deployment | Design Assistant only |
| Local ADO | `npm run dev:ado` with an explicitly configured SPA registration | Vite plus a localhost ADO relay ([`scripts/local-ado-vite.mjs`](../scripts/local-ado-vite.mjs)) | ADO submission only |
| Hosted | `npm run build` (`dist/`) deployed as an Azure Static Web App with [`api/`](../api) Functions | `collab-token`, `design-assistant`, `ado-work-items` Functions | Whatever the selected service configuration enables |
| Standalone | `npm run build` (`dist-single/index.html`) | None; one self-contained HTML file, which can also embed a model | Explicitly configured collaboration and Assistant endpoints may use the network; collaboration also requires a hosted share destination |

The [advanced configuration runtime table](advanced-configuration.md#runtime-modes)
lists the launcher equivalents and setup requirements. The root launchers
support Windows, macOS and Linux; the npm scripts remain available directly.

```mermaid
flowchart TB
  subgraph Browser
    spa[SDS single-page app]
  end
  subgraph Local machine
    vite[Vite dev server :5173]
    bridge[Local AI bridge]
    relay[Local ADO relay]
    cli[claude or codex CLI]
  end
  subgraph Azure [Azure, hosted mode only]
    swa[Static Web App]
    fcollab[collab-token Function]
    fda[design-assistant Function]
    fado[ado-work-items Function]
    wps[Web PubSub]
    aoai[Azure OpenAI]
  end
  vite --> spa
  spa -. AI mode .-> bridge --> cli
  spa -. ADO mode .-> relay
  swa --> spa
  spa -. token .-> fcollab --> wps
  spa <-. ciphertext .-> wps
  spa -. signed-in users only .-> fda --> aoai
  spa -. same-origin with user ADO token .-> fado
```

Service resolution lives in [`src/serviceConfiguration.ts`](../src/serviceConfiguration.ts)
and [`src/services.ts`](../src/services.ts). Local serving refuses endpoint
overrides outright. Builds read an explicit service file or environment
variables through [`scripts/service-configuration.mjs`](../scripts/service-configuration.mjs),
which also writes a `service-build.json` receipt. **About** shows the
effective configuration. The [advanced configuration](advanced-configuration.md)
page documents each variable.

## 4. Components

```mermaid
flowchart TB
  main[main.tsx<br/>capture pristine HTML, bootstrap libraries,<br/>AppErrorBoundary]
  lib[LibraryProvider<br/>libraries/]
  app[App.tsx shell]
  store[StoreProvider<br/>store.tsx]
  ui[UiShellProvider<br/>uiShell.tsx]
  views[Views<br/>DiagramCanvas, SequenceDiagramView,<br/>Toolbar, SidePanel inspector]
  domain[Domain logic<br/>types, policy, IssueManager,<br/>dfdSemantics, dataPropagation, diff]
  io[Format adapters<br/>tm7Import/Export, tmcImport,<br/>privacyManagerImport, vsdxExport,<br/>reportExport, findingsExport, adoExport]
  persist[Persistence<br/>autosave, embeddedDoc, documentFormat]
  collab[Collaboration<br/>collab/ Yjs + Web PubSub + AES-GCM]
  assist[Design Assistant<br/>designAssistant, threatModelDesigner,<br/>aiProvider, breachSimulation]
  shared[shared/ contracts<br/>used by browser and API]

  main --> lib --> app --> store & ui
  app --> views
  views --> store
  store --> domain & io & persist & collab
  views --> assist --> shared
  io --> domain
```

| Layer | Responsibility | Main sources |
|---|---|---|
| Bootstrap | Captures the parsed HTML for standalone export before React mounts, loads build-selected Custom Libraries, mounts the app in `StrictMode` inside an error boundary. | [`main.tsx`](../src/main.tsx), [`libraries/bootstrap.ts`](../src/libraries/bootstrap.ts), [`AppErrorBoundary.tsx`](../src/components/AppErrorBoundary.tsx) |
| Shell and UI state | Layout, theme, inspector placement, autosave interval and other per-browser presentation settings. | [`App.tsx`](../src/App.tsx), [`uiShell.tsx`](../src/uiShell.tsx) |
| Store | Owns the working document, selection, filters, active scenario and Undo/Redo history; coordinates profile libraries, collaboration and document mutations. | [`store.tsx`](../src/store.tsx) |
| Views | React components that read from the store and call its operations. Graph editing uses `@xyflow/react`; the sequence view renders the same scenario as a call timeline. Switching views never changes the document. | [`components/`](../src/components) |
| Domain logic | Pure functions and classes: model types and catalog lookups, node policy, deterministic analysis, DFD role and scope resolution, data propagation and semantic diff. | [`types.ts`](../src/types.ts), [`policy.ts`](../src/policy.ts), [`IssueManager.ts`](../src/IssueManager.ts), [`dfdSemantics.ts`](../src/dfdSemantics.ts), [`dataPropagation.ts`](../src/dataPropagation.ts), [`diff.ts`](../src/diff.ts) |
| Libraries and catalogs | Shipped JSON catalogs plus profile-editable Authentication, Classification and Communication libraries, and build-selected Custom Libraries. | [`src/data/`](../src/data), [`authentication.ts`](../src/authentication.ts), [`classificationLibrary.ts`](../src/classificationLibrary.ts), [`protocols.ts`](../src/protocols.ts), [`libraries/`](../src/libraries) |
| Format adapters | Convert between the native model and external formats. Each adapter documents what it maps and what it drops. | See [section 8](#8-import-and-export-adapters) |
| Persistence | Browser autosave, native file wrapper, and standalone HTML self-embedding. | [`autosave.ts`](../src/autosave.ts), [`documentFormat.ts`](../src/documentFormat.ts), [`embeddedDoc.ts`](../src/embeddedDoc.ts) |
| Collaboration | Mirrors the document into a Yjs document, encrypts updates with a room key, and relays them through Web PubSub. | [`collab/`](../src/collab), [`api/collab-token`](../api/collab-token) |
| Design Assistant | Builds a bounded, scenario-scoped request; validates responses against strict schemas; applies AI designs as one undoable change; animates an attack path built from connected flows near the top AI finding. | [`designAssistant.ts`](../src/designAssistant.ts), [`threatModelDesigner.ts`](../src/threatModelDesigner.ts), [`breachSimulation.tsx`](../src/breachSimulation.tsx), [`api/design-assistant`](../api/design-assistant), [`shared/`](../shared) |
| Work submission | Local work-item queue, CSV and Excel templates, and explicit ADO submission with a durable browser journal that blocks unsafe retries, including ambiguous creation results. It is not a cross-browser duplicate guarantee. | [`workItems.ts`](../src/workItems.ts), [`workSubmission.ts`](../src/workSubmission.ts), [`adoClient.ts`](../src/adoClient.ts), [`adoExport.ts`](../src/adoExport.ts), [`shared/adoContract.ts`](../shared/adoContract.ts), [`api/ado-work-items`](../api/ado-work-items) |

## 5. Data model

The whole model is one serializable `PsDocument` ([`src/types.ts`](../src/types.ts)).
Nodes, flows (edges) and boundaries are **shared**: there is one copy of each,
and scenarios reference them. Everything that differs per workflow lives on
the scenario.

```mermaid
erDiagram
  PsDocument ||--o{ PsNode : nodes
  PsDocument ||--o{ PsEdge : edges
  PsDocument ||--o{ PsBoundary : boundaries
  PsDocument ||--o{ PsTextAnnotation : textAnnotations
  PsDocument ||--o{ Scenario : scenarios
  PsDocument ||--o{ PsData : data
  PsDocument ||--o{ PsComment : comments
  PsDocument ||--o{ PsIssue : issues
  PsDocument ||--o{ PsDeviation : deviations
  PsDocument ||--o{ PsWorkItem : workItems
  PsDocument ||--o{ NodeTypeRef : nodeTypes
  PsDocument ||--o{ SavedDefinition : "authentication, protocol and catalog definitions"
  PsEdge }o--|| PsNode : source
  PsEdge }o--|| PsNode : target
  PsBoundary }o--o{ PsNode : nodeIds
  PsNode }o--|| NodeTypeRef : type
  Scenario }o--o{ PsNode : nodeIds
  Scenario }o--o{ PsEdge : "edgeIds and edgeNumbers"
  Scenario }o--o{ PsBoundary : boundaryIds
  Scenario ||--o{ PsData : "request, response and node data"
  PsComment }o--|| Scenario : scenarioId
  PsIssue }o--o{ Scenario : scenarioIds
```

| Entity | Scope | Key design points |
|---|---|---|
| `PsNode` | Shared | A service, process, data store or external dependency. Its `type` references a node-type definition that supplies policy (allowed authentication and data), icon, default DFD role and privacy defaults. Instance values can override deferred type values. |
| `PsEdge` | Shared | A directed source-to-target call. Holds authentication method, caller Application ID, audience, communication profile, required access rights and waypoints. Missing values mean *unspecified*, never *none*. |
| `PsBoundary` | Shared | A security or privacy rectangle with a subtype and optional network-intent notes. Membership is the `nodeIds` it contains; boundaries can overlap. Boundaries describe intent and do not enforce isolation. |
| `Scenario` | Per workflow | Membership lists, call order (`edgeIds` and `edgeNumbers`), DFD scope reasons, and data attachments. Request data is checked against the target's policy; response data against the source's. |
| `PsData` | Shared catalog | A reusable data item with a classification and an optional synthetic sample. |
| `PsComment` | One scenario | Discussion on a node or edge in one scenario, with replies and Active or Resolved status. |
| `PsIssue` | Several scenarios | A finding on a node or edge. Analyzer issues carry a rule `kind`; manual issues and authored threat notes do not, so Analyze never touches them. |
| `PsDeviation` | Document | An evidence-backed exception with a stable `key` so repeated evidence reviews update rather than duplicate it. |
| `PsWorkItem` | Document | A follow-up record with a review decision, classification and optional external submission receipt. |
| Saved definitions | Document | Copies of the authentication, communication-profile and catalog definitions the model references, so meaning survives on builds or profiles that lack them. |

The native `.tma` file wraps the document as
`{ format: "secure-design-studio-diagram", version: 2, doc, view }`, where
`view` holds the active scenario and filter. The legacy `privsec-diagram`
format name is still accepted. See [model compatibility](model-compatibility.md)
and [catalog snapshots](catalog-snapshots.md) for the identifier and
saved-definition rules.

## 6. State, history and persistence

- **Single store.** `StoreProvider` keeps the document and its history in one
  immutable state cell. A ref applies transitions in action order before
  publishing React render snapshots, so batched renders do not lose queued
  edits. Typed operations (`createNode`, `attachDataToEdge`, `analyze`,
  `importJson` and so on) own mutations; components do not mutate the document
  directly.
- **Snapshot-based Undo.** A mutating operation records the previous full
  document before it changes anything. Compound operations (imports, scenario
  deletion, AI-applied designs, Analyze) compute the new document first and
  apply it once, so they are one Undo step. History holds up to 100 entries.
- **One normalization gate.** Every document from outside the store (native
  open, JSON import, autosave recovery, embedded standalone HTML and
  collaboration peers) passes through `normalizeDoc` in
  [`store.tsx`](../src/store.tsx). It validates shapes, keeps unfamiliar but
  valid identifiers, and rejects or repairs malformed values without
  regenerating valid IDs. Text and numeric checks default malformed values
  in the fields they cover; strict collections reject invalid input before
  replacing the working document. These checks are not a guarantee that every
  possible rendering failure has been eliminated.
- **Render failure recovery.** If rendering still fails, `AppErrorBoundary`
  replaces the blank page with a recovery screen: reload, download the
  autosave, or discard it after confirmation. A damaged autosave would
  otherwise crash every reload. The screen never shows the error text, and the
  boundary does not log it, because either can contain model content.
- **Autosave.** The document, Undo/Redo stacks and view are written to
  `localStorage` (`secure-design-studio:autosave:v1`) on a debounce the user
  can set (0.5 to 15 seconds). Persistence starts with at most 25 entries in
  each history stack, then retries with 10, 5 and 0 if saving fails. Unavailable
  or full browser storage can prevent recovery; autosave is not a backup.
- **Profile libraries.** Authentication, Classification and Communication
  libraries, the AI provider choice and ADO configuration are per-browser
  profile settings in separate `localStorage` keys. They supply authoring
  choices and never silently rewrite an open model.
- **Native files.** Save uses the browser's file-save picker where available
  and falls back to a download.

## 7. Key runtime flows

### Edit, Undo and autosave

```mermaid
sequenceDiagram
  actor User
  participant View as Canvas or inspector
  participant Store as StoreProvider
  participant LS as localStorage
  User->>View: Edit a flow's authentication
  View->>Store: updateEdge(id, patch)
  Store->>Store: push previous doc to past, clear future
  Store->>Store: setDoc(next)
  Store-->>View: re-render
  Note over Store,LS: after the autosave interval
  Store->>LS: save doc, past, future, view
  User->>View: Undo
  View->>Store: undo()
  Store->>Store: move current doc to future, restore last past entry
```

### Analyze

```mermaid
sequenceDiagram
  actor Reviewer
  participant Store as StoreProvider
  participant IM as IssueManager
  participant Pol as policy.ts
  Reviewer->>Store: Review > Analyze
  Store->>IM: analyze(doc, catalogs, enabled and library rules)
  IM->>IM: propagate edge data onto nodes per scenario
  IM->>Pol: check auth and data against node-type policy
  IM->>IM: build expected issues per (kind, target)
  IM->>IM: reconcile with existing typed issues
  IM-->>Store: new doc
  Store->>Store: one snapshot, setDoc, open Issues
```

### Collaboration

```mermaid
sequenceDiagram
  participant A as Peer A browser
  participant Tok as collab-token Function
  participant WPS as Web PubSub group
  participant B as Peer B browser
  A->>A: generate room ID and 32-byte key in URL fragment
  A->>Tok: request token for room (no key sent)
  Tok-->>A: short-lived token for one group
  A->>WPS: AES-GCM encrypted Yjs updates
  WPS->>B: ciphertext only
  B->>B: decrypt, rebuild doc from Yjs, normalizeDoc, render
```

### Design Assistant request

```mermaid
sequenceDiagram
  actor User
  participant Panel as Design Assistant panel
  participant API as design-assistant endpoint
  participant LLM as Selected AI provider
  User->>Panel: Ask, AI Analysis or Design with AI
  Panel->>Panel: build scenario context or initial design request, enforce size budget
  Panel->>API: POST mode, question, context
  API->>API: validate request, wrap context as untrusted data
  API->>LLM: system prompt + bounded context
  LLM-->>API: JSON answer
  API->>API: validate against strict schema and allowed references
  API-->>Panel: findings, answer or design
  Panel-->>User: suggestions for human review
  User->>Panel: Accept a finding or design
  Panel->>Panel: create issue or work item, or apply design as one Undo step
```

## 8. Import and export adapters

| Adapter | Direction | Notes |
|---|---|---|
| Native `.tma` | Open, save | Editable source of truth; preserves the supported document and view. |
| Node catalog JSON | Import, export | Portable document-local node-type definitions, not a complete model. |
| Microsoft Threat Modeling Tool `.tm7` | Import, export | Each TMT tab maps to a scenario. Elements are deduplicated by TMT GUID. XML with a `DOCTYPE` or entity declaration is rejected before parsing. Lossy; see [TM7 compatibility](tm7-compatibility.md). |
| Scenario/DFD JSON (`scenarios`, `dfds`) | Import, replaces the model | IDs derive from source GUIDs so reimports stay stable. [`tmcImport.ts`](../src/tmcImport.ts). |
| Privacy Manager inventory `.pmexp` | Import, merges into an existing scenario | Map, create or ignore each inventory service; one Undo step. [`privacyManagerImport.ts`](../src/privacyManagerImport.ts). |
| Endpoint text | Import nodes | **Nodes from endpoints** matches URLs or request lines against node-type endpoint patterns. |
| Visio `.vsdx` | Export only | One page per scenario, built on an embedded BSD-3 template; see [third-party notices](third-party-notices.md). Not a Visio importer. |
| HTML review report | Export only | Escaped text, allow-listed links and a restrictive content security policy. |
| PNG diagram image | Export only | The current scenario's diagram. |
| Excel `.xlsx` workbook and ADO CSV | Export only | Text-only cells, no formulas or macros; long text split instead of truncated. |
| Standalone HTML | Export, open | The single-file app with the model embedded as JSON in which every `<` is escaped, so model text cannot end or alter the script block. A content security policy allows only the build's own inline scripts, pinned by hash. Open only trusted files, because opening one runs its code. |

## 9. Analysis engine

[`IssueManager`](../src/IssueManager.ts) is deterministic and local. It never
runs code from a model. Its rules are registered in `ANALYZER_RULES`:

| Rule | Finding kinds |
|---|---|
| Edge must carry data | `Edge_must_have_data` |
| Node retention recorded | `Node_retention_missing` |
| Single authentication method per flow | `Edge_multiple_auth_methods` |
| Authentication definition review | `Edge_authentication_definition_review` |
| Receiver accepts the authentication | `Edge_auth_not_accepted` |
| Receiver accepts the data | `Edge_data_not_accepted`, `Node_data_not_accepted` |
| Deferred instance values supplied | `Node_missing_deferred_geo`, `Node_missing_deferred_retention` |
| Caller identity | `Edge_missing_application_id`, `Edge_invalid_application_id`, `Edge_managed_identity_mismatch` |
| Communication profile guidance | `Edge_protocol_guidance_missing`, `Edge_protocol_definition_conflict` |

Custom Libraries can add declarative `required` or `guid` checks on their own
metadata fields; they cannot add code.

Reconciliation is what makes repeated reviews workable:

- A finding is identified by `(kind, targetKind, targetId)`. When it still
  triggers, its ID, status, replies and creation time are kept; title,
  description and scenarios are refreshed.
- A typed finding is removed only after its rule has **completely** evaluated
  the target, or when the target no longer exists.
- If a rule or required policy definition is unavailable, the finding is kept
  whole and labeled **Not re-evaluated**. It is not silently cleared.
- Untyped issues (manual issues and authored threat notes) are never changed.

AI Analysis is separate. It returns suggested findings with severities that
stay suggestions until a person creates an issue or work item from them.

## 10. Extensibility

| Mechanism | Who selects it | Where it lives | What it can change |
|---|---|---|---|
| Shipped catalogs | Source | [`src/data/`](../src/data) | Default node types, authentication methods, classifications, boundaries, protocols. |
| Profile libraries | Each user, per browser profile | `localStorage` | Authoring choices for authentication, classification and communication profiles. They never install services or rewrite models. |
| Node-type catalog | Model author | The document | Document-local node types; import and export as JSON. |
| Custom Libraries | Deployer, at build or dev-server start (`SDS_LIBRARY_PATHS`) | Declarative JSON packages | Catalog entries, metadata fields, declarative checks and help. At most 16 packages, 1 MiB each, 4 MiB total. A model, profile, room or URL cannot select a package, and packages cannot enable services or grant access. |

See [Custom Libraries](custom-libraries.md) for the package contract.

## 11. Cross-cutting concepts

- **All input is untrusted.** Model text renders as text. Links render only
  for `http`, `https` and `mailto` ([`urlSafety.ts`](../src/urlSafety.ts)).
  AI prompts mark model content as data, not instructions, and AI responses
  are schema-validated and may reference only elements that exist.
- **Unspecified is not negative.** A missing protocol, authentication method
  or retention value means *not recorded*. Neither the UI nor Analyze treats
  it as evidence of cleartext, no authentication or no storage.
- **Saved meaning wins over current catalogs.** When a model carries a saved
  definition, labels and semantics come from it first. Choosing a new value
  explicitly is undoable; viewing or saving never resolves it implicitly.
- **Hosted request checks.** The hosted Design Assistant route admits only
  signed-in Static Web App users and calls Azure OpenAI through
  `DefaultAzureCredential`, so no model key reaches the browser. The ADO relay
  requires a same-origin HTTPS request carrying the user's own ADO bearer
  token. The collaboration token route is anonymous and issues 60-minute
  tokens scoped to one room ([`staticwebapp.config.json`](../staticwebapp.config.json)).
- **Content security policy on production HTML surfaces.** The hosted app sends a
  content security policy that allows scripts only from its own origin and
  forbids framing, plus `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer` ([`staticwebapp.config.json`](../staticwebapp.config.json)).
  Standalone files carry a policy in a meta tag that pins each inline script
  by SHA-256 hash ([`single-file-build.mjs`](../scripts/single-file-build.mjs)),
  and the build fails if it cannot place that tag before the first script.
  Exported review reports allow no scripts or outside resources at all.
  The local Vite development page has no CSP; see the
  [tool threat model](tool-threat-model.md) for the remaining trust boundaries.
- **Explicit external effects.** Optional services require configuration.
  Opening a room link joins that configured room; sending an AI request and
  submitting to ADO are separate user actions. Normal local mode enables none
  of these services, and Undo cannot reverse an external write.
- **Accessibility and layout.** Controls are keyboard reachable with visible
  focus, and automated checks cover 320 to 1366 CSS-pixel widths in light and
  dark themes. Human usability and screen-reader passes are separate,
  manual gates.
- **Provenance.** Runtime dependency licenses, the Visio template notice and
  icon terms are tracked and shown under **About**.

## 12. Key design decisions

| Decision | Rationale | Consequences |
|---|---|---|
| Browser-only app with no required backend | Reviews often involve sensitive designs; local use needs no account, tenant or data egress. | Core modeling runs in the browser. Optional server-side services stay off by default. |
| Shared entities with per-scenario membership | A service appears in many workflows; renaming it once must update all of them. | Call order, data attachments, retention and comments live on scenarios. Deleting a scenario must not delete shared members still used elsewhere. |
| Full-document snapshots for Undo | Supports grouped Undo for compound model changes, including imports and AI designs. | Memory and autosave size grow with model size. In-memory history is capped at 100 entries per stack; autosave keeps at most 25 and retries with less if saving fails. |
| One `normalizeDoc` gate for every inbound document | Files, autosave and collaboration peers are equally untrusted, so they share model validation. | Define and check how each new field survives normalization and older readers. |
| Rule-keyed finding reconciliation | Reviewer status and replies must survive repeated Analyze runs. | Rule `kind` strings are a compatibility contract. Renaming one requires retirement handling, as done for the legacy production-identity kinds. |
| Saved definitions travel with the model | Models move between people, profiles and builds with different libraries. | Files are larger. Conflicts between saved and installed definitions are shown to the user, not auto-resolved. |
| Build-time service selection that fails closed | A model, link or preference must not be able to redirect data to a service. | Changing services requires a rebuild or relaunch. Invalid configuration disables the feature. |
| End-to-end encrypted collaboration with the key in the URL fragment | The relay should see only ciphertext. Browsers do not send fragments to servers. | Anyone with the link can read and edit. Peers are equal and edits are not attributed. |
| Repository-owned single-file inliner | Avoids a plugin dependency chain with unpatched transitive packages. | The project maintains [`scripts/single-file-build.mjs`](../scripts/single-file-build.mjs) and its tests. |

## 13. Quality and testing

Tests use Node's built-in test runner. Pure contracts live in
[`tests/authentication/`](../tests/authentication) (`npm run test:runtime`).
Browser suites drive an installed Edge or Chrome with `playwright-core`
against an owned Vite server, synthetic `.tma` fixtures and a network policy
that blocks all non-local traffic ([`tests/browser/README.md`](../tests/browser/README.md)).
[Contributing](contributing.md) maps each kind of change to the suites it
requires.

## 14. Known limits and maintenance hotspots

- `store.tsx` and `components/Toolbar.tsx` hold most operations and commands.
  Changes there affect many workflows; keep the matching browser suites close.
- Older builds can drop newer metadata when they write to a shared model or
  room. Use matching current builds for every collaboration peer and keep an
  editable `.tma` backup.
- External-format drawings and reports can omit model information. Native
  `.tma` and the model embedded in standalone HTML retain the editable document.
- The tool documents design intent. It does not discover services, inspect
  live configuration or replace a threat model of SDS itself.

## Related documentation

- [Use cases](use-cases.md) and the [user guide](user-guide.md)
- [Advanced configuration](advanced-configuration.md), including the source map
- [Custom Libraries](custom-libraries.md), [Authentication Library](authentication-library.md)
  and [Classification Library](classification-library.md)
- [Model compatibility](model-compatibility.md), [catalog snapshots](catalog-snapshots.md)
  and [TM7 compatibility](tm7-compatibility.md)
- [Contributing](contributing.md) and the [browser test guide](../tests/browser/README.md)
- [Threat model of SDS itself](tool-threat-model.md)
