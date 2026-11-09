import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
const {
  AUTH_TYPE_DEFS, LEGACY_AUTHENTICATION_IDS, authenticationCatalogFor,
  authenticationCompatibilityFor, authenticationWarnings, authenticationVersionStatus,
} = await import("../../src/authentication.ts");
import { definition, withFlow, withPolicy } from "./catalog-fixtures.mjs";

const modernIds = [
  "EntraOnBehalfOf", "EntraManagedIdentity", "EntraFederatedWorkloadIdentity",
  "OAuthAccessToken", "ClientCertificateMtls", "ApiKey", "InternalProcessCall",
  "ContosoProofV1",
];

test("compatibility: only an older running application SemVer warrants a version warning", () => {
  for (const version of ["0.1.0", "0.1.4", "0.0.99", "0.1.5-rc.1"]) {
    assert.equal(authenticationVersionStatus(version, "0.1.5"), "older", version);
  }
  for (const version of ["0.1.5", "0.1.5+build.4", "0.1.7", "0.1.8", "0.1.10", "0.2.0", "1.0.0", "1000000000000000000000.0.0"]) {
    assert.equal(authenticationVersionStatus(version, "0.1.5"), "compatible", version);
  }
  assert.equal(authenticationVersionStatus("0.1.9", "0.1.10"), "older");
  assert.equal(authenticationVersionStatus("0.1.5-rc.2", "0.1.5-rc.10"), "older");
  assert.equal(authenticationVersionStatus("0.1.5-rc.10", "0.1.5-rc.2"), "compatible");
  assert.equal(authenticationVersionStatus("0.1.5-1", "0.1.5-alpha"), "older");
  assert.equal(authenticationVersionStatus("0.1.5-alpha", "0.1.5-alpha.1"), "older");
  assert.equal(authenticationVersionStatus("0.1.5-beta", "0.1.5-alpha"), "compatible");
  assert.equal(authenticationVersionStatus("0.1.5-alpha.1", "0.1.5-alpha"), "compatible");
  assert.equal(authenticationVersionStatus("0.1.5-rc.1", "0.1.5-rc.1"), "compatible");
});

test("compatibility: missing, malformed and document-format versions never imply compatible or older", () => {
  for (const version of [undefined, null, "", 1, 2, "1", "2", "v0.1.8", "0.1", "0.01.8", "0.1.8-01", "garbage", " 0.1.8", "0.1.8 ", "0.1.8\n", "0.1.8+"]) {
    assert.equal(authenticationVersionStatus(version, "0.1.5"), "unknown", String(version));
  }
  assert.equal(authenticationVersionStatus("0.1.8", "bad"), "unknown");
});

test("compatibility: original eleven IDs and unused modern library/saved entries need no notice", () => {
  const library = [...AUTH_TYPE_DEFS, definition()];
  const doc = withFlow([...LEGACY_AUTHENTICATION_IDS]);
  doc.authenticationDefinitions = [definition()];
  assert.equal(authenticationCompatibilityFor(doc, library), null);
  assert.equal(authenticationCompatibilityFor(withFlow([]), library), null);
});

for (const id of modernIds) {
  const minimumVersion = id === "InternalProcessCall" ? "0.1.11" : "0.1.5";
  test(`compatibility: referenced ${id} requires ${minimumVersion} without inferring runtime failure`, () => {
    const doc = withFlow([id]);
    if (id === "ContosoProofV1") doc.authenticationDefinitions = [definition()];
    const library = [...AUTH_TYPE_DEFS, definition()];
    const report = authenticationCompatibilityFor(doc, library);
    assert.equal(report.minimumVersion, minimumVersion);
    assert.deepEqual(report.counts, { methods: 1, flows: 1, nodeTypePolicies: 0 });
    assert.equal(report.methods[0].id, id);
    assert.equal(report.methods[0].label, authenticationCatalogFor(doc, library).find(method => method.id === id).label);
    assert.deepEqual(authenticationWarnings(doc, library), [], "A resolved modern ID alone is not a definition warning");
  });
}

test("compatibility: unique totals deduplicate multi-auth flows and multi-method node policies", () => {
  const doc = withPolicy([
    { id: "ApiKey", status: "Allowed" }, { id: "ApiKey", status: "Allowed" },
    { id: "OAuthAccessToken", status: "Deprecated" }, { id: "*", status: "Allowed" },
  ], ["ApiKey", "ApiKey", "OAuthAccessToken", "CustomAuthentication"]);
  const report = authenticationCompatibilityFor(doc);
  assert.deepEqual(report.counts, { methods: 2, flows: 1, nodeTypePolicies: 1 });
  assert.deepEqual(report.methods.map(method => method.id), ["ApiKey", "OAuthAccessToken"]);
  for (const method of report.methods) {
    assert.equal(method.flows.length, 1);
    assert.equal(method.nodeTypePolicies.length, 1);
    assert.equal(method.nodeTypePolicies[0].id, "nt_test");
  }
  assert.deepEqual(report.methods[0].nodeTypePolicies[0].statuses, ["Allowed"]);
  assert.deepEqual(report.methods[1].nodeTypePolicies[0].statuses, ["Deprecated"]);
});

test("compatibility: unused policy-only dependencies are inventoried without expanding wildcard", () => {
  const doc = withPolicy([{ id: "*", status: "Allowed" }, { id: "PolicyProof", status: "Deprecated" }], []);
  doc.nodes = [];
  const report = authenticationCompatibilityFor(doc);
  assert.deepEqual(report.counts, { methods: 1, flows: 0, nodeTypePolicies: 1 });
  assert.equal(report.methods[0].id, "PolicyProof");
  assert.deepEqual(report.methods[0].flows, []);
  doc.nodeTypes[0].definition.allowedAuthMethods = [{ id: "*", status: "Allowed" }];
  assert.equal(authenticationCompatibilityFor(doc), null);
});

test("compatibility: all scenarios and unassigned flows are included, with stable fallback identities", () => {
  const doc = withFlow(["ApiKey"]);
  const edge = doc.edges[0];
  doc.nodes[0].title = "";
  edge.title = "  ";
  edge.target = "n_missing";
  doc.scenarios[0].name = "";
  doc.scenarios[0].edgeIds.push(edge.id);
  doc.scenarios.push({ ...structuredClone(doc.scenarios[0]), id: "s_inactive", name: "Inactive" });
  doc.edges.push({ ...structuredClone(edge), id: "e_unassigned", title: "Detached flow" });
  const report = authenticationCompatibilityFor(doc);
  assert.deepEqual(report.counts, { methods: 1, flows: 2, nodeTypePolicies: 0 });
  const affected = report.methods[0].flows.find(flow => flow.id === edge.id);
  assert.equal(affected.title, edge.id);
  assert.deepEqual(affected.source, { id: edge.source, label: edge.source });
  assert.deepEqual(affected.target, { id: "n_missing", label: "n_missing" });
  assert.deepEqual(affected.scenarios, [
    { id: doc.scenarios[0].id, label: doc.scenarios[0].id }, { id: "s_inactive", label: "Inactive" },
  ].sort((a, b) => a.id < b.id ? -1 : 1));
  assert.deepEqual(report.methods[0].flows.find(flow => flow.id === "e_unassigned").scenarios, []);
});

test("compatibility: duplicate display labels never merge IDs and saved definitions win", () => {
  const saved = definition({ label: "Saved proof" });
  const second = definition({ id: "SecondProof", label: saved.label });
  const local = definition({ label: "Local proof" });
  const doc = withPolicy([{ id: saved.id, status: "Allowed" }, { id: second.id, status: "Allowed" }], [saved.id, second.id]);
  doc.authenticationDefinitions = [saved, second];
  doc.nodeTypes.push({ ...structuredClone(doc.nodeTypes[0]), id: "nt_second" });
  doc.edges.push({ ...structuredClone(doc.edges[0]), id: "e_second" });
  const report = authenticationCompatibilityFor(doc, [...AUTH_TYPE_DEFS, local]);
  assert.deepEqual(report.counts, { methods: 2, flows: 2, nodeTypePolicies: 2 });
  assert.deepEqual(report.methods.map(method => method.label), [saved.label, saved.label]);
  assert.deepEqual(report.methods.map(method => method.id), [saved.id, second.id]);
  assert.deepEqual(report.methods[0].nodeTypePolicies.map(policy => policy.id), ["nt_second", "nt_test"]);
  assert.match(authenticationWarnings(doc, [local]).join("\n"), /saved definition differs/);
});

test("compatibility: missing definitions use resolver fallback, not a fabricated local name", () => {
  const doc = withPolicy([{ id: "ContosoProofV1", status: "Allowed" }], ["ContosoProofV1"]);
  doc.nodeTypes[0].label = " ";
  const report = authenticationCompatibilityFor(doc, [definition()]);
  assert.equal(report.methods[0].label, "ContosoProofV1 (unresolved)");
  assert.equal(report.methods[0].nodeTypePolicies[0].label, "nt_test");
  assert.match(authenticationWarnings(doc, [definition()]).join("\n"), /definition missing/);
});

test("compatibility: deterministic read-only derivation refreshes after edits, resolution and removal", () => {
  const doc = withPolicy([{ id: "ContosoProofV1", status: "Allowed" }], ["ContosoProofV1"]);
  const library = [...AUTH_TYPE_DEFS, definition()];
  const before = structuredClone({ doc, library });
  const first = authenticationCompatibilityFor(doc, library);
  assert.deepEqual(authenticationCompatibilityFor(doc, library), first);
  assert.deepEqual({ doc, library }, before);
  doc.edges[0].title = "Renamed flow";
  doc.authenticationDefinitions = [definition({ label: "Resolved saved proof" })];
  const updated = authenticationCompatibilityFor(doc, library);
  assert.equal(updated.methods[0].flows[0].title, "Renamed flow");
  assert.equal(updated.methods[0].label, "Resolved saved proof");
  assert.notDeepEqual(updated, first);
  doc.edges = [];
  assert.deepEqual(authenticationCompatibilityFor(doc, library).counts, { methods: 1, flows: 0, nodeTypePolicies: 1 });
  doc.nodeTypes = [];
  assert.equal(authenticationCompatibilityFor(doc, library), null);
});
