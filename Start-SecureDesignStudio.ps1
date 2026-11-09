<#
.SYNOPSIS
    Starts SecureDesignStudio for ordinary modeling, with no AI and no cloud account.

.DESCRIPTION
    Checks prerequisites, installs dependencies on first run, and serves the app
    at http://localhost:5173/.

    This mode needs no Azure subscription, credentials, or network access beyond
    the initial dependency install. Collaboration and the Design Assistant stay
    disabled. For the optional AI assistant, use Start-SecureDesignStudio-WithAI.ps1.

.EXAMPLE
    .\Start-SecureDesignStudio.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

# This script lives in the repository root, so its own directory is the root.
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot "scripts\launcher-common.ps1")

Write-Host ""
Write-Host "SecureDesignStudio" -ForegroundColor Cyan
Write-Host "Local modeling - no AI, no Azure account, no credentials." -ForegroundColor DarkGray
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
        "  .\Start-SecureDesignStudio.ps1"
    )
    exit 1
}

$nodeVersion = Assert-NodeToolchain
if ($nodeVersion) {
    Write-Host "Node.js $nodeVersion" -ForegroundColor DarkGray
}

Assert-PortFree -Port 5173 -Purpose "SecureDesignStudio"

Install-ProjectDependencies -RelativePath "." -Label "app"

Write-Host ""
Write-SetupStep "Starting SecureDesignStudio at http://localhost:5173/"
Write-Host "Press Ctrl+C in this window to stop it." -ForegroundColor DarkGray
Write-Host ""

npm run dev
exit $LASTEXITCODE
