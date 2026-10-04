import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { documentFixture } from "./catalog-fixtures.mjs";

const { normalizeDoc } = await import("../../src/store.tsx");
const { emptyNodeTypeDefinition } = await import("../../src/types.ts");
const { resolveDfdRole, resolveNodeReviewScope, resolveFlowReviewScope, normalizeNodeScope } = await import("../../src/dfdSemantics.ts");
const { buildDfdReviewContext } = await import("../../src/dfdReviewContext.ts");
const { validateLibraryPackage } = await import("../../src/libraries/validation.ts");
const { diffDocuments } = await import("../../src/diff.ts");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
const { capturePristineHtml, buildStandaloneHtml } = await import("../../src/embeddedDoc.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { resolveLibraries } = await import("../../src/libraries/registry.ts");
const { withLibraryDefinitions } = await import("../../src/libraries/document.ts");

const type = (role = "DataStore") => ({
  id: "synthetic-sql", label: "Synthetic SQL",
  definition: { ...emptyNodeTypeDefinition(), description: "Synthetic service", defaultDfdRole: role },
});
function fixture() {
  const doc = documentFixture();
  doc.nodeTypes = [type()];
  doc.nodes[0].type = "synthetic-sql";
  doc.scenarios.push({ ...structuredClone(doc.scenarios[0]), id: "s_other", name: "Other" });
  return normalizeDoc(doc);
}

test("DFD: SQL identity, saved default, independent override and catalog changes", () => {
  const doc = fixture(), node = doc.nodes[0];
  assert.equal(resolveDfdRole(node, doc.nodeTypes).role, "DataStore");
  assert.equal(resolveDfdRole(node, doc.nodeTypes).source, "catalog");
  node.dfdRoleOverride = "Process";
  assert.deepEqual(resolveDfdRole(node, doc.nodeTypes),
    { role: "Process", source: "override", confidence: "explicit", diagnostics: [] });
  assert.equal(node.type, "synthetic-sql");
  node.type = "other-service";
  doc.nodeTypes = [{ ...type("ExternalInteractor"), id: "other-service" }];
  assert.equal(resolveDfdRole(node, doc.nodeTypes).role, "Process");
});

test("DFD: new Azure SQL captures its explicit public default; legacy SQL is not reclassified", () => {
  const registry = resolveLibraries();
  const doc = documentFixture();
  doc.nodes[0].type = "azure.databases.sql";
  const legacy = normalizeDoc(doc);
  assert.equal(resolveDfdRole(legacy.nodes[0], legacy.nodeTypes).role, "Process");
  legacy.nodes[0].dfdRoleLegacy = false;
  const captured = withLibraryDefinitions(legacy, registry);
  assert.equal(captured.nodeTypes.find(type => type.id === "azure.databases.sql").definition.defaultDfdRole, "DataStore");
  assert.equal(resolveDfdRole(captured.nodes[0], captured.nodeTypes).role, "DataStore");
  const alteredRegistry = structuredClone(registry);
  alteredRegistry.nodes.find(type => type.id === "azure.databases.sql").definition.defaultDfdRole = "ExternalInteractor";
  const received = normalizeDoc(JSON.parse(JSON.stringify(captured)), alteredRegistry.nodes);
  assert.equal(resolveDfdRole(received.nodes[0], received.nodeTypes).role, "DataStore");
});

test("DFD: legacy role is pinned before hydration and remains stable across reopen/installations", () => {
  for (const refs of [[], ["synthetic-sql"], [{ id: "synthetic-sql", label: "SQL" }]]) {
    const doc = documentFixture();
    doc.nodeTypes = refs;
    doc.nodes[0].type = "synthetic-sql";
    const normalized = normalizeDoc(doc, [type("ExternalInteractor")]);
    assert.equal(normalized.nodes[0].dfdRoleLegacy, true);
    assert.equal(resolveDfdRole(normalized.nodes[0], normalized.nodeTypes).role, "Process");
    const reopened = normalizeDoc(JSON.parse(JSON.stringify(normalized)), [type()]);
    assert.equal(resolveDfdRole(reopened.nodes[0], reopened.nodeTypes).source, "legacy");
    reopened.nodes[0].dfdRoleLegacy = false;
    if (!reopened.nodeTypes.length) reopened.nodeTypes = [type()];
    assert.notEqual(resolveDfdRole(reopened.nodes[0], reopened.nodeTypes).source, "legacy");
  }
  const authored = documentFixture();
  authored.nodes[0] = { ...authored.nodes[0], type: "synthetic-sql", dfdRoleLegacy: false };
  authored.nodeTypes = [{ id: "synthetic-sql", label: "SQL" }];
  const installed = normalizeDoc(authored, [type()]);
  assert.equal(resolveDfdRole(installed.nodes[0], installed.nodeTypes).role, "DataStore");
});

test("DFD: invalid explicit role cannot fall through to an external default or activate exclusion", () => {
  for (const value of ["UnknownFutureRole", "", null, 19, { role: "ExternalInteractor" }, "x".repeat(200)]) {
    const doc = fixture();
    doc.nodeTypes[0] = type("ExternalInteractor");
    doc.nodes[0].dfdRoleOverride = value;
    doc.scenarios[0].nodeScopeReasons = { [doc.nodes[0].id]: "Infrastructure" };
    const normalized = normalizeDoc(doc);
    const scope = resolveNodeReviewScope(normalized.nodes[0], normalized.scenarios[0], normalized.nodeTypes);
    assert.equal(scope.role.role, "Process");
    assert.equal(scope.role.confidence, "unresolved");
    assert.equal(scope.disposition, "unresolved");
    assert.equal(scope.includeInternals, true);
    assert.equal(scope.effectiveReason, "");
    assert.ok(scope.diagnostics.length);
    assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(normalized))), normalized);
  }
});

test("DFD: scenario reasons, contradictory external input and dormant real nonmembers", () => {
  const doc = fixture(), node = doc.nodes[0], scenario = doc.scenarios[0];
  scenario.nodeScopeReasons = { [node.id]: "  Owned elsewhere\nDecision retained  ", orphan: "Do not fabricate" };
  assert.equal(resolveNodeReviewScope(node, scenario, doc.nodeTypes).effectiveReason, "Owned elsewhere\nDecision retained");
  assert.equal(resolveNodeReviewScope(node, doc.scenarios[1], doc.nodeTypes).disposition, "inScope");
  assert.equal(resolveNodeReviewScope(node, null, doc.nodeTypes).disposition, "noScenario");
  for (const reason of ["", " \n "]) {
    assert.equal(resolveNodeReviewScope(node, { ...scenario, nodeScopeReasons: { [node.id]: reason } }, doc.nodeTypes).disposition, "inScope");
  }
  node.dfdRoleOverride = "ExternalInteractor";
  const external = resolveNodeReviewScope(node, scenario, doc.nodeTypes);
  assert.equal(external.disposition, "external");
  assert.equal(external.effectiveReason, "");
  assert.equal(external.storedReason, scenario.nodeScopeReasons[node.id]);
  assert.ok(external.diagnostics.length);
  scenario.nodeIds = [doc.nodes[1].id];
  const normalized = normalizeDoc(doc);
  assert.equal(resolveNodeReviewScope(normalized.nodes[0], normalized.scenarios[0], normalized.nodeTypes).disposition, "notMember");
  assert.equal(normalized.scenarios[0].nodeScopeReasons[node.id], scenario.nodeScopeReasons[node.id]);
  assert.equal(normalized.scenarios[0].nodeScopeReasons.orphan, undefined);
  assert.deepEqual(normalizeNodeScope(scenario, new Set([doc.nodes[1].id])).nodeScopeReasons, {});
});

test("DFD: malformed role/reason fields are bounded, inactive and recoverable", () => {
  for (const reason of [false, null, ["a"], { text: "uncertain" }, "x".repeat(16001)]) {
    const doc = fixture(), id = doc.nodes[0].id;
    doc.scenarios[0].nodeScopeReasons = { [id]: reason };
    const normalized = normalizeDoc(doc);
    const scope = resolveNodeReviewScope(normalized.nodes[0], normalized.scenarios[0], normalized.nodeTypes);
    assert.equal(scope.disposition, "inScope");
    assert.equal(typeof scope.storedReason, "object");
    assert.ok(scope.storedReason.invalid.length <= 16000);
    assert.ok(scope.diagnostics.length);
    assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(normalized))), normalized);
  }
  for (const malformed of [null, 5, "oops", []]) {
    const doc = fixture();
    doc.scenarios[0].nodeScopeReasons = malformed;
    const normalized = normalizeDoc(doc);
    assert.ok(normalized.scenarios[0].nodeScopeReasonsRecovery);
    assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(normalized))), normalized);
  }
});

test("DFD: reason lookups require authored own entries even for unusual saved node IDs", () => {
  const doc = fixture(), node = { ...doc.nodes[0], id: "constructor" };
  const scenario = { ...doc.scenarios[0], nodeIds: ["constructor"], nodeScopeReasons: {} };
  assert.equal(resolveNodeReviewScope(node, scenario, doc.nodeTypes).storedReason, undefined);
  scenario.nodeScopeReasons = Object.fromEntries([["constructor", "Authored scope"]]);
  assert.equal(resolveNodeReviewScope(node, scenario, doc.nodeTypes).disposition, "outOfScope");
});

test("DFD: exact 25 flow pairs, both directions and request/response attachments", () => {
  const variants = [["Process", false], ["DataStore", false], ["Process", true], ["DataStore", true], ["ExternalInteractor", false]];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
    const doc = fixture(), scenario = doc.scenarios[0], edge = doc.edges[0];
    doc.nodes[0].dfdRoleOverride = variants[a][0];
    doc.nodes[1].dfdRoleOverride = variants[b][0];
    scenario.nodeScopeReasons = Object.fromEntries(doc.nodes.flatMap((node, i) =>
      variants[i === 0 ? a : b][1] ? [[node.id, "Infrastructure"]] : []));
    scenario.edgeRequestData[edge.id] = ["request"];
    scenario.edgeResponseData[edge.id] = ["response"];
    doc.data = ["request", "response"].map(id => ({ id, name: id, classification: "EUII", sample: "" }));
    const expected = (a === 4 && (b === 2 || b === 3)) || (b === 4 && (a === 2 || a === 3)) ? "excluded" : "included";
    for (const flow of [edge, { ...edge, source: edge.target, target: edge.source }]) {
      assert.equal(resolveFlowReviewScope(flow, doc, scenario).disposition, expected, `${a}->${b}`);
      doc.edges = [flow];
      const projection = buildDfdReviewContext(doc, scenario);
      assert.equal(projection.edges.length, expected === "included" ? 1 : 0);
      assert.deepEqual(projection.scenario.edgeRequestData, expected === "included" ? scenario.edgeRequestData : {});
      assert.deepEqual(projection.scenario.edgeResponseData, expected === "included" ? scenario.edgeResponseData : {});
    }
  }
});

test("DFD: projection omits excluded interiors/data, keeps crossing identity and structural diagnostics", () => {
  const doc = fixture(), scenario = doc.scenarios[0], node = doc.nodes[0];
  node.description = "INTERNAL_SECRET_DETAIL";
  node.geoBoundary = { id: "DataNotKeptInGeo" };
  scenario.nodeScopeReasons = { [node.id]: "Infrastructure" };
  scenario.nodeData[node.id] = { private: "StorageOver48Hours" };
  scenario.edgeRequestData[doc.edges[0].id] = ["crossing"];
  doc.data = ["private", "crossing"].map(id => ({ id, name: id, classification: "EUII", sample: "" }));
  const before = structuredClone(doc);
  const projected = buildDfdReviewContext(doc, scenario);
  assert.equal(projected.nodes[0].reviewContext, "endpoint-only");
  assert.equal(projected.nodes[0].description, undefined);
  assert.equal(projected.nodes[0].geoBoundary, undefined);
  assert.equal(projected.nodes[0].serviceTreeId, node.serviceTreeId);
  assert.equal(projected.scenario.nodeData[node.id], undefined);
  assert.deepEqual(projected.data.map(item => item.id), ["crossing"]);
  assert.equal(JSON.stringify(projected).includes("INTERNAL_SECRET_DETAIL"), false);
  assert.deepEqual(doc, before);
  scenario.nodeIds = [node.id, "missing-node"];
  scenario.edgeIds.push("missing-edge");
  assert.equal(resolveFlowReviewScope(doc.edges[0], doc, scenario).disposition, "invalid");
  const invalid = buildDfdReviewContext(doc, scenario);
  assert.deepEqual(invalid.edges, []);
  assert.deepEqual(invalid.reviewScope.missingNodeIds, ["missing-node"]);
  assert.deepEqual(invalid.reviewScope.missingEdgeIds, ["missing-edge"]);
  assert.equal(invalid.reviewScope.flows[0].disposition, "invalid");
  assert.equal(buildDfdReviewContext(doc, null).scenario, null);
  assert.deepEqual(buildDfdReviewContext(doc, null).nodes, []);
});

test("DFD: package defaults validate strictly; saved native unknown role remains evidence", () => {
  const pkg = { format: "secure-design-studio-library", apiVersion: 1, id: "synthetic",
    name: "Synthetic", version: "1.0.0", catalogs: { nodes: [type()] } };
  assert.equal(validateLibraryPackage(pkg).catalogs.nodes[0].definition.defaultDfdRole, "DataStore");
  pkg.catalogs.nodes[0].definition.defaultDfdRole = "unknown";
  assert.throws(() => validateLibraryPackage(pkg), /DFD role/);
  const doc = fixture();
  doc.nodeTypes[0] = type("unknown");
  const normalized = normalizeDoc(doc);
  assert.equal(normalized.nodeTypes[0].definition.defaultDfdRole, "unknown");
  assert.equal(resolveDfdRole(normalized.nodes[0], normalized.nodeTypes).confidence, "unresolved");
});

test("DFD: fixed analysis and manual/resolved findings are unchanged by scope", () => {
  const before = new IssueManager().analyze(fixture());
  before.issues.forEach(issue => { issue.status = "Resolved"; issue.replies = [{ id: "reply", text: "Retain", createdAt: 10 }]; });
  before.issues.push({ id: "manual", targetKind: "node", targetId: before.nodes[0].id,
    scenarioIds: [before.scenarios[0].id], title: "Authored threat", description: "Keep", status: "Active", createdAt: 10, replies: [] });
  const after = structuredClone(before);
  after.nodes[0].dfdRoleOverride = "ExternalInteractor";
  after.scenarios[0].nodeScopeReasons = { [after.nodes[1].id]: "Owned elsewhere" };
  assert.deepEqual(new IssueManager().analyze(after).issues, new IssueManager().analyze(before).issues);
  assert.deepEqual(after.issues, before.issues);
});

test("DFD: native/autosave/history/HTML/report/diff preserve exact stored evidence", t => {
  const before = fixture(), after = structuredClone(before), id = after.nodes[0].id;
  after.nodes[0].dfdRoleOverride = "ExternalInteractor";
  after.scenarios[0].nodeScopeReasons = { [id]: "Keep </script><script>literal</script>\nreason" };
  const normalized = normalizeDoc(JSON.parse(JSON.stringify(after)));
  assert.deepEqual(normalized, after);
  assert.deepEqual(diffDocuments(after, normalized), []);
  const changes = diffDocuments(before, after);
  assert.ok(changes.some(item => /DFD role/.test(item.description)));
  assert.ok(changes.some(item => /scope reason/.test(item.description) && item.target.scenarioId === after.scenarios[0].id));
  const storage = new Map();
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) ?? null } };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  saveAutosave({ doc: after, past: [before], future: [after], view: { activeScenarioId: after.scenarios[0].id, filter: {} } });
  const restored = loadAutosaveRaw();
  assert.deepEqual(normalizeDoc(restored.doc), after);
  assert.deepEqual(normalizeDoc(restored.past[0]), before);
  assert.deepEqual(normalizeDoc(restored.future[0]), after);
  capturePristineHtml("<html><body></body></html>");
  const html = buildStandaloneHtml(JSON.stringify({ format: "secure-design-studio-diagram", version: 2, doc: after }));
  const payload = /id="ps-embedded-doc">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.deepEqual(normalizeDoc(JSON.parse(payload).doc), after);
  const report = buildReviewReportHtml({ doc: after, scenario: after.scenarios[0], documentFileName: "synthetic.tma", appVersion: "test" });
  assert.match(report, /External Interactor/);
  assert.match(report, /inactive/);
  assert.match(report, /&lt;\/script&gt;/);
  assert.equal(report.includes("<script>literal"), false);
});

test("DFD: compatible Yjs peers round-trip, reconnect and converge with atomic reason maps", t => {
  const a = createYShape(), b = createYShape(), reconnect = createYShape();
  t.after(() => [a, b, reconnect].forEach(shape => shape.ydoc.destroy()));
  const doc = fixture(), id = doc.nodes[0].id, sid = doc.scenarios[0].id;
  doc.nodes[0].dfdRoleOverride = "Process";
  doc.scenarios[0].nodeScopeReasons = { [id]: "Original" };
  reconcileLocalToY(a, doc);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(buildDocFromY(b).nodes.find(node => node.id === id), doc.nodes[0]);
  assert.deepEqual(buildDocFromY(b).scenarios.find(s => s.id === sid), doc.scenarios[0]);
  let updates = 0;
  b.ydoc.on("update", () => updates++);
  reconcileLocalToY(b, buildDocFromY(b));
  assert.equal(updates, 0);
  const first = { [id]: "A" }, second = { [doc.nodes[1].id]: "B" };
  a.scenarios.get(sid).set("nodeScopeReasons", first);
  b.scenarios.get(sid).set("nodeScopeReasons", second);
  a.nodes.get(id).set("dfdRoleOverride", "ExternalInteractor");
  b.nodes.get(id).set("title", "Unrelated peer title");
  const updateA = Y.encodeStateAsUpdate(a.ydoc), updateB = Y.encodeStateAsUpdate(b.ydoc);
  Y.applyUpdate(a.ydoc, updateB); Y.applyUpdate(b.ydoc, updateA);
  assert.deepEqual(buildDocFromY(a), buildDocFromY(b));
  assert.ok([JSON.stringify(first), JSON.stringify(second)].includes(JSON.stringify(a.scenarios.get(sid).get("nodeScopeReasons"))));
  Y.applyUpdate(reconnect.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(buildDocFromY(reconnect), buildDocFromY(a));
});
