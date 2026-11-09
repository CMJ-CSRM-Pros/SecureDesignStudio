import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const contract = {};
new Function("exports", compile("../../shared/adoContract.ts"))(contract);
const compiled = compile("../../api/ado-work-items/index.ts");
const configuration = changes => ({
  organizationUrl: "https://dev.azure.com/synthetic",
  project: "Synthetic Project",
  defaults: { "System.AreaPath": "Synthetic Project\\Area", "Custom.Priority": 2, "Custom.Flag": true },
  ...changes,
});
const draft = { title: "Synthetic title", description: `<script>"&'</script>\r\nLine two`,
  workItemType: "Bug", weaknessType: "Synthetic weakness", severity: "2 - High" };
const request = changes => ({
  method: "POST",
  url: "https://studio.example/api/ado-work-items",
  headers: {
    origin: "https://studio.example",
    "content-type": "application/json",
    authorization: "Bearer synthetic-caller-token",
    "sec-fetch-site": "same-origin",
  },
  body: { configuration: configuration(), draft, validateOnly: false },
  ...changes,
});

function harness(options = {}) {
  const calls = [], logs = [], exports = {};
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (options.timeout) {
      return new Promise((_, reject) => init.signal.addEventListener("abort",
        () => reject(new Error("secret transport payload")), { once: true }));
    }
    if (options.networkError) throw new Error("secret transport payload");
    const status = options.status ?? 200;
    return {
      status, ok: status >= 200 && status < 300,
      body: new Response(options.errorBody ?? JSON.stringify(options.payload ?? {})).body,
      async json() {
        if (options.jsonError) throw new Error("secret service payload");
        return options.payload ?? { id: 42, rev: 1, fields: { "System.Title": draft.title }, url: "https://evil.example/ignored" };
      },
    };
  };
  new Function("require", "exports", "process", "fetch", "setTimeout", "clearTimeout", compiled)(
    name => {
      assert.equal(name, "../../shared/adoContract");
      return contract;
    },
    exports, { env: { SDS_ADO_RELAY_ENABLED: options.enabled === undefined ? "1" : options.enabled } },
    fetch,
    options.timeout ? callback => { queueMicrotask(callback); return 1; } : setTimeout,
    options.timeout ? () => {} : clearTimeout,
  );
  return {
    calls, logs,
    async run(req = request()) {
      const context = { log: (...args) => logs.push(args) };
      await (options.local ? exports.localAdoWorkItems : exports.default)(context, req);
      assert.equal(context.res.headers["Cache-Control"], "no-store");
      assert.equal(context.res.headers.Pragma, "no-cache");
      assert.equal(context.res.headers["Content-Type"], "application/json");
      assert.equal(context.res.headers["Set-Cookie"], undefined);
      assert.equal(context.res.headers["Access-Control-Allow-Origin"], undefined);
      assert.doesNotMatch(JSON.stringify(context.res), /synthetic-caller-token|secret .*payload/);
      assert.equal(logs.length, 0);
      return context.res;
    },
  };
}

test("ADO relay is unavailable by default and binds only the explicit POST route", async () => {
  for (const enabled of [null, "", "0", "true"]) {
    const h = harness({ enabled });
    const result = await h.run();
    assert.equal(result.status, 503);
    assert.match(result.body.error, /unavailable.*explicitly enable/i);
    assert.equal(h.calls.length, 0);
  }
  const binding = JSON.parse(readFileSync(new URL("../../api/ado-work-items/function.json", import.meta.url)));
  assert.deepEqual(binding.bindings[0].methods, ["post"]);
  assert.equal(binding.bindings[0].route, "ado-work-items");
  assert.equal(binding.scriptFile, "../dist/api/ado-work-items/index.js");
  const h = harness();
  for (const method of ["GET", "OPTIONS", "PUT", "DELETE"]) {
    assert.equal((await h.run(request({ method }))).status, 405);
  }
  assert.equal(h.calls.length, 0);
});

test("ADO local adapter is explicit and fixed-origin; deployed handler still refuses HTTP localhost", async () => {
  const localRequest = changes => request({
    url: "http://localhost:5173/api/ado-work-items",
    headers: { ...request().headers, origin: "http://localhost:5173", host: "localhost:5173" },
    ...changes,
  });
  const local = harness({ local: true, enabled: "0" });
  assert.equal((await local.run(localRequest())).status, 200);
  assert.equal(local.calls.length, 1);
  assert.match(local.calls[0].url, /^https:\/\/dev\.azure\.com\/synthetic\//);
  const deployed = harness();
  assert.equal((await deployed.run(localRequest())).status, 403);
  assert.equal(deployed.calls.length, 0);
  for (const headers of [
    { origin: "https://evil.example" }, { origin: "http://localhost:5174" },
    { origin: "http://localhost:5173", "x-forwarded-host": "localhost:5173" },
    { origin: "http://localhost:5173", "x-forwarded-proto": "https" },
    { origin: "http://localhost:5173", "sec-fetch-site": "cross-site" },
    { origin: "" }, { host: "127.0.0.1:5173", origin: "http://localhost:5173" },
  ]) {
    const h = harness({ local: true });
    const req = localRequest();
    req.headers = { ...req.headers, ...headers };
    assert.equal((await h.run(req)).status, 403);
    assert.equal(h.calls.length, 0);
  }
});

test("ADO relay forwards only the caller token to the fixed destination, with exact escaped patch", async () => {
  for (const validateOnly of [true, false]) {
    const h = harness();
    const result = await h.run(request({ body: { configuration: configuration(), draft, validateOnly } }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, validateOnly ? { validated: true } :
      { id: 42, url: "https://dev.azure.com/synthetic/Synthetic%20Project/_workitems/edit/42" });
    assert.equal(h.calls.length, 1);
    const { url, init } = h.calls[0];
    assert.equal(url, "https://dev.azure.com/synthetic/Synthetic%20Project/_apis/wit/workitems/$Bug" +
      "?api-version=7.1" + (validateOnly ? "&validateOnly=true" : ""));
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, {
      Authorization: "Bearer synthetic-caller-token", "Content-Type": "application/json-patch+json",
    });
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(init.body), [
      { op: "add", path: "/fields/System.Title", value: "Synthetic title" },
      { op: "add", path: "/fields/System.Description",
        value: "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;<br>Line two" },
      { op: "add", path: "/fields/Custom.Flag", value: true },
      { op: "add", path: "/fields/Custom.Priority", value: 2 },
      { op: "add", path: "/fields/Custom.WeaknessType", value: "Synthetic weakness" },
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Severity", value: "2 - High" },
      { op: "add", path: "/fields/System.AreaPath", value: "Synthetic Project\\Area" },
    ]);
  }
});

test("ADO relay routes mixed Bug and Task drafts from one destination without global classification overrides", async () => {
  const h = harness();
  const config = configuration({ workItemType: "Bug", defaults: {
    "Custom.WeaknessType": "Wrong global value", "Custom.RiskRating": 2,
    "Microsoft.VSTS.Common.Priority": 2, "Microsoft.VSTS.CMMI.Blocked": "No",
    "Microsoft.VSTS.CMMI.RootCause": "Unknown",
  } });
  for (const validateOnly of [true, false]) {
    for (const workItemType of ["Bug", "Task"]) {
      const item = { ...draft, workItemType, weaknessType: `${workItemType} classification` };
      assert.equal((await h.run(request({ body: { configuration: config, draft: item, validateOnly } }))).status, 200);
      const call = h.calls.at(-1);
      assert.match(call.url, new RegExp(`/workitems/\\$${workItemType}\\?`));
      const fields = Object.fromEntries(JSON.parse(call.init.body).map(op => [op.path, op.value]));
      assert.equal(fields["/fields/Custom.WeaknessType"], item.weaknessType);
      assert.equal(fields["/fields/Microsoft.VSTS.Common.Severity"], item.severity);
      for (const name of ["Custom.RiskRating", "Microsoft.VSTS.Common.Priority", "Microsoft.VSTS.CMMI.Blocked", "Microsoft.VSTS.CMMI.RootCause"]) {
        assert.equal(Object.hasOwn(fields, `/fields/${name}`), false);
      }
    }
  }
});

test("ADO relay accepts blank optional weakness and omits the field for both types", async () => {
  for (const workItemType of ["Bug", "Task"]) {
    for (const weaknessType of [undefined, "", "  ", "\t\r\n"]) {
      for (const validateOnly of [true, false]) {
        const h = harness();
        const result = await h.run(request({ body: {
          configuration: configuration({ defaults: { "Custom.WeaknessType": "Must not be inherited" } }),
          draft: { ...draft, workItemType, weaknessType }, validateOnly,
        } }));
        assert.equal(result.status, 200);
        assert.equal(h.calls.length, 1);
        const patch = JSON.parse(h.calls[0].init.body);
        assert.equal(patch.some(op => op.path === "/fields/Custom.WeaknessType"), false);
        assert.equal(patch.find(op => op.path === "/fields/Microsoft.VSTS.Common.Severity").value, draft.severity);
      }
    }
  }
});

test("ADO relay maps authored Bug/custom descriptions once and rejects template overrides", async () => {
  for (const descriptionField of ["Microsoft.VSTS.TCM.ReproSteps", "Custom.SecurityDescription"]) {
    const h = harness();
    const config = configuration({ workItemType: "Bug", descriptionField });
    const result = await h.run(request({ body: {
      configuration: config, draft: { ...draft, severity: "3 - Medium" }, validateOnly: true,
    } }));
    assert.equal(result.status, 200);
    assert.match(h.calls[0].url, /\/workitems\/\$Bug\?api-version=7\.1&validateOnly=true$/);
    const patch = JSON.parse(h.calls[0].init.body);
    assert.deepEqual(patch[1], {
      op: "add", path: `/fields/${descriptionField}`, value: "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;<br>Line two",
    });
    assert.equal(patch.some(operation => operation.path === "/fields/System.Description"), false);
    assert.equal(patch.filter(operation => operation.path.toLowerCase() === `/fields/${descriptionField}`.toLowerCase()).length, 1);
    const invalid = harness();
    const invalidConfig = configuration({
      descriptionField, defaults: { [descriptionField.toLowerCase()]: "override authored content" },
    });
    assert.equal((await invalid.run(request({
      body: { configuration: invalidConfig, draft, validateOnly: false },
    }))).status, 400);
    assert.equal(invalid.calls.length, 0);
  }
});

test("ADO relay expands saved inventory/reviewer and individual severity for both preflight and create", async () => {
  const config = configuration({
    workItemType: "Bug", inventoryId: "33333333-3333-4333-8333-333333333333",
    reviewer: "reviewer@example.com",
    defaults: { "System.Tags": "Security; ServiceOID:stale", "Custom.TeamID": "separate-team",
      "Custom.SecurityReviewer": "stale@example.com", "Microsoft.VSTS.Common.Severity": "3 - Medium" },
  });
  for (const validateOnly of [true, false]) {
    for (const severity of ["1 - Critical", "4 - Low"]) {
      const h = harness();
      const result = await h.run(request({ body: { configuration: config, draft: { ...draft, severity }, validateOnly } }));
      assert.equal(result.status, 200);
      const fields = Object.fromEntries(JSON.parse(h.calls[0].init.body).map(op => [op.path, op.value]));
      assert.equal(fields["/fields/System.Tags"], `Security; ServiceOID:${config.inventoryId}`);
      assert.equal(fields["/fields/Custom.SecurityReviewer"], config.reviewer);
      assert.equal(fields["/fields/Custom.TeamID"], "separate-team");
      assert.equal(fields["/fields/Microsoft.VSTS.Common.Severity"], severity);
    }
    const invalid = harness();
    assert.equal((await invalid.run(request({ body: { configuration: config, draft: { ...draft, severity: undefined }, validateOnly } }))).status, 400);
    assert.equal(invalid.calls.length, 0, "Missing severity is rejected before an upstream request");
  }
});

test("ADO relay enforces same-origin HTTPS, including SWA forwarded host, without host-based routing", async () => {
  const base = request();
  for (const changes of [
    { origin: undefined }, { origin: "null" }, { origin: "https://other.example" },
    { origin: "https://studio.example/path" }, { origin: "https://studio.example#secret" },
    { origin: "https://user@studio.example" }, { origin: "http://studio.example" },
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
    { "x-forwarded-host": "studio.example,evil.example" },
    { "x-forwarded-host": "studio.example/path" }, { "x-forwarded-proto": "http" },
  ]) {
    const h = harness();
    assert.equal((await h.run(request({ headers: { ...base.headers, ...changes } }))).status, 403);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  const result = await h.run(request({
    url: "http://internal-functions-host/api/ado-work-items",
    headers: {
      ...base.headers, host: "ignored.example", "x-forwarded-host": "studio.example", "x-forwarded-proto": "https",
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(new URL(h.calls[0].url).hostname, "dev.azure.com");
});

test("ADO relay requires bearer authorization and JSON; cookies never supply or accompany credentials", async () => {
  const base = request();
  for (const authorization of [undefined, "", "Basic token", "Bearer", "Bearer token\ninjected", "Bearer " + "x".repeat(33_000)]) {
    const h = harness();
    assert.equal((await h.run(request({
      headers: { ...base.headers, authorization, cookie: "Authorization=not-a-credential" },
    }))).status, 401);
    assert.equal(h.calls.length, 0);
  }
  for (const contentType of [undefined, "text/plain", "application/json-patch+json"]) {
    const h = harness();
    assert.equal((await h.run(request({
      headers: { ...base.headers, "content-type": contentType },
    }))).status, 415);
    assert.equal(h.calls.length, 0);
  }
});

test("ADO relay rejects oversized UTF-8 bodies, invalid JSON and injected destinations or patch operations", async () => {
  const base = request();
  for (const req of [
    request({ rawBody: " ".repeat(500_001) }),
    request({ body: { ...base.body, draft: { ...draft, description: "é".repeat(260_000) } } }),
    request({ headers: { ...base.headers, "content-length": "500001" } }),
    request({ headers: { ...base.headers, "content-length": "-1" } }),
  ]) {
    const h = harness();
    assert.equal((await h.run(req)).status, 413);
    assert.equal(h.calls.length, 0);
  }
  const malformed = [
    "{", "null", "[]",
    { ...base.body, validateOnly: "true" }, { ...base.body, validateOnly: undefined },
    { ...base.body, bypassRules: true }, { ...base.body, url: "https://evil.example" },
    ...[
      { organizationUrl: "https://evil.example" },
      { organizationUrl: "https://dev.azure.com:443/synthetic" },
      { organizationUrl: "https://user@dev.azure.com/synthetic" },
      { organizationUrl: "https://dev.azure.com/synthetic?bypassRules=true" },
      { organizationUrl: "https://dev.azure.com/synthetic#secret" },
      { organizationUrl: "https://dev.azure.com/synthetic/../other" },
      { project: "//evil.example" },
      { defaults: { "System.Title": "override" } },
      { defaults: { "System.Description": "override" } },
      { defaults: { "/relations/-": "https://evil.example" } },
      { defaults: { "System.CreatedBy": "spoofed" } },
      { defaults: { "Custom.Rev": 2 } }, { defaults: { "Custom.Object": {} } },
    ].map(changes => ({ ...base.body, configuration: configuration(changes) })),
    ...[{ title: "", description: "" }, { ...draft, title: "x".repeat(256) },
      { ...draft, workItemType: "../Task" }, { ...draft, workItemType: undefined },
      { ...draft, weaknessType: null }, { ...draft, weaknessType: 3 }, { ...draft, weaknessType: "not\nsingle line" },
      { ...draft, severity: undefined },
      { ...draft, operations: [{ op: "remove", path: "/fields/System.Title" }] }]
      .map(value => ({ ...base.body, draft: value })),
  ];
  for (const body of malformed) {
    const h = harness();
    assert.equal((await h.run(request({ body }))).status, 400, JSON.stringify(body));
    assert.equal(h.calls.length, 0);
  }
});

test("ADO relay preserves definite rejection statuses and sanitizes all service failures without retry", async () => {
  for (const status of [400, 401, 403, 404, 405, 409, 410, 412, 413, 415, 422, 429]) {
    const h = harness({ status, payload: { error: "secret service payload" } });
    const result = await h.run();
    assert.equal(result.status, status);
    assert.equal(result.body.uncertain, false);
    assert.equal(h.calls.length, 1);
  }
  for (const options of [
    { status: 408 }, { status: 500 }, { status: 503 }, { status: 302 },
    { status: 202 }, { status: 204 }, { networkError: true }, { timeout: true }, { jsonError: true },
    ...[{}, { id: "42" }, { id: -1 }, { id: 0 }, { id: 2 ** 53 }].map(payload => ({ payload })),
  ]) {
    const h = harness(options);
    const result = await h.run();
    assert.equal(result.status, 502);
    assert.equal(result.body.uncertain, true);
    assert.equal(h.calls.length, 1);
  }
  for (const options of [{ status: 500 }, { networkError: true }, { timeout: true }]) {
    const h = harness(options);
    const result = await h.run(request({ body: { ...request().body, validateOnly: true } }));
    assert.equal(result.status, 502);
    assert.equal(result.body.uncertain, false);
    assert.equal(h.calls.length, 1);
  }
});

test("ADO relay validates dry-run WorkItem JSON without requiring a persisted positive ID", async () => {
  for (const payload of [
    { fields: { "System.Title": draft.title } },
    { id: 0, rev: 0, fields: { "System.Title": draft.title } },
    { id: -1, rev: 1, fields: { "System.Title": draft.title } },
    { id: 42, rev: 1, fields: { "System.Title": draft.title } },
  ]) {
    const h = harness({ payload });
    const result = await h.run(request({ body: { ...request().body, validateOnly: true } }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { validated: true });
    assert.equal(h.calls.length, 1);
  }
  for (const options of [
    { jsonError: true }, { payload: "<html>WAF challenge</html>" },
    { payload: {} }, { payload: [] }, { payload: { id: 42 } }, { payload: { fields: [] } },
    { payload: { fields: null } }, { payload: { fields: {}, id: "42" } },
    { payload: { fields: {}, rev: -1 } }, { payload: { fields: {}, rev: "1" } },
  ]) {
    const h = harness(options);
    const result = await h.run(request({ body: { ...request().body, validateOnly: true } }));
    assert.equal(result.status, 502);
    assert.equal(result.body.uncertain, false);
    assert.equal(h.calls.length, 1);
  }
});

test("ADO relay exposes only safe reference names from bounded validation error JSON", async () => {
  for (const status of [400, 422]) {
    const h = harness({
      status,
      payload: {
        message: "Required field 'Custom.RequiredEvidence' is missing. Field System.AreaPath is invalid. " +
          "The value 'Custom.NotAFieldValue' is invalid. " +
          "secret model value <script>private model</script> Bearer secret-token",
        typeName: "secret raw provider type",
        customProperties: {
          FieldReferenceName: "Microsoft.VSTS.Common.Priority",
          fieldReferenceInfo: { referenceName: "Custom.ProcessField" },
          value: "Custom.PrivateModelValue",
        },
        model: { title: "Custom.PrivateTitle" },
      },
    });

    const result = await h.run(request({ body: { ...request().body, validateOnly: true } }));
    assert.equal(result.status, status);
    assert.equal(result.body.uncertain, false);
    assert.deepEqual(result.body.fields, [
      "Microsoft.VSTS.Common.Priority", "Custom.ProcessField", "Custom.RequiredEvidence", "System.AreaPath",
    ]);
    assert.deepEqual(Object.keys(result.body).sort(), ["error", "fields", "uncertain"]);
    assert.doesNotMatch(JSON.stringify(result.body), /secret|script|private|Bearer|typeName|PrivateModel|PrivateTitle|NotAFieldValue/i);
    assert.equal(h.calls.length, 1);
  }
  for (const errorBody of [
    "<html>secret provider error</html>", JSON.stringify({ message: "Unrecognized provider response" }),
    JSON.stringify({ message: "Custom.RequiredEvidence", padding: "x".repeat(16_384) }),
    JSON.stringify({ typeName: "Custom.NotAField", value: "Custom.PrivateValue" }),
  ]) {
    const h = harness({ status: 400, errorBody });
    const result = await h.run(request({ body: { ...request().body, validateOnly: true } }));
    assert.equal(result.status, 400);
    assert.equal(result.body.uncertain, false);
    assert.deepEqual(result.body.fields, []);
    assert.equal(h.calls.length, 1);
  }
  const h = harness({
    status: 422,
    payload: { fieldReferenceNames: [
      ...Array.from({ length: 30 }, (_, i) => `Custom.Required${i}`),
      "<script>secret</script>", "Custom.Injected/Path", "Other.Private",
    ] },
  });
  const result = await h.run(request({ body: { ...request().body, validateOnly: true } }));
  assert.equal(result.body.fields.length, 10);
  assert.deepEqual(result.body.fields, Array.from({ length: 10 }, (_, i) => `Custom.Required${i}`));
});
