import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const script = await readFile(new URL("../../Start-SecureDesignStudio-WithAI.ps1", import.meta.url), "utf8");
const common = await readFile(new URL("../../scripts/launcher-common.ps1", import.meta.url), "utf8");
const diagnostics = common.slice(common.indexOf("function Write-LocalProviderDiagnostics"),
  common.indexOf("function Get-NodeVersion"));

function dependencyCheck({ relativePath = ".", installed = true, healthy = true, installExit = 0 } = {}) {
  const helper = common.slice(common.indexOf("function Install-ProjectDependencies"), common.indexOf("function Invoke-AzQuiet"));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `
function Test-Path { param($LiteralPath) return $${installed} }
function Write-SetupStep { param($Message) Write-Output $Message }
function Write-SetupError { param($Lines) $Lines | Write-Output }
function npm {
  Write-Output ("NPM:" + ($args -join " "))
  $script:calls += ,($args -join " ")
  $global:LASTEXITCODE = if ($args -contains "ci") { ${installExit} } else { ${healthy ? 0 : 1} }
}
$script:calls = @()
${helper}
Install-ProjectDependencies -RelativePath "${relativePath}"
Write-Output ("CALLS:" + (ConvertTo-Json -InputObject @($script:calls) -Compress))
`], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (result.error) throw result.error;
  return { status: result.status, text: result.stdout + result.stderr };
}

test("launchers: existing incomplete dependencies are restored for app and API", { skip: process.platform !== "win32" }, () => {
  for (const relativePath of [".", "api"]) {
    const result = dependencyCheck({ relativePath, healthy: false });
    assert.equal(result.status, 0, result.text);
    const calls = JSON.parse(result.text.match(/CALLS:(.*)/)[1]);
    const prefix = relativePath === "." ? "" : "--prefix api ";
    assert.deepEqual(calls, [`${prefix}ls --depth=0 --json`, `${prefix}ci`]);
  }
});

test("launchers: healthy dependencies are reused and first run installs once", { skip: process.platform !== "win32" }, () => {
  for (const installed of [true, false]) {
    const result = dependencyCheck({ installed });
    assert.equal(result.status, 0, result.text);
    assert.deepEqual(JSON.parse(result.text.match(/CALLS:(.*)/)[1]),
      installed ? ["ls --depth=0 --json"] : ["ci"]);
  }
  const failed = dependencyCheck({ healthy: false, installExit: 1 });
  assert.equal(failed.status, 1, failed.text);
  assert.match(failed.text, /Installing app dependencies failed/);
  assert.doesNotMatch(failed.text, /CALLS:/);
});

function run(provider, { loggedIn = true, missing = false, switches = "", interactive = false,
  wrapperOnly = false, malformed = false, npmNative = false } = {}) {
  const helpers = `
${diagnostics}
function Write-SetupError { param([string[]]$Lines) $Lines | Write-Output }
function Write-SetupWarning { param([string[]]$Lines) $Lines | Write-Output }
function Write-SetupStep { param([string]$Message) Write-Output $Message }
function Test-LauncherInteractive { return $${interactive} }
function Read-Host { param([string]$Prompt) return "2" }
function Install-ProjectDependencies { param($RelativePath, $Label)
  $script:installs += $RelativePath
}
function Assert-NodeToolchain { param([switch]$NoInstallOffer)
  if ($DiagnoseProvider -and -not $NoInstallOffer) { throw "Diagnostics must not offer runtime installation." }
  return [version]"24.0.0"
}
$script:FunctionsNodeMajors = @(22, 24)
function Resolve-FuncPath {
  $script:funcCalls++
  if ($DiagnoseProvider) { throw "Diagnostics must not require Functions Core Tools." }
  return "C:\\synthetic\\func.exe"
}
function Assert-PortFree { param($Port, $Purpose) }
function Get-ConfiguredValue { param($SettingNames, $EnvNames)
  if ($SettingNames -contains "MODEL_DEPLOYMENT_NAME") { return "synthetic-model" }
  return "https://synthetic.openai.azure.com"
}
function Invoke-AzQuiet { param($Arguments) $script:azCalls++; return @{ ExitCode = 0; Output = "synthetic-identity" } }
function Get-Command { param($Name, $CommandType, $ErrorAction, [switch]$All)
  if ($Name -eq "az") { return @{ Source = "synthetic-az" } }
  if ($${missing}) { return $null }
  return @{ CommandType = "${wrapperOnly ? "ExternalScript" : "Application"}";
    Path = "C:\\synthetic-cli\\$Name.${wrapperOnly ? "ps1" : "exe"}" }
}
function Test-Path { param($LiteralPath, $PathType)
  if ($LiteralPath -like "*.exe") { return (-not $${missing} -and -not $${wrapperOnly}) }
  return $true
}
function npm { param($Action, $Command)
  Write-Output ("MOCK_START:" + (@{provider=$env:SDS_AI_PROVIDER;local=$env:SDS_LOCAL_AI;debug=$env:SDS_AI_DEBUG;cliOnly=$env:SDS_LOCAL_AI_CLI_ONLY;azureCalls=$script:azCalls;funcCalls=$script:funcCalls;installs=$script:installs;command="$Action $Command"} | ConvertTo-Json -Compress))
  $global:LASTEXITCODE = 0
}
function node {
  $provider = $args[2]
  if ($${malformed}) {
    Write-Output "Invalid response"
    Write-Error "PRIVATE_SYNTHETIC_STDERR"
    $global:LASTEXITCODE = 2
    return
  }
  if ($args[3] -ne "--diagnostics") { throw "The launcher must request shared resolver diagnostics." }
  $available = -not $${missing} -and (-not $${wrapperOnly} -or $${npmNative}) -and $${loggedIn}
  $message = if ($available) { "Synthetic isolated consumer CLI ready." } else { "Synthetic CLI unavailable or subscription sign-in missing." }
  $details = if ($${npmNative}) {
    @(@{stage="npm";message="Found Codex npm package: C:\\synthetic-cli\\node_modules\\@openai\\codex"},
      @{stage="executable";message="Selected native npm executable: C:\\synthetic-cli\\node_modules\\@openai\\codex\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"},
      @{stage="authentication";message="Checking subscription login status."})
  } elseif ($${wrapperOnly}) {
    @(@{stage="npm";message="No usable Codex native binary found in npm packages."})
  } else { @(@{stage="executable";message="Selected native PATH executable."}) }
  Write-Output (@{id=$provider;label="$provider CLI";available=$available;message=$message;diagnostics=$details} | ConvertTo-Json -Depth 5 -Compress)
  $global:LASTEXITCODE = if ($available) { 0 } else { 1 }
}
$script:azCalls = 0
$script:funcCalls = 0
$script:installs = @()
$env:PATH = "C:\\synthetic-cli;relative;C:drive-relative"
$env:OPENAI_API_KEY = "PRIVATE_SYNTHETIC_SECRET"
`;
  const body = script
    .replace("Set-Location $PSScriptRoot", "")
    .replace('. (Join-Path $PSScriptRoot "scripts\\launcher-common.ps1")', helpers);
  const command = `& { ${body} } ${provider ? `-Provider ${provider}` : ""} ${switches}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, text: result.stdout + result.stderr };
}

test("AI launcher: Claude and Codex start without Functions or API installation", { skip: process.platform !== "win32" }, () => {
  for (const provider of ["Azure", "Claude", "Codex", ""]) {
    const result = run(provider, { interactive: !provider });
    assert.equal(result.status, 0, result.text);
    const state = JSON.parse(result.text.match(/MOCK_START:(\{.*\})/)[1]);
    assert.equal(state.provider, provider.toLowerCase() || "claude");
    assert.equal(state.local, "1");
    assert.equal(state.debug, "0");
    assert.equal(state.azureCalls, provider === "Azure" ? 2 : 0);
    assert.equal(state.funcCalls, provider === "Azure" ? 1 : 0);
    assert.deepEqual(state.installs, provider === "Azure" ? [".", "api"] : ["."]);
    assert.equal(state.command, provider === "Azure" ? "run dev:ai" : "run dev:ai:local");
    assert.equal(state.cliOnly, provider === "Azure" ? null : "1");
    if (provider !== "Azure") assert.match(result.text, /No Azure Functions host or API package is needed/);
  }
});

test("AI launcher: interaction debug switch explicitly enables safe diagnostics", { skip: process.platform !== "win32" }, () => {
  const result = run("Codex", { switches: "-DebugAI" });
  assert.equal(result.status, 0, result.text);
  const state = JSON.parse(result.text.match(/MOCK_START:(\{.*\})/)[1]);
  assert.equal(state.debug, "1");
  assert.match(result.text, /AI interaction diagnostics enabled/);
});

test("AI launcher: missing CLI, non-subscription login and unattended missing selection never start", { skip: process.platform !== "win32" }, () => {
  for (const provider of ["Claude", "Codex"]) {
    for (const options of [{ missing: true }, { loggedIn: false }]) {
      const result = run(provider, options);
      assert.equal(result.status, 1, result.text);
      assert.equal(result.text.includes("MOCK_START:"), false);
      assert.match(result.text, /unavailable|could not be verified/i);
    }
  }
  const unattended = run("");
  assert.equal(unattended.status, 1);
  assert.match(unattended.text, /Specify -Provider/);
});

test("AI launcher: Azure-only switches cannot bypass subscription authentication", { skip: process.platform !== "win32" }, () => {
  for (const switches of ["-SkipAuthCheck", "-VerifyEndpoint"]) {
    const result = run("Claude", { switches });
    assert.equal(result.status, 1);
    assert.equal(result.text.includes("MOCK_START:"), false);
  }
});

test("AI launcher: diagnostic-only readiness exits before Core Tools, dependencies and servers", { skip: process.platform !== "win32" }, () => {
  for (const provider of ["Claude", "Codex"]) {
    const result = run(provider, { switches: "-DiagnoseProvider" });
    assert.equal(result.status, 0, result.text);
    assert.match(result.text, /Diagnostics complete\. No servers started/);
    assert.match(result.text, /Native PATH candidates: 1/);
    assert.match(result.text, /PATH entries ignored: 2/);
    assert.match(result.text, /valid readiness response: True/);
    assert.doesNotMatch(result.text, /MOCK_START|PRIVATE_SYNTHETIC_SECRET/);
  }
  const azure = run("Azure", { switches: "-DiagnoseProvider" });
  assert.equal(azure.status, 1);
  assert.match(azure.text, /applies to Claude and Codex/);
});

test("AI launcher: incomplete npm installs report shared discovery failure without running the wrapper", { skip: process.platform !== "win32" }, () => {
  for (const switches of ["", "-DiagnoseProvider"]) {
    const result = run("Codex", { wrapperOnly: true, switches });
    assert.equal(result.status, 1, result.text);
    assert.match(result.text, /ExternalScript - C:\\synthetic-cli\\codex\.ps1/);
    assert.match(result.text, /Native PATH candidates: 0/);
    assert.match(result.text, /\[npm\] No usable Codex native binary/);
    assert.match(result.text, /npm root -g/);
    assert.doesNotMatch(result.text, /MOCK_START|PRIVATE_SYNTHETIC_SECRET/);
  }
});

test("AI launcher: npm native resolution works despite zero direct PATH candidates", { skip: process.platform !== "win32" }, () => {
  const result = run("Codex", { wrapperOnly: true, npmNative: true, switches: "-DiagnoseProvider" });
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /Native PATH candidates: 0/);
  assert.match(result.text, /\[executable\] Selected native npm executable:/);
  assert.match(result.text, /\[authentication\] Checking subscription login status/);
  assert.match(result.text, /Diagnostics complete/);
  assert.doesNotMatch(result.text, /discovery failed|MOCK_START|PRIVATE_SYNTHETIC_SECRET/);
  const startup = run("Codex", { wrapperOnly: true, npmNative: true });
  assert.equal(startup.status, 0, startup.text);
  assert.match(startup.text, /MOCK_START:/);
});

test("AI launcher: malformed preflight output reports exit status without dumping raw output", { skip: process.platform !== "win32" }, () => {
  const result = run("Codex", { malformed: true, switches: "-DiagnoseProvider" });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /Preflight exit code: 2; valid readiness response: False/);
  assert.match(result.text, /readiness helper did not return a valid response/);
  assert.doesNotMatch(result.text, /Invalid response|PRIVATE_SYNTHETIC_STDERR|PRIVATE_SYNTHETIC_SECRET|MOCK_START/);
});
