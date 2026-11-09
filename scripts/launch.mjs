// Cross-platform launcher: the same prerequisite checks as the root PowerShell
// launchers, in Node, which every mode already requires. Used directly, through
// `npm run start` / `npm run start:ai`, or through the POSIX wrappers in the
// repository root. Uses only Node built-ins so it runs before `npm ci`.
//
// Every check reports what is missing, why the tool needs it, and the exact
// command that fixes it, because a new user cannot act on a bare failure.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Keep in step with scripts/launcher-common.ps1.
export const MINIMUM_NODE = [22, 12, 0];
// Local CLI readiness imports TypeScript through Node type stripping.
export const TYPE_STRIPPING_NODE = [22, 18, 0];
export const FUNCTIONS_NODE_MAJORS = [22, 24];
export const RECOMMENDED_NODE_MAJOR = 24;
const PROVIDERS = ["azure", "claude", "codex"];
const LABELS = { azure: "Azure", claude: "Claude", codex: "Codex" };
const BYO_AI_DOC = path.join("docs", "bring-your-own-ai.md");

export class LaunchError extends Error {
  constructor(lines, exitCode = 1) {
    super(lines[0]);
    this.lines = lines;
    this.exitCode = exitCode;
  }
}

const USAGE = [
  "Usage: node scripts/launch.mjs [--ai [--provider azure|claude|codex] [options]]",
  "",
  "  --ai                  Start with the optional AI Design Assistant.",
  "  --provider <name>     Initial AI provider. Omit for an interactive menu.",
  "  --skip-auth-check     Azure only: start without checking for an Azure identity.",
  "  --verify-endpoint     Azure only: probe the deployment (may incur usage).",
  "  --diagnose-provider   Claude/Codex only: check readiness, start nothing.",
  "  --debug-ai            Sanitized interaction diagnostics.",
  "  --debug-ai-content    Also log full prompts and responses to a local temp file.",
];

export function parseArgs(argv) {
  const options = { ai: false, provider: undefined, skipAuthCheck: false, verifyEndpoint: false,
    diagnoseProvider: false, debugAi: false, debugAiContent: false, help: false };
  const flags = { "--ai": "ai", "--skip-auth-check": "skipAuthCheck", "--verify-endpoint": "verifyEndpoint",
    "--diagnose-provider": "diagnoseProvider", "--debug-ai": "debugAi", "--debug-ai-content": "debugAiContent",
    "--help": "help", "-h": "help" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inline] = arg.startsWith("--provider=") ? ["--provider", arg.slice(11)] : [arg, undefined];
    if (name === "--provider") {
      const value = inline ?? argv[++i];
      if (!value) throw new LaunchError(["--provider needs a value: azure, claude or codex.", ...USAGE], 2);
      options.provider = value.toLowerCase();
    } else if (flags[name]) {
      options[flags[name]] = true;
    } else {
      throw new LaunchError([`Unknown option: ${arg}`, "", ...USAGE], 2);
    }
  }
  if (options.help) return options;
  const aiOnly = options.provider || options.skipAuthCheck || options.verifyEndpoint ||
    options.diagnoseProvider || options.debugAi || options.debugAiContent;
  if (aiOnly && !options.ai) throw new LaunchError(["AI options need --ai.", "", ...USAGE], 2);
  if (options.provider && !PROVIDERS.includes(options.provider)) {
    throw new LaunchError([`Unknown provider '${options.provider}'. Use azure, claude or codex.`], 2);
  }
  return options;
}

// Provider-dependent switch rules, mirroring Start-SecureDesignStudio-WithAI.ps1.
export function validateProviderOptions(options) {
  const { provider } = options;
  if (options.skipAuthCheck && provider !== "azure") {
    throw new LaunchError(["--skip-auth-check applies only to Azure. Subscription sign-in must be verified for Claude and Codex."]);
  }
  if (options.verifyEndpoint && provider !== "azure") {
    throw new LaunchError(["--verify-endpoint currently probes Azure only. Claude/Codex startup verifies sign-in without consuming inference."]);
  }
  if (options.diagnoseProvider && provider === "azure") {
    throw new LaunchError(["--diagnose-provider applies to Claude and Codex. Use --verify-endpoint for Azure."]);
  }
}

export function parseVersion(text) {
  const match = /v?(\d+)\.(\d+)\.(\d+)/.exec(text ?? "");
  return match ? match.slice(1, 4).map(Number) : null;
}

export function versionAtLeast(version, minimum) {
  for (let i = 0; i < 3; i++) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
}

// Version-manager advice per OS. Never installs anything: on macOS/Linux a
// silent package-manager install would change a machine-wide toolchain.
export function nodeInstallHint(platform) {
  const target = RECOMMENDED_NODE_MAJOR;
  if (platform === "win32") {
    return [`Install Node ${target} LTS from https://nodejs.org/ or with 'nvm install ${target}' (nvm-windows).`,
      "The PowerShell launcher, Start-SecureDesignStudio.ps1, can also install it with winget for you."];
  }
  return [
    `Install or select Node ${target} LTS with a version manager, for example:`,
    `  nvm install ${target} && nvm use ${target}`,
    `  fnm install ${target} && fnm use ${target}`,
    ...(platform === "darwin" ? [`  brew install node@${target}`] : []),
    "or download it from https://nodejs.org/, then open a new terminal and run this again.",
  ];
}

export function checkNode(versionText, platform) {
  const version = parseVersion(versionText);
  if (!version) return { version: null, warning: true };
  if (!versionAtLeast(version, MINIMUM_NODE)) {
    throw new LaunchError([
      `PREREQUISITE TOO OLD: Node.js ${version.join(".")}`,
      "",
      `This app's locked build toolchain needs Node ${MINIMUM_NODE.join(".")} or later.`,
      "Older versions fail with confusing dependency or syntax errors.",
      "",
      ...nodeInstallHint(platform),
    ]);
  }
  return { version, warning: false };
}

// Absolute, file-backed matches for a command on PATH. Relative and empty PATH
// entries are ignored so a repository-local binary is never picked up.
export function findOnPath(name, env = process.env, platform = process.platform) {
  const delimiter = platform === "win32" ? ";" : ":";
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const extensions = platform === "win32"
    ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map(ext => ext.toLowerCase())]
    : [""];
  const found = [];
  let ignored = 0;
  for (const directory of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!directory || !pathApi.isAbsolute(directory)) { ignored++; continue; }
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, name + extension);
      try {
        const stats = statSync(candidate);
        if (stats.isFile() && (platform === "win32" || (stats.mode & 0o111) !== 0)) found.push(candidate);
      } catch { /* not present */ }
    }
  }
  return { found: [...new Set(found)], ignored };
}

export function resolveFuncPath(env = process.env, platform = process.platform) {
  const onPath = findOnPath("func", env, platform).found[0];
  if (onPath) return onPath;
  if (platform !== "win32") return null;
  const candidates = [
    env.APPDATA && path.win32.join(env.APPDATA, "npm", "func.cmd"),
    env.ProgramFiles && path.win32.join(env.ProgramFiles, "Microsoft", "Azure Functions Core Tools", "func.exe"),
    env["ProgramFiles(x86)"] && path.win32.join(env["ProgramFiles(x86)"], "Microsoft", "Azure Functions Core Tools", "func.exe"),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Microsoft", "Azure Functions Core Tools", "func.exe"),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "AzureFunctionsCoreTools", "func.exe"),
  ].filter(Boolean);
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

// True when nothing listens on the port. Vite binds "localhost", which may be
// either loopback family, so both are probed; a missing IPv6 stack is not busy.
export async function portFree(port) {
  const probe = host => new Promise(resolve => {
    const server = createServer();
    server.once("error", error => resolve(error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT"));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
  return (await probe("127.0.0.1")) && (await probe("::1"));
}

export function portOwnerHint(port, platform) {
  if (platform === "win32") return `  Get-NetTCPConnection -LocalPort ${port} -State Listen`;
  if (platform === "darwin") return `  lsof -nP -iTCP:${port} -sTCP:LISTEN`;
  return `  ss -ltnp 'sport = :${port}'`;
}

// Resolution order matches scripts/configure-local-ai.mjs: environment first,
// then an existing api/local.settings.json.
export function configuredValue(settingNames, envNames, env = process.env, settingsPath = path.join(root, "api", "local.settings.json")) {
  for (const name of envNames) {
    if (env[name]?.trim()) return env[name].trim();
  }
  try {
    const values = JSON.parse(readFileSync(settingsPath, "utf8"))?.Values ?? {};
    for (const name of settingNames) {
      if (typeof values[name] === "string" && values[name]) return values[name];
    }
  } catch { /* absent or unreadable: treated as not configured */ }
  return null;
}

export function interactive(env = process.env, stdin = process.stdin) {
  return Boolean(stdin.isTTY) && !env.CI && !env.PS_LAUNCHER_NONINTERACTIVE;
}

// --- Process helpers. Windows resolves npm and az to .cmd shims, which Node
// only starts through a shell; every argument passed here is a fixed literal.

function runQuiet(command, args, platform = process.platform) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: platform === "win32", windowsHide: true, timeout: 60_000 });
  return { exitCode: result.error ? 1 : result.status ?? 1, output: (result.stdout ?? "").trim() };
}

// `ps -A -o pid= -o ppid=` output -> [pid, ppid] pairs.
export function parsePsListing(text) {
  const pairs = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) continue;
    pairs.push([Number(fields[0]), Number(fields[1])]);
  }
  return pairs;
}

// One /proc/<pid>/stat line -> [pid, ppid], or null. The comm field (2) is
// parenthesised but may itself contain spaces and parentheses, so the fields
// after it are read from the last ')': state (3), then ppid (4).
export function parseProcStat(text) {
  const close = text.lastIndexOf(")");
  const pid = /^\s*(\d+)\s+\(/.exec(text)?.[1];
  if (close < 0 || !pid) return null;
  const ppid = text.slice(close + 1).trim().split(/\s+/)[1];
  return /^\d+$/.test(ppid ?? "") ? [Number(pid), Number(ppid)] : null;
}

// Every descendant of `root` in a [pid, ppid] table, deepest first. A pid is
// visited once, so a malformed or racing snapshot cannot loop.
export function descendantsFrom(pairs, root) {
  const children = new Map();
  for (const [pid, ppid] of pairs) {
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = [];
  const seen = new Set([root]);
  const visit = pid => {
    for (const next of children.get(pid) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      visit(next);
      found.push(next);
    }
  };
  visit(root);
  return found;
}

// POSIX only: one snapshot of [pid, ppid] pairs. `ps` covers Linux and macOS;
// where it lacks -A/-o (BusyBox) or is missing, Linux falls back to /proc.
// Empty if neither is available.
export function readProcessTable(platform = process.platform) {
  const listing = spawnSync("ps", ["-A", "-o", "pid=", "-o", "ppid="], { encoding: "utf8", timeout: 5_000 });
  if (listing.status === 0 && listing.stdout) {
    const pairs = parsePsListing(listing.stdout);
    if (pairs.length) return pairs;
  }
  if (platform !== "linux") return [];
  let entries;
  try { entries = readdirSync("/proc"); } catch { return []; }
  const pairs = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try { stat = readFileSync(`/proc/${entry}/stat`, "utf8"); } catch { continue; /* exited */ }
    const pair = parseProcStat(stat);
    if (pair) pairs.push(pair);
  }
  return pairs;
}

// Every live descendant of `root`, deepest first.
export function descendantPids(root, readTable = readProcessTable) {
  return descendantsFrom(readTable(), root);
}

export function runInherited(command, args, env, platform = process.platform) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: "inherit", env, shell: platform === "win32" });
    // Ctrl+C reaches the whole foreground process group; let the child shut
    // down and report its own exit code instead of dying first.
    const ignore = () => {};
    // SIGTERM (kill) and SIGHUP (closed terminal) reach only the launcher.
    // Passing them to the direct child is not enough: 'npm run' starts the
    // server through 'sh -c', and sh dies without passing the signal on, so
    // the server would keep the port. Signal the child's whole process tree.
    // (Signalling our process group instead could hit a calling script.)
    // Windows has no POSIX signals here and closing a console ends its tree.
    const forwarded = platform === "win32" ? [] : ["SIGTERM", "SIGHUP"];
    const forward = signal => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      for (const pid of [...descendantPids(child.pid), child.pid]) {
        try { process.kill(pid, signal); } catch { /* already gone */ }
      }
    };
    process.on("SIGINT", ignore);
    for (const signal of forwarded) process.on(signal, forward);
    const cleanup = () => {
      process.off("SIGINT", ignore);
      for (const signal of forwarded) process.off(signal, forward);
    };
    const signalExit = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
    child.on("error", () => { cleanup(); resolve(1); });
    child.on("exit", (code, signal) => { cleanup(); resolve(code ?? (signal ? signalExit[signal] ?? 130 : 1)); });
  });
}

export function defaultDeps() {
  return {
    platform: process.platform,
    env: process.env,
    nodeVersion: process.version,
    typescriptFeature: process.features.typescript,
    print: line => process.stdout.write(`${line}\n`),
    hasCommand: name => findOnPath(name).found.length > 0,
    exists: relative => existsSync(path.join(root, relative)),
    dependenciesHealthy: relative => runQuiet("npm",
      [...(relative === "." ? [] : ["--prefix", relative]), "ls", "--depth=0", "--json"]).exitCode === 0,
    portFree,
    interactive: () => interactive(),
    ask: async question => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return await rl.question(question); } finally { rl.close(); }
    },
    preflight: provider => {
      const result = spawnSync(process.execPath, [path.join(root, "scripts", "ai-provider-preflight.mjs"),
        "--provider", provider, "--diagnostics"], { encoding: "utf8", cwd: root, windowsHide: true, timeout: 20_000 });
      let readiness = null;
      try { readiness = JSON.parse(result.stdout); } catch { /* reported as invalid */ }
      return { exitCode: result.status ?? 1, readiness };
    },
    resolveFuncPath: () => resolveFuncPath(),
    configuredValue: (settings, envs) => configuredValue(settings, envs),
    az: args => runQuiet("az", [...args, "--only-show-errors"]),
    probeEndpoint: async (uri, token) => {
      try {
        const response = await fetch(uri, { method: "POST", signal: AbortSignal.timeout(60_000),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "ping" }], max_tokens: 1 }) });
        return response.status;
      } catch { return 0; }
    },
    npm: (args, env) => runInherited("npm", args, { ...process.env, ...env }),
  };
}

function printLocalProviderDiagnostics(deps, provider, exitCode, validReadiness, diagnostics) {
  const { print } = deps;
  const nativeName = deps.platform === "win32" ? `${provider}.exe` : provider;
  const { found, ignored } = findOnPath(nativeName, deps.env, deps.platform);
  print("");
  print("Local provider diagnostics (no inference or credential output):");
  print(`  Preflight exit code: ${exitCode}; valid readiness response: ${validReadiness}`);
  print(`  Node: ${deps.nodeVersion}; platform: ${deps.platform}/${process.arch}`);
  print(`  Native executable required: ${nativeName} outside the SDS repository`);
  for (const candidate of found) print(`  Native PATH candidate: ${candidate}`);
  print(`  Native PATH candidates: ${found.length}; non-absolute/empty PATH entries ignored: ${ignored}`);
  for (const entry of Array.isArray(diagnostics) ? diagnostics : []) {
    if (typeof entry?.stage === "string" && typeof entry?.message === "string") print(`  [${entry.stage}] ${entry.message}`);
  }
  print("  PATH candidates alone are not proof of readiness; the shared resolver makes the final decision.");
  print("  The last stage above identifies where checking stopped.");
  print("  Repository-local binaries and shell wrappers are never executed.");
  if (provider === "codex") print("  If npm discovery fails, 'npm root -g' locates packages for installation inspection.");
}

async function assertPortFree(deps, port, purpose) {
  if (await deps.portFree(port)) return;
  throw new LaunchError([
    `PORT ${port} IS ALREADY IN USE`,
    "",
    `${purpose} needs port ${port}, and startup is strict: it will not pick another port.`,
    "",
    "If this is your own SecureDesignStudio server from an earlier run, switch to",
    "that terminal and press Ctrl+C, then run this again.",
    "",
    "If you do not recognise it, DO NOT stop it. It may belong to someone else on",
    "this machine. Inspect it first:",
    "",
    portOwnerHint(port, deps.platform),
    "",
    "and coordinate with its owner.",
  ]);
}

async function installDependencies(deps, relative, label) {
  if (deps.exists(relative === "." ? "node_modules" : path.join(relative, "node_modules"))) {
    if (deps.dependenciesHealthy(relative)) return;
    deps.print(`${label} dependencies are missing or incompatible; restoring from package-lock.json.`);
  }
  deps.print(`Installing ${label} dependencies (this can take a few minutes)...`);
  const exitCode = await deps.npm(relative === "." ? ["ci"] : ["--prefix", relative, "ci"], {});
  if (exitCode !== 0) {
    throw new LaunchError([
      `Installing ${label} dependencies failed (npm ci exited with ${exitCode}).`,
      "",
      "Common causes:",
      "  * No network access, or a proxy blocking the npm registry.",
      "  * package-lock.json out of sync after editing package.json.",
      "",
      "If the lockfile is out of sync, run 'npm install' once, then run this again.",
    ]);
  }
}

async function chooseProvider(deps) {
  if (!deps.interactive()) {
    throw new LaunchError(["Specify --provider azure, --provider claude, or --provider codex for non-interactive startup."]);
  }
  deps.print("Choose your initial AI provider:");
  deps.print("  1. Azure OpenAI / Foundry");
  deps.print("  2. Claude Code - your Claude subscription");
  deps.print("  3. Codex - your ChatGPT subscription");
  for (;;) {
    const choice = (await deps.ask("Enter 1, 2 or 3: ")).trim();
    const provider = { 1: "azure", 2: "claude", 3: "codex" }[choice];
    if (provider) return provider;
    deps.print("Choose 1, 2 or 3.");
  }
}

// Claude/Codex readiness imports the backend's TypeScript directly. Some Linux
// distribution packages of Node (Debian, Ubuntu, Kali) are built without type
// stripping even on Node 24, which reports as process.features.typescript false.
export function typeStrippingProblem(version, typescriptFeature, platform) {
  if (version && !versionAtLeast(version, TYPE_STRIPPING_NODE)) {
    return [`Node.js ${version.join(".")} cannot check Claude/Codex readiness: it needs ${TYPE_STRIPPING_NODE.join(".")} or later for TypeScript type stripping.`,
      "", ...nodeInstallHint(platform)];
  }
  if (typescriptFeature === false) {
    return ["This Node.js build has TypeScript type stripping disabled, so Claude/Codex readiness cannot be checked.",
      "Linux distribution packages of Node (Debian, Ubuntu, Kali and others) are often built this way.",
      "Use an official Node.js build instead; the version-manager builds below are official:",
      "", ...nodeInstallHint(platform)];
  }
  return null;
}

async function checkLocalProvider(deps, options, nodeVersion) {
  const { provider } = options;
  const problem = typeStrippingProblem(nodeVersion, deps.typescriptFeature, deps.platform);
  if (problem) throw new LaunchError(problem);
  const { exitCode, readiness } = deps.preflight(provider);
  const valid = Boolean(readiness) && readiness.id === provider &&
    typeof readiness.available === "boolean" && typeof readiness.message === "string";
  const ready = exitCode === 0 && valid && readiness.available;
  if (options.diagnoseProvider || !ready) printLocalProviderDiagnostics(deps, provider, exitCode, valid, readiness?.diagnostics);
  if (!ready) {
    const instructions = provider === "claude"
      ? "Use the official native Claude Code CLI from https://code.claude.com/docs/en/setup, then run 'claude auth login' and choose your Claude subscription."
      : "Use the official native Codex CLI from https://developers.openai.com/codex/cli, then run 'codex login' and sign in with ChatGPT.";
    const message = valid ? readiness.message
      : `The readiness helper did not return a valid response (exit ${exitCode}). Check Node.js type-stripping support (${TYPE_STRIPPING_NODE.join(".")}+) and that scripts/ai-provider-preflight.mjs exists.`;
    throw new LaunchError([
      `${LABELS[provider]} is unavailable: ${message}`,
      instructions,
      "A completed login does not establish executable discovery or isolation support.",
      "No provider fallback was attempted. No credentials were printed.",
    ]);
  }
  deps.print(`Initial provider: ${LABELS[provider]} (${readiness.message})`);
}

async function checkAzure(deps, options, nodeVersion) {
  const { print } = deps;
  const funcPath = deps.resolveFuncPath();
  if (!funcPath) {
    throw new LaunchError([
      "MISSING PREREQUISITE: Azure Functions Core Tools ('func')",
      "",
      "The Azure provider needs it; it runs the local API on port 7071.",
      "",
      "Install it once, for example:",
      "",
      ...(deps.platform === "win32" ? ["  winget install --id Microsoft.Azure.FunctionsCoreTools -e"]
        : deps.platform === "darwin" ? ["  brew tap azure/functions && brew install azure-functions-core-tools@4"] : []),
      "  npm install -g azure-functions-core-tools@4 --unsafe-perm true",
      "",
      "Then open a new terminal so PATH updates apply, confirm with 'func --version',",
      "and run this again. To model without AI, no install is needed: npm run start",
    ]);
  }
  const env = {};
  const funcDirectory = path.dirname(funcPath);
  const delimiter = deps.platform === "win32" ? ";" : ":";
  if (!(deps.env.PATH ?? "").split(delimiter).includes(funcDirectory)) {
    print(`Using Azure Functions Core Tools at ${funcPath}`);
    env.PATH = `${funcDirectory}${delimiter}${deps.env.PATH ?? ""}`;
  }
  if (nodeVersion && !FUNCTIONS_NODE_MAJORS.includes(nodeVersion[0])) {
    print("");
    print(`Warning: Node ${nodeVersion.join(".")} is outside the versions the Azure Functions host`);
    print(`         supports (${FUNCTIONS_NODE_MAJORS.join(", ")}). Vite still runs, but the API on port 7071`);
    print("         may refuse to start and the Design Assistant may then return errors.");
    for (const line of nodeInstallHint(deps.platform)) print(`         ${line}`);
    print("");
  }

  const endpoint = deps.configuredValue(["AZURE_OPENAI_ENDPOINT", "AZURE_AI_ENDPOINT"], ["AZURE_OPENAI_ENDPOINT", "AZURE_AI_ENDPOINT"]);
  const deployment = deps.configuredValue(["MODEL_DEPLOYMENT_NAME"], ["MODEL_DEPLOYMENT_NAME"]);
  if (!endpoint || !deployment) {
    const missing = [!endpoint && "AZURE_OPENAI_ENDPOINT", !deployment && "MODEL_DEPLOYMENT_NAME"].filter(Boolean);
    const setter = deps.platform === "win32"
      ? ["  $env:AZURE_OPENAI_ENDPOINT = 'https://<your-resource>.openai.azure.com'", "  $env:MODEL_DEPLOYMENT_NAME = '<your-model-deployment-name>'"]
      : ["  export AZURE_OPENAI_ENDPOINT='https://<your-resource>.openai.azure.com'", "  export MODEL_DEPLOYMENT_NAME='<your-model-deployment-name>'"];
    throw new LaunchError([
      `MISSING CONFIGURATION: ${missing.join(" and ")}`,
      "",
      "The AI Design Assistant needs your own Azure OpenAI deployment. Nothing is",
      "provided with the app, and no AI service is shared with you.",
      "",
      "If you already have one, set these in THIS terminal and re-run:",
      "",
      ...setter,
      "",
      "They are not secrets, and they are not saved into the repository.",
      `If you do NOT have one yet, follow ${BYO_AI_DOC} to create and secure it.`,
      "To model without AI instead, run: npm run start",
    ]);
  }
  if (!/^https:\/\//.test(endpoint)) {
    throw new LaunchError(["INVALID CONFIGURATION: the endpoint must use HTTPS.", "", `Current value: ${endpoint}`,
      "", "Use the resource endpoint shown in the Azure portal, for example:", "", "  https://<your-resource>.openai.azure.com"]);
  }
  print(`Azure OpenAI endpoint: ${endpoint}`);
  print(`Model deployment:      ${deployment}`);

  if (options.skipAuthCheck) {
    print("");
    print("Skipping the Azure identity check (--skip-auth-check).");
    print("Design Assistant requests will fail until a signed-in identity is available.");
    print("");
    return env;
  }
  if (!deps.hasCommand("az")) {
    throw new LaunchError([
      "MISSING PREREQUISITE: Azure CLI ('az')",
      "",
      "A secured Azure OpenAI account accepts Microsoft Entra tokens only, and the",
      "local API obtains one from your Azure CLI sign-in. No API key is used.",
      "",
      "Install it from https://aka.ms/installazurecli, open a new terminal,",
      "run 'az login', then run this again.",
      "",
      "To start without the assistant, re-run with --skip-auth-check.",
    ]);
  }
  const account = deps.az(["account", "show", "--query", "user.name", "-o", "tsv"]);
  if (account.exitCode !== 0 || !account.output) {
    throw new LaunchError(["NOT SIGNED IN TO AZURE", "",
      "A secured Azure OpenAI account accepts Microsoft Entra tokens only, so the",
      "local API needs a signed-in identity. Run:", "", "  az login", "",
      "then run this again. To start without the assistant, use --skip-auth-check."]);
  }
  const resource = ["--resource", "https://cognitiveservices.azure.com"];
  if (deps.az(["account", "get-access-token", ...resource, "--query", "expiresOn", "-o", "tsv"]).exitCode !== 0) {
    throw new LaunchError([`Signed in as ${account.output}, but an Azure OpenAI token could not be acquired.`, "",
      "The sign-in has most likely expired or needs re-authentication. Run:", "", "  az login", "", "then run this again."]);
  }
  print(`Azure identity:        ${account.output}`);
  // DefaultAzureCredential prefers these over the CLI sign-in, which silently
  // changes which principal the Function presents.
  if (deps.env.AZURE_CLIENT_ID && deps.env.AZURE_TENANT_ID &&
      (deps.env.AZURE_CLIENT_SECRET || deps.env.AZURE_CLIENT_CERTIFICATE_PATH)) {
    print("");
    print("Warning: AZURE_CLIENT_ID/AZURE_TENANT_ID credentials are set in this session.");
    print(`         The API will use that service principal instead of ${account.output}.`);
    print("         Clear them if you intended to use your own identity.");
    print("");
  }
  if (options.verifyEndpoint) {
    print(`Verifying ${deployment} on ${endpoint} (inference probe; may incur usage) ...`);
    const token = deps.az(["account", "get-access-token", ...resource, "--query", "accessToken", "-o", "tsv"]).output;
    const uri = `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-10-21`;
    const status = await deps.probeEndpoint(uri, token);
    if (status >= 200 && status < 300) {
      print("Endpoint reachable.");
    } else {
      const hint = { 401: `${account.output} lacks a data-plane role. Assign 'Cognitive Services OpenAI User' on the account.`,
        403: "The account firewall rejected this machine's public IP, which may have rotated.",
        404: `Deployment '${deployment}' does not exist on that account.` }[status] ?? "See the error above.";
      print("");
      print(`Warning: endpoint probe failed (HTTP ${status}). ${hint}`);
      print(`         See ${BYO_AI_DOC} for the access checklist.`);
      print("         Design Assistant requests will fail until this is resolved; starting anyway.");
      print("");
    }
  }
  return env;
}

// Returns the process exit code. Every user-facing failure is a LaunchError.
export async function main(argv, deps = defaultDeps()) {
  const { print } = deps;
  const options = parseArgs(argv);
  if (options.help) { USAGE.forEach(line => print(line)); return 0; }

  print("");
  if (options.ai) {
    print("SecureDesignStudio - with AI Design Assistant");
    print("Use your Azure deployment, Claude subscription, or ChatGPT subscription.");
    print("Prompts and included model context are sent to the provider you choose.");
    print(`See ${BYO_AI_DOC}. Ordinary startup checks do not run inference.`);
  } else {
    print("SecureDesignStudio");
    print("Local modeling - no AI, no Azure account, no credentials.");
  }
  print("");

  if (!deps.exists("package.json")) {
    throw new LaunchError(["package.json was not found in the repository root, so the clone looks incomplete.",
      "Clone the repository again and run this from its root."]);
  }

  const env = {};
  if (options.ai) {
    options.provider ??= await chooseProvider(deps);
    validateProviderOptions(options);
    Object.assign(env, {
      SDS_AI_PROVIDER: options.provider,
      SDS_LOCAL_AI: "1",
      SDS_AI_DEBUG: options.debugAi || options.debugAiContent ? "1" : "0",
      SDS_AI_DEBUG_CONTENT: options.debugAiContent ? "1" : "0",
    });
    if (options.debugAi) print("AI interaction diagnostics enabled (sanitized; no raw provider output).");
    if (options.debugAiContent) {
      print("WARNING: AI content logging includes full prompts, model context and responses. Logs are local temporary files; protect and delete them after debugging.");
    }
  }

  if (!deps.hasCommand("npm")) {
    throw new LaunchError(["MISSING PREREQUISITE: npm", "",
      "Node.js was found but npm was not. npm installs this app's dependencies.", "",
      `Reinstall Node.js ${RECOMMENDED_NODE_MAJOR} LTS with npm included, then run this again.`]);
  }
  const node = checkNode(deps.nodeVersion, deps.platform);
  if (node.warning) print(`Could not determine the Node.js version; continuing. If startup fails, confirm 'node --version' reports ${MINIMUM_NODE.join(".")} or later.`);
  else print(`Node.js ${node.version.join(".")}`);

  if (!options.ai) {
    await assertPortFree(deps, 5173, "SecureDesignStudio");
    await installDependencies(deps, ".", "app");
    print("");
    print("Starting SecureDesignStudio at http://localhost:5173/");
    print("Press Ctrl+C to stop it.");
    print("");
    return deps.npm(["run", "dev"], env);
  }

  if (options.provider !== "azure") {
    await checkLocalProvider(deps, options, node.version);
    if (options.diagnoseProvider) {
      print("Diagnostics complete. No servers started and no inference requested.");
      return 0;
    }
    await assertPortFree(deps, 5173, "SecureDesignStudio");
    await installDependencies(deps, ".", "app");
    print("");
    print(`Starting SecureDesignStudio at http://localhost:5173/ with the local ${LABELS[options.provider]} bridge.`);
    print("No Azure Functions host or API package is needed for Claude/Codex.");
    print("Select a scenario, then choose Review > Design Assistant.");
    print("Both AI surfaces share the provider selector. Press Ctrl+C to stop.");
    print("");
    return deps.npm(["run", "dev:ai:local"], { ...env, SDS_LOCAL_AI_CLI_ONLY: "1" });
  }

  Object.assign(env, await checkAzure(deps, options, node.version));
  await assertPortFree(deps, 5173, "SecureDesignStudio");
  await assertPortFree(deps, 7071, "The local Design Assistant API");
  await installDependencies(deps, ".", "app");
  await installDependencies(deps, "api", "API");
  print("");
  print("Starting SecureDesignStudio at http://localhost:5173/");
  print("Select a scenario, then choose Review > Design Assistant.");
  print("Initial AI provider: Azure. Both AI surfaces share the provider selector.");
  print("Press Ctrl+C to stop the app and the API.");
  print("");
  return deps.npm(["run", "dev:ai"], env);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(root);
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof LaunchError)) throw error;
    process.stderr.write(`\n${error.lines.join("\n")}\n\n`);
    process.exitCode = error.exitCode;
  }
}
