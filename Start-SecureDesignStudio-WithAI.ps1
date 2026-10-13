<#
.SYNOPSIS
    Starts SecureDesignStudio with the optional AI Design Assistant enabled.

.DESCRIPTION
    Same app as Start-SecureDesignStudio.ps1. Claude and Codex use a local Vite
    bridge; Azure uses the local Azure Functions host. Choose once here, switch
    in SDS.

    This is bring-your-own-AI: no AI account ships with the app. Azure needs
    your authorized endpoint/deployment and Entra identity. Claude/Codex need
    their official CLI and consumer subscription sign-in, not Azure credentials.

    See docs/bring-your-own-ai.md for provider setup and data handling.

.PARAMETER Provider
    Initial AI provider: Azure, Claude or Codex. Omit for an interactive menu.
    Non-interactive callers must specify the provider.

.PARAMETER SkipAuthCheck
    Start without checking for an Azure identity. Vite and the API still run, but
    Design Assistant requests fail until a signed-in identity is available.

.PARAMETER VerifyEndpoint
    Additionally probe the configured deployment before starting, which detects a
    missing data-plane role, a rotated client IP, or a wrong deployment name.

.PARAMETER DiagnoseProvider
    Check Claude/Codex readiness and show executable-discovery diagnostics only.
    Does not install dependencies, start servers, or run inference.

.PARAMETER DebugAI
    Enable bounded, sanitized interaction diagnostics. Azure logs request sizing
    and exact usage when available; no prompts or raw CLI output are logged.

.PARAMETER DebugAIContent
    Also log full prompts, model context and provider responses to a local
    temporary file. Sensitive content is included; do not share the file blindly.

.EXAMPLE
    az login
    .\Start-SecureDesignStudio-WithAI.ps1

.EXAMPLE
    .\Start-SecureDesignStudio-WithAI.ps1 -VerifyEndpoint

.EXAMPLE
    .\Start-SecureDesignStudio-WithAI.ps1 -Provider Claude
#>
[CmdletBinding()]
param(
    [ValidateSet("Azure", "Claude", "Codex")]
    [string]$Provider,
    [switch]$SkipAuthCheck,
    [switch]$VerifyEndpoint,
    [switch]$DiagnoseProvider,
    [switch]$DebugAI,
    [switch]$DebugAIContent
)

$ErrorActionPreference = "Stop"

# This script lives in the repository root, so its own directory is the root.
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot "scripts\launcher-common.ps1")

$byoAiDoc = "docs\bring-your-own-ai.md"

Write-Host ""
Write-Host "SecureDesignStudio - with AI Design Assistant" -ForegroundColor Cyan
Write-Host "Use your Azure deployment, Claude subscription, or ChatGPT subscription." -ForegroundColor DarkGray
Write-Host "Prompts and included model context are sent to the provider you choose." -ForegroundColor DarkGray
Write-Host "See $byoAiDoc. Ordinary startup checks do not run inference." -ForegroundColor DarkGray
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

if (-not $Provider) {
    if (-not (Test-LauncherInteractive)) {
        Write-SetupError @("Specify -Provider Azure, -Provider Claude, or -Provider Codex for non-interactive startup.")
        exit 1
    }
    Write-Host "Choose your initial AI provider:"
    Write-Host "  1. Azure OpenAI / Foundry"
    Write-Host "  2. Claude Code - your Claude subscription"
    Write-Host "  3. Codex - your ChatGPT subscription"
    do {
        $choice = Read-Host "Enter 1, 2 or 3"
        $Provider = switch ($choice) { "1" { "Azure" } "2" { "Claude" } "3" { "Codex" } }
        if (-not $Provider) { Write-Host "Choose 1, 2 or 3." -ForegroundColor Yellow }
    } until ($Provider)
}
if ($SkipAuthCheck -and $Provider -ne "Azure") {
    Write-SetupError @("-SkipAuthCheck applies only to Azure. Subscription sign-in must be verified for Claude and Codex.")
    exit 1
}
if ($VerifyEndpoint -and $Provider -ne "Azure") {
    Write-SetupError @("-VerifyEndpoint currently probes Azure only. Claude/Codex startup verifies sign-in without consuming inference.")
    exit 1
}
if ($DiagnoseProvider -and $Provider -eq "Azure") {
    Write-SetupError @("-DiagnoseProvider applies to Claude and Codex. Use -VerifyEndpoint for Azure.")
    exit 1
}
$env:SDS_AI_PROVIDER = $Provider.ToLowerInvariant()
$env:SDS_LOCAL_AI = "1"
$env:SDS_AI_DEBUG = if ($DebugAI -or $DebugAIContent) { "1" } else { "0" }
$env:SDS_AI_DEBUG_CONTENT = if ($DebugAIContent) { "1" } else { "0" }
if ($DebugAI) { Write-Host "AI interaction diagnostics enabled (sanitized; no raw provider output)." -ForegroundColor Yellow }
if ($DebugAIContent) {
    Write-Host "WARNING: AI content logging includes full prompts, model context and responses. Logs are local temporary files; protect and delete them after debugging." -ForegroundColor Yellow
}

$nodeVersion = Assert-NodeToolchain -NoInstallOffer:$DiagnoseProvider
if ($nodeVersion) {
    Write-Host "Node.js $nodeVersion" -ForegroundColor DarkGray
}

if ($Provider -ne "Azure") {
    $cliName = $Provider.ToLowerInvariant()
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & node "scripts\ai-provider-preflight.mjs" --provider $cliName --diagnostics 2>$null | Out-String
        $exitCode = $LASTEXITCODE
        try { $readiness = $output | ConvertFrom-Json -ErrorAction Stop } catch { $readiness = $null }
    } finally { $ErrorActionPreference = $previous }
    $validReadiness = $readiness -and $readiness.id -eq $cliName -and
        $readiness.available -is [bool] -and $readiness.message -is [string]
    $ready = $exitCode -eq 0 -and $validReadiness -and $readiness.available
    if ($DiagnoseProvider -or -not $ready) {
        Write-LocalProviderDiagnostics -Provider $cliName -PreflightExitCode $exitCode -ParsedReadiness ([bool]$validReadiness) -Diagnostics $readiness.diagnostics
    }
    if (-not $ready) {
        $instructions = if ($Provider -eq "Claude") {
            "Use the official native Claude Code CLI from https://code.claude.com/docs/en/setup, then run 'claude auth login' and choose your Claude subscription."
        } else {
            "Use the official native Codex CLI from https://developers.openai.com/codex/cli, then run 'codex login' and sign in with ChatGPT."
        }
        $message = if ($validReadiness) { $readiness.message } else {
            "The readiness helper did not return a valid response (exit $exitCode). Check Node.js type-stripping support and that scripts\ai-provider-preflight.mjs exists."
        }
        Write-SetupError @(
            "$Provider is unavailable: $message",
            $instructions,
            "A completed login does not establish executable discovery or isolation support.",
            "No provider fallback was attempted. No credentials were printed."
        )
        exit 1
    }
    Write-Host "Initial provider: $Provider ($($readiness.message))" -ForegroundColor DarkGray
    if ($DiagnoseProvider) {
        Write-Host "Diagnostics complete. No servers started and no inference requested." -ForegroundColor DarkGray
        exit 0
    }
}

if ($Provider -ne "Azure") {
    Assert-PortFree -Port 5173 -Purpose "SecureDesignStudio"
    Install-ProjectDependencies -RelativePath "." -Label "app"

    Write-Host ""
    Write-SetupStep "Starting SecureDesignStudio at http://localhost:5173/ with the local $Provider bridge."
    Write-Host "No Azure Functions host or API package is needed for Claude/Codex." -ForegroundColor DarkGray
    Write-Host "Select a scenario, then choose Review > Design Assistant." -ForegroundColor DarkGray
    Write-Host "Both AI surfaces share the provider selector. Press Ctrl+C to stop." -ForegroundColor DarkGray
    Write-Host ""

    $previousCliOnly = $env:SDS_LOCAL_AI_CLI_ONLY
    $env:SDS_LOCAL_AI_CLI_ONLY = "1"
    try {
        npm run dev:ai:local
        $localExitCode = $LASTEXITCODE
    } finally {
        if ($null -eq $previousCliOnly) { Remove-Item Env:SDS_LOCAL_AI_CLI_ONLY -ErrorAction SilentlyContinue }
        else { $env:SDS_LOCAL_AI_CLI_ONLY = $previousCliOnly }
    }
    exit $localExitCode
}

# -----------------------------------------------------------------------------
# Azure Functions Core Tools
# -----------------------------------------------------------------------------
$funcPath = Resolve-FuncPath
if (-not $funcPath) {
    Write-SetupError @(
        "MISSING PREREQUISITE: Azure Functions Core Tools ('func')",
        "",
        "The Azure provider needs it; it runs the local API on port 7071.",
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
if ($Provider -eq "Azure") {
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
        Write-SetupStep "Verifying $deployment on $endpoint (inference probe; may incur usage) ..."
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
Write-Host "Initial AI provider: $Provider. Both AI surfaces share the provider selector." -ForegroundColor DarkGray
Write-Host "Press Ctrl+C in this window to stop the app and the API." -ForegroundColor DarkGray
Write-Host ""

npm run dev:ai
exit $LASTEXITCODE
