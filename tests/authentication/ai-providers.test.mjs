import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const native = resolve(root, "..", "synthetic-native");
const source = file => readFileSync(resolve(root, file), "utf8");
const result = { answer: "Synthetic answer", references: [], findings: [] };
const design = { answer: "Clarify the design", assumptions: [], design: null };
const catalog = {
  nodeTypes: [{ id: "synthetic-node", label: "Synthetic node" }],
  authentication: [{ id: "synthetic-auth", label: "Synthetic auth" }],
  classifications: [{ id: "synthetic-data", label: "Synthetic data" }],
};

function harness(env = {}, options = {}) {
  const calls = [], files = new Map(), removed = [], logs = [], modelCalls = [], timeouts = [];
  let directory = 0, killed = 0, tokens = 0;
  const fakeProcess = {
    platform: "win32", cwd: () => root,
    env: { PATH: native, USERPROFILE: resolve(root, "..", "synthetic-user"), ...env },
    kill() { killed++; },
  };
  const fakeFs = {
    async realpath(path) { return path; },
    async stat(path) {
      if (path.endsWith(".exe")) {
        if (options.missing) throw Object.assign(new Error(), { code: "ENOENT" });
        return { isFile: () => true };
      }
      if (options.managed && path.includes("managed-settings")) return { isFile: () => true };
      throw Object.assign(new Error(), { code: "ENOENT" });
    },
    async mkdtemp(prefix) { return `${prefix}${++directory}`; },
    async chmod() {}, async mkdir() {},
    async writeFile(file, content) { files.set(file, content); },
    async readFile(file) {
      if (!files.has(file)) throw Object.assign(new Error(), { code: "ENOENT" });
      return files.get(file);
    },
    async rm(path) {
      removed.push(path);
      for (const key of files.keys()) if (key.startsWith(path)) files.delete(key);
    },
  };
  const fakeSpawn = (command, args, config) => {
    const child = new EventEmitter();
    child.pid = 12345;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => { killed++; queueMicrotask(() => child.emit("close", null)); return true; };
    const call = { command, args, config, input: "" };
    calls.push(call);
    child.stdin.on("data", data => { call.input += data.toString(); });
    child.stdin.on("finish", () => queueMicrotask(() => {
      if (options.hang && args.includes("-p")) return;
      let stdout, stderr = "";
      if (args.includes("query")) {
        stdout = options.registryManaged ? "Settings REG_SZ synthetic-policy" :
          "ERROR: The system was unable to find the specified registry key or value.";
      } else if (args.includes("--help")) {
        stdout = options.oldCli ? "--help --print" :
          "--restricted --safe-mode --json-schema --no-session-persistence --system-prompt-file --tools --setting-sources " +
          "--ignore-user-config --ignore-rules --strict-config --disable --enable --ephemeral --output-schema --sandbox --json --output-last-message";
      } else if (args.includes("list")) {
        stdout = ["shell_tool", "unified_exec", "hooks", "plugins", "remote_plugin", "shell_snapshot",
          "apps", "code_mode", "multi_agent", "browser_use", "computer_use", "in_app_browser",
          "view_image", "image_generation", "skill_search"]
          .map(feature => `${feature} stable false`).join("\n") + "\nskip_host_skill_discovery under_development true\n";
        if (options.featureOverride) stdout = stdout.replace("shell_tool stable false", "shell_tool stable true");
      } else if (args.includes("status")) {
        if (command.endsWith("claude.exe")) stdout = JSON.stringify({
          loggedIn: true, authMethod: options.apiAuth ? "api_key" : "claude.ai", subscriptionType: "pro",
        });
        else { stdout = ""; stderr = options.apiAuth ? "Logged in using an API key\n" : "Logged in using ChatGPT\n"; }
      } else {
        const value = options.output ?? (call.input.startsWith("MODE: design") ? design : result);
        if (command.endsWith("claude.exe")) {
          stdout = JSON.stringify({ subtype: options.incomplete ? "error_max_turns" : "success",
            is_error: Boolean(options.incomplete), structured_output: value });
        } else {
          files.set(args[args.indexOf("--output-last-message") + 1], JSON.stringify(value));
          stdout = [
            { type: "thread.started" }, { type: "turn.started" },
            ...(options.codexItem ? [{ type: "item.started", item: { type: options.codexItem } }] : []),
            { type: "item.completed", item: { type: "agent_message", text: "synthetic" } },
            options.incomplete ? { type: "turn.failed" } : { type: "turn.completed" },
          ].map(event => JSON.stringify(event)).join("\n");
        }
        if (options.outputOverflow) stdout = "x".repeat(1_000_001);
      }
      child.stdout.write(stdout);
      child.stderr.write(stderr);
      child.stdout.end(); child.stderr.end();
      child.emit("close", args.includes("query") && !options.registryManaged ? 1 :
        options.failure && args.includes("-p") ? 1 : 0);
    }));
    return child;
  };
  const modules = new Map();
  const load = file => {
    file = resolve(file);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const require = name => {
      if (name.startsWith(".")) return load(resolve(dirname(file), `${name}.ts`));
      if (name === "@azure/identity") return { DefaultAzureCredential: class {
        async getToken() { tokens++; return { token: "synthetic-token" }; }
      } };
      if (name === "node:child_process") return { spawn: fakeSpawn };
      if (name === "node:fs") return { promises: fakeFs };
      if (name === "node:os") return { tmpdir: () => "C:\\synthetic-temp" };
      if (name === "node:path") return { delimiter: ";", dirname, isAbsolute, join, relative, resolve };
      throw new Error(`Unexpected test dependency ${name}`);
    };
    const fetch = async (url, request) => {
      modelCalls.push({ url, ...request });
      return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop",
        message: { content: JSON.stringify(result) } }] }) };
    };
    vm.runInNewContext(`(function(require,module,exports,process,Buffer,fetch,AbortSignal,setTimeout,clearTimeout){${compiled}\n})`, { URL })(
      require, module, module.exports, fakeProcess, Buffer, fetch, AbortSignal,
      (fn, ms) => { timeouts.push(ms); return setTimeout(fn, options.fastTimeout ? 5 : ms); }, clearTimeout,
    );
    return module.exports;
  };
  return {
    load: file => load(resolve(root, file)), calls, files, removed, logs, modelCalls, fakeProcess, timeouts,
    get killed() { return killed; }, get tokens() { return tokens; },
    async invoke(body, { method = "POST", origin = "http://localhost:5173" } = {}) {
      const context = { log: { error: (...values) => logs.push(values) } };
      const handler = load(resolve(root, "api", "design-assistant", "index.ts")).default;
      await handler(context, { method, headers: origin === null ? {} : { origin }, body });
      return context.res;
    },
  };
}

test("providers: strict shared capabilities validate complete unique provider identities", () => {
  const contract = harness().load("shared\\aiProviders.ts");
  assert.deepEqual([...contract.AI_PROVIDER_IDS], ["azure", "claude", "codex"]);
  for (const invalid of [null, "", "Azure", "custom", {}, 0]) assert.equal(contract.isAiProviderId(invalid), false);
  const capabilities = {
    defaultProvider: "codex",
    providers: ["azure", "claude", "codex"].map(id => ({ id, label: id, available: false, message: "Unavailable" })),
  };
  assert.equal(contract.parseAiProviderCapabilities(capabilities).defaultProvider, "codex");
  assert.equal(contract.parseAiProviderCapabilities(capabilities).providers.length, 3);
  for (const invalid of [
    null, { ...capabilities, extra: true }, { ...capabilities, defaultProvider: "custom" },
    { ...capabilities, providers: capabilities.providers.slice(1) },
    { ...capabilities, providers: [capabilities.providers[0], capabilities.providers[0], capabilities.providers[2]] },
    { ...capabilities, providers: capabilities.providers.map(p => ({ ...p, available: "true" })) },
    { ...capabilities, providers: capabilities.providers.map(p => ({ ...p, credential: "hidden" })) },
    { ...capabilities, providers: capabilities.providers.map(p => ({ ...p, message: "" })) },
  ]) assert.throws(() => contract.parseAiProviderCapabilities(invalid), /Invalid AI provider/);
});

test("providers: hosted remains Azure-only with no CLI execution and no fallback", async () => {
  const h = harness({ AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid", MODEL_DEPLOYMENT_NAME: "synthetic" });
  const body = { mode: "chat", question: "Synthetic", context: {} };
  assert.equal((await h.invoke(undefined, { method: "GET", origin: null })).status, 405);
  assert.equal((await h.invoke(body, { origin: null })).status, 200);
  assert.equal(h.tokens, 1);
  assert.equal(h.modelCalls.length, 1);
  for (const provider of ["claude", "codex", "custom", null]) {
    assert.equal((await h.invoke({ ...body, provider })).status, provider === "claude" || provider === "codex" ? 403 : 400);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.modelCalls.length, 1);
});

test("providers: local GET checks subscription readiness without inference or credential leakage", async () => {
  const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex" });
  const response = await h.invoke(undefined, { method: "GET", origin: null });
  assert.equal(response.status, 200);
  const contract = h.load("shared\\aiProviders.ts");
  const capabilities = contract.parseAiProviderCapabilities(response.body);
  assert.equal(capabilities.defaultProvider, "codex");
  assert.equal(capabilities.providers[0].available, false);
  assert.equal(capabilities.providers[1].available, true);
  assert.equal(capabilities.providers[2].available, true);
  assert.ok(h.calls.every(call => call.args.includes("--help") || call.args.includes("status") ||
    call.args.includes("list") || call.args.includes("query")));
  assert.equal(h.tokens, 0); assert.equal(h.modelCalls.length, 0);
  assert.ok(h.timeouts.reduce((sum, value) => sum + value, 0) < 15_000,
    "All sequential readiness subprocess budgets fit the frontend GET timeout");
  assert.equal(h.files.size, 0); assert.equal(h.removed.length, 2);
  assert.equal(h.logs.length, 0);
  assert.doesNotMatch(JSON.stringify(response), /synthetic-token|loggedIn|subscriptionType|USERPROFILE/);
});

test("providers: strict local origins reject hostile and missing browser POST origins before spawning", async () => {
  const h = harness({ SDS_LOCAL_AI: "1" });
  for (const origin of ["https://hostile.invalid", "http://127.0.0.1:5173", "http://localhost:5174", "null", null]) {
    assert.equal((await h.invoke({ mode: "chat", question: "Synthetic", context: {} }, { origin })).status, 403);
    if (origin !== null) assert.equal((await h.invoke(undefined, { method: "GET", origin })).status, 403);
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await h.invoke(undefined, { method: "OPTIONS" })).status, 204);
  assert.equal((await h.invoke(undefined, { method: "DELETE" })).status, 405);
  assert.equal((await h.invoke({ mode: "chat", question: "Synthetic", context: {} })).status, 503);
  assert.equal(h.calls.length, 0, "Absent local provider defaults to Azure, not whichever CLI is available");
});

test("providers: local configured defaults and explicit selections use the same validated modes", async () => {
  for (const provider of ["claude", "codex"]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: provider,
      ANTHROPIC_API_KEY: "DO_NOT_COPY", OPENAI_API_KEY: "DO_NOT_COPY", CODEX_API_KEY: "DO_NOT_COPY",
      ANTHROPIC_BASE_URL: "https://hostile.invalid", NODE_OPTIONS: "--require malicious",
      CODEX_HOME: "malicious", CLAUDE_CONFIG_DIR: "malicious", HTTPS_PROXY: "malicious" });
    for (const mode of ["chat", "analyze", "design"]) {
      const question = "SYNTHETIC_UNTRUSTED_QUESTION";
      const context = mode === "design" ? { catalog } : { nodes: [] };
      const response = await h.invoke({ mode, question, context, history: [] });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const call = h.calls.at(-1);
      assert.equal(call.command, join(native, `${provider}.exe`));
      assert.equal(call.config.shell, false);
      assert.ok(call.input.includes(question));
      assert.ok(!call.args.some(arg => arg.includes(question)));
      assert.ok(!call.args.some(arg => /dangerously|full-auto|danger-full-access/.test(arg)));
      assert.ok(Object.keys(call.config.env).every(key => key === "USERPROFILE"));
      if (provider === "claude") {
        assert.equal(call.args[call.args.indexOf("--tools") + 1], "");
        assert.ok(call.args.includes("--restricted") && call.args.includes("--safe-mode"));
        assert.ok(!call.args.includes("--bare"));
        assert.ok(call.args.includes("--no-session-persistence"));
      } else {
        assert.ok(call.args.includes("--ephemeral") && call.args.includes("--ignore-user-config"));
        assert.equal(call.args[call.args.indexOf("--sandbox") + 1], "read-only");
        for (const setting of ["shell_tool", "unified_exec", 'web_search="disabled"',
          "mcp_servers={}", 'forced_login_method="chatgpt"', 'model_provider="openai"']) {
          assert.ok(call.args.includes(setting), setting);
        }
      }
      assert.equal(h.files.size, 0);
    }
    assert.equal(h.tokens, 0); assert.equal(h.modelCalls.length, 0); assert.equal(h.logs.length, 0);
    const azure = await h.invoke({ mode: "chat", question: "Synthetic", context: {}, provider: "azure" });
    assert.equal(azure.status, 503, "Explicit missing Azure cannot silently use configured CLI");
  }
});

test("providers: missing, old, managed and API-key CLI readiness is unavailable without inference", async () => {
  for (const options of [{ missing: true }, { oldCli: true }, { apiAuth: true }, { managed: true }, { registryManaged: true }]) {
    const h = harness({ SDS_LOCAL_AI: "1" }, options);
    const response = await h.invoke(undefined, { method: "GET" });
    assert.equal(response.status, 200);
    assert.equal(response.body.providers[1].available, false);
    if (!options.managed && !options.registryManaged) assert.equal(response.body.providers[2].available, false);
    assert.equal(h.tokens, 0); assert.equal(h.modelCalls.length, 0);
    assert.ok(h.calls.every(call => !call.args.includes("-p") && !call.args.includes("--output-schema")));
    assert.equal(h.files.size, 0);
  }
});

test("providers: invalid configuration, requests and catalog fail before CLI inference", async () => {
  const invalid = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "custom" });
  assert.equal((await invalid.invoke(undefined, { method: "GET" })).status, 503);
  const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "claude" });
  for (const body of [
    { mode: "chat", question: "Synthetic", context: {}, provider: "custom" },
    { mode: "design", question: "Synthetic", context: { catalog: {} } },
    { mode: "chat", question: "Synthetic", context: { aiDesignGuidance: [{ revision: 0 }] } },
    { mode: "chat", question: "Synthetic", context: { text: "x".repeat(500_000) } },
  ]) assert.notEqual((await h.invoke(body)).status, 200);
  assert.equal(h.calls.length, 0); assert.equal(h.tokens, 0);
});

test("providers: Codex policy-overridden safety features make readiness unavailable", async () => {
  const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex" }, { featureOverride: true });
  const response = await h.invoke(undefined, { method: "GET" });
  assert.equal(response.status, 200);
  assert.equal(response.body.providers[2].available, false);
  assert.match(response.body.providers[2].message, /isolation/);
  assert.ok(h.calls.every(call => !call.args.includes("--output-schema")));
  assert.equal(h.files.size, 0);
});

test("providers: common catalog validation rejects invalid CLI design proposals", async () => {
  const invalid = {
    answer: "Synthetic", assumptions: [], design: {
      scenario: { name: "Synthetic", description: "" },
      nodes: [{ id: "node", type: "unavailable", title: "Synthetic", description: "", dfdRole: "Process" }],
      edges: [], boundaries: [], data: [],
    },
  };
  for (const provider of ["claude", "codex"]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: provider }, { output: invalid });
    assert.equal((await h.invoke({ mode: "design", question: "Synthetic", context: { catalog }, history: [] })).status, 502);
    assert.equal(h.files.size, 0); assert.equal(h.modelCalls.length, 0);
  }
});

test("providers: bounded output, incomplete results, timeout and concurrency release owned resources", async () => {
  for (const options of [{ incomplete: true }, { failure: true }, { outputOverflow: true }, { hang: true, fastTimeout: true }]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "claude" }, options);
    const response = await h.invoke({ mode: "design", question: "PRIVATE_SYNTHETIC_PROMPT", context: { catalog }, history: [] });
    assert.equal(response.status, 502);
    assert.equal(h.files.size, 0);
    assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_SYNTHETIC_PROMPT/);
    if (options.hang || options.outputOverflow) assert.ok(h.killed > 0);
  }
  const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "claude" });
  const body = { mode: "chat", question: "Synthetic", context: {} };
  const responses = await Promise.all([h.invoke(body), h.invoke(body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
  assert.equal((await h.invoke(body)).status, 200, "Concurrency slot is released");
  assert.equal(h.files.size, 0);
});

test("providers: Codex answers are discarded after any tool item or incomplete turn", async () => {
  for (const options of [{ codexItem: "command_execution" }, { codexItem: "mcp_tool_call" },
    { codexItem: "web_search" }, { codexItem: "file_change" }, { incomplete: true }]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex" }, options);
    const response = await h.invoke({ mode: "chat", question: "Synthetic", context: {} });
    assert.equal(response.status, 502, JSON.stringify(options));
    assert.equal(h.files.size, 0);
  }
});

test("providers: route registration and dynamically loaded native helpers preserve Azure packaging", () => {
  const definition = JSON.parse(source("api\\design-assistant\\function.json"));
  assert.ok(definition.bindings[0].methods.includes("get"));
  const index = source("api\\design-assistant\\index.ts");
  assert.ok(index.includes('await import("./localProviders")'));
  assert.ok(!/import .* from ["'](?:node:child_process|\.\/localProviders)/.test(index));
});
