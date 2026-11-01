# Advanced configuration and implementation reference

*Updated: 2026-10-11 - Claude/Codex use the Vite-hosted local bridge.*

Start with the [user guide](user-guide.md). None of the optional service
configuration below is required for ordinary modeling with
`.\Start-SecureDesignStudio.ps1`. Use approved endpoints and synthetic models
when experimenting. This page does not authorize a deployment or changing
someone else's running preview.

## Runtime modes

| Mode | Local processes and network behavior |
|---|---|
| `.\Start-SecureDesignStudio.ps1` (`npm run dev`) | Vite only, strict `http://localhost:5173/`. No Azure credentials, API, room persistence, or model-service requests. Room/key fragments are ignored and left untouched. |
| `.\Start-SecureDesignStudio-WithAI.ps1 -Provider Claude|Codex` (`npm run dev:ai:local`) | Explicit opt-in: Vite on 5173 serves the app and local CLI bridge in one process. No Azure Functions host, API package installation, or Azure credentials. Collaboration stays disabled. |
| `.\Start-SecureDesignStudio-WithAI.ps1 -Provider Azure` (`npm run dev:ai`) | Explicit opt-in: Vite on 5173, API build watcher, and local Azure Functions on 7071. The bridge calls your Azure deployment. Collaboration stays disabled. |
| Deployed `dist` | Local modeling by default. Collaboration and Assistant require explicit build configuration; using them is a network operation. |
| Standalone `dist-single\index.html` | Browser-openable local editor by default. Explicitly configured services may use the network; collaboration also requires a hosted share destination. |

The launchers are prerequisite-checking wrappers around the npm scripts shown
in parentheses; the npm scripts remain available and perform no checks.

Local Vite rejects `VITE_COLLAB_TOKEN_ENDPOINT` and
`VITE_DESIGN_ASSISTANT_ENDPOINT` overrides. Do not use overrides to bypass the
local-mode boundary. For AI opt-in it uses the fixed
`http://localhost:5173/api/design-assistant` endpoint for Claude/Codex. Azure
uses the same browser endpoint on 5173, which Vite proxies only to the local
Functions endpoint at `http://localhost:7071/api/design-assistant`. Azure
settings and Entra authentication are loaded by Functions, not the CLI bridge.

Production builds have **no built-in service destinations**, including no
implicit `/api/design-assistant` endpoint. Service selection is explicit and
independent of Custom Libraries. These are build-time values, not model fields
or an end-user operational mode.

### Service availability and disclosure

Use `SDS_SERVICE_CONFIG` to select one local, data-only JSON file:

```powershell
$env:SDS_SERVICE_CONFIG = 'examples\service-configuration\example.json'
npm run build
```

The example uses reserved synthetic domains; replace them in your own reviewed
file. Its schema is:

```json
{
  "format": "secure-design-studio-service-configuration",
  "version": 1,
  "id": "example",
  "name": "Example services",
  "collaboration": {
    "tokenEndpoint": "https://services.example.invalid/api/collab-token",
    "appUrl": "https://diagram.example.invalid/app/"
  },
  "assistant": {
    "hostedEndpoint": "/api/design-assistant",
    "standaloneEndpoint": ""
  }
}
```

All fields are required; empty endpoint strings disable those capabilities.
A file that enables collaboration must also supply its hosted app URL, so the
same selection can be used for standalone sharing and CLI origin validation.
The ID/name identify the selected configuration in About. The reader allows one
regular local file up to 16 KiB, with a bounded read. No directory discovery,
remote download, scripts, room-link overrides or model-installed settings.
Missing/unreadable/invalid files disable all services and produce a visible
diagnostic rather than contacting a fallback. A selected file is validated as
a whole, including both Assistant delivery settings.

Alternatively, without a file selection, explicitly supply
`VITE_COLLAB_TOKEN_ENDPOINT`, `VITE_COLLAB_APP_URL` and/or
`VITE_DESIGN_ASSISTANT_ENDPOINT`. Unset or empty values are disabled. File
selection and these overrides **cannot be combined**, even with empty
overrides; conflicts disable services. Remove all four variables for a
plain disconnected build. Merely having an internal configuration file or
selecting a Custom Library does not activate services.

The file is read during a production build, not fetched by the browser or
discovered beside an exported HTML file. A standalone export retains the
configuration of the build that produced it. Ordinary Vite serving never
reads `SDS_SERVICE_CONFIG` and cannot enable deployment services through it;
local AI retains its separately selected fixed localhost workflow.

Service URLs support HTTP(S) without embedded credentials, query parameters or
fragments. Never put API keys in frontend configuration. The Assistant supports
an explicit same-origin path, such as `/api/design-assistant`, in hosted builds
only. A standalone file requires absolute service URLs and a valid hosted
`VITE_COLLAB_APP_URL` to make collaboration links usable by recipients.
Hosted sharing continues to use the current page's origin and path.

**About** displays effective service availability and the configured addresses.
The Assistant panel repeats its destination before a user sends model context.
These displays do not contact a service, authorize access or attest to service
health. Invalid settings disable the affected capability with a visible
diagnostic; rejected values are not echoed. Custom Libraries cannot configure
or enable services.

Builds also produce `service-build.json`, a local consistency receipt binding
the configuration to hashes of the emitted HTML/assets. With the same selection:

```powershell
node scripts/service-configuration.mjs --verify dist-single
```

Verification rejects errors, configuration differences, missing/changed/extra
artifacts and symbolic links. It is not signed provenance, an authorization
check or public-release approval. The browser does not fetch this receipt,
and standalone export still downloads one HTML file.

Disabled collaboration ignores room/key fragments without interpreting them,
creating room persistence or requesting tokens. Ordinary local Vite remains
collaboration-disabled regardless of endpoint values. The local AI workflow
still uses only its fixed localhost endpoint; disabling or misconfiguring a
service does not affect local editing, autosave, native imports or exports.

## Optional local Design Assistant

**File > Design with AI** (directly below **Open**) uses this same endpoint and server-side
provider dispatch as review/chat (Entra/Azure in hosted mode; Azure or subscription CLI in explicit local AI mode). It introduces
no provider, default cloud destination or credential setting. Default
credential-free localhost disables both experiences; the explicitly selected
`dev:ai` workflow continues to use only the fixed localhost API.

Browser and API authoring share `shared/designContract.ts`. Keep shared runtime
code outside `api/`: Vite serves source modules by path, while credential-free
browser checks deliberately block every `/api/` request, including source files.
The API compiler uses the repository root for its source layout and emits
`api/dist/api/{collab-token,design-assistant}/index.js` plus
`api/dist/shared/designContract.js`. Both `function.json` entrypoints and the API
package's `main` point into that compiled tree. Build with
`npm --prefix api run build` from the full checkout before packaging `api/`;
the compiled shared module stays inside that deployable folder, and HTTP routes
are unchanged. The same layout applies to the API watch command.

`shared/aiDesignGuidance.ts` supplies the guidance validator, fixed trusted
reference-data policy and request-size budgets to both browser and API.
It also compiles under `api/dist/shared/`. Node-type, protocol and
authentication-method guidance stays in the
serialized user/model-context message, never interpolated into the system
prompt. Both AI experiences resolve diagram-local guidance before installed
definitions; review includes only applicable interior-node bindings, and only
cards for authentication methods used by in-scope flows. Guidance
sources are not fetched, and guidance carries no privileged instructions or
verified authentication assurance. The browser and API enforce one
384,000-byte serialized guidance budget across node, protocol and
authentication cards, plus the 500,000-byte whole-request limit; these are
UTF-8 byte limits, not provider token limits. See
[AI design guidance](custom-libraries.md#ai-design-guidance) and the
[authentication guidance contract](authentication-library.md#ai-design-guidance)
for authoring, portability, provenance and explicit overflow behavior.
Local development guards are unchanged: credential-free `npm run dev` still
makes no AI or other non-local request, and selecting or editing guidance
sends nothing.

The API isolates authoring (`mode: "design"`) from the evidence-based review
policy. Authoring uses strict JSON-schema output with the request's actual
component, authentication and classification IDs as enumerated choices, followed
by server and browser validation. Use a deployment supporting structured output,
such as GPT-4.1. Chat and AI Analysis retain their existing JSON-object mode.
Unsupported structured requests report an explicit error; they do not silently
fall back to unconstrained generation.

The empty component type (`type: ""`) is the editor's existing unspecified
component, not a new catalog entry. AI uses it for people, browsers and generic
components without a suitable service type, with `dfdRole` set independently.
`ExternalInteractor` is a role, not a component ID. Unknown nonempty component
IDs are still rejected atomically rather than coerced to unrelated services.

Authoring accepts at most 12 history messages, a 4,000-character prompt
and a 500,000-byte request. Threat Model Designer treats that request as one
**ask, then response** exchange when its library is large: the planning call
sends compact node, protocol and authentication indexes (no card bodies) and the
design call sends the selected and already-used cards (planning selects at
most 24 component types, 24 protocols and 8 authentication methods). Both calls
are independent HTTP requests; the provider is not assumed to remember the first.
The required in-use cards are checked before any call: if they cannot fit, no
provider call is made. If selected
cards push the design request past the guidance or request budget, the design
call is not sent: the dialog explains the exceeded boundary and measured sizes,
asks for a narrower design task, and applies nothing. SDS does not truncate
cards, batch automatically or add a repeated "ask for another card" loop. The
status line reports which authentication guidance was supplied and any
in-use or proposed authentication method without a card. Chat and AI Analysis
have no selection round; they send the cards for in-use flow methods directly.
Complete JSON responses have bounded lists (24 nodes,
48 flows, 12 boundaries and 24 data items); unknown fields, invalid references,
unavailable catalog values and non-stop/truncated completions never partially
apply. The service request timeout is 90 seconds and the dialog cancels after
100 seconds. Server diagnostics log status/error class, not downstream model
content. These limits are implementation safeguards, not a guarantee that a
live model will produce an acceptable design.

The structured design carries explicit `remove.nodeIds`, `remove.edgeIds` and
`remove.boundaryIds` arrays, limited to 100 supplied IDs each. Only targets in
the selected scenario can be named, but deletion and incident-flow cleanup are
global. Unknown targets, duplicate/delete-and-edit conflicts and references to
deleted nodes fail before any store/history mutation. Incident connections
explicitly rerouted in the same batch survive if both final endpoints exist.
Rerouted shared connections gain their new endpoints in every scenario that
uses them; surviving order/numbers are retained.

Edges carry `dataMode: "merge" | "replace"` for selected-scenario request/response
attachments. Boundaries carry `membershipMode: "merge" | "replace"` for global
node membership. Replace uses the exact supplied arrays, including empty
arrays. Older additive responses that omit these modes remain additive; omitted
elements or `remove` never imply deletion. No persisted document format change
is required. New readers still revalidate all output against the live document
and catalog before applying a single atomic, undoable transition.

`design.edgeOrder` is either `null` (preserve order) or a complete ordered list
of the selected scenario's surviving flow IDs, including temporary IDs for
connections created in that response. Explicit ordering is validated as an exact
permutation after deletions/reroutes, then writes both `Scenario.edgeIds` and
consecutive `edgeNumbers` from 1 in one history step. Missing, duplicate, unknown,
deleted and out-of-scenario IDs reject the entire response. Legacy responses
that omit ordering retain their existing behavior and custom numbering.
The AI context includes the actual timeline (`flowOrder`, positions and display
numbers); connectivity is not treated as proof of sequence order. Sequence
participants already follow first appearance in `edgeIds`; no canvas geometry
or persisted format change is needed.

AI-edited flows also populate missing receiving-node data entries in the selected
scenario using the same pure directional propagation helper as Analyze and the
explicit store propagation action. Only flows present in the AI edit are
propagated automatically; unrelated scenarios/flows are not rewritten.
Requests populate the target, responses the source, with retention `""`
(unspecified), never an inferred storage promise. Existing node retention,
including values unrelated to current flow attachments, remains intact.
Both flow attachments and their node entries are persisted inside the one
AI-response history transition; no Analyze pass or extra Undo entry is required.

When a proposed boundary would enclose unrelated components, the designer tries
one alternate placement of **new** components next to the existing members;
it never moves existing components merely to fit an addition. If geometry still
conflicts, it preserves the existing model and adds only the identifiable new
components, disconnected, plus a scenario-scoped canvas text annotation.
The annotation explains the conflict, deferred flows/boundaries/deletions and
the owner decisions needed. The dialog explicitly reports a partial design
instead of repeating the model's claim that all edits succeeded.

The optional `design.humanReviewNotes` array supports the same fallback for
unresolved requirements (at most 16 nonblank notes of 1,000 characters each).
Structured-output providers return an empty array for fully specified designs;
older responses may omit it. AI is instructed to use disconnected components
and specific notes rather than guess consequential routing, authentication or
boundary decisions. All original operations still undergo catalog, reference,
scope and order validation before any fallback; malformed or unauthorized
output remains an atomic error. Neither fallback nor annotations certify the
design. Components and annotation share one Undo/Redo step and persist through
native save/open, autosave and collaboration using the existing annotation
format, without a document schema version change.
Scenario annotations are included as explicitly untrusted author notes in the
next design context, so the owner can resolve a decision and request a connected
refinement. Notes do not authorize deferred changes or become flow endpoints.

New scenarios require a nonblank name (at most 160 characters) and description
(at most 4,000 characters). For existing scenarios, responses send a
`scenario: {}` patch or only the fields explicitly being edited. Omitted fields
retain their saved values locally, even when authored descriptions or appended
assumptions exceed the response limit. Supplied fields still undergo strict
type and length validation; an explicitly empty description clears it.
Name-only, description-only and explicit description-clearing updates to an
existing scenario do not require any element upserts. Each actual change is
one Undo step; repeating the same patch without new assumptions is a no-op.
Assumptions are appended without repeating already-saved text or duplicates
within the response. Saved content is never truncated to fit a refinement.

Selected-scenario authoring context includes names/descriptions, roles, flows,
membership, numbering, directional data/retention, protocol profiles, and
active caller IDs plus preserved historical identity evidence for existing
flows. Historical identity is never a source for a new caller ID; the model
may only echo an active GUID on the same unchanged caller edge. Node inventory
metadata, data samples, comments and review records are not projected.
Authored text is still untrusted and may contain sensitive information; review
what you send. The designer's chat and draft
remain in memory across closing/reopening for the current scenario. A scenario
switch, New/Open/imported model replacement, or page reload clears them. Dialog
position is also session-local; neither it nor chat becomes a document field
or collaboration state. Closing aborts any pending request. See the
[authoring workflow](user-guide.md#build-a-proposed-threat-model-with-ai).

### Prerequisites

The assistant is **bring your own AI**: no model service ships with the app and
none is provided for you. To create an Azure OpenAI instance and secure it —
disabling key authentication with `disableLocalAuth`, restricting network
access, and assigning the data-plane role — follow
[bring your own AI](bring-your-own-ai.md). This page covers how the local
workflow consumes it.

In addition to the [source setup](user-guide.md#2-how-to-install-and-run),
Azure Functions Core Tools (`func`) are needed only for `-Provider Azure`.
Choose Claude Code or Codex with a consumer subscription sign-in as described in
[bring your own AI](bring-your-own-ai.md#choose-a-provider-at-startup-or-in-sds).
The following Azure-specific setup applies only to `-Provider Azure`: an Azure CLI identity
authorized to invoke an existing Azure AI deployment, its HTTPS endpoint,
and its model deployment name. If you are using someone else's deployment,
obtain those from its owner. Basic use of SecureDesignStudio does not require
creating Azure resources.

For Azure, install Core Tools once if `func --version` does not work, then open a new
PowerShell window so the PATH update applies:

```powershell
winget install --id Microsoft.Azure.FunctionsCoreTools -e
# or, without an installer:
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

Run the Function host on a Node version it supports (22 or 24). Node 20 reached
end of support in April 2026, and odd-numbered Current releases such as Node 25
are never supported: they can start Vite but leave the host on port 7071
failing. Node 24 LTS satisfies both the frontend toolchain and the Function
host.

When the running version is unsupported, the launcher prints the exact upgrade
command and offers to run it. The prompt defaults to **no**, states that a
machine-wide install affects every project on the computer, and prefers
`nvm install 24` when nvm-windows is present because that is reversible and
needs no elevation.

The winget package is a machine-wide MSI, so it requires administrator
approval. When the window is not elevated the launcher says so before
prompting, then requests elevation itself. Declining the User Account Control
prompt changes nothing and reports that, rather than failing with a bare
`0x8A150006`; the same code from any other cause is decoded too.

Two conditions make the MSI fail with error 1603, and the launcher checks for
both before offering to install anything:

| Condition | Why it fails |
|---|---|
| `OpenJS.NodeJS` (the Current release) already installed | It is a separate winget package owning the same folder as `OpenJS.NodeJS.LTS`, so it must be uninstalled first |
| Running `node.exe` processes from the install directory | The installer cannot replace files that are in use |

When either applies the launcher prints the exact remediation instead of
starting an install that cannot succeed. Node bundled inside other
applications lives elsewhere and is correctly ignored.

Accepting a successful install stops the launcher afterwards: PATH changes
never reach a running process, so the upgrade only takes effect in a new
PowerShell window. Set `PS_LAUNCHER_NONINTERACTIVE=1` (or `CI`) to print the
command without prompting.

Set the non-secret service configuration in the PowerShell session that will
launch the app:

```powershell
$env:AZURE_OPENAI_ENDPOINT = "https://<your-resource>.openai.azure.com"
$env:MODEL_DEPLOYMENT_NAME = "<your-model-deployment-name>"
```

`AZURE_AI_ENDPOINT` is an alternative to `AZURE_OPENAI_ENDPOINT`.
Set `AZURE_OPENAI_API_VERSION` only if the deployment needs an override.
Do not copy real credentials into these values or into the diagram.

If the required identity is not already available, use your approved
`az login` workflow. The Function uses `DefaultAzureCredential`, which can
use the local Azure CLI identity; credentials are not supplied by the browser.
The local host cannot automatically read deployed application settings.

The account accepts Microsoft Entra tokens only — key-based access is
disabled — so a signed-in identity is required, not optional. The launcher
checks for one before starting and stops with guidance when it is missing,
because an unauthenticated Function surfaces only an opaque HTTP 500 to the
browser. Assign **Cognitive Services OpenAI User** on the account to the
identity that will run it. See
[grant yourself access](bring-your-own-ai.md#5-grant-yourself-access).

### Start and stop

First stop only your own ordinary Vite server. The launcher checks that ports
5173 and 7071 are free and reports the owning process when they are not. From
the repository root in the configured PowerShell session:

```powershell
az login
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Azure
```

The launcher requires Node, npm, `func`, and the selected provider's prerequisites.
Azure requires an endpoint, deployment name and Entra identity; Claude/Codex
require their official CLI and subscription sign-in, not Azure credentials.
Without `-Provider` the interactive launcher presents a choice; non-interactive
callers must supply it. The shared in-app selector can switch to another ready
provider afterward. It installs dependencies if their
directories are missing, then runs `npm run dev:ai`. It finds Core Tools
installed outside the current PATH, and when a prerequisite is missing it
reports what is missing and the command that fixes it instead of failing with
a bare error. `npm run dev:ai` runs `setup:ai`, builds the API, then starts
Vite, the API TypeScript watcher, and the Function host. It can still be
invoked directly — though that path performs no prerequisite or identity check.

Two switches adjust the preflight:

| Switch | Effect |
|---|---|
| `-VerifyEndpoint` | Azure only: an explicit, potentially billable inference probe. Failures warn but do not block. |
| `-SkipAuthCheck` | Azure only: starts without checking for an identity. Requests still require valid credentials. |

The launcher also warns when `AZURE_CLIENT_ID`/`AZURE_TENANT_ID` service
principal variables are present, because `DefaultAzureCredential` prefers them
over the Azure CLI sign-in and would present a different principal than the
one you signed in as.

The configuration helper writes ignored `api\local.settings.json` from the
environment, including `SDS_LOCAL_AI=1` and `SDS_AI_PROVIDER`. Existing Azure
deployment values are retained when selecting another provider. Missing Azure
endpoint/deployment values are errors only when Azure is the initial provider.
API keys and CLI login credentials are not written to this file.
`npm run setup:ai` creates/refreshes configuration without starting servers.
Never commit the local settings file.

Open http://localhost:5173/, select a scenario, and choose **Review >
Design Assistant**. Ctrl+C in the owning terminal stops this workflow.
Return to `.\Start-SecureDesignStudio.ps1` for credential-free operation; do
not leave an unneeded API running.

### What is sent and what is saved

Chat and AI Analysis send the prompt plus the active scenario, its member
nodes, edges and boundaries, referenced authentication and catalog-display
definitions (including any saved, unverified library metadata), the authored
AI design guidance for in-use node types, protocols and authentication methods,
attached
data (including sample fields), retention, and selection metadata. Filters
and selection do **not** narrow this to just visible or selected objects.
DFD scope omits excluded node-interior fields and excluded-flow data
attachments. Endpoint-only nodes still carry identity; scope coverage,
stored reasons and structural diagnostics are sent as model data.
Out-of-scope is a review boundary, not a confidentiality filter.
The local API forwards context to the configured model service.

Use only information approved for that destination. Keep secrets and real
personal/confidential sample values out of the model. Review AI evidence
against source or deployment facts: this is not a live vulnerability database
lookup or security certification.

**Create issue** and **Create work item** explicitly copy a suggestion into
the model. Chat and unaccepted findings are transient panel state, not
durable review records. The deterministic **Review > Analyze** needs none of
this service setup and remains a separate operation.

## Collaboration

In a collaboration-enabled build, use the status menu to **Start
collaboration**, copy the room link, or **Leave collaboration**. Joining a
valid shared link connects to the existing room; ordinary localhost Vite
does not join rooms.

Web PubSub carries encrypted document synchronization. The AES key is in
the URL fragment after `#`, which is not part of the browser's HTTP request
to the app server. The full link is nevertheless a bearer secret: anyone
with it can join and decrypt the room. Share privately with authorized
participants, never in logs, public issues, screenshots, or command lines.
Leaving a room is not revocation of a link already given to someone else.

A room synchronizes diagram state, including saved authentication
definitions, not each participant's browser-profile Authentication Library
preferences. Use compatible builds; readers before 0.1.5 can discard new or
custom auth IDs. Older peers cannot be reliably detected or prevented.
Save a `.tma` backup rather than treating a live room as archival storage.

A standalone file's copied collaboration link opens the configured public
app, not the sender's local path. Browser restrictions on `file://` network
access can prevent hosting; use the approved hosted app rather than disabling
browser protections. Local file editing does not require a room.

## Browser recovery

Autosave stores the document, bounded Undo/Redo history, active scenario, and
filters in browser localStorage for the app origin/profile. Writes are
debounced, with a flush when the page is hidden or closed. Settings changes
the autosave interval. Browser quota or denied storage can prevent recovery;
in-memory editing is not evidence that a save succeeded.

The current key is `secure-design-studio:autosave:v1`. Startup can migrate
the legacy `privsec-diagram:autosave:v1` value when there is no current
autosave. A model embedded in standalone HTML takes precedence over autosave.
Standalone file-origin storage behavior varies by browser; explicitly export
changes instead of relying on refresh or copying the original HTML.

If you deliberately want to remove **document recovery only**, save a `.tma`
backup first. In developer tools for the correct app origin, run:

```javascript
localStorage.removeItem("secure-design-studio:autosave:v1");
localStorage.removeItem("privsec-diagram:autosave:v1");
location.reload();
```

The legacy name here is cleanup-only, never a new output identifier. This
does not clear the separate Authentication Library, inspector/preferences,
or collaboration IndexedDB caches. Room caches use
`secure-design-studio:collab:<room>` with legacy migration support.
Export library JSON before broader site-data cleanup. Clearing local data
does not delete another participant's copy or revoke a shared link.

## Implementation and contributor references

| Surface | Source of truth |
|---|---|
| React shell and commands | [`src/App.tsx`](../src/App.tsx), [`Toolbar.tsx`](../src/components/Toolbar.tsx), [`SidePanel.tsx`](../src/components/SidePanel.tsx) |
| Serializable model, state, undo, normalization, I/O | [`src/types.ts`](../src/types.ts), [`src/store.tsx`](../src/store.tsx) |
| Graph and sequence | [`DiagramCanvas.tsx`](../src/components/DiagramCanvas.tsx), [`SequenceDiagramView.tsx`](../src/components/SequenceDiagramView.tsx), [`EdgeTable.tsx`](../src/components/EdgeTable.tsx) |
| Policy and deterministic analysis | [`src/policy.ts`](../src/policy.ts), [`src/IssueManager.ts`](../src/IssueManager.ts) |
| Authentication and node definitions | [Library contract](authentication-library.md), [cloud catalog](microsoft-cloud-node-catalog.md), [`src/data`](../src/data) |
| Data classification and retention descriptions | [`dataClassifications.json`](../src/data/dataClassifications.json), [`retentionTypes.json`](../src/data/retentionTypes.json) |
| External format mapping | [`tm7Import.ts`](../src/tm7Import.ts), [`tm7Export.ts`](../src/tm7Export.ts), [`tmcImport.ts`](../src/tmcImport.ts), [`privacyManagerImport.ts`](../src/privacyManagerImport.ts), [`vsdxExport.ts`](../src/vsdxExport.ts) |
| Native recovery and embedded files | [`src/autosave.ts`](../src/autosave.ts), [`src/embeddedDoc.ts`](../src/embeddedDoc.ts) |
| Semantic model comparison | [`src/diff.ts`](../src/diff.ts) |
| Yjs/Web PubSub and short-lived room tokens | [`src/collab`](../src/collab), [`api/collab-token`](../api/collab-token) |
| AI request and local configuration | [`src/designAssistant.ts`](../src/designAssistant.ts), [`api/design-assistant`](../api/design-assistant), [`configure-local-ai.mjs`](../scripts/configure-local-ai.mjs) |
| Launchers and prerequisite checks | [`Start-SecureDesignStudio.ps1`](../Start-SecureDesignStudio.ps1), [`Start-SecureDesignStudio-WithAI.ps1`](../Start-SecureDesignStudio-WithAI.ps1), [`launcher-common.ps1`](../scripts/launcher-common.ps1) |

For source changes, follow [contributing and local validation](contributing.md)
and the scoped [browser checks](../tests/browser/README.md). Keep code validation
distinct from analysis of a user's model. Local results are contributor evidence
for maintainer review, not enforced merge protection. No user setup, build or
validation step deploys the site. Companion integrations have separate setup
and validation owned by their maintainers.
