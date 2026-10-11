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

// Codex --json reports command, file-change, MCP and web-search items; any of them voids the answer.
export function verifyCodexEvents(stdout: string): void {
  let completed = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: { type?: unknown; item?: { type?: unknown } };
    try { event = JSON.parse(line); } catch { throw new LocalProviderError(502, "Codex returned an invalid event stream."); }
    if (event.type === "turn.failed" || event.type === "error") {
      throw new LocalProviderError(502, "Codex did not complete the request. No provider fallback was attempted.");
    }
    if (event.type === "turn.completed") completed = true;
    if (typeof event.type === "string" && event.type.startsWith("item.") &&
        !CODEX_ALLOWED_ITEMS.has(String(event.item?.type))) {
      throw new LocalProviderError(502, "Codex attempted a disallowed tool or action. The response was discarded.");
    }
  }
  if (!completed) throw new LocalProviderError(502, "Codex did not complete the request.");
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

async function executable(provider: "claude" | "codex"): Promise<string> {
  const root = await protectedRoot();
  const name = process.platform === "win32" ? `${provider}.exe` : provider;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, name);
    try {
      const path = await fs.realpath(candidate);
      const inside = relative(root, path);
      if (!inside.startsWith("..") && !isAbsolute(inside)) continue;
      if ((await fs.stat(path)).isFile()) return path;
    } catch { /* Missing native executable; never invoke a cmd/PowerShell shim. */ }
  }
  throw new LocalProviderError(503, `Install a supported native ${provider} CLI on PATH. Shell launchers are not supported.`);
}

export function runProcess(
  command: string, args: readonly string[], cwd: string, input: string,
  timeoutMs: number, env = childEnvironment(), includeStderr = false, acceptedExitCodes = [0],
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, [...args], {
      cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let output = "", bytes = 0, failure: LocalProviderError | undefined;
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

async function prepare(provider: "claude" | "codex", cwd: string): Promise<string> {
  await rejectManagedConfiguration(provider, cwd);
  const command = await executable(provider);
  const help = await runProcess(command, provider === "codex" ? ["exec", "--help"] : ["--help"], cwd, "", READINESS_TIMEOUT_MS);
  const required = provider === "claude"
    ? ["--restricted", "--safe-mode", "--json-schema", "--no-session-persistence", "--system-prompt-file", "--tools", "--setting-sources"]
    : ["--ignore-user-config", "--ignore-rules", "--strict-config", "--disable", "--enable",
      "--ephemeral", "--output-schema", "--sandbox", "--json", "--output-last-message"];
  if (required.some(flag => !help.includes(flag))) {
    throw new LocalProviderError(503, `The installed ${provider} CLI cannot prove the required isolation flags. Update it before selecting this provider.`);
  }
  if (provider === "codex") {
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
    for (const [feature, expected] of [
      ["shell_tool", "false"], ["unified_exec", "false"], ["hooks", "false"],
      ["plugins", "false"], ["remote_plugin", "false"], ["shell_snapshot", "false"],
      ["apps", "false"], ["code_mode", "false"], ["multi_agent", "false"],
      ["browser_use", "false"], ["computer_use", "false"], ["in_app_browser", "false"],
      ["view_image", "false"], ["image_generation", "false"], ["skill_search", "false"],
      ["skip_host_skill_discovery", "true"],
    ]) {
      if (!new RegExp(`^${feature}\\s+.*\\s${expected}\\s*$`, "m").test(features)) {
        throw new LocalProviderError(503, "Codex could not verify its tool, hook, and project-discovery isolation.");
      }
    }
  }
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

export async function localProviderStatus(id: "claude" | "codex"): Promise<AiProviderStatus> {
  const label = id === "claude" ? "Claude Code subscription" : "ChatGPT Codex CLI";
  if (active) return { id, label, available: false, message: "A local AI request is already running." };
  active = true;
  try {
    await withWorkspace(cwd => prepare(id, cwd));
    return { id, label, available: true, message: "Subscription CLI is ready for local, tool-free requests." };
  } catch (error) {
    return { id, label, available: false, message: error instanceof LocalProviderError
      ? error.message : "Local CLI readiness could not be verified." };
  } finally { active = false; }
}

export async function runLocalProvider(
  provider: Exclude<AiProviderId, "azure">, system: string, prompt: string, schema: unknown,
): Promise<string> {
  if (active) throw new LocalProviderError(429, "A local AI request is already running. Try again after it finishes.");
  active = true;
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  try {
    return await withWorkspace(async cwd => {
      const command = await prepare(provider, cwd);
      const schemaText = JSON.stringify(schema);
      const instructions = join(cwd, "instructions.txt");
      await fs.writeFile(instructions, system, { mode: 0o600 });
      if (provider === "claude") {
        if (process.platform === "win32" && schemaText.length > 20_000) {
          throw new LocalProviderError(413, "The catalog schema exceeds the Windows Claude CLI argument limit. Select Codex or Azure explicitly.");
        }
        const text = await runProcess(command, [
          ...CLAUDE_ISOLATION_ARGS, "-p", "--output-format", "json",
          "--no-session-persistence", "--system-prompt-file", instructions,
          "--json-schema", schemaText,
        ], cwd, prompt, Math.max(1, deadline - Date.now()));
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
      const events = await runProcess(command, [
        "exec", ...CODEX_ISOLATION_ARGS,
        "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
        "-c", 'approval_policy="never"',
        "-c", `model_instructions_file=${JSON.stringify(instructions)}`,
        "--json", "--output-last-message", outputFile,
        "--output-schema", schemaFile, "-",
      ], cwd, prompt, Math.max(1, deadline - Date.now()));
      verifyCodexEvents(events);
      const output = await fs.readFile(outputFile, "utf8");
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        throw new LocalProviderError(502, "The local AI response exceeded its output limit.");
      }
      return output;
    });
  } finally { active = false; }
}
