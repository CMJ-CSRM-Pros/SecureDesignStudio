# Shared prerequisite checks for the root launchers.
#
# Start-SecureDesignStudio.ps1 and Start-SecureDesignStudio-WithAI.ps1 dot-source
# this file. It is not a user entry point: the launchers stay in the repository
# root so a new clone shows them immediately.
#
# Every check reports what is missing, why the tool needs it, and the exact
# command that fixes it, because a new user cannot act on a bare failure.

# The locked frontend toolchain (Vite 7) requires this minimum.
$script:MinimumNodeVersion = [version]"22.12.0"
# Node majors the in-process Azure Functions host supports. Node 24 and 22 are
# the GA versions for the Functions v4 Node.js model; Node 20 reached end of
# support in April 2026. Odd-numbered Current releases are never supported.
# Source: https://learn.microsoft.com/azure/azure-functions/functions-reference-node
$script:FunctionsNodeMajors = @(22, 24)

function Write-SetupError {
    param([string[]]$Lines)
    Write-Host ""
    foreach ($line in $Lines) {
        Write-Host $line -ForegroundColor Red
    }
    Write-Host ""
}

function Write-SetupWarning {
    param([string[]]$Lines)
    Write-Host ""
    foreach ($line in $Lines) {
        Write-Host $line -ForegroundColor Yellow
    }
    Write-Host ""
}

function Write-SetupStep {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-LocalProviderDiagnostics {
    param(
        [ValidateSet("claude", "codex")][string]$Provider,
        [int]$PreflightExitCode,
        [bool]$ParsedReadiness,
        [object[]]$Diagnostics
    )
    Write-Host ""
    Write-Host "Local provider diagnostics (no inference or credential output):" -ForegroundColor Cyan
    Write-Host "  Preflight exit code: $PreflightExitCode; valid readiness response: $ParsedReadiness"
    Write-Host "  PowerShell: $($PSVersionTable.PSVersion); OS architecture: $env:PROCESSOR_ARCHITECTURE"
    Write-Host "  Native executable required: $Provider.exe outside the SDS repository"

    $commands = @(Get-Command $Provider -All -CommandType Application,ExternalScript -ErrorAction SilentlyContinue)
    if ($commands.Count -eq 0) {
        Write-Host "  PowerShell found no file-backed '$Provider' command."
    }
    foreach ($command in $commands) {
        Write-Host "  PowerShell command: $($command.CommandType) - $($command.Path)"
    }

    $nativeCandidates = 0
    $ignoredEntries = 0
    foreach ($directory in ($env:PATH -split [System.IO.Path]::PathSeparator)) {
        if (-not $directory -or -not [System.IO.Path]::IsPathRooted($directory) -or
            $directory -notmatch '^(?:[A-Za-z]:[\\/]|\\\\)') {
            $ignoredEntries++
            continue
        }
        $candidate = Join-Path $directory "$Provider.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $nativeCandidates++
            Write-Host "  Native PATH candidate: $candidate"
        }
    }
    Write-Host "  Native PATH candidates: $nativeCandidates; non-absolute/empty PATH entries ignored: $ignoredEntries"
    foreach ($entry in $Diagnostics) {
        if ($entry.stage -is [string] -and $entry.message -is [string]) {
            Write-Host "  [$($entry.stage)] $($entry.message)"
        }
    }
    Write-Host "  PATH candidates alone are not proof of readiness; the shared resolver also checks"
    Write-Host "  supported Codex npm packages. The last stage above identifies where checking stopped."
    Write-Host "  Repository-local binaries and shell wrappers are never executed."
    if ($Provider -eq "codex") {
        Write-Host "  If npm discovery fails, 'npm root -g' locates packages for installation inspection."
        Write-Host "  Do not rename a wrapper to .exe or copy login tokens into SDS."
    }
}

function Get-NodeVersion {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    try {
        $raw = (& node --version 2>&1 | Out-String).Trim()
    } catch {
        return $null
    }
    if ($raw -match "v?(\d+)\.(\d+)\.(\d+)") {
        return [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $Matches[3])
    }
    return $null
}

# Keep $script:RecommendedNodeMajor and the winget package id in step with
# $script:FunctionsNodeMajors above.
$script:RecommendedNodeMajor = 24

# True only when a human can answer a prompt. Browser suites and CI must never
# block on Read-Host.
function Test-LauncherInteractive {
    if ($env:CI) { return $false }
    if ($env:PS_LAUNCHER_NONINTERACTIVE) { return $false }
    if (-not [Environment]::UserInteractive) { return $false }
    return $true
}

function Test-LauncherElevated {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

# Map the winget failure codes worth naming. Anything else still gets its hex
# form, which is what the user needs to search for.
function Get-WingetFailureHint {
    param([int]$ExitCode)
    # Negative codes are winget HRESULTs; MSI codes such as 1603 are positive
    # and must not have 2^32 added to them.
    $hex = if ($ExitCode -lt 0) {
        "0x{0:X8}" -f [uint32]([uint64]4294967296 + $ExitCode)
    } else {
        "0x{0:X8}" -f [uint32]$ExitCode
    }
    if ($ExitCode -eq -1978335226) {
        return @(
            "winget returned $ExitCode ($hex), APPINSTALLER_CLI_ERROR_SHELLEXEC_INSTALL_FAILED.",
            "",
            "The Node.js package is a machine-wide MSI, so Windows requires",
            "administrator approval to install it. This code almost always means",
            "that approval was declined, dismissed, or could not be shown."
        )
    }
    if ($ExitCode -eq 1603) {
        return @(
            "The MSI returned 1603, ERROR_INSTALL_FAILURE.",
            "",
            "For Node.js that nearly always means one of two things:",
            "  * node.exe was in use, so the installer could not replace it, or",
            "  * a different Node.js package already owns the install directory.",
            "",
            "Rebooting releases every lock, and uninstalling the existing Node.js",
            "first clears the directory."
        )
    }
    return @("winget returned $ExitCode ($hex), so Node was not upgraded.")
}

# $true when winget reports the package as installed. 'winget list' exits 0 on a
# match and -1978335212 (0x8A150014) when nothing matches.
function Test-WingetPackageInstalled {
    param([string]$Id)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & winget list --id $Id --exact --accept-source-agreements 2>&1 | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previous
    }
}

# Running node.exe processes from the directory the installer would overwrite.
# Node bundled inside other applications lives elsewhere and does not block it.
function Get-LockingNodeProcesses {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if (-not $command) { return @() }
    $installDirectory = Split-Path -Parent $command.Source
    try {
        return @(Get-Process node -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -and (Split-Path -Parent $_.Path) -eq $installDirectory
        })
    } catch {
        return @()
    }
}

# Run winget, elevating first when the current window is not already elevated.
# Returns the process exit code, or $null when elevation was refused.
function Invoke-WingetInstall {
    param([string[]]$Arguments)

    if (Test-LauncherElevated) {
        & winget @Arguments
        return $LASTEXITCODE
    }

    Write-Host "Requesting administrator approval..." -ForegroundColor DarkGray
    try {
        $process = Start-Process -FilePath "winget" -ArgumentList $Arguments `
            -Verb RunAs -Wait -PassThru -ErrorAction Stop
        return $process.ExitCode
    } catch {
        # The UAC dialog was cancelled, or policy blocks elevation.
        return $null
    }
}

# Offer to install a supported Node.js. Returns $true when an install ran, in
# which case the caller must stop: PATH changes never reach the current
# process, so this session would keep resolving the old node.exe.
function Invoke-NodeInstallOffer {
    $target = $script:RecommendedNodeMajor
    $nvm = Get-Command nvm -ErrorAction SilentlyContinue
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $elevated = Test-LauncherElevated
    $needsElevation = $false

    if ($nvm) {
        $commands = @("nvm install $target", "nvm use $target")
        $consequence = @(
            "nvm-windows switches the active Node version for your user account.",
            "It is reversible at any time with 'nvm use <version>'."
        )
    } elseif ($winget) {
        # OpenJS.NodeJS is the Current release and is NOT supported here;
        # OpenJS.NodeJS.LTS is the one that tracks Node 24 LTS.
        $ltsId = "OpenJS.NodeJS.LTS"
        $currentId = "OpenJS.NodeJS"
        $wingetArguments = @(
            "install", "--id", $ltsId, "--exact",
            "--accept-source-agreements", "--accept-package-agreements"
        )
        $commands = @("winget " + ($wingetArguments -join " "))
        $needsElevation = $true
        $consequence = @(
            "This replaces the machine-wide Node.js installation, so it affects",
            "every project on this computer, not just SecureDesignStudio."
        )

        # Both conditions below make the MSI fail with 1603. Detect them here
        # rather than let the user discover them as a bare exit code.
        $blockers = @()

        if ((-not (Test-WingetPackageInstalled -Id $ltsId)) -and
            (Test-WingetPackageInstalled -Id $currentId)) {
            $blockers += @(
                "A different Node.js package already owns the install directory.",
                "",
                "  installed: $currentId (the Current release)",
                "  wanted:    $ltsId",
                "",
                "They are separate winget packages targeting the same folder, so",
                "installing over the top fails with MSI error 1603. The existing",
                "one has to be removed first:",
                "",
                "  winget uninstall --id $currentId --exact",
                "  $($commands[0])"
            )
        }

        $locking = Get-LockingNodeProcesses
        if ($locking.Count -gt 0) {
            $blockers += @(
                "$($locking.Count) running node.exe process(es) would lock the files the",
                "installer needs to replace, which also fails with MSI error 1603.",
                "",
                "Close the editors, terminals and dev servers using Node, or simply",
                "reboot, then install before starting anything else."
            )
        }

        if ($blockers.Count -gt 0) {
            Write-Host ""
            Write-Host "CANNOT INSTALL AUTOMATICALLY YET" -ForegroundColor Yellow
            foreach ($line in $blockers) {
                Write-Host $line -ForegroundColor Yellow
            }
            Write-Host ""
            Write-Host "Run the steps above from an elevated PowerShell window." -ForegroundColor Yellow
            Write-Host "nvm-windows avoids both problems and needs no elevation:" -ForegroundColor DarkGray
            Write-Host "https://github.com/coreybutler/nvm-windows" -ForegroundColor DarkGray
            return $false
        }
    } else {
        Write-Host "To upgrade, install Node $target LTS from https://nodejs.org/ (the 'LTS' download)," -ForegroundColor Yellow
        Write-Host "then open a new PowerShell window and run this script again." -ForegroundColor Yellow
        return $false
    }

    Write-Host ""
    Write-Host "To upgrade, run:" -ForegroundColor Yellow
    foreach ($command in $commands) {
        Write-Host "  $command" -ForegroundColor Yellow
    }
    Write-Host ""
    foreach ($line in $consequence) {
        Write-Host $line -ForegroundColor DarkGray
    }

    if ($needsElevation -and -not $elevated) {
        Write-Host ""
        Write-Host "ADMINISTRATOR RIGHTS REQUIRED" -ForegroundColor Yellow
        Write-Host "The Node.js package is a machine-wide MSI and this window is not" -ForegroundColor Yellow
        Write-Host "elevated, so Windows will show a User Account Control prompt." -ForegroundColor Yellow
        Write-Host "Approve it, or the install fails with 0x8A150006." -ForegroundColor Yellow
        Write-Host "If you cannot approve UAC on this machine, use nvm-windows instead:" -ForegroundColor DarkGray
        Write-Host "https://github.com/coreybutler/nvm-windows" -ForegroundColor DarkGray
    }

    if (-not (Test-LauncherInteractive)) {
        Write-Host ""
        if ($needsElevation -and -not $elevated) {
            Write-Host "Run the command above from an elevated PowerShell window, then start" -ForegroundColor Yellow
            Write-Host "this script again." -ForegroundColor Yellow
        } else {
            Write-Host "Run the command above, then start this script again." -ForegroundColor Yellow
        }
        return $false
    }

    Write-Host ""
    $answer = Read-Host "Install Node $target LTS now? [y/N]"
    if ($answer -notmatch '^(y|yes)$') {
        Write-Host "Skipped. Run the command above when you are ready." -ForegroundColor DarkGray
        return $false
    }

    if ($winget -and -not $nvm) {
        Write-SetupStep "Running: $($commands[0])"
        $exitCode = Invoke-WingetInstall -Arguments $wingetArguments

        if ($null -eq $exitCode) {
            Write-SetupError @(
                "Administrator approval was declined, so Node was not upgraded.",
                "",
                "Nothing on this machine was changed. To continue, either:",
                "",
                "  * Re-run this script and approve the User Account Control prompt, or",
                "  * Open PowerShell as Administrator and run:",
                "      $($commands[0])",
                "  * Install per-user with nvm-windows, which needs no elevation:",
                "      https://github.com/coreybutler/nvm-windows",
                "",
                "SecureDesignStudio without AI does not need any of this:",
                "  .\Start-SecureDesignStudio.ps1"
            )
            return $false
        }

        if ($exitCode -ne 0) {
            $hint = Get-WingetFailureHint -ExitCode $exitCode
            Write-SetupError ($hint + @(
                "",
                "Nothing on this machine was changed. To continue, either:",
                "",
                "  * Open PowerShell as Administrator and run:",
                "      $($commands[0])",
                "  * Install per-user with nvm-windows, which needs no elevation:",
                "      https://github.com/coreybutler/nvm-windows",
                "  * Download Node $target LTS directly from https://nodejs.org/"
            ))
            return $false
        }
    } else {
        foreach ($command in $commands) {
            Write-SetupStep "Running: $command"
            Invoke-Expression $command
            if ($LASTEXITCODE -ne 0) {
                Write-SetupError @(
                    "'$command' exited with $LASTEXITCODE, so Node was not upgraded.",
                    "",
                    "Run it yourself in a PowerShell window, or install Node $target LTS",
                    "from https://nodejs.org/, then run this script again."
                )
                return $false
            }
        }
    }

    Write-Host ""
    Write-Host "Node $target LTS installed." -ForegroundColor Green
    Write-SetupWarning @(
        "This window still uses the old Node version: PATH changes do not apply",
        "to a running process.",
        "",
        "Close this window, open a NEW PowerShell window, confirm with",
        "'node --version', then run this script again."
    )
    return $true
}

# Node and npm must both exist and be new enough for the locked toolchain.
# Returns the detected Node version; exits with guidance when unusable.
function Assert-NodeToolchain {
    param([switch]$NoInstallOffer)
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-SetupError @(
            "MISSING PREREQUISITE: Node.js",
            "",
            "SecureDesignStudio runs on Node.js, which was not found on PATH.",
            "",
            "Install Node.js 24 LTS from https://nodejs.org/ (the 'LTS' download),",
            "then CLOSE this window and open a new PowerShell window so the PATH",
            "update applies. Confirm with:",
            "",
            "  node --version",
            "",
            "Then run this script again."
        )
        exit 1
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-SetupError @(
            "MISSING PREREQUISITE: npm",
            "",
            "Node.js was found but npm was not. npm installs this app's dependencies.",
            "",
            "Reinstall Node.js 24 LTS from https://nodejs.org/ and keep the bundled",
            "npm option selected, then open a new PowerShell window and run this",
            "script again."
        )
        exit 1
    }

    $nodeVersion = Get-NodeVersion
    if (-not $nodeVersion) {
        Write-SetupWarning @(
            "Could not determine the Node.js version; continuing.",
            "If startup fails, confirm 'node --version' reports 22.12.0 or later."
        )
        return $null
    }

    if ($nodeVersion -lt $script:MinimumNodeVersion) {
        Write-SetupError @(
            "PREREQUISITE TOO OLD: Node.js $nodeVersion",
            "",
            "This app's locked build toolchain needs Node $($script:MinimumNodeVersion) or later.",
            "Older versions fail with confusing dependency or syntax errors.",
            "",
            "Node $($script:RecommendedNodeMajor) LTS is the recommended version: it satisfies this",
            "toolchain and AI runtimes used by the optional AI mode."
        )
        if (-not $NoInstallOffer) { Invoke-NodeInstallOffer | Out-Null }
        exit 1
    }

    return $nodeVersion
}

# True when nothing is listening on the port.
function Test-PortFree {
    param([int]$Port)
    try {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
        return $listeners.Count -eq 0
    } catch [System.Management.Automation.CommandNotFoundException] {
        # Get-NetTCPConnection is Windows-only; fall back to a bind probe.
        try {
            $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
            $listener.Start()
            $listener.Stop()
            return $true
        } catch {
            return $false
        }
    } catch {
        # No matching connection is reported as an error by some builds.
        return $true
    }
}

function Get-PortOwner {
    param([int]$Port)
    try {
        $owningPid = (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1 -ExpandProperty OwningProcess)
        if (-not $owningPid) { return $null }
        $process = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
        if ($process) {
            return "PID $owningPid ($($process.ProcessName))"
        }
        return "PID $owningPid"
    } catch {
        return $null
    }
}

# Vite uses strictPort, so an occupied 5173 is fatal. Never tell the user to kill
# an unfamiliar process: it may be someone else's preview on a shared machine.
function Assert-PortFree {
    param(
        [int]$Port,
        [string]$Purpose
    )
    if (Test-PortFree -Port $Port) { return }

    $owner = Get-PortOwner -Port $Port
    $ownerLine = if ($owner) { "Currently used by $owner." } else { "The owning process could not be identified." }

    Write-SetupError @(
        "PORT $Port IS ALREADY IN USE",
        "",
        "$Purpose needs port $Port, and startup is strict: it will not pick another port.",
        $ownerLine,
        "",
        "If this is your own SecureDesignStudio server from an earlier run, switch to",
        "that window and press Ctrl+C, then run this script again.",
        "",
        "If you do not recognise it, DO NOT stop it. It may belong to someone else on",
        "this machine. Inspect it first:",
        "",
        "  Get-NetTCPConnection -LocalPort $Port -State Listen",
        "",
        "and coordinate with its owner."
    )
    exit 1
}

# Reuse healthy installs; restore missing or incompatible direct dependencies
# from the lockfile after updates or interrupted installations.
function Install-ProjectDependencies {
    param(
        [string]$RelativePath = ".",
        [string]$Label = "app"
    )

    $modulesPath = if ($RelativePath -eq ".") { "node_modules" } else { Join-Path $RelativePath "node_modules" }
    if (Test-Path -LiteralPath $modulesPath) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            if ($RelativePath -eq ".") {
                npm ls --depth=0 --json >$null 2>$null
            } else {
                npm --prefix $RelativePath ls --depth=0 --json >$null 2>$null
            }
            $dependenciesHealthy = $LASTEXITCODE -eq 0
        } finally { $ErrorActionPreference = $previous }
        if ($dependenciesHealthy) { return }
        Write-SetupStep "$Label dependencies are missing or incompatible; restoring from package-lock.json."
    }

    Write-SetupStep "Installing $Label dependencies (this can take a few minutes)..."

    if ($RelativePath -eq ".") {
        npm ci
    } else {
        npm --prefix $RelativePath ci
    }

    if ($LASTEXITCODE -ne 0) {
        Write-SetupError @(
            "Installing $Label dependencies failed (npm ci exited with $LASTEXITCODE).",
            "",
            "Common causes:",
            "  * No network access, or a proxy blocking the npm registry.",
            "  * package-lock.json out of sync after editing package.json.",
            "",
            "If the lockfile is out of sync, run this once:",
            "",
            "  npm install",
            "",
            "Then run this script again."
        )
        exit 1
    }
}

function Invoke-AzQuiet {
    # Native stderr becomes a terminating error under $ErrorActionPreference = "Stop",
    # which would surface raw CLI noise instead of the guidance the callers print.
    param([string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $raw = & az @Arguments --only-show-errors 2>&1
        $code = $LASTEXITCODE
        $stdout = @($raw | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n"
        return [pscustomobject]@{ ExitCode = $code; Output = $stdout.Trim() }
    } catch {
        return [pscustomobject]@{ ExitCode = 1; Output = "" }
    } finally {
        $ErrorActionPreference = $previous
    }
}

# Resolution order matches scripts/configure-local-ai.mjs: environment first,
# then an existing api\local.settings.json.
function Get-ConfiguredValue {
    param([string[]]$SettingNames, [string[]]$EnvNames)
    foreach ($name in $EnvNames) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value) { return $value.Trim() }
    }
    $settingsPath = Join-Path (Get-Location).Path "api\local.settings.json"
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        try {
            $values = (Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json).Values
            foreach ($name in $SettingNames) {
                if ($values.$name) { return [string]$values.$name }
            }
        } catch {
            Write-Verbose "Could not read api\local.settings.json: $_"
        }
    }
    return $null
}

function Resolve-FuncPath {
    $command = Get-Command func -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @()
    if ($env:APPDATA) {
        $candidates += (Join-Path $env:APPDATA "npm\func.cmd")
    }
    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "Microsoft\Azure Functions Core Tools\func.exe")
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Azure Functions Core Tools\func.exe")
    }
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA "Microsoft\Azure Functions Core Tools\func.exe")
        $candidates += (Join-Path $env:LOCALAPPDATA "AzureFunctionsCoreTools\func.exe")
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return $null
}
