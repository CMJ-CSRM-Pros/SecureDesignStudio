# Advanced configuration and implementation reference

*Updated: 2026-09-22 - Start from the root launcher scripts.*

Start with the [user guide](user-guide.md). None of the optional service
configuration below is required for ordinary modeling with
`.\Start-SecureDesignStudio.ps1`. Use approved endpoints and synthetic models
when experimenting. This page does not authorize a deployment or changing
someone else's running preview.

## Runtime modes

| Mode | Local processes and network behavior |
|---|---|
| `.\Start-SecureDesignStudio.ps1` (`npm run dev`) | Vite only, strict `http://localhost:5173/`. No Azure credentials, API, room persistence, or model-service requests. Room/key fragments are ignored and left untouched. |
| `.\Start-SecureDesignStudio-WithAI.ps1` (`npm run dev:ai`) | Explicit opt-in: Vite on 5173, API build watcher, and local Azure Functions on 7071. The Function calls the Azure model service you configure. Collaboration stays disabled. |
| Deployed `dist` | Local modeling by default. Collaboration and Assistant require explicit build configuration; using them is a network operation. |
| Standalone `dist-single\index.html` | Browser-openable local editor by default. Explicitly configured services may use the network; collaboration also requires a hosted share destination. |

The launchers are prerequisite-checking wrappers around the npm scripts shown
in parentheses; the npm scripts remain available and perform no checks.

Local Vite rejects `VITE_COLLAB_TOKEN_ENDPOINT` and
`VITE_DESIGN_ASSISTANT_ENDPOINT` overrides. Do not use overrides to bypass the
local-mode boundary. For AI opt-in it uses the fixed
`http://localhost:7071/api/design-assistant` endpoint.

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

### Prerequisites

The assistant is **bring your own AI**: no model service ships with the app and
none is provided for you. To create an Azure OpenAI instance and secure it —
disabling key authentication with `disableLocalAuth`, restricting network
access, and assigning the data-plane role — follow
[bring your own AI](bring-your-own-ai.md). This page covers how the local
workflow consumes it.

In addition to the [source setup](user-guide.md#2-how-to-install-and-run),
this workflow needs Azure Functions Core Tools (`func`), an Azure CLI identity
authorized to invoke an existing Azure AI deployment, its HTTPS endpoint,
and its model deployment name. If you are using someone else's deployment,
obtain those from its owner. Basic use of SecureDesignStudio does not require
creating Azure resources.

Install Core Tools once if `func --version` does not work, then open a new
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
.\Start-SecureDesignStudio-WithAI.ps1
```

The launcher requires Node, npm, `func`, a configured endpoint and deployment
name, and a signed-in Azure identity; it installs dependencies if their
directories are missing, then runs `npm run dev:ai`. It finds Core Tools
installed outside the current PATH, and when a prerequisite is missing it
reports what is missing and the command that fixes it instead of failing with
a bare error. `npm run dev:ai` runs `setup:ai`, builds the API, then starts
Vite, the API TypeScript watcher, and the Function host. It can still be
invoked directly — though that path performs no prerequisite or identity check.

Two switches adjust the preflight:

| Switch | Effect |
|---|---|
| `-VerifyEndpoint` | Also probes the configured deployment before starting, which catches a missing data-plane role, a rotated client IP, or a wrong deployment name. Failures warn but do not block. |
| `-SkipAuthCheck` | Starts without checking for an identity. Vite and the API still run; Design Assistant requests fail. |

The launcher also warns when `AZURE_CLIENT_ID`/`AZURE_TENANT_ID` service
principal variables are present, because `DefaultAzureCredential` prefers them
over the Azure CLI sign-in and would present a different principal than the
one you signed in as.

The configuration helper writes ignored `api\local.settings.json` from the
environment. With no endpoint/deployment environment values, it reuses a
valid existing file. Missing or blank endpoint/deployment values are errors.
`npm run setup:ai` creates/refreshes configuration without starting servers.
Never commit the local settings file.

Open http://localhost:5173/, select a scenario, and choose **Review >
Design Assistant**. Ctrl+C in the owning terminal stops this workflow.
Return to `.\Start-SecureDesignStudio.ps1` for credential-free operation; do
not leave an unneeded API running.

### What is sent and what is saved

Chat and AI Analysis send the prompt plus the active scenario, its member
nodes, edges and boundaries, referenced authentication and catalog-display
definitions (including any saved, unverified library metadata), attached
data (including sample fields), retention, and selection metadata. Filters
and selection do **not** narrow this to just visible or selected objects.
The local API forwards context to the configured model service.

Use only information approved for that destination. Keep secrets and real
personal/confidential sample values out of the model. Review AI evidence
against source or deployment facts: this is not a live vulnerability database
lookup or security certification.

**Create issue** and **Create work item** explicitly copy a suggestion into
the model. Chat and unaccepted findings are transient panel state, not
durable review records. The deterministic **Review > Analyze** needs none of
this service setup and remains a separate operation.

## Collaboration and headless CLI

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

Optional agent participants are separately supplied companion integrations,
not application build/runtime prerequisites. Follow their owner's setup and
authorization guidance. Sharing model context with an AI or other participant
is subject to your data policy; ordinary browser collaboration does not require
an agent integration.

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
