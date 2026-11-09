import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../../src/adoClient.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const contract = {};
new Function("exports", ts.transpileModule(
  readFileSync(new URL("../../shared/adoContract.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(contract);
const configuration = (changes = {}) => ({
  organizationUrl: "https://dev.azure.com/example",
  project: "Synthetic Project",
  defaults: { "System.AreaPath": "Synthetic Project\\Area", "Custom.Priority": 2, "Custom.Flag": true },
  ...changes,
});
const authentication = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
};
const draft = { title: "Synthetic title", description: `<script>"&'</script>\r\nLine two`,
  workItemType: "Bug", weaknessType: "Synthetic weakness", severity: "2 - High" };

test("ADO per-item classification routes Bug and Task independently and omits retired global fields", () => {
  const config = configuration({ workItemType: "Bug", defaults: {
    "System.AreaPath": "Synthetic Project", "Custom.WeaknessType": "Legacy global weakness",
    "Custom.RiskRating": 2, "Microsoft.VSTS.Common.Priority": 2,
    "Microsoft.VSTS.CMMI.Blocked": "No", "Microsoft.VSTS.CMMI.RootCause": "Unknown",
  } });
  const before = structuredClone(config);
  const normalized = contract.normalizeAdoConfiguration(config);
  assert.equal(Object.hasOwn(normalized, "workItemType"), false);
  assert.deepEqual(normalized.defaults, { "System.AreaPath": "Synthetic Project" });
  assert.deepEqual(config, before, "Normalization does not rewrite the original stored source");
  for (const workItemType of ["Bug", "Task"]) {
    const item = { ...draft, workItemType, weaknessType: `${workItemType} weakness`, severity: "2 - High" };
    const fields = Object.fromEntries(contract.adoPatch(item, config).map(operation => [operation.path, operation.value]));
    assert.equal(fields["/fields/Custom.WeaknessType"], item.weaknessType);
    assert.equal(fields["/fields/Microsoft.VSTS.Common.Severity"], item.severity);
    for (const name of ["Custom.RiskRating", "Microsoft.VSTS.Common.Priority", "Microsoft.VSTS.CMMI.Blocked", "Microsoft.VSTS.CMMI.RootCause"]) {
      assert.equal(Object.hasOwn(fields, `/fields/${name}`), false);
    }
    assert.equal(contract.adoEndpoint(normalized, workItemType, true),
      `https://dev.azure.com/example/Synthetic%20Project/_apis/wit/workitems/$${workItemType}?api-version=7.1&validateOnly=true`);
  }
});

test("ADO optional weakness accepts blanks for Bug and Task without reviving global defaults", async () => {
  const config = configuration({ defaults: { "Custom.WeaknessType": "Legacy global weakness" } });
  const h = harness();
  const client = new h.AdoClient(config);
  await client.signIn();
  for (const workItemType of ["Bug", "Task"]) {
    for (const weaknessType of [undefined, "", "   ", "\t\r\n"]) {
      const value = { ...draft, workItemType, weaknessType };
      const normalized = contract.normalizeAdoDraft(value);
      assert.equal(Object.hasOwn(normalized, "weaknessType"), false);
      assert.equal(contract.adoPatch(value, config).some(op => op.path === "/fields/Custom.WeaknessType"), false);
      await client.validate(value);
      assert.equal(Object.hasOwn(JSON.parse(h.calls.requests.at(-1).init.body).draft, "weaknessType"), false);
    }
  }
  const value = { ...draft, weaknessType: "  Specific weakness  " };
  assert.equal(contract.normalizeAdoDraft(value).weaknessType, "Specific weakness");
  assert.equal(value.weaknessType, "  Specific weakness  ", "Authored input is not rewritten");
});

test("ADO per-item classification requires type and severity for both Bug and Task", () => {
  const config = configuration({ workItemType: "Bug", defaults: {
    "Custom.WeaknessType": "Legacy weakness", "Microsoft.VSTS.Common.Severity": "3 - Medium",
  } });
  for (const workItemType of ["Bug", "Task"]) {
    const item = { ...draft, workItemType, weaknessType: "Specific weakness", severity: "2 - High" };
    for (const field of ["workItemType", "severity"]) {
      const missing = { ...item }; delete missing[field];
      assert.throws(() => contract.adoPatch(missing, config), contract.AdoRequestError);
    }
    assert.doesNotThrow(() => contract.adoPatch(item, config));
  }
  for (const workItemType of ["User Story", "", "bug", "../Task", null]) {
    assert.throws(() => contract.adoPatch({ ...draft, workItemType, weaknessType: "Specific", severity: "2 - High" }, config),
      contract.AdoRequestError);
    assert.throws(() => contract.adoEndpoint(config, workItemType, false), contract.AdoRequestError);
  }
});

test("ADO configuration JSON accepts the complete object without a separate defaults-only form", () => {
  const config = configuration({
    inventoryId: "33333333-3333-4333-8333-333333333333",
    reviewer: "reviewer@example.invalid", descriptionField: "System.Description",
  });
  assert.deepEqual(contract.parseAdoConfigurationJson(JSON.stringify(config, null, 2)), config);
  assert.deepEqual(contract.parseAdoConfigurationJson("\uFEFF" + JSON.stringify(config)), config);
  assert.deepEqual(contract.parseAdoConfigurationJson(JSON.stringify({
    ...config, ...authentication, inventoryId: " ", reviewer: "",
  })), configuration({ descriptionField: "System.Description" }),
  "Blank optional values and legacy registration IDs are omitted without touching deployment authentication");
  assert.throws(() => contract.parseAdoConfigurationJson(JSON.stringify(config.defaults)), /complete.*configuration/i);
  assert.throws(() => contract.parseAdoConfigurationJson('{"organizationUrl":'), /JSON is invalid/);
  assert.throws(() => contract.parseAdoConfigurationJson("[]"), /complete.*configuration/i);
  assert.throws(() => contract.parseAdoConfigurationJson(JSON.stringify({
    ...config, clientSecret: "private-value-never-echo",
  })), error => /Invalid ADO configuration/.test(error.message) && !error.message.includes("private-value"));
  assert.throws(() => contract.parseAdoConfigurationJson(" ".repeat(contract.ADO_MAX_REQUEST_BYTES + 1)), /500,000/);
  const expanded = configuration({
    defaults: Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`Custom.Field${i}`, "x"])),
  });
  const compact = JSON.stringify(expanded);
  assert.ok(new TextEncoder().encode(compact).length <= contract.ADO_MAX_REQUEST_BYTES);
  assert.throws(() => contract.parseAdoConfigurationJson(compact), /Formatted configuration JSON/);
});

test("ADO configuration JSON rejects mismatched or overescaped paths before saving, without rewriting them", () => {
  for (const field of ["System.AreaPath", "System.IterationPath"]) {
    for (const path of ["Other Project\\Prod", "Synthetic ProjectOther\\Prod", "Synthetic Project\\\\Prod", "Synthetic Project\\", ""]) {
      const input = configuration({ defaults: { [field]: path } });
      const original = JSON.stringify(input);
      assert.throws(() => contract.parseAdoConfigurationJson(original), error => error.message.includes(field));
      assert.equal(JSON.stringify(input), original);
    }
    for (const path of ["Synthetic Project", "synthetic project\\Prod"]) {
      const input = configuration({ defaults: { [field.toLowerCase()]: path } });
      assert.deepEqual(contract.parseAdoConfigurationJson(JSON.stringify(input)), input);
    }
  }
  assert.deepEqual(contract.parseAdoConfigurationJson(JSON.stringify(configuration({ defaults: {} }))),
    configuration({ defaults: {} }), "Routing fields can be omitted for an ADO-default configuration");
});

function harness(options = {}) {
  const calls = { loads: 0, initialize: 0, popups: [], silent: [], requests: [], settings: [] };
  let active;
  const account = { homeAccountId: "synthetic-account" };
  const window = {
    location: { href: options.href ?? "https://studio.example/app/index.html?private=ignored#secret" },
    opener: options.opener ?? null,
  };
  window.self = window;
  window.top = options.frame ? {} : window;
  class PublicClientApplication {
    constructor(settings) { calls.settings.push(settings); }
    async initialize() {
      calls.initialize++;
      if (options.initializeError) throw new Error("sensitive provider payload");
    }
    async loginPopup(request) {
      calls.popups.push(request);
      if (options.popupError) throw new Error("sensitive provider payload");
      return { account };
    }
    setActiveAccount(value) { active = value; }
    getActiveAccount() { return active; }
    async acquireTokenSilent(request) {
      calls.silent.push(request);
      if (options.silentError) throw new Error("sensitive provider payload");
      return { accessToken: "synthetic-token-never-log" };
    }
  }
  const exports = {};
  const fetch = async (url, init) => {
    calls.requests.push({ url, init });
    if (options.timeout) {
      return new Promise((_, reject) => init.signal.addEventListener("abort",
        () => reject(new Error("sensitive transport payload")), { once: true }));
    }
    if (options.networkError) throw new Error("sensitive transport payload");
    return {
      ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
      status: options.status ?? 200,
      body: new Response(options.errorBody ?? JSON.stringify(options.payload ?? {})).body,
      async json() {
        if (options.jsonError) throw new Error("sensitive response payload");
        return options.payload ?? (JSON.parse(init.body).validateOnly ? { validated: true } :
          { id: 42, url: "https://untrusted.example/do-not-follow" });
      },
    };
  };
  new Function("require", "exports", "window", "__PS_LOCAL_ONLY__", "fetch", "setTimeout", "clearTimeout",
    "__SDS_ADO_AUTH__", "__SDS_LOCAL_ADO__", compiled)(
    name => {
      if (name === "../shared/adoContract") return contract;
      assert.equal(name, "@azure/msal-browser");
      calls.loads++;
      return { PublicClientApplication, BrowserCacheLocation: { MemoryStorage: "memoryStorage" } };
    },
    exports, window, options.local ?? false, fetch,
    options.timeout ? callback => { queueMicrotask(callback); return 1; } : setTimeout,
    options.timeout ? () => {} : clearTimeout,
    Object.hasOwn(options, "authentication") ? options.authentication : authentication,
    options.localAdo ?? false,
  );
  return { ...exports, calls, window };
}

test("ADO exports, lazy loading, stable destination identity and copied configuration", async () => {
  const h = harness();
  assert.deepEqual(Object.keys(h).filter(key => !["calls", "window"].includes(key)).sort(),
    ["AdoClient", "AdoRequestError", "adoAuthenticationConfigured", "adoConnectionAllowed", "destinationKey", "normalizeAdoConfiguration"]);
  const config = configuration();
  const client = new h.AdoClient(config);
  assert.equal(h.calls.loads, 0);
  assert.equal(h.destinationKey(config), h.destinationKey(configuration({
    organizationUrl: "https://DEV.AZURE.COM/EXAMPLE/", project: "synthetic project",
    workItemType: "user story", defaults: {},
  })));
  config.defaults["System.Title"] = "injected";
  await client.signIn();
  await client.create(draft);
  assert.equal(h.calls.requests[0].init.body.includes("injected"), false);
});

test("ADO explicit local mode permits only the fixed localhost origin without weakening ordinary local guards", async () => {
  const h = harness({ local: true, localAdo: true, href: "http://localhost:5173/?ignored#room=synthetic" });
  assert.equal(h.adoConnectionAllowed(), true);
  const client = new h.AdoClient(configuration());
  await client.signIn();
  await client.validate(draft);
  assert.equal(h.calls.settings[0].auth.redirectUri, "http://localhost:5173/");
  assert.equal(h.calls.requests[0].url, "/api/ado-work-items");
  for (const options of [
    { local: true, localAdo: false, href: "http://localhost:5173/" },
    { local: false, localAdo: true, href: "http://localhost:5173/" },
    ...["http://localhost:5174/", "http://127.0.0.1:5173/", "https://localhost:5173/",
      "http://evil.example:5173/", "file:///C:/synthetic/index.html"].map(href => ({ local: true, localAdo: true, href })),
  ]) {
    const invalid = harness(options);
    assert.equal(invalid.adoConnectionAllowed(), false);
    await assert.rejects(() => new invalid.AdoClient(configuration()).signIn(), invalid.AdoRequestError);
    assert.equal(invalid.calls.loads, 0);
    assert.equal(invalid.calls.requests.length, 0);
  }
});

test("ADO destination needs no registration IDs and legacy profile IDs cannot select authentication", async () => {
  const h = harness();
  const config = configuration();
  assert.deepEqual(h.normalizeAdoConfiguration(config), config);
  const legacy = configuration({
    tenantId: "33333333-3333-4333-8333-333333333333",
    clientId: "44444444-4444-4444-8444-444444444444",
  });
  assert.deepEqual(h.normalizeAdoConfiguration(legacy), config);
  assert.equal(h.destinationKey(legacy), h.destinationKey(config));
  assert.equal(h.adoAuthenticationConfigured(), true);
  const client = new h.AdoClient(legacy);
  await client.signIn();
  await client.create(draft);
  assert.equal(h.calls.settings[0].auth.clientId, authentication.clientId);
  assert.equal(h.calls.settings[0].auth.authority, `https://login.microsoftonline.com/${authentication.tenantId}`);
  assert.deepEqual(JSON.parse(h.calls.requests[0].init.body).configuration, config);
  assert.deepEqual(legacy.clientId, "44444444-4444-4444-8444-444444444444", "Migration does not mutate stored input");
});

test("ADO absent or invalid deployment authentication blocks MSAL and transport, even with legacy profile IDs", async () => {
  for (const deployment of [null, undefined, {}, { ...authentication, clientId: "bad" },
    { ...authentication, tenantId: "common" }, { ...authentication, secret: "not-allowed" }]) {
    const h = harness({ authentication: deployment });
    assert.equal(h.adoAuthenticationConfigured(), false);
    const client = new h.AdoClient(configuration(authentication));
    for (const method of ["signIn", "validate", "create"]) {
      await assert.rejects(() => client[method](draft),
        error => !error.uncertain && /administrator|deployment/i.test(error.message));
    }
    assert.equal(h.calls.loads, 0);
    assert.equal(h.calls.requests.length, 0);
  }
});

test("ADO Vite registration selection is deployment-owned, default-off and ignored by local serving", async () => {
  const { resolveConfig } = await import("vite");
  const keys = ["VITE_ADO_TENANT_ID", "VITE_ADO_CLIENT_ID"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const select = async (tenantId, clientId, command = "build", mode = "production") => {
    process.env.VITE_ADO_TENANT_ID = tenantId;
    process.env.VITE_ADO_CLIENT_ID = clientId;
    const config = await resolveConfig({ mode }, command);
    assert.equal(config.define.__SDS_LOCAL_ADO__, JSON.stringify(command === "serve" && mode === "ado"));
    assert.equal(config.plugins.some(plugin => plugin.name === "secure-design-studio-local-ado"),
      command === "serve" && mode === "ado");
    if (command === "serve") assert.equal(config.define.__PS_TOKEN_ENDPOINT__, '""');
    return JSON.parse(config.define.__SDS_ADO_AUTH__);
  };
  try {
    assert.equal(await select("", ""), null);
    assert.deepEqual(await select(authentication.tenantId, authentication.clientId), authentication);
    assert.deepEqual(await select(` ${authentication.tenantId.toUpperCase()} `, ` ${authentication.clientId} `),
      authentication);
    for (const [tenantId, clientId] of [
      [authentication.tenantId, ""], ["", authentication.clientId],
      ["common", authentication.clientId], [authentication.tenantId, "not-a-client"],
    ]) {
      await assert.rejects(() => select(tenantId, clientId), /administrator/);
      assert.equal(await select(tenantId, clientId, "serve"), null,
        "Local mode never consumes deployment authentication, including invalid values");
    }
    assert.equal(await select(authentication.tenantId, authentication.clientId, "serve"), null);
    assert.deepEqual(await select(authentication.tenantId, authentication.clientId, "serve", "ado"), authentication);
    await assert.rejects(() => select("", "", "serve", "ado"), /VITE_ADO_TENANT_ID.*VITE_ADO_CLIENT_ID/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("ADO uses memory-only delegated authorization and exact validate/create requests", async () => {
  const h = harness();
  const client = new h.AdoClient(configuration());
  await client.signIn();
  assert.equal(h.calls.initialize, 1);
  assert.equal(h.calls.settings[0].cache.cacheLocation, "memoryStorage");
  assert.equal(h.calls.settings[0].auth.authority,
    "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111");
  assert.equal(h.calls.settings[0].auth.redirectUri, "https://studio.example/app/index.html");
  assert.equal(h.calls.settings[0].auth.originCheck, true);
  assert.equal(h.calls.settings[0].system.enableLegacyPolling, true);
  const scopes = ["499b84ac-1321-427f-aa17-267ca6975798/user_impersonation"];
  assert.deepEqual(h.calls.popups, [{ scopes }]);
  await client.validate(draft);
  assert.deepEqual(await client.create(draft), {
    id: 42, url: "https://dev.azure.com/example/Synthetic%20Project/_workitems/edit/42",
  });
  assert.equal(h.calls.popups.length, 1);
  assert.equal(h.calls.silent.length, 2);
  for (const request of h.calls.silent) assert.deepEqual(request.scopes, scopes);
  assert.deepEqual(h.calls.requests.map(call => call.url), ["/api/ado-work-items", "/api/ado-work-items"]);
  for (const [index, { init }] of h.calls.requests.entries()) {
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, {
      Authorization: "Bearer synthetic-token-never-log", "Content-Type": "application/json",
    });
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(init.body), { configuration: configuration(), draft, validateOnly: index === 0 });
  }
});

test("ADO optional description-field mapping preserves legacy shape and reaches the relay", async () => {
  const h = harness();
  const legacy = configuration();
  assert.deepEqual(h.normalizeAdoConfiguration(legacy), legacy);
  assert.equal(Object.hasOwn(h.normalizeAdoConfiguration(legacy), "descriptionField"), false);
  assert.equal(contract.adoPatch(draft, legacy)[1].path, "/fields/System.Description");
  for (const descriptionField of [
    "System.Description", "Microsoft.VSTS.TCM.ReproSteps", "Custom.SecurityDescription", "Custom.Description",
  ]) {
    const config = configuration({ descriptionField });
    const bugDraft = { ...draft, severity: "3 - Medium" };
    const client = new h.AdoClient(config);
    await client.signIn();
    await client.validate(bugDraft);
    await client.create(bugDraft);
    assert.deepEqual(JSON.parse(h.calls.requests.at(-1).init.body).configuration, config);
    const patch = contract.adoPatch(bugDraft, config);
    assert.equal(patch.filter(operation => operation.path.toLowerCase() === `/fields/${descriptionField}`.toLowerCase()).length, 1);
    assert.equal(patch[1].path, `/fields/${descriptionField}`);
    assert.equal(patch[1].value, "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;<br>Line two");
    assert.equal(h.destinationKey(config), h.destinationKey(configuration({ workItemType: "Bug" })));
  }
  for (const descriptionField of [
    "", null, 3, "System.Title", "System.AreaPath", "System.History", "Custom.CreatedBy",
    "Microsoft.VSTS.Common.ClosedDate", "Custom.Rev", "Custom.Links", "/fields/Custom.Body",
    "Custom.Body/relations", "Custom.Body~1Path", "Custom.<script>", "Other.Description",
    "Custom." + "x".repeat(129),
  ]) {
    assert.throws(() => h.normalizeAdoConfiguration(configuration({ descriptionField })), h.AdoRequestError);
  }
  for (const [descriptionField, override] of [
    ["Microsoft.VSTS.TCM.ReproSteps", "microsoft.vsts.tcm.reprosteps"],
    ["Custom.SecurityDescription", "CUSTOM.securitydescription"],
    ["System.Description", "system.description"],
  ]) {
    const config = configuration({ descriptionField, defaults: { [override]: "overwrite authored description" } });
    assert.throws(() => h.normalizeAdoConfiguration(config), h.AdoRequestError);
    assert.throws(() => contract.adoPatch(draft, config), h.AdoRequestError);
  }
});

test("ADO destination variables replace inventory/reviewer fields without confusing service and team IDs", () => {
  const inventoryId = "33333333-3333-4333-8333-333333333333";
  const defaults = {
    "system.tags": "Security; ServiceOID:old-service; DataSource:SecureDesignStudio; SERVICEoid:another-service",
    "custom.securityreviewer": "old-reviewer@example.com",
    "Custom.TeamID": "44444444-4444-4444-8444-444444444444",
    "System.AssignedTo": "owner@example.com",
    "microsoft.vsts.common.severity": "4 - Low",
  };
  const config = configuration({ workItemType: "Bug", inventoryId, reviewer: "reviewer@example.com", defaults });
  const before = structuredClone(config);
  const fields = Object.fromEntries(contract.adoPatch({ ...draft, severity: "2 - High" }, config)
    .map(operation => [operation.path, operation.value]));
  assert.equal(fields["/fields/System.Tags"], `Security; DataSource:SecureDesignStudio; ServiceOID:${inventoryId}`);
  assert.equal(fields["/fields/Custom.SecurityReviewer"], config.reviewer);
  assert.equal(fields["/fields/Custom.TeamID"], defaults["Custom.TeamID"]);
  assert.equal(fields["/fields/System.AssignedTo"], defaults["System.AssignedTo"]);
  assert.equal(fields["/fields/Microsoft.VSTS.Common.Severity"], "2 - High");
  assert.equal(Object.keys(fields).filter(key => /securityreviewer$/i.test(key)).length, 1);
  assert.equal(Object.keys(fields).filter(key => /severity$/i.test(key)).length, 1);
  assert.deepEqual(config, before);
  const cleared = { ...config }; delete cleared.inventoryId; delete cleared.reviewer;
  const restored = Object.fromEntries(contract.adoPatch({ ...draft, severity: "1 - Critical" }, cleared)
    .map(operation => [operation.path.toLowerCase(), operation.value]));
  assert.equal(restored["/fields/system.tags"], defaults["system.tags"]);
  assert.equal(restored["/fields/custom.securityreviewer"], defaults["custom.securityreviewer"]);
  const minimal = configuration({ inventoryId, reviewer: config.reviewer, defaults: {} });
  assert.equal(contract.adoPatch(draft, minimal).find(op => op.path === "/fields/System.Tags").value, `ServiceOID:${inventoryId}`);
  for (const changes of [
    { inventoryId: "" }, { inventoryId: null }, { inventoryId: "not-a-guid" },
    { reviewer: "" }, { reviewer: null }, { reviewer: "Display Name" }, { reviewer: "a@example.com; b@example.com" },
    { inventoryId, defaults: { "System.Tags": false } },
    { descriptionField: "Custom.SecurityReviewer" }, { descriptionField: "Microsoft.VSTS.Common.Severity" },
  ]) assert.throws(() => contract.normalizeAdoConfiguration(configuration(changes)), contract.AdoRequestError);
  assert.throws(() => contract.normalizeAdoConfiguration(configuration({ inventoryId: "not-a-guid" })),
    error => error.message === "Inventory ID must be a valid GUID.");
});

test("ADO Bug and Task severity is explicit per item, never inferred from old template defaults", async () => {
  const h = harness();
  const config = configuration({ workItemType: "Bug", defaults: { "Microsoft.VSTS.Common.Severity": "3 - Medium" } });
  const client = new h.AdoClient(config);
  for (const method of ["validate", "create"]) {
    for (const workItemType of ["Bug", "Task"]) {
      await assert.rejects(() => client[method]({ ...draft, workItemType, severity: undefined }), /Choose a severity.*Bug or Task/);
    }
  }
  assert.equal(h.calls.loads, 0);
  assert.equal(h.calls.requests.length, 0);
  for (const severity of contract.WORK_ITEM_SEVERITIES) {
    const patch = contract.adoPatch({ ...draft, severity }, config);
    assert.equal(patch.find(op => op.path === "/fields/Microsoft.VSTS.Common.Severity").value, severity);
  }
  for (const severity of [null, "", 2, "High", "5 - Unknown", {}, []]) {
    assert.throws(() => contract.adoPatch({ ...draft, severity }, config), /severity/);
  }
  assert.equal(contract.adoPatch(draft, configuration({ defaults: config.defaults }))
    .find(op => /severity$/i.test(op.path)).value, draft.severity);
  await client.signIn();
  for (const severity of ["1 - Critical", "4 - Low"]) await client.create({ ...draft, severity });
  assert.deepEqual(h.calls.requests.map(call => JSON.parse(call.init.body).draft.severity), ["1 - Critical", "4 - Low"]);
});

test("ADO local, file, insecure, loopback and non-main-window guards prevent authentication", async () => {
  for (const options of [
    { local: true }, { href: "file:///C:/synthetic/index.html" },
    { href: "http://studio.example/" }, { href: "https://localhost/" },
    { href: "https://127.0.0.1/" }, { href: "https://[::1]/" },
  ]) {
    const h = harness(options);
    const client = new h.AdoClient(configuration());
    for (const method of ["signIn", "validate", "create"]) {
      await assert.rejects(() => client[method](draft), h.AdoRequestError);
    }
    assert.equal(h.calls.loads, 0);
    assert.equal(h.calls.requests.length, 0);
  }
  for (const options of [{ frame: true }, { opener: {} }]) {
    const h = harness(options);
    await assert.rejects(() => new h.AdoClient(configuration()).signIn(), /hosting main window/);
    assert.equal(h.calls.loads, 0);
  }
});

test("ADO every public method rechecks the current hosting location", async () => {
  const h = harness();
  const client = new h.AdoClient(configuration());
  await client.signIn();
  h.window.location.href = "file:///C:/synthetic/index.html";
  for (const method of ["signIn", "validate", "create"]) {
    await assert.rejects(() => client[method](draft), h.AdoRequestError);
  }
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.popups.length, 1);
});

test("ADO configuration rejects unsafe destinations, identity fields and patch injection", () => {
  const h = harness();
  for (const organizationUrl of [
    "http://dev.azure.com/example", "https://dev.azure.com:443/example",
    "https://user@dev.azure.com/example", "https://dev.azure.com/example?x=y",
    "https://dev.azure.com/example#secret", "https://dev.azure.com/example/project",
    "https://dev.azure.com/../example", "https://evil.example/example",
    "https://dev.azure.com/example%2fother", "https://dev.azure.com/example\\other",
  ]) assert.throws(() => h.normalizeAdoConfiguration(configuration({ organizationUrl })));
  for (const name of [
    "System.Title", "system.description", "System.Id", "System.Rev",
    "System.CreatedBy", "System.ChangedDate", "System.History", "System.TeamProject",
    "Custom.History", "Custom.Links", "/relations/-", "Custom.A/B", "Custom.A~B",
    "System.AuthorizedAs", "__proto__", "Custom.Rev",
    "Microsoft.VSTS.Common.ActivatedBy", "Microsoft.VSTS.Common.ClosedDate",
    "Microsoft.VSTS.Common.StateChangeDate", "Microsoft.VSTS.Common.ResolvedBy",
  ]) assert.throws(() => h.normalizeAdoConfiguration(configuration({ defaults: { [name]: "bad" } })), name);
  for (const value of [null, [], {}, Infinity, NaN, undefined]) {
    assert.throws(() => h.normalizeAdoConfiguration(configuration({ defaults: { "Custom.Value": value } })));
  }
  for (const changes of [
    { defaults: [] }, { defaults: { "Custom.Flag": true, "custom.flag": false } },
    { token: "not-allowed" },
    { project: ".." }, { project: "P\nInjected" },
  ]) assert.throws(() => h.normalizeAdoConfiguration(configuration(changes)));
});

test("ADO malformed drafts fail before authentication or transmission", async () => {
  const h = harness();
  const client = new h.AdoClient(configuration());
  for (const value of [
    { ...draft, title: "" }, { ...draft, title: "  " }, { ...draft, title: "x".repeat(256) },
    { ...draft, title: "title\ninjected" }, { ...draft, description: null },
    { ...draft, workItemType: "../Task" }, { ...draft, workItemType: undefined },
    { ...draft, weaknessType: null }, { ...draft, weaknessType: 3 },
    { ...draft, weaknessType: "not\nsingle line" }, { ...draft, severity: undefined },
    { ...draft, operations: [] }, null,
  ]) {
    await assert.rejects(() => client.validate(value), h.AdoRequestError);
    await assert.rejects(() => client.create(value), error => error.uncertain === false);
  }
  assert.equal(h.calls.loads, 0);
  assert.equal(h.calls.requests.length, 0);
  await client.signIn();
  await client.validate({ ...draft, title: "x".repeat(255), description: "" });
});

test("ADO oversized relay requests fail before authentication and invalid validation receipts fail safely", async () => {
  const h = harness();
  const client = new h.AdoClient(configuration());
  for (const method of ["validate", "create"]) {
    await assert.rejects(() => client[method]({ ...draft, description: "é".repeat(260_000) }),
      error => error instanceof h.AdoRequestError && !error.uncertain && /size limit/.test(error.message));
  }
  assert.equal(h.calls.loads, 0);
  assert.equal(h.calls.requests.length, 0);
  for (const payload of [{}, { validated: "true" }, { id: 42 }]) {
    const invalid = harness({ payload });
    const signedIn = new invalid.AdoClient(configuration());
    await signedIn.signIn();
    await assert.rejects(() => signedIn.validate(draft),
      error => error instanceof invalid.AdoRequestError && !error.uncertain);
    assert.equal(invalid.calls.requests.length, 1);
  }
});

test("ADO validation errors display only bounded safe field names and actionable template guidance", async () => {
  for (const status of [400, 422]) {
    const h = harness({
      status,
      payload: {
        fields: ["Custom.RequiredEvidence", "System.AreaPath", "Microsoft.VSTS.Common.Priority",
          "Custom.RequiredEvidence", "<script>secret-model-value</script>", "Custom.Value=secret",
          "Other.PrivateField", "Custom." + "x".repeat(129)],
        error: "secret service payload <script>secret-model-value</script>",
        typeName: "secret identity response",
      },
    });
    const client = new h.AdoClient(configuration());
    await client.signIn();
    await assert.rejects(() => client.validate(draft), error => {
      assert.equal(error.uncertain, false);
      assert.match(error.message, /Fields: Custom.RequiredEvidence, System.AreaPath, Microsoft\.VSTS\.Common\.Priority\./);
      assert.match(error.message, /Check this Work item's fields and the configuration JSON defaults\./);
      assert.doesNotMatch(error.message, /secret|script|Other|Custom\.Value|typeName|fields"/);
      return true;
    });
    assert.equal(h.calls.requests.length, 1);
    assert.equal(h.calls.popups.length, 1);
  }
  for (const errorBody of [
    "not-json <script>secret</script>", JSON.stringify({ error: "secret payload", message: "Custom.NotFromRelayFields" }),
    JSON.stringify({ fields: ["Custom.RequiredEvidence"], padding: "x".repeat(16_384) }),
  ]) {
    const h = harness({ status: 400, errorBody });
    const client = new h.AdoClient(configuration());
    await client.signIn();
    await assert.rejects(() => client.validate(draft), error => {
      assert.match(error.message, /Check this Work item's fields and the configuration JSON defaults\./);
      assert.doesNotMatch(error.message, /Fields:|secret|script|Custom\./);
      assert.equal(error.uncertain, false);
      return true;
    });
    assert.equal(h.calls.requests.length, 1);
  }
  const many = harness({
    status: 422, payload: { fields: Array.from({ length: 30 }, (_, i) => `Custom.Required${i}`) },
  });
  const client = new many.AdoClient(configuration());
  await client.signIn();
  await assert.rejects(() => client.validate(draft), error =>
    (error.message.match(/Custom\.Required\d+/g)?.length === 10) && !error.uncertain);
});

test("ADO never interacts automatically or leaks provider errors", async () => {
  for (const options of [{}, { silentError: true }, { initializeError: true }]) {
    const h = harness(options);
    const client = new h.AdoClient(configuration());
    if (options.silentError) await client.signIn();
    const count = h.calls.popups.length;
    for (const method of ["validate", "create"]) {
      await assert.rejects(() => client[method](draft), error => {
        assert.ok(error instanceof h.AdoRequestError);
        assert.equal(error.uncertain, false);
        assert.doesNotMatch(error.message, /sensitive|synthetic-token/);
        return true;
      });
    }
    assert.equal(h.calls.popups.length, count);
    assert.equal(h.calls.requests.length, 0);
  }
  const h = harness({ popupError: true });
  await assert.rejects(() => new h.AdoClient(configuration()).signIn(),
    error => !/sensitive/.test(error.message) && !error.uncertain);
});

test("ADO definite rejection, ambiguous HTTP, transport, timeout and invalid success are not retried", async () => {
  const cases = [
    ...[400, 401, 403, 404, 405, 409, 410, 412, 413, 415, 422, 429].map(status => [{ status }, false]),
    ...[408, 500, 502, 503, 504, 202, 204].map(status => [{ status }, true]),
    [{ networkError: true }, true], [{ timeout: true }, true], [{ jsonError: true }, true],
    ...[{}, { id: "42" }, { id: -1 }, { id: 0 }, { id: 1.5 }, { id: 2 ** 53 }]
      .map(payload => [{ payload }, true]),
  ];
  for (const [options, uncertain] of cases) {
    const h = harness(options);
    const client = new h.AdoClient(configuration());
    await client.signIn();
    await assert.rejects(() => client.create(draft), error => {
      assert.ok(error instanceof h.AdoRequestError);
      assert.equal(error.uncertain, uncertain, JSON.stringify(options));
      assert.doesNotMatch(error.message, /sensitive|synthetic-token/);
      return true;
    });
    assert.equal(h.calls.requests.length, 1);
    assert.equal(h.calls.popups.length, 1);
  }
  for (const options of [{ status: 400 }, { status: 401 }, { status: 403 }, { status: 429 },
    { status: 500 }, { networkError: true }, { timeout: true }]) {
    const h = harness(options);
    const client = new h.AdoClient(configuration());
    await client.signIn();
    await assert.rejects(() => client.validate(draft), error => !error.uncertain);
    assert.equal(h.calls.requests.length, 1);
  }
});
