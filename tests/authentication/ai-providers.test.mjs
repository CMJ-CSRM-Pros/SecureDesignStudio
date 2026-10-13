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
    platform: "win32", arch: options.arch ?? "x64", cwd: () => root,
    env: { PATH: native, USERPROFILE: resolve(root, "..", "synthetic-user"), ...env },
    kill() { killed++; },
  };
  const fakeFs = {
    async realpath(path) { return options.realpaths?.get(path) ?? path; },
    async stat(path) {
      if (options.filesystem) {
        if (path === join(root, ".git")) return { isFile: () => false };
        if (!files.has(path)) throw Object.assign(new Error(), { code: "ENOENT" });
        return { isFile: () => true, size: Buffer.byteLength(files.get(path)) };
      }
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
      } else if (args.includes("--version")) {
        stdout = "codex-cli 0.162.1\r\n";
      } else if (args.includes("list")) {
        stdout = ["shell_tool", "unified_exec", "hooks", "plugins", "remote_plugin", "shell_snapshot",
          "apps", "code_mode", "multi_agent", "browser_use", "computer_use", "in_app_browser",
          "view_image", "image_generation", "skill_search"]
          .map(feature => `${feature} stable false`).join("\n") + "\nskip_host_skill_discovery under_development true\n";
        if (options.featureOverride) stdout = stdout.replace("shell_tool stable false", "shell_tool stable true");
        if (options.unifiedExecForced) {
          stdout = stdout.replace("unified_exec stable false", "unified_exec                 stable             true")
            .replace(/\n/g, "\r\n");
        }
        if (options.missingFeature) stdout = stdout.replace("hooks stable false\n", "");
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
      return options.azureResponse ?? { ok: true, json: async () => ({ choices: [{ finish_reason: "stop",
        message: { content: JSON.stringify(result) } }], usage: {
        prompt_tokens: 16, completion_tokens: 1, total_tokens: 17,
      } }) };
    };
    vm.runInNewContext(`(function(require,module,exports,process,Buffer,fetch,AbortSignal,setTimeout,clearTimeout){${compiled}\n})`, { URL, TextEncoder })(
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

test("providers: Azure debug logs request size without prompt text and exact successful usage", async () => {
  const prompt = "PRIVATE_SYNTHETIC_PROMPT";
  const h = harness({ AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid",
    MODEL_DEPLOYMENT_NAME: "synthetic", SDS_AI_DEBUG: "1" }, {
    azureResponse: { ok: true, json: async () => ({ choices: [{ finish_reason: "stop",
      message: { content: JSON.stringify(design) } }], usage: {
      prompt_tokens: 160, completion_tokens: 12, total_tokens: 172,
    } }) },
  });
  const response = await h.invoke({ mode: "design", question: prompt, context: { catalog }, history: [] });
  assert.equal(response.status, 200);
  const sizing = h.logs.find(([message]) => message === "AI request sizing");
  assert.ok(sizing);
  const metrics = JSON.parse(sizing[1]);
  assert.equal(metrics.provider, "azure");
  assert.equal(metrics.mode, "design");
  assert.ok(metrics.requestBodyUtf8Bytes > 0);
  assert.ok(metrics.estimatedInputTokens > 0);
  assert.equal(metrics.maxOutputTokens, 8000);
  assert.equal(metrics.estimatedTokensWithMaxOutput, metrics.estimatedInputTokens + 8000);
  assert.equal(Object.values(metrics.breakdown).reduce((sum, bytes) => sum + bytes, 0),
    metrics.estimatedInputUtf8Bytes);
  assert.equal(metrics.breakdown.catalogBytes, Buffer.byteLength(JSON.stringify(catalog)));
  assert.equal(metrics.breakdown.conversationBytes, 2);
  assert.equal(metrics.breakdown.guidanceBytes, 0);
  assert.ok(metrics.breakdown.outputSchemaBytes > 0);
  assert.match(metrics.estimate, /not a model tokenizer/);
  assert.doesNotMatch(JSON.stringify(h.logs), new RegExp(prompt));
  assert.deepEqual(JSON.parse(h.logs.find(([message]) => message === "AI response token usage")[1]),
    { prompt_tokens: 160, completion_tokens: 12, total_tokens: 172 });
});

test("providers: Azure sizing accounts for Unicode, escaped diagram text, guidance and conversation without changing payloads", async () => {
  const body = { mode: "chat", question: "PRIVATE_QUESTION",
    context: { nodes: [{ id: "n", title: 'PRIVATE_NODE "quoted" \n \u00e9' }],
      catalog, aiDesignGuidance: [{ typeId: "synthetic-node", definitionSource: "core",
        revision: 1, updatedOn: "2026-10-12", sources: [], content: "PRIVATE_GUIDANCE",
        appliesToNodeIds: ["n"] }] } };
  for (const mode of ["chat", "design"]) {
    const request = { ...body, mode, ...(mode === "design"
      ? { history: [{ role: "user", text: "PRIVATE_HISTORY" }] } : {}) };
    const logsByDebug = [];
    const payloads = [];
    for (const debug of ["0", "1"]) {
      const h = harness({ AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid",
        MODEL_DEPLOYMENT_NAME: "synthetic", SDS_AI_DEBUG: debug }, {
        azureResponse: { ok: true, json: async () => ({ choices: [{ finish_reason: "stop",
          message: { content: JSON.stringify(mode === "design" ? design : result) } }] }) },
      });
      const response = await h.invoke(request);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      payloads.push(h.modelCalls[0].body);
      logsByDebug.push(h.logs);
    }
    assert.equal(payloads[0], payloads[1], "Debugging must not change or truncate the model request");
    assert.equal(logsByDebug[0].length, 0);
    const metrics = JSON.parse(logsByDebug[1].find(([label]) => label === "AI request sizing")[1]);
    const breakdown = metrics.breakdown;
    assert.equal(Object.values(breakdown).reduce((sum, count) => sum + count, 0),
      metrics.estimatedInputUtf8Bytes);
    assert.equal(metrics.requestBodyUtf8Bytes, Buffer.byteLength(payloads[1]));
    assert.equal(breakdown.diagramContextBytes, Buffer.byteLength(JSON.stringify(body.context.nodes)));
    assert.equal(breakdown.guidanceBytes, Buffer.byteLength(JSON.stringify(body.context.aiDesignGuidance)));
    assert.equal(breakdown.conversationBytes, mode === "design"
      ? Buffer.byteLength(JSON.stringify(request.history)) : 0);
    assert.doesNotMatch(JSON.stringify(logsByDebug), /PRIVATE_|synthetic-token/);
  }
});

test("providers: Azure debug logs estimated size before a throttled response", async () => {
  const h = harness({ AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid",
    MODEL_DEPLOYMENT_NAME: "synthetic", SDS_AI_DEBUG: "1" }, {
    azureResponse: {
      ok: false,
      status: 429,
      headers: { get: name => name === "retry-after" ? "30" : null },
      json: async () => ({ error: { code: "rate_limit_exceeded", message: "Synthetic throttling." } }),
    },
  });
  const response = await h.invoke({ mode: "design", question: "PRIVATE_SYNTHETIC_PROMPT",
    context: { catalog }, history: [] });
  assert.equal(response.status, 429);
  assert.ok(h.logs.some(([message]) => message === "AI request sizing"));
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_SYNTHETIC_PROMPT/);
  assert.ok(!h.logs.some(([message]) => message === "AI response token usage"));
});

const planContext = {
  scenario: null, nodes: [], edges: [], boundaries: [],
  nodeTypeIndex: [
    { id: "Dataverse Table", label: "Dataverse table", category: "Data", defaultDfdRole: "DataStore", hasGuidance: true },
    { id: "synthetic-node", label: "Synthetic node", category: "", defaultDfdRole: "", hasGuidance: false },
  ],
};
const plan = { nodeTypeIds: ["Dataverse Table"], rationale: "Synthetic rationale." };

test("providers: Azure design planning uses the index-only enum schema and a small output reservation", async () => {
  const h = harness({ AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid",
    MODEL_DEPLOYMENT_NAME: "synthetic", SDS_AI_DEBUG: "1" }, {
    azureResponse: { ok: true, json: async () => ({ choices: [{ finish_reason: "stop",
      message: { content: JSON.stringify(plan) } }] }) },
  });
  const response = await h.invoke({ mode: "design-plan", question: "PRIVATE_PLAN_PROMPT", context: planContext,
    history: [{ role: "user", text: "PRIVATE_HISTORY" }] });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(JSON.parse(JSON.stringify(response.body)), plan);
  const body = JSON.parse(h.modelCalls[0].body);
  assert.equal(body.max_tokens, 1000);
  assert.equal(body.response_format.json_schema.name, "threat_model_design_plan");
  assert.deepEqual(body.response_format.json_schema.schema.properties.nodeTypeIds.items.enum,
    ["Dataverse Table", "synthetic-node"]);
  assert.match(body.messages[0].content, /planning step/);
  assert.match(body.messages[0].content, /untrusted authored reference data/);
  assert.match(body.messages[1].content, /^MODE: design-plan/);
  assert.match(body.messages[1].content, /CONVERSATION:/);
  const metrics = JSON.parse(h.logs.find(([label]) => label === "AI request sizing")[1]);
  assert.equal(metrics.mode, "design-plan");
  assert.equal(metrics.maxOutputTokens, 1000);
  assert.equal(metrics.breakdown.catalogBytes, Buffer.byteLength(JSON.stringify(planContext.nodeTypeIndex)));
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_/);
});

test("providers: design plans reject unknown, oversized and malformed selections and invalid indexes", async () => {
  const azure = { AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid", MODEL_DEPLOYMENT_NAME: "synthetic" };
  for (const output of [
    { nodeTypeIds: ["invented"], rationale: "x" },
    { nodeTypeIds: ["Dataverse Table"], rationale: "x", extra: true },
    { nodeTypeIds: "Dataverse Table", rationale: "x" },
    { nodeTypeIds: ["Dataverse Table"] },
  ]) {
    const h = harness(azure, { azureResponse: { ok: true, json: async () => ({ choices: [{ finish_reason: "stop",
      message: { content: JSON.stringify(output) } }] }) } });
    const response = await h.invoke({ mode: "design-plan", question: "Synthetic", context: planContext, history: [] });
    assert.equal(response.status, 502, JSON.stringify(output));
  }
  const truncated = harness(azure, { azureResponse: { ok: true, json: async () => ({ choices: [{ finish_reason: "length",
    message: { content: JSON.stringify(plan) } }] }) } });
  assert.equal((await truncated.invoke({ mode: "design-plan", question: "Synthetic", context: planContext, history: [] })).status, 502);
  for (const context of [{}, { nodeTypeIndex: [] }, { nodeTypeIndex: [{ label: "missing id" }] }]) {
    const h = harness(azure);
    assert.equal((await h.invoke({ mode: "design-plan", question: "Synthetic", context, history: [] })).status, 400);
    assert.equal(h.modelCalls.length, 0);
  }
  const h = harness(azure);
  assert.equal((await h.invoke({ mode: "design-plan", question: "Synthetic", context: planContext,
    history: [{ role: "system", text: "x" }] })).status, 400);
  assert.equal(h.modelCalls.length, 0);
});

test("providers: local Claude and Codex planning use the same validated plan schema", async () => {
  for (const provider of ["claude", "codex"]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: provider }, { output: plan });
    const response = await h.invoke({ mode: "design-plan", question: "Synthetic", context: planContext, history: [] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(JSON.parse(JSON.stringify(response.body)), plan);
    const call = h.calls.at(-1);
    assert.match(call.input, /^MODE: design-plan/);
    const schema = provider === "claude" ? call.args[call.args.indexOf("--json-schema") + 1] : undefined;
    if (schema) assert.deepEqual(JSON.parse(schema).properties.nodeTypeIds.items.enum, ["Dataverse Table", "synthetic-node"]);
    const invalid = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: provider },
      { output: { nodeTypeIds: ["invented"], rationale: "x" } });
    assert.notEqual((await invalid.invoke({ mode: "design-plan", question: "Synthetic", context: planContext, history: [] })).status, 200);
  }
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

test("providers: Vite CLI-only mode disables Azure and rejects explicit Azure requests", async () => {
  const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex", SDS_LOCAL_AI_CLI_ONLY: "1",
    AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid", MODEL_DEPLOYMENT_NAME: "synthetic" });
  const response = await h.invoke(undefined, { method: "GET", origin: null });
  assert.equal(response.status, 200);
  assert.equal(response.body.providers[0].available, false);
  assert.match(response.body.providers[0].message, /Start with -Provider Azure/);
  assert.equal((await h.invoke({ mode: "chat", question: "Synthetic", context: {}, provider: "azure" })).status, 403);
  assert.equal(h.tokens, 0);
  assert.equal(h.modelCalls.length, 0);
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

function npmInstallation({ location = "nested", layout = "bin", arch = "x64", ...options } = {}) {
  const h = harness({ SDS_LOCAL_AI: "1" }, { filesystem: true, arch, ...options });
  const packageRoot = join(native, "node_modules", "@openai", "codex");
  const platformRoot = location === "bundled" ? packageRoot : location === "nested"
    ? join(packageRoot, "node_modules", "@openai", `codex-win32-${arch}`)
    : join(native, "node_modules", "@openai", `codex-win32-${arch}`);
  h.files.set(join(packageRoot, "package.json"), JSON.stringify({
    name: "@openai/codex", bin: { codex: "bin/codex.js" },
  }));
  if (location !== "bundled") h.files.set(join(platformRoot, "package.json"), JSON.stringify({
    name: "@openai/codex", os: ["win32"], cpu: [arch],
  }));
  const triple = arch === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  const binary = join(platformRoot, "vendor", triple, layout, "codex.exe");
  h.files.set(binary, "synthetic executable");
  // Wrappers must be ignored even when installed and functional.
  for (const extension of ["ps1", "cmd", ""]) h.files.set(join(native, extension ? `codex.${extension}` : "codex"),
    "PRIVATE_WRAPPER_CONTENT");
  return { h, packageRoot, platformRoot, binary };
}

test("providers: npm-only Codex installs resolve native x64/ARM64 binaries in current and older layouts", async () => {
  for (const arch of ["x64", "arm64"]) {
    for (const location of ["nested", "sibling", "bundled"]) {
      for (const layout of ["bin", "codex"]) {
        const { h, binary } = npmInstallation({ arch, location, layout });
        const local = h.load("api\\design-assistant\\localProviders.ts");
        const diagnostics = [];
        assert.equal(await local.resolveLocalExecutable("codex", (stage, message) => diagnostics.push({ stage, message })), binary);
        assert.equal(h.calls.length, 0, "Discovery does not execute wrappers, npm or inference");
        assert.match(diagnostics.at(-1).message, /Selected native npm executable/);
        assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_WRAPPER_CONTENT/);
        h.fakeProcess.cwd = () => join(root, "api");
        const status = await local.localProviderStatus("codex");
        assert.equal(status.available, true, status.message);
        assert.ok(h.calls.every(call => call.command === binary), "The API shares launcher discovery");
        const response = await h.invoke({ mode: "chat", question: "Synthetic", context: {}, provider: "codex" });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(h.calls.at(-1).command, binary);
        assert.ok(h.calls.every(call => call.config.shell === false));
        assert.equal(h.tokens, 0);
      }
    }
  }
});

test("providers: native PATH keeps precedence over npm without changing Claude discovery", async () => {
  const { h } = npmInstallation();
  const codex = join(native, "codex.exe"), claude = join(native, "claude.exe");
  h.files.set(codex, "native"); h.files.set(claude, "native");
  const local = h.load("api\\design-assistant\\localProviders.ts");
  assert.equal(await local.resolveLocalExecutable("codex"), codex);
  assert.equal(await local.resolveLocalExecutable("claude"), claude);
  assert.equal(h.calls.length, 0);
});

test("providers: incomplete, incompatible and malformed npm installs fail without wrapper execution", async () => {
  for (const variant of ["missing-binary", "wrong-name", "wrong-bin", "wrong-cpu", "wrong-os",
    "malformed", "oversized", "missing-platform-manifest"]) {
    const { h, binary, packageRoot, platformRoot } = npmInstallation();
    if (variant === "missing-binary") h.files.delete(binary);
    else if (variant === "missing-platform-manifest") h.files.delete(join(platformRoot, "package.json"));
    else if (variant === "wrong-cpu" || variant === "wrong-os") h.files.set(join(platformRoot, "package.json"),
      JSON.stringify({ name: "@openai/codex", cpu: [variant === "wrong-cpu" ? "arm64" : "x64"],
        os: [variant === "wrong-os" ? "linux" : "win32"] }));
    else h.files.set(join(packageRoot, "package.json"), variant === "malformed" ? "{" :
      variant === "oversized" ? " ".repeat(64_001) : JSON.stringify({
        name: variant === "wrong-name" ? "unrelated-package" : "@openai/codex",
        bin: { codex: variant === "wrong-bin" ? "untrusted.js" : "bin/codex.js" },
      }));
    const local = h.load("api\\design-assistant\\localProviders.ts");
    const diagnostics = [];
    await assert.rejects(local.resolveLocalExecutable("codex", (stage, message) => diagnostics.push({ stage, message })),
      /native executable was not found/);
    assert.equal(h.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_WRAPPER_CONTENT/);
  }
});

test("providers: npm discovery rejects relative roots, repository installs and escaped real paths", async () => {
  for (const variant of ["relative", "repository", "package-link", "binary-link", "escaped-binary"]) {
    const realpaths = new Map();
    const { h, packageRoot, binary } = npmInstallation({ realpaths });
    if (variant === "relative") h.fakeProcess.env.PATH = "relative";
    if (variant === "repository") {
      const prefix = join(root, "synthetic-prefix");
      h.fakeProcess.env.PATH = prefix;
      for (const [path, contents] of [...h.files]) h.files.set(join(prefix, relative(native, path)), contents);
    }
    if (variant === "package-link") {
      const target = join(root, "node_modules", "@openai", "codex");
      realpaths.set(packageRoot, target);
      for (const [path, contents] of [...h.files]) {
        if (path.startsWith(packageRoot)) h.files.set(join(target, relative(packageRoot, path)), contents);
      }
    }
    if (variant === "binary-link") {
      const target = join(root, "codex.exe");
      realpaths.set(binary, target); h.files.set(target, "native");
    }
    if (variant === "escaped-binary") {
      const target = join(native, "unrelated.exe");
      realpaths.set(binary, target); h.files.set(target, "native");
    }
    await assert.rejects(h.load("api\\design-assistant\\localProviders.ts").resolveLocalExecutable("codex"),
      /native executable was not found/);
    assert.equal(h.calls.length, 0);
  }
});

test("providers: npm discovery does not waive unsupported isolation capabilities", async () => {
  const { h, binary } = npmInstallation({ oldCli: true });
  const diagnostics = [];
  const status = await h.load("api\\design-assistant\\localProviders.ts").localProviderStatus("codex",
    (stage, message) => diagnostics.push({ stage, message }));
  assert.equal(status.available, false);
  assert.match(status.message, /--ignore-user-config/);
  assert.equal(diagnostics.at(-1).stage, "capabilities");
  assert.ok(h.calls.every(call => call.command === binary && call.args.includes("--help")));
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

test("providers: Codex forced unified_exec is accepted only because shell_tool stays disabled", async () => {
  const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex" }, { unifiedExecForced: true });
  const diagnostics = [];
  const status = await h.load("api\\design-assistant\\localProviders.ts").localProviderStatus("codex",
    (stage, message) => diagnostics.push({ stage, message }));
  assert.equal(status.available, true, status.message);
  const text = diagnostics.map(entry => entry.message).join("\n");
  assert.match(text, /Codex CLI version: 0\.162\.1\./);
  assert.match(text, /shell_tool: observed false, required false\./);
  assert.match(text, /unified_exec: observed true; informational only/);
  assert.ok(h.calls.every(call => !call.args.includes("--output-schema")));

  const both = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex" }, { unifiedExecForced: true, featureOverride: true });
  const blocked = await both.load("api\\design-assistant\\localProviders.ts").localProviderStatus("codex");
  assert.equal(blocked.available, false);
  assert.match(blocked.message, /shell_tool must be false/);
});

test("providers: Codex feature diagnostics report every mismatch and absent feature", async () => {
  const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex" }, { featureOverride: true, missingFeature: true });
  const diagnostics = [];
  const status = await h.load("api\\design-assistant\\localProviders.ts").localProviderStatus("codex",
    (stage, message) => diagnostics.push({ stage, message }));
  assert.equal(status.available, false);
  assert.match(status.message, /shell_tool must be false; hooks must be false\./);
  const text = diagnostics.map(entry => entry.message).join("\n");
  assert.match(text, /shell_tool: observed true, required false \(mismatch\)/);
  assert.match(text, /hooks: observed absent, required false \(mismatch\)/);
  assert.doesNotMatch(text, /synthetic-token|Logged in/);
});

test("providers: Codex feature parser reads padded and CRLF rows only", () => {
  const { parseCodexFeatures } = harness({}).load("api\\design-assistant\\localProviders.ts");
  const parsed = parseCodexFeatures("shell_tool    stable   false\r\nunified_exec  stable   true\r\nWARNING something true\r\nbroken\n");
  assert.equal(parsed.get("shell_tool"), "false");
  assert.equal(parsed.get("unified_exec"), "true");
  assert.equal(parsed.has("WARNING"), false);
  assert.equal(parsed.size, 2);
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
    { codexItem: "web_search" }, { codexItem: "file_change" }, { codexItem: "collab_tool_call" },
    { incomplete: true }]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex" }, options);
    const response = await h.invoke({ mode: "chat", question: "Synthetic", context: {} });
    assert.equal(response.status, 502, JSON.stringify(options));
    assert.equal(h.files.size, 0);
    if (options.codexItem) assert.ok(response.body.error.includes(`item=${options.codexItem}`));
  }
});

test("providers: Codex error notifications and unknown items are not mislabeled as tool actions", () => {
  const { verifyCodexEvents } = harness({}).load("api\\design-assistant\\localProviders.ts");
  const eventStream = item => JSON.stringify({ type: "item.completed", item }) + '\n{"type":"turn.completed"}';
  const diagnostics = [];
  const warning = JSON.stringify({ type: "item.completed", item: { type: "error",
    message: "Reconnecting stream PRIVATE_SYNTHETIC_SECRET" } });
  const answer = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Synthetic answer" } });
  assert.doesNotThrow(() => verifyCodexEvents(`${warning}\n${answer}\n{"type":"turn.completed"}`,
    (stage, message) => diagnostics.push({ stage, message })));
  assert.match(JSON.stringify(diagnostics), /nonfatal notification; category=network\/stream/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE_SYNTHETIC_SECRET|Synthetic answer/);
  assert.throws(() => verifyCodexEvents(`${warning}\n{"type":"turn.completed"}`), /did not complete a response/);
  assert.throws(() => verifyCodexEvents(`${warning}\n${answer}\n{"type":"turn.failed","error":{"message":"quota PRIVATE_SYNTHETIC_SECRET"}}`),
    error => /turn.failed \(usage\/rate-limit\)/.test(error.message) && !/PRIVATE_SYNTHETIC_SECRET/.test(error.message));
  for (const item of [{ type: "PRIVATE_SYNTHETIC_SECRET" }, {}, null]) {
    assert.throws(() => verifyCodexEvents(eventStream(item)),
      error => /unsupported item shape.*item=unknown/.test(error.message) &&
        !/PRIVATE_SYNTHETIC_SECRET/.test(error.message));
  }
  for (const event of [null, [], {}, { type: "PRIVATE_SYNTHETIC_SECRET" }]) {
    assert.throws(() => verifyCodexEvents(JSON.stringify(event)), /unsupported event shape/);
  }
  assert.throws(() => verifyCodexEvents(eventStream({ type: "command_execution", status: "declined",
    command: "PRIVATE_SYNTHETIC_SECRET" })),
    error => /item=command_execution, status=declined/.test(error.message) &&
      !/PRIVATE_SYNTHETIC_SECRET/.test(error.message));
});

test("providers: AI debug is opt-in and returns bounded sanitized interaction traces", async () => {
  for (const debug of ["0", "1"]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex", SDS_AI_DEBUG: debug },
      { codexItem: "error" });
    const response = await h.invoke({ mode: "chat", question: "PRIVATE_SYNTHETIC_PROMPT", context: {} });
    assert.equal(response.status, 200);
    if (debug === "1") {
      assert.match(JSON.stringify(h.logs), /Codex CLI version/);
      assert.match(JSON.stringify(h.logs), /item=error; nonfatal notification/);
      assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_SYNTHETIC_PROMPT|synthetic-token|USERPROFILE/);
    } else assert.equal(response.body.diagnostics, undefined);
    assert.equal(response.body.diagnostics, undefined, "Debug metadata must not alter the response contract");
    const blocked = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex", SDS_AI_DEBUG: debug },
      { codexItem: "command_execution" });
    const failure = await blocked.invoke({ mode: "chat", question: "PRIVATE_SYNTHETIC_PROMPT", context: {} });
    assert.equal(failure.status, 502);
    assert.equal(failure.body.error.includes("AI debug trace:"), debug === "1");
    assert.doesNotMatch(failure.body.error, /PRIVATE_SYNTHETIC_PROMPT/);
  }
});

test("providers: debug design responses preserve the strict client contract and content logging is separately opt-in", async () => {
  for (const contentDebug of ["0", "1"]) {
    const h = harness({ SDS_LOCAL_AI: "1", SDS_AI_PROVIDER: "codex", SDS_AI_DEBUG: "1",
      SDS_AI_DEBUG_CONTENT: contentDebug });
    const response = await h.invoke({ mode: "design", question: "SYNTHETIC_DEBUG_PROMPT",
      context: { catalog }, history: [] });
    assert.equal(response.status, 200);
    const contract = h.load("shared\\designContract.ts");
    assert.doesNotThrow(() => contract.parseDesignResult(response.body));
    const records = h.logs.filter(entry => entry[0] === "AI interaction content");
    assert.equal(records.length, contentDebug === "1" ? 2 : 0);
    if (contentDebug === "1") {
      assert.match(JSON.stringify(records), /SYNTHETIC_DEBUG_PROMPT/);
      assert.match(JSON.stringify(records), /response/);
    }
  }
});
test("providers: route registration and dynamically loaded native helpers preserve Azure packaging", () => {
  const definition = JSON.parse(source("api\\design-assistant\\function.json"));
  assert.ok(definition.bindings[0].methods.includes("get"));
  const index = source("api\\design-assistant\\index.ts");
  assert.ok(index.includes('await import("./localProviders")'));
  assert.ok(!/import .* from ["'](?:node:child_process|\.\/localProviders)/.test(index));
});
