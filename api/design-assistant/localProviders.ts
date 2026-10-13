import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import type { AiProviderId, AiProviderStatus } from "../../shared/aiProviders";

const MAX_OUTPUT_BYTES = 1_000_000;
const READINESS_TIMEOUT_MS = 1_500;
const REQUEST_TIMEOUT_MS = 80_000;
let active = false;

// Plain fields keep this module loadable by Node's type stripping (launcher preflight).
export class LocalProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const CODEX_ALLOWED_ITEMS = new Set(["agent_message", "reasoning", "todo_list"]);
const CODEX_TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "collab_tool_call", "web_search"]);
const CODEX_EVENT_TYPES = new Set(["thread.started", "turn.started", "turn.completed",
  "turn.failed", "item.started", "item.updated", "item.completed", "error"]);

// Codex --json reports command, file-change, MCP and web-search items; any of them voids the answer.
export function verifyCodexEvents(stdout: string, diagnostic?: ProviderDiagnostic): void {
  let completed = false;
  let answerCompleted = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: { type?: unknown; error?: { message?: unknown }; message?: unknown;
      item?: { type?: unknown; status?: unknown; message?: unknown; text?: unknown } } | null;
    try { event = JSON.parse(line); } catch { throw new LocalProviderError(502, "Codex returned an invalid event stream."); }
    if (!event || typeof event !== "object" || typeof event.type !== "string" ||
        !CODEX_EVENT_TYPES.has(event.type)) {
      throw new LocalProviderError(502, "Codex returned an unsupported event shape. The response was discarded; update the CLI or report its version. Raw output was not exposed.");
    }
    if (event.type === "turn.failed" || event.type === "error") {
      const category = classifyCliError(event.error?.message ?? event.message);
      diagnostic?.("events", `${event.type}; category=${category}`);
      throw new LocalProviderError(502, `Codex reported ${event.type} (${category}). The response was discarded. No provider fallback was attempted; raw error text was not exposed.`);
    }
    if (event.type === "turn.completed") completed = true;
    if (event.type.startsWith("item.")) {
      const itemType = event.item?.type;
      if (itemType === "error") {
        diagnostic?.("events", `${event.type}; item=error; nonfatal notification; category=${classifyCliError(event.item?.message)}`);
        continue;
      }
      if (typeof itemType === "string" && CODEX_TOOL_ITEMS.has(itemType)) {
        const status = ["in_progress", "completed", "failed", "declined"].includes(String(event.item?.status))
          ? String(event.item?.status) : "unspecified";
        throw new LocalProviderError(502, `Codex attempted a disallowed tool or action (${event.type}, item=${itemType}, status=${status}). The response was discarded. Commands, arguments, paths, and raw output were not exposed.`);
      }
      if (typeof itemType !== "string" || !CODEX_ALLOWED_ITEMS.has(itemType)) {
        throw new LocalProviderError(502, `Codex returned an unsupported item shape (${event.type}, item=unknown). The response was discarded; update the CLI or report its version. Raw output was not exposed.`);
      }
      diagnostic?.("events", `${event.type}; item=${itemType}`);
      if (event.type === "item.completed" && itemType === "agent_message" &&
          typeof event.item?.text === "string" && event.item.text.trim()) answerCompleted = true;
    }
  }
  if (!completed || !answerCompleted) throw new LocalProviderError(502, "Codex did not complete a response. Enable -DebugAI for interaction diagnostics.");
}

export function classifyCliError(value: unknown): string {
  if (typeof value !== "string") return "unspecified CLI error";
  if (/schema|response_format|structured.output/i.test(value)) return "structured-output/schema";
  if (/quota|usage.limit|rate.limit|too many requests|429/i.test(value)) return "usage/rate-limit";
  if (/unauthori[sz]ed|authentication|sign.in|401|token.expired/i.test(value)) return "authentication";
  if (/reconnect|retry|stream|network|connection|timed.out|timeout/i.test(value)) return "network/stream";
  if (/model.*(?:not.*(?:found|supported|available)|invalid)/i.test(value)) return "model availability";
  return "unspecified CLI error";
}

// Official references: code.claude.com/docs/en/{cli-reference,headless} and
// developers.openai.com/codex/{noninteractive,config-reference}.
// --bare is deliberately NOT used: it disables Claude subscription OAuth.
export const CLAUDE_ISOLATION_ARGS = [
  "--restricted", "--safe-mode", "--setting-sources", "",
  "--settings", '{"disableAllHooks":true,"disableClaudeAiConnectors":true,"forceLoginMethod":"claudeai"}',
  "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
  "--tools", "", "--disable-slash-commands", "--no-chrome",
] as const;

export const CODEX_ISOLATION_ARGS = [
  "--ignore-user-config", "--ignore-rules", "--strict-config",
  "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"',
  "-c", 'cli_auth_credentials_store="file"',
  // Documented config keys: no AGENTS.md project docs and no ancestor project
  // root search, so the empty per-request cwd is the whole project.
  "-c", "project_doc_max_bytes=0", "-c", "project_root_markers=[]",
  "-c", "mcp_servers={}", "-c", 'web_search="disabled"',
  "-c", "allow_login_shell=false",
  // --disable/--enable reject unknown feature names. Only current (non-removed)
  // features are listed so a future removal cannot silently break readiness.
  "--disable", "shell_tool", "--disable", "unified_exec",
  "--disable", "apps", "--disable", "hooks",
  "--disable", "shell_snapshot", "--disable", "shell_snapshot_v2",
  "--disable", "multi_agent", "--disable", "multi_agent_v2",
  "--enable", "skip_host_skill_discovery", "--disable", "skill_search",
  "--disable", "skill_mcp_dependency_install",
  "--disable", "plugins", "--disable", "remote_plugin",
  "--disable", "browser_use", "--disable", "computer_use",
  "--disable", "in_app_browser", "--disable", "code_mode",
  "--disable", "view_image", "--disable", "image_generation",
  "--disable", "memory_tool", "--disable", "request_permissions_tool",
  "-c", "skills.include_instructions=false", "-c", "skills.bundled.enabled=false",
  "-c", 'history.persistence="none"',
] as const;

// shell_tool=false is the command-execution gate. unified_exec is deliberately
// not required: current Codex forces it on unless managed requirements pin it,
// and it only selects the backend of the (disabled) shell tool.
export const CODEX_REQUIRED_FEATURES: ReadonlyArray<readonly [string, "true" | "false"]> = [
  ["shell_tool", "false"], ["hooks", "false"],
  ["plugins", "false"], ["remote_plugin", "false"], ["shell_snapshot", "false"],
  ["apps", "false"], ["code_mode", "false"], ["multi_agent", "false"],
  ["browser_use", "false"], ["computer_use", "false"], ["in_app_browser", "false"],
  ["view_image", "false"], ["image_generation", "false"], ["skill_search", "false"],
  ["skip_host_skill_discovery", "true"],
];

/** Parses `codex features list` rows (`name  stage  true|false`); other lines are ignored. */
export function parseCodexFeatures(output: string): Map<string, "true" | "false"> {
  const features = new Map<string, "true" | "false">();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([a-z0-9_]+)\s+\S.*?\s(true|false)\s*$/.exec(line);
    if (match) features.set(match[1], match[2] as "true" | "false");
  }
  return features;
}

export function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // No API keys, custom gateways, NODE_OPTIONS, proxy variables, provider
  // overrides, CLI config overrides, or repository instruction variables.
  for (const key of ["SystemRoot", "WINDIR", "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "LANG"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function protectedRoot(): Promise<string> {
  // The API runs from api/ and the launcher from the repository root; exclude
  // the whole enclosing repository/worktree (`.git` directory or file).
  const start = await fs.realpath(process.cwd());
  for (let current = start; ; current = dirname(current)) {
    try { await fs.stat(join(current, ".git")); return current; } catch { /* keep searching */ }
    if (dirname(current) === current) return start;
  }
}

type ProviderDiagnostic = (stage: string, message: string) => void;

export async function resolveLocalExecutable(
  provider: "claude" | "codex", diagnostic?: ProviderDiagnostic,
): Promise<string> {
  const root = await protectedRoot();
  const name = process.platform === "win32" ? `${provider}.exe` : provider;
  const directories = [...new Set((process.env.PATH ?? "").split(delimiter).filter(isAbsolute))];
  const outsideRepository = (path: string) => {
    const inside = relative(root, path);
    return /^\.\.[\\/]/.test(inside) ||
      inside === ".." || isAbsolute(inside);
  };
  const nativeFile = async (candidate: string, packageRoot?: string): Promise<string | undefined> => {
    try {
      const path = await fs.realpath(candidate);
      if (!outsideRepository(path)) {
        diagnostic?.("executable", "Rejected a repository-local executable.");
        return;
      }
      if (packageRoot) {
        const inside = relative(packageRoot, path);
        if (inside === ".." || inside.startsWith("..") || isAbsolute(inside)) {
          diagnostic?.("npm", "Rejected a binary resolving outside its package.");
          return;
        }
      }
      if ((await fs.stat(path)).isFile()) return path;
    } catch { /* Missing native executable; never invoke a cmd/PowerShell shim. */ }
  };
  for (const directory of directories) {
    const path = await nativeFile(join(directory, name));
    if (path) {
      diagnostic?.("executable", `Selected native PATH executable: ${path}`);
      return path;
    }
  }
  // Official npm Windows prefixes expose wrappers beside node_modules. Inspect
  // only known package paths, never execute or parse a wrapper.
  if (provider === "codex" && process.platform === "win32") {
    const triple = process.arch === "x64" ? "x86_64-pc-windows-msvc"
      : process.arch === "arm64" ? "aarch64-pc-windows-msvc" : undefined;
    if (!triple) throw new LocalProviderError(503, `Codex npm discovery does not support Node architecture ${process.arch}.`);
    const platformPackage = `codex-win32-${process.arch}`;
    const packageDirectory = async (candidate: string, main: boolean): Promise<string | undefined> => {
      let path: string;
      try { path = await fs.realpath(candidate); } catch { return; }
      if (!outsideRepository(path)) {
        diagnostic?.("npm", "Rejected a repository-local Codex package.");
        return;
      }
      try {
        const manifestPath = join(path, "package.json");
        if ((await fs.stat(manifestPath)).size > 64_000) throw new Error("Oversized manifest");
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        // Platform dependencies are published as aliases of @openai/codex.
        if (!manifest || !(main ? ["@openai/codex"] :
            ["@openai/codex", `@openai/${platformPackage}`]).includes(manifest.name) ||
            (main && manifest.bin?.codex !== "bin/codex.js") ||
            (manifest.os && (!Array.isArray(manifest.os) || !manifest.os.includes("win32"))) ||
            (manifest.cpu && (!Array.isArray(manifest.cpu) || !manifest.cpu.includes(process.arch)))) {
          throw new Error("Unexpected manifest");
        }
        return path;
      } catch {
        diagnostic?.("npm", `Rejected missing, malformed or incompatible package metadata: ${path}`);
      }
    };
    for (const directory of directories) {
      const main = await packageDirectory(join(directory, "node_modules", "@openai", "codex"), true);
      if (!main) continue;
      diagnostic?.("npm", `Found Codex npm package: ${main}`);
      const packageRoots: string[] = [];
      for (const candidate of [
        join(main, "node_modules", "@openai", platformPackage),
        join(dirname(main), platformPackage),
      ]) {
        const path = await packageDirectory(candidate, false);
        if (path && !packageRoots.includes(path)) packageRoots.push(path);
      }
      packageRoots.push(main);
      for (const packageRoot of packageRoots) {
        // Current packages use bin/; older packages use codex/.
        for (const binaryDirectory of ["bin", "codex"]) {
          const path = await nativeFile(join(packageRoot, "vendor", triple, binaryDirectory, name), packageRoot);
          if (path) {
            diagnostic?.("executable", `Selected native npm executable: ${path}`);
            return path;
          }
        }
      }
      diagnostic?.("npm", `No native binary for ${triple}; the platform dependency may be missing.`);
    }
    diagnostic?.("npm", "No usable Codex native binary found in npm packages beneath absolute PATH directories.");
  }
  throw new LocalProviderError(503, provider === "codex" && process.platform === "win32"
    ? "Codex native executable was not found on PATH or in a supported npm package. Check the installation's platform dependency. Shell launchers are not executed."
    : `Install a supported native ${provider} CLI on PATH. Shell launchers are not supported.`);
}

export function runProcess(
  command: string, args: readonly string[], cwd: string, input: string,
  timeoutMs: number, env = childEnvironment(), includeStderr = false, acceptedExitCodes = [0],
  diagnostic?: ProviderDiagnostic,
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, [...args], {
      cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "", bytes = 0, stderrCategory = "unspecified CLI error", failure: LocalProviderError | undefined;
    const stop = (message: string) => {
      if (failure) return;
      failure = new LocalProviderError(502, message);
      // No tools/descendants are permitted. On POSIX, also kill our own process
      // group; never kill unrelated processes by executable name.
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("The local AI request timed out. No changes were applied."), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_OUTPUT_BYTES) stop("The local AI response exceeded its output limit.");
      else output += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      const category = classifyCliError(chunk.toString("utf8"));
      if (category !== "unspecified CLI error") stderrCategory = category;
      if (bytes > MAX_OUTPUT_BYTES) stop("The local AI response exceeded its output limit.");
      else if (includeStderr) output += chunk.toString("utf8");
    });
    child.stdin.on("error", () => stop("The local AI process could not receive the request."));
    child.on("error", () => {
      clearTimeout(timer);
      reject(new LocalProviderError(503, "The local AI executable could not start."));
    });
    child.on("close", code => {
      clearTimeout(timer);
      diagnostic?.("process", `exit=${code ?? "terminated"}; output bytes=${bytes}; stderr category=${stderrCategory}`);
      if (failure) reject(failure);
      else if (code === null || !acceptedExitCodes.includes(code)) reject(new LocalProviderError(502,
        "The local AI CLI failed. Check its subscription sign-in and usage limits; no provider fallback was attempted."));
      else resolveOutput(output);
    });
    child.stdin.end(input);
  });
}

async function withWorkspace<T>(work: (cwd: string) => Promise<T>): Promise<T> {
  // Outside the repository so neither CLI discovers its instructions or
  // configuration. Codex additionally uses project_root_markers=[] and
  // --skip-git-repo-check; Claude uses --safe-mode and no setting sources.
  const directory = await fs.mkdtemp(join(tmpdir(), "sds-ai-"));
  try {
    await fs.chmod(directory, 0o700);
    const cwd = join(directory, "work");
    await fs.mkdir(cwd);
    return await work(cwd);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function rejectManagedConfiguration(provider: "claude" | "codex", cwd: string): Promise<void> {
  // Policy takes precedence over CLI options. Do not bypass it or claim
  // isolation when host-managed hooks/providers could override this adapter.
  const paths = process.platform === "win32"
    ? provider === "claude"
      ? ["managed-settings.json", "managed-settings.d", "managed-mcp.json"]
        .map(name => join(process.env.ProgramFiles ?? "C:\\Program Files", "ClaudeCode", name))
      : [join(process.env.ProgramData ?? "C:\\ProgramData", "OpenAI", "Codex", "requirements.toml"),
        join(process.env.ProgramData ?? "C:\\ProgramData", "OpenAI", "Codex", "managed_config.toml")]
    : provider === "claude"
      ? ["/etc/claude-code", "/Library/Application Support/ClaudeCode"].flatMap(directory =>
        ["managed-settings.json", "managed-settings.d", "managed-mcp.json"].map(name => join(directory, name)))
        .concat("/Library/Managed Preferences/com.anthropic.claudecode.plist")
      : ["/etc/codex/requirements.toml", "/etc/codex/managed_config.toml"];
  for (const path of paths) {
    try {
      await fs.stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new LocalProviderError(503, "Cannot verify local CLI managed-configuration isolation.");
    }
    throw new LocalProviderError(503, "Host-managed CLI configuration requires a separate isolation review. Use Azure instead.");
  }
  if (provider === "claude" && process.platform === "win32") {
    const registry = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
    for (const hive of ["HKLM", "HKCU"]) {
      const status = await runProcess(registry, ["query", `${hive}\\SOFTWARE\\Policies\\ClaudeCode`, "/v", "Settings"],
        cwd, "", READINESS_TIMEOUT_MS, childEnvironment(), true, [0, 1]);
      // Localized or inaccessible policy diagnostics are deliberately not
      // interpreted as absence. Never log the registry's returned contents.
      if (!/unable to find the specified registry key or value/i.test(status)) {
        throw new LocalProviderError(503, "Claude registry policy is present or cannot be verified. A separate isolation review is required.");
      }
    }
  }
}

async function prepare(provider: "claude" | "codex", cwd: string, diagnostic?: ProviderDiagnostic): Promise<string> {
  diagnostic?.("policy", "Checking managed configuration without inference.");
  await rejectManagedConfiguration(provider, cwd);
  diagnostic?.("executable", "Resolving a native executable without running shell wrappers.");
  const command = await resolveLocalExecutable(provider, diagnostic);
  diagnostic?.("capabilities", "Checking required isolation flags.");
  const help = await runProcess(command, provider === "codex" ? ["exec", "--help"] : ["--help"], cwd, "", READINESS_TIMEOUT_MS);
  const required = provider === "claude"
    ? ["--restricted", "--safe-mode", "--json-schema", "--no-session-persistence", "--system-prompt-file", "--tools", "--setting-sources"]
    : ["--ignore-user-config", "--ignore-rules", "--strict-config", "--disable", "--enable",
      "--ephemeral", "--output-schema", "--sandbox", "--json", "--output-last-message"];
  const missingFlags = required.filter(flag => !help.includes(flag));
  if (missingFlags.length) {
    throw new LocalProviderError(503, `The installed ${provider} CLI cannot prove the required isolation flags: ${missingFlags.join(", ")}. Update it before selecting this provider.`);
  }
  if (provider === "codex") {
    if (diagnostic) {
      try {
        const version = await runProcess(command, ["--version"], cwd, "", READINESS_TIMEOUT_MS);
        const semver = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\b/.exec(version)?.[0];
        diagnostic("features", `Codex CLI version: ${semver ?? "unrecognized"}.`);
      } catch {
        diagnostic("features", "Codex CLI version: unavailable.");
      }
    }
    diagnostic?.("features", "Checking effective tool and discovery isolation features.");
    const toggles: string[] = [];
    for (let index = 0; index < CODEX_ISOLATION_ARGS.length - 1; index++) {
      if (CODEX_ISOLATION_ARGS[index] === "--disable" || CODEX_ISOLATION_ARGS[index] === "--enable") {
        toggles.push(CODEX_ISOLATION_ARGS[index], CODEX_ISOLATION_ARGS[++index]);
      }
    }
    // A non-inference check validates feature names and effective safety
    // toggles, including host policy precedence, before advertising readiness.
    let features: string;
    try {
      features = await runProcess(command, [...toggles, "features", "list"], cwd, "", READINESS_TIMEOUT_MS);
    } catch {
      throw new LocalProviderError(503, "The installed Codex CLI does not recognize the required isolation features. Update it before selecting this provider.");
    }
    const observed = parseCodexFeatures(features);
    diagnostic?.("features", `Parsed ${observed.size} feature rows from 'features list'.`);
    const mismatches: string[] = [];
    for (const [feature, expected] of CODEX_REQUIRED_FEATURES) {
      const value = observed.get(feature);
      const ok = value === expected;
      diagnostic?.("features", `${feature}: observed ${value ?? "absent"}, required ${expected}${ok ? "" : " (mismatch)"}.`);
      if (!ok) mismatches.push(`${feature} must be ${expected}`);
    }
    // Codex 0.16x forces unified_exec on unless enterprise requirements pin it.
    // It is only a shell backend: shell_tool=false registers no command tools.
    const unified = observed.get("unified_exec");
    if (unified !== undefined) {
      diagnostic?.("features", `unified_exec: observed ${unified}; informational only because shell_tool=false removes all command execution tools.`);
    }
    if (mismatches.length) {
      throw new LocalProviderError(503, `Codex could not verify its tool, hook, and project-discovery isolation: ${mismatches.join("; ")}.`);
    }
  }
  diagnostic?.("authentication", "Checking subscription login status; credentials and raw CLI output are not reported.");
  const status = await runProcess(command, provider === "claude"
    ? [...CLAUDE_ISOLATION_ARGS, "auth", "status"]
    // --ignore-user-config belongs to exec, not the root/login command. Status
    // does not run inference/tools; the actual exec ignores config separately.
    : ["-c", 'forced_login_method="chatgpt"', "-c", 'model_provider="openai"',
      "-c", 'cli_auth_credentials_store="file"', "login", "status"],
    cwd, "", READINESS_TIMEOUT_MS, childEnvironment(), provider === "codex");
  if (provider === "claude") {
    let auth: Record<string, unknown>;
    try { auth = JSON.parse(status); } catch { throw new LocalProviderError(503, "Claude subscription authentication could not be verified."); }
    if (auth.loggedIn !== true || auth.authMethod !== "claude.ai" ||
        !["pro", "max"].includes(String(auth.subscriptionType).toLowerCase())) {
      throw new LocalProviderError(503, "Sign in to Claude Code with a consumer Pro or Max subscription. API-key and organizational gateway authentication are not supported.");
    }
  } else if (!/^Logged in using ChatGPT\s*$/i.test(status.trim())) {
    throw new LocalProviderError(503, "Sign in to Codex CLI using ChatGPT. API-key authentication is not supported.");
  }
  return command;
}

export async function localProviderStatus(id: "claude" | "codex", diagnostic?: ProviderDiagnostic): Promise<AiProviderStatus> {
  const label = id === "claude" ? "Claude Code subscription" : "ChatGPT Codex CLI";
  if (active) return { id, label, available: false, message: "A local AI request is already running." };
  active = true;
  try {
    await withWorkspace(cwd => prepare(id, cwd, diagnostic));
    return { id, label, available: true, message: "Subscription CLI is ready for local, tool-free requests." };
  } catch (error) {
    return { id, label, available: false, message: error instanceof LocalProviderError
      ? error.message : "Local CLI readiness could not be verified." };
  } finally { active = false; }
}

export async function runLocalProvider(
  provider: Exclude<AiProviderId, "azure">, system: string, prompt: string, schema: unknown,
  diagnostic?: ProviderDiagnostic,
): Promise<string> {
  if (active) throw new LocalProviderError(429, "A local AI request is already running. Try again after it finishes.");
  active = true;
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  try {
    return await withWorkspace(async cwd => {
      diagnostic?.("request", `provider=${provider}; starting isolated readiness`);
      const command = await prepare(provider, cwd, diagnostic ? (stage, message) => {
        if (stage === "features" || stage === "capabilities" || stage === "authentication") diagnostic(stage, message);
      } : undefined);
      diagnostic?.("request", `readiness passed; schema bytes=${Buffer.byteLength(JSON.stringify(schema))}; prompt bytes=${Buffer.byteLength(prompt)}`);
      const schemaText = JSON.stringify(schema);
      const instructions = join(cwd, "instructions.txt");
      await fs.writeFile(instructions, `${system}\n\nThis is a tool-free structured-response request. Use only the supplied model context. Do not run commands, read or modify files, browse, call tools, or delegate work. Return the requested JSON directly; describe missing evidence without attempting to retrieve it.`, { mode: 0o600 });
      if (provider === "claude") {
        if (process.platform === "win32" && schemaText.length > 20_000) {
          throw new LocalProviderError(413, "The catalog schema exceeds the Windows Claude CLI argument limit. Select Codex or Azure explicitly.");
        }
        diagnostic?.("inference", "Claude structured request started");
        const text = await runProcess(command, [
          ...CLAUDE_ISOLATION_ARGS, "-p", "--output-format", "json",
          "--no-session-persistence", "--system-prompt-file", instructions,
          "--json-schema", schemaText,
        ], cwd, prompt, Math.max(1, deadline - Date.now()), childEnvironment(), false, [0], diagnostic);
        const response = JSON.parse(text);
        if (response.is_error || response.subtype !== "success" ||
            !response.structured_output || typeof response.structured_output !== "object") {
          throw new LocalProviderError(502, "Claude did not return a complete structured response.");
        }
        return JSON.stringify(response.structured_output);
      }
      const schemaFile = join(cwd, "response-schema.json");
      const outputFile = join(cwd, "response.json");
      await fs.writeFile(schemaFile, schemaText, { mode: 0o600 });
      diagnostic?.("inference", "Codex structured request started; tool-free; read-only; ephemeral");
      const events = await runProcess(command, [
        "exec", ...CODEX_ISOLATION_ARGS,
        "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
        "-c", 'approval_policy="never"',
        "-c", `model_instructions_file=${JSON.stringify(instructions)}`,
        "--json", "--output-last-message", outputFile,
        "--output-schema", schemaFile, "-",
      ], cwd, prompt, Math.max(1, deadline - Date.now()), childEnvironment(), false, [0], diagnostic);
      diagnostic?.("inference", `Codex process completed; event bytes=${Buffer.byteLength(events)}`);
      verifyCodexEvents(events, diagnostic);
      const output = await fs.readFile(outputFile, "utf8");
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        throw new LocalProviderError(502, "The local AI response exceeded its output limit.");
      }
      diagnostic?.("response", `completed output bytes=${Buffer.byteLength(output)}`);
      return output;
    });
  } finally { active = false; }
}
