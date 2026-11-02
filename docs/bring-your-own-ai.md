# Bring your own AI

*Updated: 2026-10-11 - Added subscription CLI startup and Codex feature diagnostics.*

The AI Design Assistant is **bring-your-own-AI**. No model service ships with
SecureDesignStudio, none is shared with you, and the app has no default AI
service account. `Start-SecureDesignStudio-WithAI.ps1` offers Azure
OpenAI/Foundry, Claude Code, and Codex. Azure requires your authorized deployment;
Claude and Codex use their official CLI with your eligible consumer subscription.

Use **Node.js 24 LTS** for local development. The Azure API's Identity SDK
requires Node 22 or later; `staticwebapp.config.json` selects the supported
**Node 22** managed API runtime for Azure Static Web Apps. Node 18/20 cannot
run this API dependency set. Updating this configuration does not deploy it.

## Choose a provider at startup or in SDS

```powershell
.\Start-SecureDesignStudio-WithAI.ps1                 # interactive menu
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Azure
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Claude
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Codex
```

Non-interactive launchers must supply `-Provider`. Every option needs Node.js.
Claude and Codex use a local Vite bridge and do not require Azure Functions Core
Tools, the API package, or Azure credentials. Only Azure needs Functions Core
Tools, Azure CLI, endpoint/deployment configuration, and Entra access. The Azure
setup guide below is not a prerequisite for Claude or Codex.
In Claude/Codex mode, the in-app provider selector switches between those two
subscription CLIs; restart with `-Provider Azure` to use an Azure deployment.
The status below the selector names only the selected provider. Unavailable
alternatives are described under the collapsed **Other provider setup**
disclosure; these notices do not change request routing.

For Claude, install [Claude Code](https://code.claude.com/docs/en/setup), then run
`claude auth login` and sign in with your Claude subscription. For Codex, install
[Codex CLI](https://developers.openai.com/codex/cli), then run `codex login` and
sign in with ChatGPT. CLI versions must support structured output and the safety
options used by SDS. Unsupported versions fail rather than relaxing permissions.
SDS invokes a native CLI executable, not an npm `.cmd` shim. On Windows, make the
official native `claude.exe` or `codex.exe` available on PATH, or install Codex
with npm in a global prefix on PATH. SDS discovers the native Codex binary in
that prefix's `node_modules\@openai\codex` package, including nested/sibling
Windows platform dependencies and older bundled `vendor` layouts. Windows x64
and ARM64 packages are selected using Node's architecture. Claude requires
restricted mode (Claude Code 2.1.248 or later) and safe mode; an older installation
can sign in successfully but still be unavailable for SDS requests.
These subscription allowances are distinct from provider API billing.
SDS will not silently use an API key, a custom gateway, or a different provider.
Manage any paid extra-usage settings in your provider account.

### Troubleshoot subscription CLI startup

```powershell
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Codex -DiagnoseProvider
# For Claude, substitute -Provider Claude.
```

This checks readiness and prints file-backed PowerShell commands, native PATH
candidates, shared npm discovery, the selected native executable, the last
readiness stage, and the preflight exit code. It exits without starting servers,
installing project dependencies, or making an inference request. Failed ordinary
subscription startup also prints these diagnostics. It does not print credentials,
CLI authentication files, raw CLI output, or the full environment.

**A missing native executable is an installation-discovery problem, not
a failed login.** An official npm installation can expose `codex.cmd` or
`codex.ps1` while its bundled native executable is elsewhere. `codex login` can
succeed through that wrapper, but SDS deliberately does not execute shell
wrappers. Zero direct native PATH candidates is normal for an npm installation:
the shared resolver locates its bundled executable without modifying PATH.
If the diagnostic `[npm]` stage still fails, use `Get-Command codex -All` to inspect command resolution and
`npm root -g` to locate your global packages. Locate the official package's
platform-specific `codex.exe`; layouts vary by package version. Add its containing
directory to this PowerShell session if the installation uses an unsupported
package layout, keeping the existing PATH:

```powershell
$env:PATH = 'C:\actual\directory\containing\codex.exe' + [IO.Path]::PathSeparator + $env:PATH
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Codex -DiagnoseProvider
```

Use the actual installed binary directory, not the placeholder above. Do not
rename `.cmd`/`.ps1` files to `.exe`, copy tokens, or place the executable inside
the SDS repository. If the platform dependency is absent or damaged, repair the
official Codex installation rather than replacing its executable with a wrapper.
SDS does not automatically install or update provider software. Once discovery succeeds, SDS still checks host policy,
required isolation capabilities, and ChatGPT subscription login; each can fail
independently. Diagnostics identify the stage reached; missing isolation flags
and mismatched feature settings are named without exposing raw CLI output.
For Codex, the `[features]` stage also reports the CLI version and each required
feature's observed and required value (`true`, `false`, or `absent`). Command
execution is blocked by requiring `shell_tool=false`. Current Codex releases
keep `unified_exec` enabled unless enterprise requirements pin it, so it is
shown as informational; it only selects the backend of the disabled shell tool.
A feature reported as enabled by host or managed policy still blocks readiness.
Run normal startup without `-DiagnoseProvider` only when readiness
succeeds. Native discovery does not bypass any safety check.

If a Codex response is discarded, the error now identifies the event and
recognized item type, and a bounded status when available. For example,
`item=command_execution` is a blocked command attempt; `item=error` is a CLI
error notification, not proof that a tool ran. Unknown event/item shapes remain
blocked. These diagnostics never include commands, arguments, paths, model
content, or raw CLI error text. Include that sanitized error and the
`-DiagnoseProvider` version/readiness output when reporting a failure.
Readiness checks do not run inference and cannot prove that a model will avoid
tool attempts; tool/action responses are still discarded.

### Debug an AI interaction

On Azure startup, Vite can become ready before the Functions API on port 7071.
A proxy connection error at that point is not a Foundry authentication error.
SDS returns an explicit 503 diagnostic; wait for the API to start and use
**Refresh providers**. Persistent proxy errors require checking the API process.
The Functions message `Unable to create client for AzureWebJobsStorage` is a
separate host-storage health issue: the generated local settings use an empty
storage value for the HTTP-only AI workflow. Successful AI invocations do not
prove that host storage is healthy. Do not add cloud storage credentials or
disable health checks merely to hide this message.

Designer preserves strict validation for unknown or incomplete flow orders.
One recoverable case is an empty `edgeOrder` array accompanying otherwise valid
entity edits: SDS preserves surviving flow order and numbers, appends new flows,
and displays a warning to review the sequence. Empty reorder-only requests and
nonempty invalid orders still fail atomically. This does not bypass authentication,
boundary, reference, or stale-result validation.

```powershell
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Codex -DebugAI
# Omit -DebugAI on the next launch to turn diagnostics off.
```

For Azure request-size diagnostics, launch with
`.\Start-SecureDesignStudio-WithAI.ps1 -Provider Azure -DebugAI`.

Debug mode is off by default. For Azure, it logs sanitized request sizing to the
Functions terminal: serialized request bytes, an approximate input-token count,
the configured output-token ceiling, and their estimated total. The estimate
uses UTF-8 bytes divided by four, not the model tokenizer; successful Azure
responses also log the exact token usage reported by the service. The `breakdown`
reports byte counts for system instructions, diagram context (all context values
other than catalog/guidance), catalog, guidance, conversation, question, and
output schema. Context structure, message wrappers and JSON escaping/envelope
overhead are recorded separately; all breakdown entries sum to
`estimatedInputUtf8Bytes`. Catalog and guidance also occur inside the context,
so do not add the full context again. These are sizes only, not text or IDs.
Nothing is removed, summarized or truncated by debugging. Failed
Claude/Codex requests include an **AI debug trace** in the displayed error.
Those traces also appear in the launcher terminal and
a local `%TEMP%\sds-ai-debug-<unique-id>.jsonl` file. The terminal prints its
exact path when the first record is written. Response objects retain their
strict application contract; debug metadata is never added to design results.
It reports readiness, Codex version, byte counts, process
exit, event/item types, and classified error categories (schema, authentication,
usage limits, network/stream, or model availability). It does not print raw
provider messages, prompts, model content, commands, paths, or credentials.
`-DiagnoseProvider` remains a separate readiness-only check.

To additionally capture the complete sent prompt (including system instructions,
model context and conversation) and the provider's final response:

```powershell
.\Start-SecureDesignStudio-WithAI.ps1 -Provider Codex -DebugAIContent
```

This explicitly enables sensitive content logging to the same local JSONL file.
It is separate from sanitized `-DebugAI`; content is not echoed to the terminal
or included in browser errors. Protect the file, review before sharing, and
delete it after analysis. No automatic upload or retention cleanup occurs.
Restart without either debug switch to turn logging off. File permissions follow
the user's temporary directory on Windows; the file is not an encrypted vault.

Codex `item=error` notifications are nonfatal in its event contract. SDS allows
a completed, validated answer after such a notification, but still requires a
completed answer item and turn, rejects fatal events, and discards every tool
attempt. Diagnostics do not relax these restrictions.

Both **Design Assistant** and **Threat Model Designer** share an **AI provider**
selector. Unavailable providers display setup guidance; **Refresh providers**
rechecks installation/sign-in without making an inference request. The selector
is locked while either surface has a pending request. Switching resets the
conversation; it does not alter the diagram, findings already accepted as
issues/work items, or model history. Provider preferences are local to the
browser, never saved into `.tma`, exported HTML, or collaboration.

The launcher supplies the initial default. A saved UI selection is reused on
reload when that launcher default is unchanged; a different launcher default
resets the selection. For the npm workflow, set `$env:SDS_AI_PROVIDER = "claude"`
or `"codex"` before `npm run dev:ai`; without it, the default remains Azure.

The browser sends the same structured SDS request to the fixed localhost API.
The API invokes a bounded, non-interactive CLI request and validates the result
through the existing review/design contracts. The CLI does not edit your model
or repository; model changes are applied through SDS's existing undoable actions.
Credentials remain with the official CLI. Do not copy login tokens into scripts,
the browser, diagrams, or local settings.

**Local-only:** a hosted SDS deployment cannot invoke the user's local CLI.
Hosted Azure processing stays unchanged. `Start-SecureDesignStudio.ps1` remains
credential-free and starts neither the API nor an AI provider.

**Data handling:** your prompts, included scenario context, catalog guidance
(including authentication guidance for methods in use) and
recent design conversation go to the selected provider. Use only information
you are authorized to send; consumer data handling differs from an
organization-managed Azure deployment. Read the provider's account controls and
SDS's [request disclosure](advanced-configuration.md#what-is-sent-and-what-is-saved).
No inference is made merely by launching or refreshing readiness.
`-VerifyEndpoint` is an explicit Azure-only inference probe and can incur usage.
Stopping or closing a browser request prevents its result from being applied.
An already-running CLI may continue consuming allowance until completion or
the bridge's 80-second inference timeout. Only one consumer CLI inference runs
at a time.

Nothing on this page is needed for ordinary modeling. Analysis, diagrams,
scenarios, and saving all work with `Start-SecureDesignStudio.ps1`, which needs
no cloud account at all. Choose AI only when you want the optional Chat and AI
Analysis features.

**Contents**

1. [Before you start](#1-before-you-start)
2. [Create the resource](#2-create-the-resource)
3. [Deploy a model](#3-deploy-a-model)
4. [Secure it](#4-secure-it)
5. [Grant yourself access](#5-grant-yourself-access)
6. [Point SecureDesignStudio at it](#6-point-securedesignstudio-at-it)
7. [Verify and troubleshoot](#7-verify-and-troubleshoot)
8. [Running cost and cleanup](#8-running-cost-and-cleanup)

## 1. Before you start

You need an Azure subscription in which you are permitted to create Azure
OpenAI resources, and approval to use the service in your tenant. In many
organizations Azure OpenAI access is gated; obtain that approval first rather
than assuming a subscription is enough.

You also need the Azure CLI. Install it from
[aka.ms/installazurecli](https://aka.ms/installazurecli), then:

```powershell
az login
az account set --subscription "<your-subscription-name-or-id>"
```

Follow your organization's policies for region, naming, tagging, and data
handling. The commands below are a working baseline, not an approved
architecture for your environment.

> **What leaves your machine.** With AI enabled, Chat and AI Analysis send the
> active scenario's nodes, flows, boundaries, authentication definitions,
> attached data (including sample field names), and retention to your endpoint.
> Keep real secrets and real personal data out of the model regardless of how
> the endpoint is secured. See
> [what is sent](advanced-configuration.md#what-is-sent-and-what-is-saved).

## 2. Create the resource

Pick your own names; these are placeholders.

```powershell
$resourceGroup = "<your-resource-group>"
$account       = "<your-account-name>"
$location      = "eastus"

az group create --name $resourceGroup --location $location

az cognitiveservices account create `
  --name $account `
  --resource-group $resourceGroup `
  --location $location `
  --kind OpenAI `
  --sku S0 `
  --custom-domain $account
```

`--custom-domain` is required for Microsoft Entra token authentication, which
is the only authentication this app uses. Without it the account has no
`https://<account>.openai.azure.com` endpoint.

## 3. Deploy a model

The Design Assistant calls the chat completions API with `temperature`,
`max_tokens`, and `response_format` at api-version `2024-10-21`. Deploy a
model such as `gpt-4.1`. **Design with AI** additionally requires strict
JSON-schema structured output to restrict component choices to the catalog.
Chat and AI Analysis use JSON-object mode. A deployment that only supports
JSON-object mode can review existing models but cannot run the design builder.

```powershell
az cognitiveservices account deployment create `
  --name $account `
  --resource-group $resourceGroup `
  --deployment-name "gpt-4.1" `
  --model-name "gpt-4.1" `
  --model-version "2025-04-14" `
  --model-format OpenAI `
  --sku-name Standard `
  --sku-capacity 10
```

The **deployment name** you choose here is what you later set as
`MODEL_DEPLOYMENT_NAME`. It is independent of the model name.

Reasoning-only models are not interchangeable here: some reject
`temperature`, `max_tokens`, or `response_format`, so a reachable endpoint can
still fail at inference. If the assistant returns errors while connectivity
checks pass, confirm the deployed model accepts those parameters.

List what exists on an account at any time:

```powershell
az cognitiveservices account deployment list `
  --name $account --resource-group $resourceGroup -o table
```

### Request size and tokens per minute

Every Standard or GlobalStandard deployment enforces a tokens-per-minute
limit (1 capacity unit = 1,000 tokens per minute). Azure charges each request's
prompt tokens plus its `max_tokens` reservation before the model runs, so a
single request larger than the limit is always rejected with HTTP 429.

To keep requests small, **Design with AI** uses two calls when the full
component library and its design guidance would exceed about 96 KB (a
heuristic on the context, not a provider limit). When the whole request fits,
it makes a single call that includes the cards for every selectable
authentication method as well as the in-use ones; if that complete request
does not fit, the two-call flow below applies:

1. **Plan.** SDS sends the prompt, the scenario outline (names, types and
   connections) and compact indexes of component types (ID, label, category,
   default role, whether guidance exists), protocols and authentication methods
   (`id`, `label`, `hasGuidance`, `usedInScenario`). The model returns up to 24
   type IDs the design needs, up to 24 protocol IDs and up to 8 authentication
   method IDs, chosen from strict lists. No guidance text is sent (the API
   rejects a plan request that carries authentication card bodies), and the
   output reservation is 1,000 tokens.
2. **Design.** SDS sends the normal design request, limited to the planned
   types plus any types already used in the scenario, with their complete
   guidance. Authentication guidance follows the same rule: complete cards for
   methods on included existing flows (bound to those flows) plus the selected
   methods (unbound, offered for conditional proposals), but not every
   selectable method. If the model needs a service that is not in that subset,
   it leaves the type blank and names the service in its answer. The design
   catalog still lists every selectable authentication method with
   `hasGuidance` and `guidanceSupplied`, plus the target-node authentication
   rules, so an unselected card never clears or forbids a method; a proposed
   method without a supplied card is reported as such in the status line.

Node, protocol and authentication cards share one **384,000-byte** serialized
guidance budget, and the whole request (question, context, history, guidance and
provider) must stay within **500,000 UTF-8 bytes**. These are byte limits, not
tokens: trusted system instructions and the response schema add provider input
outside the serialized request, and the debug bytes/4 figure is only an
estimate. A larger model does not raise these application limits. SDS checks
the complete request before sending and the API checks it again.

Before any call, SDS builds the request with only the cards already in use and
checks it. If that required context cannot fit, the error begins "Required
design context cannot be sent", reports the measured request and guidance bytes
against both limits, and no AI request is sent. If the selected cards plus that
context are too large, "Selected design guidance cannot be sent" explains that
one planning request was sent, the design call was not sent, nothing is
truncated or applied, and asks for a narrower design task (for example, one
scenario or fewer requested services). If the planning request itself (the
indexes plus conversation) is too large it is not sent. SDS does not
automatically split the work into batches, which could lose cross-flow and
trust-boundary reasoning, and does not loop asking for more cards. The two
calls are independent requests; the provider is not assumed to remember the
first, so the final request is self-contained. If the model, scenario or
catalog changes between the calls, or a planned ID no longer resolves with its
guidance, the design call is not sent; resend the prompt. Design Assistant Chat
and AI Analysis send the cards for in-use flow methods directly, with no extra
selection call.

Guidance is untrusted reference text, and its source URLs are never fetched.
Confirm your deployment's actual context window and output limits separately;
these limits are not proof that a live model will accept or answer well.

With the shipped library, both calls are typically well under 50,000 tokens.
That estimate predates authentication cards; recheck with `-DebugAI` after
cards are populated. Small catalogs still use a single call. The status line
reports how many component types were used. Claude and Codex use the same
two-phase flow.
With `-DebugAI`, each call logs its own sizing line (`mode` is `design-plan` or
`design`).

## 4. Secure it

Three settings matter, and they are independent. Apply all three.

### Disable key authentication

By default a Cognitive Services account accepts static API keys. Keys are
long-lived bearer secrets: anyone holding one is indistinguishable from you,
they are easy to leak into a terminal history or a file, and they carry no user
identity for auditing.

SecureDesignStudio never uses a key. The local API authenticates with
`DefaultAzureCredential`, which resolves your Azure CLI sign-in. So you can turn
key authentication off entirely with no loss of function:

```powershell
az resource update `
  --resource-group $resourceGroup `
  --name $account `
  --resource-type "Microsoft.CognitiveServices/accounts" `
  --set properties.disableLocalAuth=true
```

Confirm it took effect:

```powershell
az cognitiveservices account show `
  --name $account --resource-group $resourceGroup `
  --query "properties.disableLocalAuth"
```

Expect `true`. From this point the account accepts Microsoft Entra tokens only,
every call is attributable to a real identity, and a leaked key cannot be used
because none is valid.

### Restrict network access

Deny by default and allow only what you need. This is separate from
authentication: it limits *where* calls may originate, not *who* may make them.

```powershell
az cognitiveservices account update `
  --name $account --resource-group $resourceGroup `
  --set properties.networkAcls.defaultAction=Deny `
        properties.publicNetworkAccess=Enabled

az cognitiveservices account network-rule add `
  --name $account --resource-group $resourceGroup `
  --ip-address "<your-public-ip>"
```

Find the address Azure actually sees with `curl -s https://api.ipify.org`.

Two practical warnings:

- A rule holding a private address such as `10.0.0.0/8` or `100.64.0.0/10`
  (carrier-grade NAT) can never match internet traffic. If a portal button
  recorded one, your real egress address is still missing.
- Corporate networks often rotate egress addresses across a pool, so a single
  allow-listed address produces intermittent `403` responses. Allow-list the
  documented corporate range, or use a private endpoint, instead of adding
  addresses one at a time.

For a stable, non-internet path, use a
[private endpoint](https://learn.microsoft.com/azure/ai-services/cognitive-services-virtual-networks)
and set `properties.publicNetworkAccess=Disabled`.

### Keep diagnostics

Send account logs somewhere durable so assistant use is reviewable:

```powershell
az monitor diagnostic-settings create `
  --name "openai-audit" `
  --resource $(az cognitiveservices account show --name $account --resource-group $resourceGroup --query id -o tsv) `
  --workspace "<your-log-analytics-workspace-resource-id>" `
  --logs '[{"category":"Audit","enabled":true},{"category":"RequestResponse","enabled":true}]'
```

Review your organization's guidance before enabling `RequestResponse`, which
records prompt and completion content.

## 5. Grant yourself access

With key authentication disabled, a role assignment is mandatory. Owning the
subscription is **not** sufficient: management-plane ownership does not grant
data-plane inference rights.

```powershell
$accountId = az cognitiveservices account show `
  --name $account --resource-group $resourceGroup --query id -o tsv
$userId = az ad signed-in-user show --query id -o tsv

az role assignment create `
  --assignee-object-id $userId `
  --assignee-principal-type User `
  --role "Cognitive Services OpenAI User" `
  --scope $accountId
```

On Azure AI Foundry accounts the equivalent role is **Azure AI User**.
Assignments can take a few minutes to propagate.

Grant the narrowest role that works. **Cognitive Services OpenAI User** allows
inference; it does not allow creating or deleting deployments.

## 6. Point SecureDesignStudio at it

Set these in the PowerShell window that will launch the app:

```powershell
$env:AZURE_OPENAI_ENDPOINT = "https://<your-account-name>.openai.azure.com"
$env:MODEL_DEPLOYMENT_NAME = "gpt-4.1"
```

Neither value is a secret, and no key is involved. Both are read by the
launcher and written to an ignored `api\local.settings.json`. Never commit that
file, and never paste a key, token, or real personal data into it or into a
diagram.

Because they are set per window, they disappear when you close it. To persist
them for your own account:

```powershell
[Environment]::SetEnvironmentVariable("AZURE_OPENAI_ENDPOINT", "https://<your-account-name>.openai.azure.com", "User")
[Environment]::SetEnvironmentVariable("MODEL_DEPLOYMENT_NAME", "gpt-4.1", "User")
```

Then start the app:

```powershell
az login
.\Start-SecureDesignStudio-WithAI.ps1
```

## 7. Verify and troubleshoot

Confirm access before starting, which reports problems as a clear result rather
than an opaque failure in the browser:

```powershell
.\Start-SecureDesignStudio-WithAI.ps1 -VerifyEndpoint
```

| Symptom | Cause | Fix |
|---|---|---|
| Launcher reports missing configuration | No endpoint or deployment name set | [Section 6](#6-point-securedesignstudio-at-it) |
| `401` / `PermissionDenied` | The signed-in identity has no data-plane role | Assign **Cognitive Services OpenAI User** ([section 5](#5-grant-yourself-access)); allow time to propagate |
| `403` "A Virtual Network is configured for this resource" | The account firewall rejected your public IP | Add the current address, or the corporate range ([section 4](#4-secure-it)) |
| Intermittent `403`, sometimes working | Rotating corporate egress addresses | Allow-list the range or use a private endpoint |
| `404` `DeploymentNotFound` | Wrong deployment name | List deployments ([section 3](#3-deploy-a-model)) |
| Assistant fails although the probe passes | Deployed model rejects the request parameters | Deploy a GPT-4-class model ([section 3](#3-deploy-a-model)) |
| Requests fail only via the app | No signed-in identity for the local API | Run `az login`, restart the launcher |
| API on port 7071 will not start | Unsupported Node version for the Functions host | Use Node 24 LTS or Node 22; the launcher warns and offers to install it |

An API key is never a valid fix for any row above. If a suggestion involves
re-enabling key authentication, it is working around the security posture in
[section 4](#4-secure-it) rather than solving the problem.

## 8. Running cost and cleanup

A deployed model bills per token, so the resource keeps costing money while it
exists even if the app is closed. Remove the deployment or the whole resource
group when you no longer need it:

```powershell
az cognitiveservices account deployment delete `
  --name $account --resource-group $resourceGroup --deployment-name "gpt-4.1"

# or remove everything created here
az group delete --name $resourceGroup
```

Deleting the resource group is irreversible and removes every resource inside
it. Confirm the group contains only what you created for this purpose.

## Related documentation

- [User guide](user-guide.md): installing and using the app.
- [Advanced configuration](advanced-configuration.md): runtime modes, what the
  assistant sends, collaboration, and the implementation map.
