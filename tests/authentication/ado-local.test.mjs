import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as contract from "../../shared/adoContract.ts";
import { localAdoVitePlugin } from "../../scripts/local-ado-vite.mjs";

const source = ts.transpileModule(readFileSync(new URL("../../api/ado-work-items/index.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const body = {
  configuration: { organizationUrl: "https://dev.azure.com/synthetic", project: "Synthetic Project",
    defaults: {} },
  draft: { title: "Synthetic finding", description: "Synthetic description", severity: "2 - High",
    workItemType: "Bug", weaknessType: "Synthetic weakness" },
  validateOnly: true,
};
const originalRelaySetting = process.env.SDS_ADO_RELAY_ENABLED;

function request(changes = {}, content = JSON.stringify(body)) {
  const value = Readable.from([Buffer.from(content)]);
  Object.assign(value, {
    url: "/api/ado-work-items", method: "POST",
    socket: { remoteAddress: "::1" },
    headers: {
      host: "localhost:5173", origin: "http://localhost:5173", "sec-fetch-site": "same-origin",
      "content-type": "application/json", authorization: "Bearer synthetic-test-token",
    },
    ...changes,
  });
  return value;
}

function harness({ error, status = 200, handlerError = false } = {}) {
  let middleware, loads = 0, next = 0;
  const upstream = [], exports = {};
  const fakeFetch = async (url, init) => {
    upstream.push({ url, init });
    if (error) throw new Error("sensitive provider detail");
    return new Response(JSON.stringify({ id: 42, fields: {} }), { status });
  };
  new Function("require", "exports", "process", "fetch", source)(
    name => { assert.equal(name, "../../shared/adoContract"); return contract; },
    exports, { env: { SDS_ADO_RELAY_ENABLED: "0" } }, fakeFetch,
  );
  localAdoVitePlugin().configureServer({
    middlewares: { use(value) { middleware = value; } },
    async ssrLoadModule(path) {
      loads++;
      assert.equal(path, "/api/ado-work-items/index.ts");
      if (handlerError) throw new Error("sensitive loader detail");
      return exports;
    },
  });
  return {
    upstream,
    get loads() { return loads; },
    get next() { return next; },
    async run(req = request()) {
      const response = {
        statusCode: 200, headers: {}, headersSent: false, body: "",
        setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
        end(value = "") { this.body = value; this.headersSent = true; },
      };
      await middleware(req, response, () => { next++; });
      assert.doesNotMatch(response.body, /sensitive|synthetic-test-token/);
      if (response.body) {
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(response.headers["access-control-allow-origin"], undefined);
        assert.equal(response.headers["set-cookie"], undefined);
        response.json = JSON.parse(response.body);
      }
      return response;
    },
  };
}

test("local ADO adapter reuses real relay validation and forwards only the caller token to fixed ADO HTTPS", async () => {
  const h = harness();
  assert.deepEqual((await h.run()).json, { validated: true });
  assert.equal(h.upstream.length, 1);
  const { url, init } = h.upstream[0];
  assert.equal(url, "https://dev.azure.com/synthetic/Synthetic%20Project/_apis/wit/workitems/$Bug?api-version=7.1&validateOnly=true");
  assert.equal(init.headers.Authorization, "Bearer synthetic-test-token");
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
  assert.equal(process.env.SDS_ADO_RELAY_ENABLED, originalRelaySetting, "Local mode never enables the deployed relay globally");
  const created = await h.run(request({}, JSON.stringify({ ...body, validateOnly: false })));
  assert.deepEqual(created.json, { id: 42, url: "https://dev.azure.com/synthetic/Synthetic%20Project/_workitems/edit/42" });
});

test("local ADO adapter rejects non-loopback, DNS rebinding, cross-origin and proxy headers before loading a handler", async () => {
  for (const changes of [
    { socket: { remoteAddress: "192.0.2.1" } }, { socket: {} },
    ...[
      { host: "evil.example:5173" }, { host: "127.0.0.1:5173" },
      { origin: "https://evil.example" }, { origin: "" },
      { "sec-fetch-site": "cross-site" }, { "x-forwarded-host": "localhost:5173" },
      { "x-forwarded-proto": "https" },
    ].map(headers => ({ headers: { ...request().headers, ...headers } })),
    { url: "http://evil.example/api/ado-work-items" },
  ]) {
    const h = harness();
    assert.equal((await h.run(request(changes))).statusCode, 403);
    assert.equal(h.loads, 0);
    assert.equal(h.upstream.length, 0);
  }
});

test("local ADO adapter handles only POST JSON on its exact route and bounds streamed UTF-8 input", async () => {
  for (const url of ["/", "/api/design-assistant", "/api/ado-work-items-other"]) {
    const h = harness();
    await h.run(request({ url }));
    assert.equal(h.next, 1);
    assert.equal(h.loads, 0);
  }
  for (const [changes, text, expected] of [
    [{ method: "GET" }, "", 405], [{ method: "OPTIONS" }, "", 405],
    [{ headers: { ...request().headers, "content-type": "text/plain" } }, "{}", 415],
    [{ headers: { ...request().headers, "content-length": "500001" } }, "", 413],
    [{ headers: { ...request().headers, "content-length": "invalid" } }, "", 413],
    [{}, "é".repeat(250001), 413],
    [{}, "not JSON", 400],
    [{ headers: { ...request().headers, authorization: "" } }, JSON.stringify(body), 401],
    [{}, JSON.stringify({ ...body, configuration: { ...body.configuration, organizationUrl: "https://evil.example" } }), 400],
  ]) {
    const h = harness();
    assert.equal((await h.run(request(changes, text))).statusCode, expected);
    assert.equal(h.upstream.length, 0);
  }
});

test("local ADO adapter preserves ambiguous creation outcomes without retries and exposes safe loader errors", async () => {
  for (const options of [{ error: true }, { status: 500 }]) {
    const h = harness(options);
    const result = await h.run(request({}, JSON.stringify({ ...body, validateOnly: false })));
    assert.equal(result.statusCode, 502);
    assert.equal(result.json.uncertain, true);
    assert.equal(h.upstream.length, 1);
  }
  const h = harness({ handlerError: true });
  assert.equal((await h.run()).statusCode, 500);
  assert.equal(h.upstream.length, 0);
});
