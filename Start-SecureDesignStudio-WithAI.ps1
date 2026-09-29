<#
.SYNOPSIS
    Starts SecureDesignStudio with the optional AI Design Assistant enabled.

.DESCRIPTION
    Same app as Start-SecureDesignStudio.ps1, plus a local Azure Functions host
    that forwards Design Assistant requests to YOUR OWN Azure OpenAI deployment.

    This is bring-your-own-AI: no AI service ships with the app, and none is
    provided for you. You need an Azure OpenAI resource you are allowed to use,
    its endpoint, a model deployment name, and a signed-in Azure identity holding
    a data-plane role on it.

    See docs/bring-your-own-ai.md to create and secure that resource.

.PARAMETER SkipAuthCheck
    Start without checking for an Azure identity. Vite and the API still run, but
    Design Assistant requests fail until a signed-in identity is available.

.PARAMETER VerifyEndpoint
    Additionally probe the configured deployment before starting, which detects a
    missing data-plane role, a rotated client IP, or a wrong deployment name.

.EXAMPLE
    az login
    .\Start-SecureDesignStudio-WithAI.ps1

.EXAMPLE
    .\Start-SecureDesignStudio-WithAI.ps1 -VerifyEndpoint
#>
[CmdletBinding()]
param(
    [switch]$SkipAuthCheck,
    [switch]$VerifyEndpoint
)

$ErrorActionPreference = "Stop"

# This script lives in the repository root, so its own directory is the root.
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot "scripts\launcher-common.ps1")

$byoAiDoc = "docs\bring-your-own-ai.md"

Write-Host ""
Write-Host "SecureDesignStudio - with AI Design Assistant" -ForegroundColor Cyan
Write-Host "Bring your own Azure OpenAI deployment. See $byoAiDoc." -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path -LiteralPath "package.json")) {
    Write-SetupError @(
        "This script must stay in the repository root.",
        "",
        "package.json was not found next to it, so the clone looks incomplete or the",
        "script was copied elsewhere. Clone the repository and run the copy in its root:",
        "",
        "  git clone <repository-url-from-your-distribution> SecureDesignStudio",
        "  cd SecureDesignStudio",
        "  .\Start-SecureDesignStudio-WithAI.ps1"
    )
    exit 1
}

$nodeVersion = Assert-NodeToolchain
if ($nodeVersion) {
    Write-Host "Node.js $nodeVersion" -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# Azure Functions Core Tools
# -----------------------------------------------------------------------------
$funcPath = Resolve-FuncPath
if (-not $funcPath) {
    Write-SetupError @(
        "MISSING PREREQUISITE: Azure Functions Core Tools ('func')",
        "",
        "Only this optional AI workflow needs it; it runs the local API on port 7071.",
        "",
        "Install it once, using either option:",
        "",
        "  winget install --id Microsoft.Azure.FunctionsCoreTools -e",
        "  npm install -g azure-functions-core-tools@4 --unsafe-perm true",
        "",
        "Then open a new PowerShell window so PATH updates apply, confirm with",
        "'func --version', and run this script again.",
        "",
        "To model without AI, no install is needed - run:",
        "",
        "  .\Start-SecureDesignStudio.ps1"
    )
    exit 1
}

# Core Tools installed outside PATH still works when child processes inherit its directory.
$funcDirectory = Split-Path -Parent $funcPath
$pathSeparator = [System.IO.Path]::PathSeparator
if (($env:PATH -split $pathSeparator) -notcontains $funcDirectory) {
    Write-Host "Using Azure Functions Core Tools at $funcPath" -ForegroundColor DarkGray
    $env:PATH = "$funcDirectory$pathSeparator$env:PATH"
}

if ($nodeVersion -and ($script:FunctionsNodeMajors -notcontains $nodeVersion.Major)) {
    Write-SetupWarning @(
        "Warning: Node $nodeVersion is outside the versions the Azure Functions host",
        "         supports ($($script:FunctionsNodeMajors -join ', ')).",
        "         Vite still runs, but the API on port 7071 may refuse to start and",
        "         the Design Assistant may then return errors."
    )
    if (Invoke-NodeInstallOffer) { exit 0 }
}

# -----------------------------------------------------------------------------
# Your Azure OpenAI deployment
# -----------------------------------------------------------------------------
$endpoint = Get-ConfiguredValue -SettingNames @("AZURE_OPENAI_ENDPOINT", "AZURE_AI_ENDPOINT") -EnvNames @("AZURE_OPENAI_ENDPOINT", "AZURE_AI_ENDPOINT")
$deployment = Get-ConfiguredValue -SettingNames @("MODEL_DEPLOYMENT_NAME") -EnvNames @("MODEL_DEPLOYMENT_NAME")

if (-not $endpoint -or -not $deployment) {
    $missing = @()
    if (-not $endpoint) { $missing += "AZURE_OPENAI_ENDPOINT" }
    if (-not $deployment) { $missing += "MODEL_DEPLOYMENT_NAME" }

    Write-SetupError @(
        "MISSING CONFIGURATION: $($missing -join ' and ')",
        "",
        "The AI Design Assistant needs your own Azure OpenAI deployment. Nothing is",
        "provided with the app, and no AI service is shared with you.",
        "",
        "If you already have one, set these in THIS PowerShell window and re-run:",
        "",
        "  `$env:AZURE_OPENAI_ENDPOINT = 'https://<your-resource>.openai.azure.com'",
        "  `$env:MODEL_DEPLOYMENT_NAME = '<your-model-deployment-name>'",
        "",
        "They are not secrets, and they are not saved into the repository.",
        "",
        "If you do NOT have one yet, follow $byoAiDoc to create and secure it.",
        "",
        "To model without AI instead, run:",
        "",
        "  .\Start-SecureDesignStudio.ps1"
    )
    exit 1
}

if ($endpoint -notmatch "^https://") {
    Write-SetupError @(
        "INVALID CONFIGURATION: the endpoint must use HTTPS.",
        "",
        "Current value: $endpoint",
        "",
        "Use the resource endpoint shown in the Azure portal, for example:",
        "",
        "  https://<your-resource>.openai.azure.com"
    )
    exit 1
}

Write-Host "Azure OpenAI endpoint: $endpoint" -ForegroundColor DarkGray
Write-Host "Model deployment:      $deployment" -ForegroundColor DarkGray

# -----------------------------------------------------------------------------
# Azure identity
#
# A correctly secured account has local (key) authentication disabled, so it
# accepts Microsoft Entra tokens only. The Function resolves an identity through
# DefaultAzureCredential, which falls back to the Azure CLI sign-in locally.
# Without one, every Design Assistant request fails as an opaque HTTP 500.
# -----------------------------------------------------------------------------
if ($SkipAuthCheck) {
    Write-SetupWarning @(
        "Skipping the Azure identity check (-SkipAuthCheck).",
        "Design Assistant requests will fail until a signed-in identity is available."
    )
} else {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        Write-SetupError @(
            "MISSING PREREQUISITE: Azure CLI ('az')",
            "",
            "A secured Azure OpenAI account accepts Microsoft Entra tokens only, and the",
            "local API obtains one from your Azure CLI sign-in. No API key is used.",
            "",
            "Install it from https://aka.ms/installazurecli, open a new PowerShell window,",
            "run 'az login', then run this script again.",
            "",
            "To start without the assistant, re-run with -SkipAuthCheck."
        )
        exit 1
    }

    $accountShow = Invoke-AzQuiet @("account", "show", "--query", "user.name", "-o", "tsv")
    $signedInUser = $accountShow.Output
    if ($accountShow.ExitCode -ne 0 -or -not $signedInUser) {
        Write-SetupError @(
            "NOT SIGNED IN TO AZURE",
            "",
            "A secured Azure OpenAI account accepts Microsoft Entra tokens only, so the",
            "local API needs a signed-in identity. Run:",
            "",
            "  az login",
            "",
            "then run this script again. To start without the assistant, use -SkipAuthCheck."
        )
        exit 1
    }

    $tokenCheck = Invoke-AzQuiet @("account", "get-access-token", "--resource", "https://cognitiveservices.azure.com", "--query", "expiresOn", "-o", "tsv")
    if ($tokenCheck.ExitCode -ne 0) {
        Write-SetupError @(
            "Signed in as $signedInUser, but an Azure OpenAI token could not be acquired.",
            "",
            "The sign-in has most likely expired or needs re-authentication. Run:",
            "",
            "  az login",
            "",
            "then run this script again."
        )
        exit 1
    }

    Write-Host "Azure identity:        $signedInUser" -ForegroundColor DarkGray

    # DefaultAzureCredential prefers these over the CLI sign-in, which silently
    # changes which principal the Function presents.
    if ($env:AZURE_CLIENT_ID -and $env:AZURE_TENANT_ID -and ($env:AZURE_CLIENT_SECRET -or $env:AZURE_CLIENT_CERTIFICATE_PATH)) {
        Write-SetupWarning @(
            "Warning: AZURE_CLIENT_ID/AZURE_TENANT_ID credentials are set in this session.",
            "         The API will use that service principal instead of $signedInUser.",
            "         Clear them if you intended to use your own identity."
        )
    }

    if ($VerifyEndpoint) {
        Write-SetupStep "Verifying $deployment on $endpoint ..."
        $token = (Invoke-AzQuiet @("account", "get-access-token", "--resource", "https://cognitiveservices.azure.com", "--query", "accessToken", "-o", "tsv")).Output
        $probeUri = "$($endpoint.TrimEnd('/'))/openai/deployments/$([System.Uri]::EscapeDataString($deployment))/chat/completions?api-version=2024-10-21"
        $probeBody = @{ messages = @(@{ role = "user"; content = "ping" }); max_tokens = 1 } | ConvertTo-Json -Depth 5
        try {
            Invoke-RestMethod -Uri $probeUri -Method Post -Headers @{ Authorization = "Bearer $token" } `
                -ContentType "application/json" -Body $probeBody -TimeoutSec 60 -ErrorAction Stop | Out-Null
            Write-Host "Endpoint reachable." -ForegroundColor Green
        } catch {
            $status = 0
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
            $hint = switch ($status) {
                401 { "$signedInUser lacks a data-plane role. Assign 'Cognitive Services OpenAI User' on the account." }
                403 { "The account firewall rejected this machine's public IP, which may have rotated." }
                404 { "Deployment '$deployment' does not exist on that account." }
                default { "See the error above." }
            }
            Write-SetupWarning @(
                "Warning: endpoint probe failed (HTTP $status). $hint",
                "         See $byoAiDoc for the access checklist.",
                "         Design Assistant requests will fail until this is resolved; starting anyway."
            )
        }
    }
}

# -----------------------------------------------------------------------------
# Ports and dependencies
# -----------------------------------------------------------------------------
Assert-PortFree -Port 5173 -Purpose "SecureDesignStudio"
Assert-PortFree -Port 7071 -Purpose "The local Design Assistant API"

Install-ProjectDependencies -RelativePath "." -Label "app"
Install-ProjectDependencies -RelativePath "api" -Label "API"

Write-Host ""
Write-SetupStep "Starting SecureDesignStudio at http://localhost:5173/"
Write-Host "Select a scenario, then choose Review > Design Assistant." -ForegroundColor DarkGray
Write-Host "Press Ctrl+C in this window to stop the app and the API." -ForegroundColor DarkGray
Write-Host ""

npm run dev:ai
exit $LASTEXITCODE
