# Bring your own AI: create and secure an Azure OpenAI instance

*Updated: 2026-09-22 - Added for the optional Design Assistant.*

The AI Design Assistant is **bring-your-own-AI**. No model service ships with
SecureDesignStudio, none is shared with you, and the app has no default AI
provider. To use `Start-SecureDesignStudio-WithAI.ps1` you supply an Azure
OpenAI resource that you are authorized to create and use.

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
GPT-4-class model such as `gpt-4.1` or `gpt-4o`.

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
