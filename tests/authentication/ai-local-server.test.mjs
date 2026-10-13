import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { readFileSync, unlinkSync } from "node:fs";
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
