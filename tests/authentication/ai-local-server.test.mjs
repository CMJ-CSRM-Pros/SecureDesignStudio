import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { readFileSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { localAiVitePlugin } from "../../scripts/local-ai-vite.mjs";

function mockServer(handler) {
  let middleware;
  return {
    get middleware() { return middleware; },
    middlewares: { use(value) { middleware = value; } },
    async ssrLoadModule(path) {
      assert.equal(path, "/api/design-assistant/index.ts");
      return { default: handler };
    },
  };
}

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: "",
    headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = "") { this.body += value; this.headersSent = true; },
  };
}

test("local AI Azure mode proxies only Assistant requests to Functions instead of loading the CLI handler", () => {
  const server = mockServer(async () => assert.fail("Azure must use the Functions host."));
  const plugin = localAiVitePlugin({ cliOnly: false });
  const configuration = plugin.config();
  const proxy = configuration.server.proxy["^/api/design-assistant(?:\\?|$)"];
  assert.equal(proxy.target, "http://localhost:7071");
  assert.equal(proxy.changeOrigin, false);
  let onError;
  proxy.configure({ on(event, callback) { assert.equal(event, "error"); onError = callback; } });
  const response = mockResponse();
  onError(new Error("synthetic connection refused"), {}, response);
  assert.equal(response.statusCode, 503);
  assert.match(JSON.parse(response.body).error, /still starting.*refresh providers/);
  plugin.configureServer(server);
  assert.equal(server.middleware, undefined);
});

test("local AI Vite configuration keeps Azure, Claude and Codex startup routes separate", async () => {
  const { resolveConfig } = await import("vite");
  const keys = ["npm_lifecycle_event", "SDS_LOCAL_AI", "SDS_LOCAL_AI_CLI_ONLY", "SDS_AI_PROVIDER"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const provider of ["azure", "claude", "codex"]) {
      const cliOnly = provider !== "azure";
      process.env.npm_lifecycle_event = cliOnly ? "dev:ai:local" : "dev:ai";
      process.env.SDS_AI_PROVIDER = provider;
      // A stale CLI-only flag must not divert an explicit Azure startup.
      process.env.SDS_LOCAL_AI_CLI_ONLY = "1";
      const config = await resolveConfig({ mode: "ai" }, "serve");
      assert.equal(config.define.__PS_ASSISTANT_ENDPOINT__, '"http://localhost:5173/api/design-assistant"');
      assert.equal(config.define.__PS_TOKEN_ENDPOINT__, '""');
      assert.equal(process.env.SDS_LOCAL_AI, "1");
      assert.equal(process.env.SDS_LOCAL_AI_CLI_ONLY, cliOnly ? "1" : "0");
      assert.equal(Boolean(config.server.proxy), !cliOnly);
      if (!cliOnly) {
        assert.equal(config.server.proxy["^/api/design-assistant(?:\\?|$)"].target, "http://localhost:7071");
      }
    }
    const plain = await resolveConfig({ mode: "development" }, "serve");
    assert.equal(plain.define.__PS_ASSISTANT_ENDPOINT__, '""');
    assert.equal(plain.server.proxy, undefined);
    assert.equal(plain.plugins.some(plugin => plugin.name === "secure-design-studio-local-ai"), false);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("local AI Azure proxy forwards requests and preserves the browser origin without CLI execution", async () => {
  const { createServer: createViteServer } = await import("vite");
  const received = [];
  const backend = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ method: request.method, url: request.url, origin: request.headers.origin,
      body: Buffer.concat(chunks).toString("utf8") });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ answer: "Synthetic Azure response" }));
  });
  let vite, frontend;
  try {
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    vite = await createViteServer({
      configFile: false,
      plugins: [localAiVitePlugin({ cliOnly: false }), {
        name: "synthetic-functions-port",
        config: () => ({ server: { proxy: {
          "^/api/design-assistant(?:\\?|$)": {
            target: `http://127.0.0.1:${backend.address().port}`,
          },
        } } }),
      }],
      server: { middlewareMode: true },
    });
    frontend = createServer(vite.middlewares);
    frontend.listen(0, "127.0.0.1");
    await once(frontend, "listening");
    const base = `http://127.0.0.1:${frontend.address().port}`;
    const body = JSON.stringify({ provider: "azure", mode: "chat", question: "Synthetic", context: {} });
    const response = await fetch(`${base}/api/design-assistant`, {
      method: "POST", headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" }, body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer: "Synthetic Azure response" });
    assert.deepEqual(received, [{ method: "POST", url: "/api/design-assistant",
      origin: "http://localhost:5173", body }]);
    await fetch(`${base}/api/design-assistant-other`);
    assert.equal(received.length, 1, "Only the exact Assistant route may reach Functions.");
  } finally {
    if (frontend) await new Promise(resolve => frontend.close(resolve));
    if (vite) await vite.close();
    await new Promise(resolve => backend.close(resolve));
  }
});

test("local AI Vite plugin forwards same-origin API requests through the shared handler", async () => {
  let received;
  const server = mockServer(async (context, request) => {
    received = request;
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: { answer: "Synthetic response." },
    };
  });
  const plugin = localAiVitePlugin();
  assert.equal(plugin.apply, "serve");
  plugin.configureServer(server);
  const requestBody = { mode: "chat", question: "Synthetic", context: {} };
  const request = Readable.from([Buffer.from(JSON.stringify(requestBody))]);
  request.url = "/api/design-assistant";
  request.method = "POST";
  request.headers = { origin: "http://localhost:5173", "content-type": "application/json" };
  const response = mockResponse();
  let passedThrough = false;

  await server.middleware(request, response, () => { passedThrough = true; });

  assert.equal(passedThrough, false);
  assert.deepEqual(received.body, requestBody);
  assert.equal(received.method, "POST");
  assert.equal(received.headers.origin, "http://localhost:5173");
  assert.deepEqual(JSON.parse(response.body), { answer: "Synthetic response." });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("local AI Vite plugin bounds request buffering before loading the API handler", async () => {
  let loaded = false;
  const server = mockServer(async () => { loaded = true; });
  localAiVitePlugin().configureServer(server);
  const request = Readable.from([Buffer.alloc(500_001)]);
  request.url = "/api/design-assistant";
  request.method = "POST";
  request.headers = {};
  const response = mockResponse();

  await server.middleware(request, response, () => assert.fail("API request must be handled."));

  assert.equal(response.statusCode, 413);
  assert.match(JSON.parse(response.body).error, /too large/);
  assert.equal(loaded, false);
});

test("local AI Vite plugin leaves unrelated URLs to Vite", async () => {
  const server = mockServer(async () => assert.fail("Non-API URL must not load the handler."));
  localAiVitePlugin().configureServer(server);
  const request = Readable.from([]);
  request.url = "/@vite/client";
  request.method = "GET";
  request.headers = {};
  const response = mockResponse();
  let passedThrough = false;

  await server.middleware(request, response, () => { passedThrough = true; });

  assert.equal(passedThrough, true);
});

test("local AI content debugging writes a local log without echoing content", async () => {
  const previousDebug = process.env.SDS_AI_DEBUG;
  const previousContent = process.env.SDS_AI_DEBUG_CONTENT;
  const previousError = console.error;
  const messages = [];
  let path;
  try {
    process.env.SDS_AI_DEBUG = "1";
    process.env.SDS_AI_DEBUG_CONTENT = "1";
    console.error = (...values) => messages.push(values.join(" "));
    const server = mockServer(async context => {
      context.log.error("AI interaction content", JSON.stringify({ prompt: "SYNTHETIC_PRIVATE_PROMPT",
        response: "SYNTHETIC_PRIVATE_RESPONSE" }));
      context.res = { status: 200, body: { answer: "Synthetic" } };
    });
    localAiVitePlugin().configureServer(server);
    const request = Readable.from([]);
    request.url = "/api/design-assistant";
    request.method = "GET";
    request.headers = {};
    await server.middleware(request, mockResponse(), () => assert.fail());
    path = messages.find(value => value.startsWith("AI debug log file: "))?.slice("AI debug log file: ".length);
    assert.ok(path);
    const record = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(record.kind, "content");
    assert.match(JSON.stringify(record), /SYNTHETIC_PRIVATE_PROMPT/);
    assert.match(JSON.stringify(record), /SYNTHETIC_PRIVATE_RESPONSE/);
    assert.doesNotMatch(messages.join("\n"), /SYNTHETIC_PRIVATE/);
  } finally {
    console.error = previousError;
    if (previousDebug === undefined) delete process.env.SDS_AI_DEBUG;
    else process.env.SDS_AI_DEBUG = previousDebug;
    if (previousContent === undefined) delete process.env.SDS_AI_DEBUG_CONTENT;
    else process.env.SDS_AI_DEBUG_CONTENT = previousContent;
    if (path) unlinkSync(path);
  }
});
