import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const script = await readFile(new URL("../../Start-SecureDesignStudio-WithAI.ps1", import.meta.url), "utf8");

function run(provider, { loggedIn = true, missing = false, switches = "", interactive = false } = {}) {
  const helpers = `
function Write-SetupError { param([string[]]$Lines) $Lines | Write-Output }
function Write-SetupWarning { param([string[]]$Lines) $Lines | Write-Output }
function Write-SetupStep { param([string]$Message) Write-Output $Message }
function Test-LauncherInteractive { return $${interactive} }
function Read-Host { param([string]$Prompt) return "2" }
function Assert-NodeToolchain { return [version]"24.0.0" }
$script:FunctionsNodeMajors = @(22, 24)
function Resolve-FuncPath { return "C:\\synthetic\\func.exe" }
function Assert-PortFree { param($Port, $Purpose) }
function Install-ProjectDependencies { param($RelativePath, $Label) }
function Get-ConfiguredValue { param($SettingNames, $EnvNames)
  if ($SettingNames -contains "MODEL_DEPLOYMENT_NAME") { return "synthetic-model" }
  return "https://synthetic.openai.azure.com"
}
function Invoke-AzQuiet { param($Arguments) $script:azCalls++; return @{ ExitCode = 0; Output = "synthetic-identity" } }
function Get-Command { param($Name, $CommandType, $ErrorAction)
  if ($Name -eq "az") { return @{ Source = "synthetic-az" } }
  if ($${missing}) { return $null }
  return @{ Source = {
    $global:LASTEXITCODE = ${loggedIn ? "0" : "1"}
    if ($env:SDS_AI_PROVIDER -eq "claude") { '{"authMethod":"${loggedIn ? "claude.ai" : "api_key"}"}' }
    else { '${loggedIn ? "Logged in using ChatGPT" : "Logged in using an API key"}' }
  } }
}
function npm { param($Action, $Command)
  Write-Output ("MOCK_START:" + (@{provider=$env:SDS_AI_PROVIDER;local=$env:SDS_LOCAL_AI;azureCalls=$script:azCalls} | ConvertTo-Json -Compress))
  $global:LASTEXITCODE = 0
}
function node {
  $provider = $args[2]
  $available = -not $${missing} -and $${loggedIn}
  $message = if ($available) { "Synthetic isolated consumer CLI ready." } else { "Synthetic CLI unavailable or subscription sign-in missing." }
  Write-Output (@{id=$provider;label="$provider CLI";available=$available;message=$message} | ConvertTo-Json -Compress)
  $global:LASTEXITCODE = if ($available) { 0 } else { 1 }
}
$script:azCalls = 0
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

test("AI launcher: interactive menu and explicit providers start only their own prerequisites", { skip: process.platform !== "win32" }, () => {
  for (const provider of ["Azure", "Claude", "Codex", ""]) {
    const result = run(provider, { interactive: !provider });
    assert.equal(result.status, 0, result.text);
    const state = JSON.parse(result.text.match(/MOCK_START:(\{.*\})/)[1]);
    assert.equal(state.provider, provider.toLowerCase() || "claude");
    assert.equal(state.local, "1");
    assert.equal(state.azureCalls, provider === "Azure" ? 2 : 0);
  }
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
