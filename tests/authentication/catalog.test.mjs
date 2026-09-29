import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  UNKNOWN_BEHAVIOR, LEGACY_LABELS, EXPECTED_PROFILES, IDS,
  definition, documentFixture, withFlow, withPolicy, tm7Fixture,
  PACKAGE_METHOD_IDS, historicalAuthenticationDefinitions,
} from "./catalog-fixtures.mjs";

const [auth, types, store, policy, analyzer, diff, tm7Import, tm7Export, report, embedded, links, richText] =
  await Promise.all([
    import("../../src/authentication.ts"),
    import("../../src/types.ts"),
    import("../../src/store.tsx"),
    import("../../src/policy.ts"),
    import("../../src/IssueManager.ts"),
    import("../../src/diff.ts"),
    import("../../src/tm7Import.ts"),
    import("../../src/tm7Export.ts"),
    import("../../src/reportExport.ts"),
    import("../../src/embeddedDoc.ts"),
    import("../../src/urlSafety.ts"),
    import("../../src/components/RichText.tsx"),
  ]);

const originalParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
Object.defineProperty(globalThis, "DOMParser", { configurable: true, writable: true, value: DOMParser });
after(() => {
  if (originalParser) Object.defineProperty(globalThis, "DOMParser", originalParser);
  else delete globalThis.DOMParser;
});

const wrap = (methods) => ({ format: "secure-design-studio-authentication-catalog", version: 1, methods });
const clone = (value) => structuredClone(value);
const sorted = (values) => [...values].sort();
const find = (catalog, id) => {
  const result = catalog.find((entry) => entry.id === id);
  assert.ok(result, `Expected definition ${id}`);
  return result;
};
const analyze = (doc) => new analyzer.IssueManager().analyze(doc);
const edgeIssues = (doc) => analyze(doc).issues.filter((issue) => issue.targetKind === "edge" && issue.targetId === IDS.edge);
const issueKinds = (doc) => edgeIssues(doc).map((issue) => issue.kind);
const reviewIssue = (doc) => edgeIssues(doc).find((issue) => issue.kind === "Edge_authentication_definition_review");
const reportFor = (doc) => report.buildReviewReportHtml({
  doc, scenario: doc.scenarios[0], documentFileName: "catalog-test.tma", appVersion: "test",
});
const installedHistory = [...auth.AUTH_TYPE_DEFS, ...historicalAuthenticationDefinitions()];

describe("authentication catalog: immutable compatibility contracts", () => {
  test("core ships 14 stable IDs, with 13 modern choices and one legacy certificate", () => {
    assert.equal(auth.AUTH_TYPE_DEFS.length, 14);
    assert.deepEqual(sorted(auth.AUTH_TYPES), sorted(Object.keys(EXPECTED_PROFILES).filter(id => !PACKAGE_METHOD_IDS.includes(id))));
    assert.equal(auth.AUTH_TYPE_DEFS.filter((entry) => !entry.legacy).length, 13);
    assert.deepEqual(auth.AUTH_TYPE_DEFS.filter((entry) => entry.legacy).map((entry) => entry.id), ["CertificateAuthentication"]);
    assert.ok(auth.AUTH_TYPE_DEFS.every((entry) => !entry.disabled && !entry.unresolved));
    assert.strictEqual(types.AUTH_TYPE_DEFS, auth.AUTH_TYPE_DEFS);
    assert.strictEqual(types.normalizeAuthenticationValue, auth.normalizeAuthenticationValue);
    assert.equal(types.emptyDocument().version, 1);
    assert.deepEqual(types.emptyDocument().authenticationDefinitions, []);
  });

  for (const [id, expected] of Object.entries(EXPECTED_PROFILES)) {
    test(`${id} preserves its exact explicit behavior profile`, () => {
      const [productionIdentity, audience, constraints, anonymous, managedIdentity] = expected;
      const catalog = PACKAGE_METHOD_IDS.includes(id) ? installedHistory : auth.AUTH_TYPE_DEFS;
      const entry = find(catalog, id);
      assert.ok(entry);
      assert.deepEqual(entry.behavior, { productionIdentity, audience, constraints, anonymous, managedIdentity });
      assert.equal(auth.authTypeLabel(id, catalog), entry.label);
      assert.equal(auth.authTypeShortLabel(id, catalog), entry.shortLabel);
      assert.equal(auth.authTypeDescription(id, catalog), entry.description);
      assert.equal(auth.edgeRequiresProductionIdentity([id], catalog), productionIdentity === "required");
      assert.equal(auth.normalizeAuthenticationValue(id), id);
    });
  }

  test("the original eleven retain five identity contracts when their definitions are installed", () => {
    const expected = [
      "EntraDelegatedUserAccess", "EntraApplicationOnlyAccess", "EntraApplicationOnlyWithCdt",
      "ProtectedForwardedAccessToken", "PopWithProtectedForwardedToken",
    ];
    assert.deepEqual(sorted(Object.keys(LEGACY_LABELS).filter(id => auth.edgeRequiresProductionIdentity([id], installedHistory))), sorted(expected));
    assert.deepEqual(sorted(auth.AUTH_TYPES_REQUIRING_PRODUCTION_IDENTITY), sorted([
      "EntraDelegatedUserAccess", "EntraApplicationOnlyAccess", "EntraOnBehalfOf", "EntraManagedIdentity", "EntraFederatedWorkloadIdentity",
    ]));
    assert.equal(auth.edgeRequiresProductionIdentity(["ApiKey", "EntraOnBehalfOf"]), true);
    assert.equal(auth.edgeRequiresProductionIdentity([]), false);
    assert.equal(auth.edgeRequiresProductionIdentity(undefined), false);
  });

  for (const [id, label] of Object.entries(LEGACY_LABELS)) {
    test(`legacy label resolves to original ${id}, never a newer look-alike`, () => {
      assert.equal(auth.normalizeAuthenticationValue(label), id);
      assert.equal(auth.normalizeAuthenticationValue(label.toUpperCase()), id);
      assert.equal(auth.normalizeAuthenticationValue(label, []), id);
      const doc = withFlow(undefined, { authenticationType: label });
      assert.deepEqual(store.normalizeDoc(doc).edges[0].authenticationTypes, [id]);
    });
  }

  test("core descriptions preserve public protocol distinctions without supplying private descriptions", () => {
    const description = (id) => auth.authTypeDescription(id);
    assert.match(description("SharedAccessSignature"), /user.delegation.*service.*account SAS/i);
    assert.match(description("SharedAccessSignature"), /not assumed.*user delegation/i);
    assert.match(description("SharedKeyAuthorization"), /signs requests.*shared account key/i);
    assert.match(description("SharedKeyAuthorization"), /distinct.*API key/i);
    assert.match(description("ClientCertificateMtls"), /presents.*X\.509 client certificate.*receiving service.*mutual TLS/i);
    assert.match(description("InternalProcessCall"), /same process boundary/i);
    assert.match(description("InternalProcessCall"), /no particular authentication/i);
    assert.match(description("CertificateAuthentication"), /unspecified/i);
    assert.match(description("CertificateAuthentication"), /not assume.*mTLS.*Entra/i);
    for (const id of PACKAGE_METHOD_IDS) assert.equal(description(id), undefined);
  });

  test("shipped definitions and their nested compatibility metadata cannot be mutated", () => {
    assert.ok(Object.isFrozen(auth.AUTH_TYPE_DEFS));
    for (const entry of auth.AUTH_TYPE_DEFS) {
      assert.ok(Object.isFrozen(entry), entry.id);
      assert.ok(Object.isFrozen(entry.behavior), `${entry.id}.behavior must be immutable`);
      assert.ok(Object.isFrozen(entry.aliases), `${entry.id}.aliases must be immutable`);
    }
    assert.ok(Object.isFrozen(auth.UNKNOWN_AUTH_BEHAVIOR));
  });
});

describe("authentication catalog: strict atomic interchange", () => {
  test("exports only the current wrapper and losslessly reparses full definitions", () => {
    const methods = auth.validateAuthenticationDefinitions([...auth.AUTH_TYPE_DEFS, definition()]);
    const json = auth.exportAuthenticationCatalog(methods);
    assert.deepEqual(JSON.parse(json), wrap(methods));
    assert.deepEqual(auth.parseAuthenticationCatalog(JSON.parse(json)), methods);
    assert.equal(auth.AUTHENTICATION_STORAGE_KEY, "secure-design-studio:authentication-library:v1");
    assert.deepEqual(auth.parseAuthenticationCatalog(wrap([])), []);
  });

  test("omitted custom behavior defaults to unknown rather than label-based inference", () => {
    const raw = { id: "EntraManagedIdentityPretend", label: "Definitely secure managed identity", description: "Claims mTLS and delegated user credentials." };
    const [entry] = auth.parseAuthenticationCatalog(wrap([raw]));
    assert.deepEqual(entry.behavior, UNKNOWN_BEHAVIOR);
    assert.equal(entry.shortLabel, raw.label.slice(0, 20));
    assert.equal(entry.disabled, false);
    assert.equal(entry.legacy, false);
    assert.deepEqual(entry.aliases, []);
    assert.equal(auth.edgeRequiresProductionIdentity([entry.id], [entry]), false);
  });

  test("parsing clones nested caller-owned metadata", () => {
    const raw = definition();
    const [entry] = auth.parseAuthenticationCatalog(wrap([raw]));
    raw.behavior.anonymous = true;
    raw.aliases.push("mutation");
    raw.label = "Changed input";
    assert.deepEqual(entry, definition());
  });

  const invalidWrappers = [
    ["null wrapper", null], ["array wrapper", []], ["bare methods", [definition()]],
    ["wrong format", { ...wrap([]), format: "privsec-authentication-catalog" }],
    ["string version", { ...wrap([]), version: "1" }],
    ["unsupported version", { ...wrap([]), version: 2 }],
    ["extra wrapper key", { ...wrap([]), ignored: true }],
    ["missing methods", { format: "secure-design-studio-authentication-catalog", version: 1 }],
    ["null methods", wrap(null)], ["object methods", wrap({})],
  ];
  for (const [name, value] of invalidWrappers) {
    test(`rejects ${name}`, () => assert.throws(() => auth.parseAuthenticationCatalog(value)));
  }

  const invalidDefinitions = [
    ["null definition", null], ["array definition", []],
    ["invalid ID", definition({ id: "starts with space" })],
    ["blank method", definition({ label: " \t\n" })],
    ["oversized method", definition({ label: "x".repeat(81) })],
    ["blank description", definition({ description: " " })],
    ["oversized description", definition({ description: "x".repeat(4001) })],
    ["control character", definition({ description: "bad\u0000text" })],
    ["empty short label", definition({ shortLabel: "" })],
    ["oversized short label", definition({ shortLabel: "x".repeat(25) })],
    ["numeric disabled", definition({ disabled: 1 })],
    ["string legacy", definition({ legacy: "false" })],
    ["unknown behavior key", definition({ behavior: { ...UNKNOWN_BEHAVIOR, secure: true } })],
    ["partial behavior", definition({ behavior: { productionIdentity: "required" } })],
    ["null behavior", definition({ behavior: null })],
    ["array behavior", definition({ behavior: [] })],
    ["unsupported identity requirement", definition({ behavior: { ...UNKNOWN_BEHAVIOR, productionIdentity: "never" } })],
    ["nonboolean audience", definition({ behavior: { ...UNKNOWN_BEHAVIOR, audience: "false" } })],
    ["nonboolean constraints", definition({ behavior: { ...UNKNOWN_BEHAVIOR, constraints: 0 } })],
    ["nonboolean anonymous", definition({ behavior: { ...UNKNOWN_BEHAVIOR, anonymous: null } })],
    ["nonboolean managed identity", definition({ behavior: { ...UNKNOWN_BEHAVIOR, managedIdentity: 1 } })],
    ["managed identity without required PI", definition({ behavior: { ...UNKNOWN_BEHAVIOR, managedIdentity: true } })],
    ["custom legacy flag", definition({ legacy: true })],
    ["custom compatibility aliases", definition({ aliases: ["Other mechanism"] })],
    ["nonarray aliases", definition({ aliases: "alias" })],
    ["oversized aliases array", definition({ aliases: Array(21).fill("alias") })],
    ["blank alias", definition({ aliases: [" "] })],
    ["oversized alias", definition({ aliases: ["x".repeat(161)] })],
    ["persisted unresolved sentinel", definition({ unresolved: true })],
    ["unsupported metadata", definition({ trusted: true })],
  ];
  for (const [name, invalid] of invalidDefinitions) {
    test(`rejects ${name} without accepting the preceding valid record`, () => {
      const input = wrap([definition({ id: "ValidFirst", label: "Valid first" }), invalid]);
      const before = clone(input);
      assert.throws(() => auth.parseAuthenticationCatalog(input));
      assert.deepEqual(input, before);
    });
  }

  test("accepts documented text and ID maximum lengths", () => {
    const [entry] = auth.validateAuthenticationDefinitions([definition({
      id: "A".repeat(128), label: "L".repeat(80), description: "D".repeat(4000), shortLabel: "S".repeat(24),
    })]);
    assert.equal(entry.id.length, 128);
    assert.equal(entry.label.length, 80);
    assert.equal(entry.description.length, 4000);
    assert.equal(entry.shortLabel.length, 24);
  });

  test("enforces the 2000-method boundary without mutating oversized input", () => {
    const methods = Array.from({ length: 2000 }, (_, index) => definition({ id: `Method${index}`, label: `Method ${index}` }));
    assert.equal(auth.validateAuthenticationDefinitions(methods).length, 2000);
    methods.push(definition({ id: "Method2000", label: "Method 2000" }));
    assert.throws(() => auth.validateAuthenticationDefinitions(methods), /2000/);
    assert.equal(methods.length, 2001);
  });

  test("validates safe branded IDs and rejects all prototype and malformed names", () => {
    for (const value of ["A", "Custom.v2-proof_1", "A".repeat(128)]) assert.equal(auth.isAuthenticationType(value), true, value);
    const forbidden = ["__proto__", "prototype", ...Object.getOwnPropertyNames(Object.prototype)];
    for (const value of forbidden.flatMap((id) => [id, id.toUpperCase()])) {
      assert.equal(auth.isAuthenticationType(value), false, value);
      assert.throws(() => auth.validateAuthenticationDefinitions([definition({ id: value })]), /ID|\.id/);
    }
    for (const value of ["", " ", "_first", "9first", "has/slash", "has:colon", "<script>", "éclair", "x\n", "A".repeat(129), 1, null, undefined, {}, []]) {
      assert.equal(auth.isAuthenticationType(value), false, JSON.stringify(value));
    }
  });

  test("rejects case-insensitive duplicate IDs and ambiguous labels atomically", () => {
    for (const other of [
      definition({ label: "Another label" }),
      definition({ id: "contosoproofv1", label: "Another label" }),
      definition({ id: "AnotherProof", label: "CONTOSO PROOF" }),
      definition({ id: "AnotherProof", label: "ContosoProofV1" }),
    ]) {
      assert.throws(() => auth.validateAuthenticationDefinitions([definition(), other]), /Duplicate|ambiguous/);
    }
    assert.throws(() => auth.validateAuthenticationDefinitions([definition({ id: "apikey", label: "Not an API key" })]), /protected/);
  });

  test("custom names cannot impersonate shipped IDs, labels or compatibility aliases", () => {
    for (const label of ["EntraManagedIdentity", "Managed identity", LEGACY_LABELS.EntraDelegatedUserAccess]) {
      assert.throws(() => auth.validateAuthenticationDefinitions([definition({ label })]), /built-in|ambiguous/);
    }
  });

  test("built-in presentation and availability can change but compatibility metadata cannot", () => {
    const builtin = clone(auth.builtInAuthentication("EntraDelegatedUserAccess"));
    const edited = { ...builtin, label: "Reviewed app user", description: "Updated owner documentation.", shortLabel: "Reviewed", disabled: true };
    assert.deepEqual(auth.validateAuthenticationDefinitions([edited]), [edited]);
    for (const changed of [
      { ...builtin, id: "entradelegateduseraccess" },
      { ...builtin, behavior: { ...builtin.behavior, productionIdentity: "optional" } },
      { ...builtin, behavior: { ...builtin.behavior, audience: false } },
      { ...builtin, legacy: true },
      { ...builtin, aliases: [] },
    ]) assert.throws(() => auth.validateAuthenticationDefinitions([changed]), /protected/);
    assert.deepEqual(auth.builtInAuthentication(builtin.id), builtin);
  });
});

describe("authentication catalog: saved dependencies and library resolution", () => {
  test("explicit import replaces matching IDs and adds new IDs without changing either input", () => {
    const current = [...auth.AUTH_TYPE_DEFS, definition()];
    const imported = [definition({ label: "Renamed proof", description: "Reviewed description." }), definition({ id: "NewProof", label: "New proof" })];
    const before = clone(current);
    const merged = auth.mergeAuthenticationLibrary(current, imported);
    assert.equal(merged.length, current.length + 1);
    assert.deepEqual(find(merged, "ContosoProofV1"), imported[0]);
    assert.deepEqual(find(merged, "NewProof"), imported[1]);
    assert.deepEqual(current, before);
    assert.equal(imported.length, 2);
  });

  test("renaming a method never rewrites its stable edge or node-policy references", () => {
    const original = definition();
    const renamed = definition({ label: "Proof renamed", description: "A new description." });
    const doc = withPolicy([{ id: original.id, status: "Allowed" }], [original.id]);
    doc.authenticationDefinitions = [renamed];
    const normalized = store.normalizeDoc(JSON.parse(JSON.stringify(doc)));
    assert.deepEqual(normalized.edges[0].authenticationTypes, [original.id]);
    assert.deepEqual(find(normalized.nodeTypes, "nt_test").definition.allowedAuthMethods, [{ id: original.id, status: "Allowed" }]);
    assert.equal(auth.authTypeLabel(original.id, auth.authenticationCatalogFor(normalized)), renamed.label);
    assert.equal(auth.normalizeAuthenticationValue(renamed.label, [renamed]), original.id);
  });

  test("a cross-library naming collision rejects the whole merge", () => {
    const current = [...auth.AUTH_TYPE_DEFS, definition()];
    const before = clone(current);
    assert.throws(() => auth.mergeAuthenticationLibrary(current, [
      definition({ id: "NewProof", label: "New proof" }),
      definition({ id: "Collision", label: "Contoso proof" }),
    ]), /ambiguous/);
    assert.deepEqual(current, before);
  });

  test("duplicate import IDs are rejected rather than last-write silently winning", () => {
    const current = [...auth.AUTH_TYPE_DEFS, definition()];
    assert.throws(() => auth.mergeAuthenticationLibrary(current, [
      definition({ label: "First competing import" }), definition({ label: "Second competing import" }),
    ]), /Duplicate/);
  });

  test("saved definitions override different local definitions and produce a conflict warning", () => {
    const saved = definition({ label: "Saved proof" });
    const local = definition({ label: "Local proof" });
    const doc = withFlow([saved.id]);
    doc.authenticationDefinitions = [saved];
    const library = [...auth.AUTH_TYPE_DEFS, local];
    const before = clone({ doc, library });
    assert.deepEqual(find(auth.authenticationCatalogFor(doc, library), saved.id), saved);
    assert.match(auth.authenticationWarnings(doc, library).join("\n"), /saved definition differs.*keeps its saved definition/i);
    assert.deepEqual(auth.withAuthenticationDefinitions(doc, library).authenticationDefinitions, [saved]);
    assert.deepEqual({ doc, library }, before);
  });

  test("a missing custom dependency stays unresolved even when this browser has a same-ID library entry", () => {
    const local = definition({ behavior: { ...UNKNOWN_BEHAVIOR, productionIdentity: "required", audience: true } });
    const doc = withFlow([local.id], { audience: "saved-audience", constraints: "saved-contract", productionIdentity: { kind: "ManagedIdentity" } });
    const before = clone(doc);
    const catalog = auth.authenticationCatalogFor(doc, [...auth.AUTH_TYPE_DEFS, local]);
    const unresolved = find(catalog, local.id);
    assert.equal(unresolved.unresolved, true);
    assert.equal(unresolved.disabled, true);
    assert.equal(unresolved.label, `${local.id} (unresolved)`);
    assert.deepEqual(unresolved.behavior, UNKNOWN_BEHAVIOR);
    assert.deepEqual(auth.withAuthenticationDefinitions(doc, catalog).authenticationDefinitions, []);
    assert.match(auth.authenticationWarnings(doc, [local]).join("\n"), /definition missing.*explicitly use/i);
    assert.deepEqual(doc, before);
  });

  test("references include node-policy-only dependencies, omit wildcard, and deduplicate edges", () => {
    const doc = withPolicy([{ id: "PolicyProof", status: "Deprecated" }, { id: "*", status: "Allowed" }], ["ContosoProofV1", "ContosoProofV1"]);
    assert.deepEqual(sorted(auth.authenticationReferences(doc)), ["ContosoProofV1", "PolicyProof"]);
    const catalog = auth.authenticationCatalogFor(doc);
    assert.equal(find(catalog, "PolicyProof").unresolved, true);
    assert.equal(find(catalog, "ContosoProofV1").unresolved, true);
    assert.equal(catalog.some((entry) => entry.id === "*"), false);
  });

  test("saving includes all resolved referenced definitions but excludes unreferenced local methods", () => {
    const doc = withPolicy([{ id: "PolicyProof", status: "Allowed" }], ["EntraManagedIdentity", "ContosoProofV1"]);
    const custom = definition();
    const policyOnly = definition({ id: "PolicyProof", label: "Policy-only proof" });
    const unused = definition({ id: "UnusedProof", label: "Unused proof" });
    const saved = auth.withAuthenticationDefinitions(doc, [...auth.AUTH_TYPE_DEFS, custom, policyOnly, unused]);
    assert.deepEqual(sorted(saved.authenticationDefinitions.map((entry) => entry.id)), ["ContosoProofV1", "EntraManagedIdentity", "PolicyProof"]);
    assert.deepEqual(saved.edges, doc.edges);
    assert.deepEqual(saved.nodeTypes, doc.nodeTypes);
    assert.deepEqual(doc.authenticationDefinitions, []);
    assert.deepEqual(auth.withAuthenticationDefinitions(saved, []).authenticationDefinitions, saved.authenticationDefinitions);
  });

  test("document-only and identical definitions produce distinct accurate warning states", () => {
    const doc = withFlow(["ContosoProofV1"]);
    doc.authenticationDefinitions = [definition()];
    assert.match(auth.authenticationWarnings(doc, []).join("\n"), /diagram only/i);
    const identical = auth.authenticationWarnings(doc, [definition()]);
    assert.deepEqual(identical, []);
    const modern = auth.authenticationWarnings(withFlow(["ApiKey"]), auth.AUTH_TYPE_DEFS);
    assert.deepEqual(modern, []);
    assert.deepEqual(auth.authenticationWarnings(withFlow(["EntraApplicationOnlyAccess"]), auth.AUTH_TYPE_DEFS), []);
  });

  test("unknown, custom, disabled, legacy and blank selections are not conflated", () => {
    assert.equal(auth.normalizeAuthenticationValue(""), undefined);
    assert.equal(auth.normalizeAuthenticationValue(" \t"), undefined);
    assert.equal(auth.normalizeAuthenticationValue(null), undefined);
    assert.equal(auth.normalizeAuthenticationValue("UnknownSafeID"), "UnknownSafeID");
    assert.equal(auth.authTypeLabel("UnknownSafeID"), "UnknownSafeID (unresolved)");
    assert.equal(auth.authTypeShortLabel("UnknownSafeID"), "Unresolved");
    assert.equal(auth.authTypeDescription("UnknownSafeID"), undefined);
    assert.deepEqual(auth.authBehavior("UnknownSafeID"), UNKNOWN_BEHAVIOR);
    assert.deepEqual(auth.authBehavior("CustomAuthentication"), UNKNOWN_BEHAVIOR);
    assert.equal(auth.authTypeLabel("CustomAuthentication"), "Custom method");
    const disabled = definition({ disabled: true });
    const doc = withFlow([disabled.id]);
    doc.authenticationDefinitions = [disabled];
    const effective = find(auth.authenticationCatalogFor(doc), disabled.id);
    assert.equal(effective.disabled, true);
    assert.equal(effective.unresolved, undefined);
    assert.equal(effective.legacy, false);
    assert.equal(auth.builtInAuthentication("CertificateAuthentication").legacy, true);
    assert.equal(auth.authBehavior("CertificateAuthentication").managedIdentity, false);
  });
});

describe("authentication catalog: actual native normalization", () => {
  test("full definition metadata, legacy multi-auth selections and production identity survive native JSON", () => {
    const custom = definition({
      disabled: true,
      behavior: { productionIdentity: "required", audience: true, constraints: true, anonymous: false, managedIdentity: false },
    });
    const doc = withFlow([
      LEGACY_LABELS.EntraDelegatedUserAccess, custom.id, "MissingProof", LEGACY_LABELS.CertificateAuthentication, custom.id,
    ], {
      productionIdentity: { kind: "AppId", appId: `  ${IDS.app.toUpperCase()}  `, tenant: "FirstParty" },
      audience: "api://fixture", constraints: "owner-reviewed constraint", problem: true,
    });
    doc.authenticationDefinitions = [custom];
    const native = { format: "secure-design-studio-diagram", version: 2, doc, view: { activeScenarioId: IDS.scenario } };
    const reopened = store.normalizeDoc(JSON.parse(JSON.stringify(native)).doc);
    assert.deepEqual(reopened.authenticationDefinitions, [custom]);
    assert.deepEqual(reopened.edges[0].authenticationTypes, ["EntraDelegatedUserAccess", custom.id, "MissingProof", "CertificateAuthentication"]);
    assert.deepEqual(reopened.edges[0].productionIdentity, doc.edges[0].productionIdentity);
    assert.equal(reopened.edges[0].audience, "api://fixture");
    assert.equal(reopened.edges[0].constraints, "owner-reviewed constraint");
    assert.equal(reopened.edges[0].problem, true);
    assert.equal(find(auth.authenticationCatalogFor(reopened), "MissingProof").unresolved, true);
    assert.deepEqual(reopened.scenarios[0], doc.scenarios[0]);
    assert.deepEqual(store.normalizeDoc(JSON.parse(JSON.stringify(reopened))), reopened);
  });

  test("modern array wins over legacy singular field without collapsing a legacy multi-selection", () => {
    const normalized = store.normalizeDoc(withFlow(["ApiKey", "OAuthAccessToken", "ApiKey"], { authenticationType: LEGACY_LABELS.AnonymousAccess }));
    assert.deepEqual(normalized.edges[0].authenticationTypes, ["ApiKey", "OAuthAccessToken"]);
    assert.ok(issueKinds(normalized).includes("Edge_multiple_auth_methods"));
    assert.deepEqual(store.normalizeDoc(withFlow([], { authenticationType: "ApiKey" })).edges[0].authenticationTypes, undefined);
  });

  test("all safe unknown IDs and their non-inferred metadata are preserved", () => {
    const doc = withFlow(["Contoso.Unknown-Auth_v2"], {
      audience: "legacy audience", constraints: "legacy constraints",
      productionIdentity: { kind: "AppId", appId: "invalid but recoverable", tenant: "Customer" },
    });
    const normalized = store.normalizeDoc(doc);
    assert.deepEqual(normalized.edges[0].authenticationTypes, doc.edges[0].authenticationTypes);
    assert.deepEqual(normalized.edges[0].productionIdentity, doc.edges[0].productionIdentity);
    assert.equal(normalized.edges[0].audience, "legacy audience");
    assert.equal(normalized.edges[0].constraints, "legacy constraints");
    assert.deepEqual(normalized.authenticationDefinitions, []);
    assert.match(reviewIssue(normalized).description, /unresolved definition/);
    assert.equal(issueKinds(normalized).includes("Edge_invalid_production_identity"), false);
  });

  for (const selected of [undefined, [], ["ApiKey"], ["EntraApplicationOnlyWithForwardedUserContext"], ["CertificateAuthentication"], ["MissingProof"], ["EntraManagedIdentity"]]) {
    test(`preserves valid production identity even when selected auth is ${JSON.stringify(selected)}`, () => {
      for (const tenant of ["Customer", "ME", "FirstParty", "Other"]) {
        const pi = { kind: "AppId", appId: IDS.app, tenant };
        assert.deepEqual(store.normalizeDoc(withFlow(selected, { productionIdentity: pi })).edges[0].productionIdentity, pi);
      }
      const pi = { kind: "ManagedIdentity" };
      assert.deepEqual(store.normalizeDoc(withFlow(selected, { productionIdentity: pi })).edges[0].productionIdentity, pi);
    });
  }

  test("legacy production identity migration retains recoverable values conservatively", () => {
    const cases = [
      [{ appId: " not-a-guid ", tenant: "UnknownTenant" }, { kind: "AppId", appId: " not-a-guid ", tenant: "UnknownTenant" }],
      [{ name: "legacy-managed-name" }, { kind: "ManagedIdentity" }],
      [{ kind: "ManagedIdentity", name: "legacy-managed-name" }, { kind: "ManagedIdentity" }],
      [{ kind: "AppId", tenant: "ME" }, { kind: "AppId", appId: "", tenant: "ME" }],
      [null, undefined], ["not-an-object", undefined], [{ kind: "Other" }, undefined],
    ];
    for (const [raw, expected] of cases) {
      assert.deepEqual(store.normalizeDoc(withFlow(["ApiKey"], { productionIdentity: raw })).edges[0].productionIdentity, expected);
    }
  });

  test("invalid references and definition packages fail explicitly instead of silently becoming blank", () => {
    for (const value of ["Unknown label with spaces", "__proto__", "constructor", "javascript:proof"]) {
      assert.throws(() => store.normalizeDoc(withFlow([value])), /valid ID|authentication/i);
    }
    const doc = withFlow(["ContosoProofV1"]);
    doc.authenticationDefinitions = [definition(), definition({ id: "Bad ID" })];
    const before = clone(doc);
    assert.throws(() => store.normalizeDoc(doc));
    assert.deepEqual(doc, before);
  });

  test("node-policy-only missing definitions remain named dependencies after normalization", () => {
    const normalized = store.normalizeDoc(withPolicy([{ id: "MissingPolicyProof", status: "Deprecated" }], []));
    assert.deepEqual(find(normalized.nodeTypes, "nt_test").definition.allowedAuthMethods, [{ id: "MissingPolicyProof", status: "Deprecated" }]);
    assert.equal(find(auth.authenticationCatalogFor(normalized), "MissingPolicyProof").unresolved, true);
    assert.deepEqual(normalized.authenticationDefinitions, []);
  });
});

describe("authentication catalog: actual policy and analyzer behavior", () => {
  test("core no longer asserts the curated Key Vault policy", () => {
    assert.equal(types.NODE_TYPE_DEFS.some(def => def.id === "AzureKeyVault"), false);
    assert.ok(types.NODE_TYPE_DEFS.every(def => def.policyStatus === "Unspecified"));
  });

  test("wildcards expand the effective catalog, including custom definitions", () => {
    const doc = withPolicy([{ id: "*", status: "Allowed" }]);
    doc.authenticationDefinitions = [definition()];
    const catalog = auth.authenticationCatalogFor(doc);
    assert.deepEqual(policy.allowedAuthMethodsForNode(doc.nodes[1], doc.nodeTypes, catalog), catalog.map((entry) => entry.id));
    assert.equal(policy.authMethodStatusOnNode(doc.nodes[1], "ContosoProofV1", doc.nodeTypes), "Allowed");
    assert.equal(issueKinds(doc).includes("Edge_auth_not_accepted"), false);
    assert.match(reviewIssue(doc).description, /unverified semantics/);
  });

  test("an exact Deprecated rule overrides wildcard Allowed and uses saved dynamic labels", () => {
    const doc = withPolicy([{ id: "*", status: "Allowed" }, { id: "ContosoProofV1", status: "Deprecated" }]);
    doc.authenticationDefinitions = [definition({ label: "Retired owner proof" })];
    assert.equal(policy.authMethodStatusOnNode(doc.nodes[1], "ContosoProofV1", doc.nodeTypes), "Deprecated");
    assert.equal(policy.authMethodStatusOnNode(doc.nodes[1], "ApiKey", doc.nodeTypes), "Allowed");
    const issue = edgeIssues(doc).find((entry) => entry.kind === "Edge_auth_not_accepted");
    assert.ok(issue);
    assert.match(issue.description, /deprecated: Retired owner proof/);
    assert.equal(issue.resolutionLink, undefined, "Core analysis has no organization-specific remediation destination");
  });

  test("exact Allowed overrides wildcard Deprecated, and absent exact rules are not inferred from the library", () => {
    const doc = withPolicy([{ id: "*", status: "Deprecated" }, { id: "ContosoProofV1", status: "Allowed" }]);
    doc.authenticationDefinitions = [definition()];
    assert.equal(policy.authMethodStatusOnNode(doc.nodes[1], "ContosoProofV1", doc.nodeTypes), "Allowed");
    assert.equal(policy.authMethodStatusOnNode(doc.nodes[1], "ApiKey", doc.nodeTypes), "Deprecated");
    assert.equal(issueKinds(doc).includes("Edge_auth_not_accepted"), false);
    doc.nodeTypes[0].definition.allowedAuthMethods = [{ id: "ApiKey", status: "Allowed" }];
    assert.deepEqual(policy.allowedAuthMethodsForNode(doc.nodes[1], doc.nodeTypes, auth.authenticationCatalogFor(doc)), ["ApiKey"]);
    const issue = edgeIssues(doc).find((entry) => entry.kind === "Edge_auth_not_accepted");
    assert.match(issue.description, /not accepted: Contoso proof/);
    assert.equal(issue.resolutionLink, undefined);
  });

  test("unknown and explicitly unspecified target policies are not false prohibitions", () => {
    const unknown = withFlow(["ApiKey"]);
    assert.equal(issueKinds(unknown).includes("Edge_auth_not_accepted"), false);
    const unspecified = withPolicy([], ["ApiKey"], { policyStatus: "Unspecified" });
    assert.equal(policy.authMethodStatusOnNode(unspecified.nodes[1], "ApiKey", unspecified.nodeTypes), undefined);
    assert.deepEqual(policy.allowedAuthMethodsForNode(unspecified.nodes[1], unspecified.nodeTypes), auth.AUTH_TYPES);
    assert.equal(issueKinds(unspecified).includes("Edge_auth_not_accepted"), false);
  });

  test("built-in Custom and unresolved/legacy methods require review, unlike blank and explicit anonymous", () => {
    assert.match(reviewIssue(withFlow(["CustomAuthentication"])).description, /unverified semantics/);
    assert.match(reviewIssue(withFlow(["MissingProof"])).description, /unresolved definition/);
    assert.match(reviewIssue(withFlow(["CertificateAuthentication"])).description, /certificate role needs explicit classification/);
    for (const selected of [undefined, [], ["AnonymousAccess"], ["InternalProcessCall"], ["ApiKey"], ["ClientCertificateMtls"]]) {
      assert.equal(reviewIssue(withFlow(selected)), undefined, JSON.stringify(selected));
    }
  });

  test("custom explicit behavior controls required fields but never establishes trusted semantics or target acceptance", () => {
    const custom = definition({ behavior: { ...UNKNOWN_BEHAVIOR, productionIdentity: "required", audience: true } });
    const doc = withPolicy([{ id: "ApiKey", status: "Allowed" }]);
    doc.authenticationDefinitions = [custom];
    const kinds = issueKinds(doc);
    assert.ok(kinds.includes("Edge_missing_production_identity"));
    assert.ok(kinds.includes("Edge_authentication_definition_review"));
    assert.ok(kinds.includes("Edge_auth_not_accepted"));
    assert.equal(auth.authBehavior(custom.id, auth.authenticationCatalogFor(doc)).audience, true);
  });

  test("renamed descriptions do not change built-in identity requirements or anonymous semantics", () => {
    const entry = { ...clone(auth.builtInAuthentication("ApiKey")), label: "App identity", description: "This description claims Entra, managed identity and anonymous access." };
    const doc = withFlow(["ApiKey"]);
    doc.authenticationDefinitions = [entry];
    assert.equal(auth.edgeRequiresProductionIdentity(["ApiKey"], auth.authenticationCatalogFor(doc)), false);
    assert.equal(auth.authBehavior("ApiKey", auth.authenticationCatalogFor(doc)).anonymous, false);
    assert.equal(issueKinds(doc).includes("Edge_missing_production_identity"), false);
  });

  test("managed-identity/App-ID mismatch is diagnosed without erasing identity or associated fields", () => {
    const pi = { kind: "AppId", appId: IDS.app, tenant: "ME" };
    const doc = store.normalizeDoc(withFlow(["EntraManagedIdentity"], { productionIdentity: pi, audience: "api://fixture", constraints: "retain" }));
    const result = analyze(doc);
    assert.deepEqual(result.edges[0].productionIdentity, pi);
    assert.equal(result.edges[0].audience, "api://fixture");
    assert.equal(result.edges[0].constraints, "retain");
    assert.deepEqual(result.issues.filter((issue) => issue.kind.startsWith("Edge_") && /identity/.test(issue.kind)).map((issue) => issue.kind), ["Edge_managed_identity_mismatch"]);
    assert.equal(issueKinds(withFlow(["EntraManagedIdentity"], { productionIdentity: { kind: "ManagedIdentity" } })).includes("Edge_managed_identity_mismatch"), false);
  });

  test("required identity findings distinguish absent, blank, malformed, and valid App IDs", () => {
    for (const [pi, expected] of [
      [undefined, "Edge_missing_production_identity"],
      [{ kind: "AppId", appId: "  ", tenant: "Other" }, "Edge_missing_production_identity"],
      [{ kind: "AppId", appId: "not-a-guid", tenant: "Other" }, "Edge_invalid_production_identity"],
      [{ kind: "AppId", appId: IDS.app, tenant: "Customer" }, undefined],
      [{ kind: "ManagedIdentity" }, undefined],
    ]) {
      const kinds = issueKinds(withFlow(["EntraApplicationOnlyAccess"], { productionIdentity: pi }))
        .filter((kind) => kind === "Edge_missing_production_identity" || kind === "Edge_invalid_production_identity");
      assert.deepEqual(kinds, expected ? [expected] : []);
    }
  });

  test("rerunning analysis preserves review status, replies and manual issues; resolution removes only obsolete typed findings", () => {
    const first = analyze(withFlow(["MissingProof"]));
    const issue = first.issues.find((entry) => entry.kind === "Edge_authentication_definition_review");
    issue.status = "Resolved";
    issue.replies = [{ id: "r_test", text: "Owner response", createdAt: 123 }];
    const manual = { id: "i_manual", targetKind: "edge", targetId: IDS.edge, scenarioIds: [], title: "Manual", description: "Keep", status: "Active", createdAt: 456, replies: [] };
    first.issues.push(manual);
    const second = analyze(first);
    const retained = second.issues.find((entry) => entry.kind === issue.kind);
    assert.equal(retained.id, issue.id);
    assert.equal(retained.status, "Resolved");
    assert.equal(retained.createdAt, issue.createdAt);
    assert.deepEqual(retained.replies, issue.replies);
    assert.deepEqual(second.issues.find((entry) => entry.id === manual.id), manual);
    second.edges[0].authenticationTypes = ["ApiKey"];
    const third = analyze(second);
    assert.equal(third.issues.some((entry) => entry.kind === issue.kind), false);
    assert.deepEqual(third.issues.find((entry) => entry.id === manual.id), manual);
  });
});

describe("authentication catalog: diff, report, TM7 and standalone interoperability", () => {
  for (const [name, patch] of [
    ["method", { label: "Changed method" }],
    ["description", { description: "Changed description." }],
    ["short label", { shortLabel: "Changed" }],
    ["disabled", { disabled: true }],
    ["explicit behavior", { behavior: { ...UNKNOWN_BEHAVIOR, audience: true } }],
  ]) {
    test(`catalog-only ${name} edit produces one reviewable authentication diff`, () => {
      const prev = documentFixture({ authenticationDefinitions: [definition()] });
      const curr = clone(prev);
      curr.authenticationDefinitions[0] = { ...curr.authenticationDefinitions[0], ...patch };
      const changes = diff.diffDocuments(prev, curr);
      assert.equal(changes.length, 1);
      assert.equal(changes[0].category, "authentication");
      assert.match(changes[0].description, /Changed authentication definition/);
      assert.match(changes[0].description, /ContosoProofV1/);
      assert.equal(changes[0].target, undefined);
      assert.deepEqual(curr.edges, prev.edges);
    });
  }

  test("adding/removing an unused saved definition is visible while catalog order alone is not", () => {
    const before = documentFixture();
    const after = documentFixture({ authenticationDefinitions: [definition()] });
    assert.match(diff.diffDocuments(before, after)[0].description, /Added authentication definition/);
    assert.match(diff.diffDocuments(after, before)[0].description, /Removed authentication definition/);
    const first = documentFixture({ authenticationDefinitions: [definition(), definition({ id: "OtherProof", label: "Other proof" })] });
    const second = clone(first);
    second.authenticationDefinitions.reverse();
    assert.deepEqual(diff.diffDocuments(first, second), []);
  });

  test("auth array order does not cause a diff and flow changes use saved display labels", () => {
    const before = withFlow(["ApiKey", "ContosoProofV1"]);
    before.authenticationDefinitions = [definition({ label: "Saved display proof" })];
    const after = clone(before);
    after.edges[0].authenticationTypes.reverse();
    assert.deepEqual(diff.diffDocuments(before, after), []);
    after.edges[0].authenticationTypes = ["ApiKey"];
    const changes = diff.diffDocuments(before, after);
    assert.ok(changes.some((change) => change.category === "edge" && /Saved display proof/.test(change.description)));
  });

  test("reports render saved dynamic labels and escape hostile text without a browser", () => {
    const label = '<img src=x onerror="boom"> & proof';
    const doc = withFlow(["ContosoProofV1"]);
    doc.authenticationDefinitions = [definition({ label })];
    doc.edges[0].title = '<script>alert("flow")</script>';
    doc.edges[0].audience = '"><svg onload=boom>';
    const html = reportFor(doc);
    assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt; &amp; proof/);
    assert.match(html, /&lt;script&gt;alert\(&quot;flow&quot;\)&lt;\/script&gt;/);
    assert.match(html, /&quot;&gt;&lt;svg onload=boom&gt;/);
    assert.doesNotMatch(html, /<img src=x|<svg onload=|<script>alert/);
    assert.doesNotMatch(html, /ContosoProofV1 \(unresolved\)/);
  });

  test("reports distinguish blank, custom, legacy and missing definitions", () => {
    for (const [selection, expected] of [
      [undefined, "Not specified"],
      [["CustomAuthentication"], "Custom method"],
      [["CertificateAuthentication"], "Certificate authentication (legacy, ambiguous)"],
      [["MissingProof"], "MissingProof (unresolved)"],
    ]) assert.ok(reportFor(withFlow(selection)).includes(`<td>${expected}</td>`), expected);
  });

  for (const [id, label] of Object.entries(LEGACY_LABELS)) {
    test(`TM7 old-label-only import retains original ${id}`, () => {
      const result = tm7Import.parseTm7(tm7Fixture(`7. Imported flow\nAuth: ${label}`));
      assert.equal(result.summary.edgeCount, 1);
      assert.deepEqual(result.doc.edges[0].authenticationTypes, [id]);
      assert.equal(result.doc.edges[0].title, "Imported flow");
      assert.equal(result.doc.scenarios[0].edgeNumbers[IDS.edge], 1);
    });
  }

  test("TM7 retains baseline ordering and sequential numbering for out-of-order legacy labels", () => {
    const earlierId = "66666666-6666-4666-8666-666666666666";
    const later = tm7Fixture(`7. Later flow\nAuth: ${LEGACY_LABELS.EntraApplicationOnlyAccess}`);
    const earlier = tm7Fixture(`2. Earlier flow\nAuth: ${LEGACY_LABELS.SharedKeyAuthorization}`)
      .match(/<Lines>([\s\S]*?)<\/Lines>/)[1].replace(IDS.edge, earlierId);
    const result = tm7Import.parseTm7(later.replace("</Lines>", `${earlier}</Lines>`));
    assert.equal(result.summary.edgeCount, 2);
    assert.deepEqual(result.doc.scenarios[0].edgeIds, [earlierId, IDS.edge]);
    assert.deepEqual(result.doc.scenarios[0].edgeNumbers, { [earlierId]: 1, [IDS.edge]: 2 });
    assert.deepEqual(result.doc.edges.find(edge => edge.id === earlierId).authenticationTypes, ["SharedKeyAuthorization"]);
    assert.deepEqual(result.doc.edges.find(edge => edge.id === IDS.edge).authenticationTypes, ["EntraApplicationOnlyAccess"]);
  });

  test("TM7 old labels retain multiple methods rather than silently choosing one", () => {
    const result = tm7Import.parseTm7(tm7Fixture(`2. Legacy multi\nAuth: ${LEGACY_LABELS.EntraDelegatedUserAccess}, ${LEGACY_LABELS.SharedKeyAuthorization}`));
    assert.deepEqual(result.doc.edges[0].authenticationTypes, ["EntraDelegatedUserAccess", "SharedKeyAuthorization"]);
    assert.ok(issueKinds(store.normalizeDoc(result.doc)).includes("Edge_multiple_auth_methods"));
  });

  test("explicit TM7 stable Auth IDs outrank renamed or ambiguous display labels", () => {
    const raw = tm7Fixture('7. Explicit identity\r\nAuth: No authentication\r\nAuth IDs: ["ClientCertificateMtls","ContosoProofV1","ContosoProofV1"]');
    const result = tm7Import.parseTm7(raw);
    assert.deepEqual(result.doc.edges[0].authenticationTypes, ["ClientCertificateMtls", "ContosoProofV1"]);
    assert.equal(result.doc.edges[0].title, "Explicit identity");
    const normalized = store.normalizeDoc(result.doc);
    assert.equal(find(auth.authenticationCatalogFor(normalized), "ContosoProofV1").unresolved, true);
  });

  for (const ids of ['["constructor"]', '["__proto__"]', '["not a safe ID"]', "[1]", '{"id":"ApiKey"}', "not-json"]) {
    test(`TM7 invalid Auth IDs ${ids} fail instead of falling back to a misleading secure label`, () => {
      assert.throws(() => tm7Import.parseTm7(tm7Fixture(`1. Invalid IDs\nAuth: Managed identity\nAuth IDs: ${ids}`)), tm7Import.Tm7ImportError);
    });
  }

  test("TM7 exports stable IDs alongside renamed labels; lost custom definitions reopen unresolved", () => {
    const custom = definition({ label: "Proof, renamed & <external>", description: "Unique definition not representable in TM7.", behavior: { ...UNKNOWN_BEHAVIOR, productionIdentity: "required", audience: true } });
    const doc = withFlow([custom.id, "ClientCertificateMtls"], { productionIdentity: { kind: "ManagedIdentity" }, audience: "api://not-transported" });
    doc.authenticationDefinitions = [custom];
    const xml = tm7Export.exportTm7(doc, { modelName: "Authentication <roundtrip>" });
    const parsedXml = new DOMParser().parseFromString(xml, "text/xml");
    const text = parsedXml.documentElement.textContent;
    assert.ok(text.includes(`Auth: ${custom.label}, Client certificate (mTLS)`));
    assert.ok(text.includes('Auth IDs: ["ContosoProofV1","ClientCertificateMtls"]'));
    assert.doesNotMatch(xml, /Unique definition not representable|authenticationDefinitions/);
    const result = tm7Import.parseTm7(xml);
    assert.equal(result.summary.nodeCount, 2);
    assert.equal(result.summary.edgeCount, 1);
    assert.equal(result.summary.scenarioCount, 1);
    assert.deepEqual(result.doc.edges[0].authenticationTypes, [custom.id, "ClientCertificateMtls"]);
    assert.equal(result.doc.edges[0].source, IDS.source);
    assert.equal(result.doc.edges[0].target, IDS.target);
    assert.equal(result.doc.edges[0].productionIdentity, undefined);
    assert.equal(result.doc.edges[0].audience, undefined);
    const reopened = store.normalizeDoc(result.doc);
    assert.deepEqual(reopened.authenticationDefinitions, []);
    assert.equal(find(auth.authenticationCatalogFor(reopened, [custom]), custom.id).unresolved, true);
    assert.equal(auth.edgeRequiresProductionIdentity(reopened.edges[0].authenticationTypes, auth.authenticationCatalogFor(reopened)), false);
    assert.match(reviewIssue(reopened).description, /unresolved definition/);
  });

  test("safe-link helpers allow only absolute navigation schemes", () => {
    for (const value of ["https://example.test/review", "http://example.test", "mailto:reviewer@example.test"]) {
      assert.equal(links.isSafeNavigationUrl(value), true);
      assert.equal(links.safeNavigationHref(`  ${value}  `), value);
    }
    for (const value of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:msgbox(1)", "file:///C:/secret", "//example.test", "example.test", "/relative", "", null, undefined]) {
      assert.equal(links.isSafeNavigationUrl(value), false);
      assert.equal(links.safeNavigationHref(value), null);
    }
  });

  test("actual rich-text rendering escapes imported descriptions and never links dangerous schemes", () => {
    const text = '<img src=x onerror=boom> [unsafe](javascript:alert(1)) [review](https://example.test/review) https://example.test/docs.';
    const markup = renderToStaticMarkup(createElement(richText.RichText, { text }));
    assert.match(markup, /&lt;img src=x onerror=boom&gt;/);
    assert.match(markup, /\[unsafe\]\(javascript:alert\(1\)\)/);
    assert.doesNotMatch(markup, /<img|href="javascript:/);
    assert.match(markup, /href="https:\/\/example\.test\/review"/);
    assert.match(markup, /rel="noopener noreferrer"/);
    const tokens = richText.__tokenize(text);
    assert.deepEqual(tokens.filter((token) => token.kind === "link").map((token) => token.url), ["https://example.test/review", "https://example.test/docs"]);
    assert.equal(tokens.at(-1).text, ".");
  });

  test("embedded HTML escapes closing-script sequences while retaining complete catalog and PI JSON", () => {
    const doc = withFlow(["ContosoProofV1"], { productionIdentity: { kind: "AppId", appId: IDS.app, tenant: "Other" } });
    doc.authenticationDefinitions = [definition({ description: '</script><script>boom</script> mixed </ScRiPt> and </body>' })];
    const wrapper = { format: "secure-design-studio-diagram", version: 2, doc, view: { activeScenarioId: IDS.scenario } };
    const pristine = '<html><head><script>const sample = "</body>";</script></head><body><main>fixture</main></body></html>';
    embedded.capturePristineHtml(pristine);
    const html = embedded.buildStandaloneHtml(JSON.stringify(wrapper));
    const matches = [...html.matchAll(/<script type="application\/json" id="ps-embedded-doc">([\s\S]*?)<\/script>/g)];
    assert.equal(matches.length, 1);
    assert.doesNotMatch(matches[0][1], /<\/script/i);
    assert.match(matches[0][1], /<\\\/script>/);
    assert.match(matches[0][1], /<\\\/script>/i);
    assert.deepEqual(JSON.parse(matches[0][1]), wrapper);
    assert.ok(html.indexOf('id="ps-embedded-doc"') > html.indexOf("<main>fixture</main>"));
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.equal(embedded.getPristineHtml(), pristine);

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { getElementById: (id) => id === "ps-embedded-doc" ? { textContent: matches[0][1] } : null },
    });
    try {
      const reopened = embedded.readEmbeddedDoc();
      assert.deepEqual(reopened, wrapper);
      const normalized = store.normalizeDoc(reopened.doc);
      assert.deepEqual(normalized.authenticationDefinitions, doc.authenticationDefinitions);
      assert.deepEqual(normalized.edges[0].productionIdentity, doc.edges[0].productionIdentity);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
      else delete globalThis.document;
    }
  });

  test("re-export replaces the existing embedded payload instead of accumulating stale catalogs", () => {
    const original = '<html><body><script id="ps-embedded-doc" type="application/json">{"old":true}</script></body></html>';
    embedded.capturePristineHtml(original);
    const wrapper = { format: "secure-design-studio-diagram", version: 2, doc: documentFixture({ authenticationDefinitions: [definition()] }) };
    const html = embedded.buildStandaloneHtml(JSON.stringify(wrapper));
    assert.equal((html.match(/id="ps-embedded-doc"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /"old":true/);
    assert.ok(html.includes('"authenticationDefinitions"'));
  });
});
