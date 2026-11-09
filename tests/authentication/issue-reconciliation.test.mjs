import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { IDS, documentFixture, withFlow, withPolicy } from "./catalog-fixtures.mjs";

const { IssueManager } = await import("../../src/IssueManager.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { createYShape, REMOTE_ORIGIN } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");

function finding(kind = "Unavailable_rule", overrides = {}) {
  return {
    id: "i_saved", kind, targetKind: "edge", targetId: IDS.edge,
    scenarioIds: [IDS.scenario], title: "Saved finding", description: "Original evidence.",
    status: "Resolved", createdAt: 1234,
    replies: [{ id: "ir_saved", text: "Maintainer decision.", createdAt: 2345 }],
    resolutionLink: "https://example.invalid/remediation",
    ...overrides,
  };
}
const analyze = doc => new IssueManager().analyze(doc);
const saved = doc => doc.issues.find(issue => issue.id === "i_saved");
const expectRetained = (doc, reason) => {
  const original = structuredClone(doc.issues[0]);
  const result = analyze(doc);
  assert.deepEqual(saved(result), { ...original, notEvaluatedReason: reason });
  assert.deepEqual(doc.issues[0], original, "Analyze does not mutate its input");
  return result;
};

for (const status of ["Active", "Resolved"]) {
  test(`unavailable rule preserves all ${status} finding evidence`, () => {
    expectRetained(documentFixture({ issues: [finding(undefined, { status })] }), "rule-unavailable");
  });
}

test("runtime rule availability, not emitted findings, controls clearing and refresh", () => {
  const input = documentFixture({ issues: [finding("Edge_must_have_data")] });
  const paused = new IssueManager(undefined, []).analyze(input);
  assert.deepEqual(saved(paused), { ...input.issues[0], notEvaluatedReason: "rule-unavailable" });
  const resumed = analyze(paused);
  assert.equal(saved(resumed).title, "Edge has no data attached");
  assert.equal(saved(resumed).notEvaluatedReason, undefined);
  for (const key of ["id", "status", "replies", "createdAt"]) {
    assert.deepEqual(saved(resumed)[key], input.issues[0][key]);
  }
  resumed.scenarios[0].edgeRequestData[IDS.edge] = ["d"];
  resumed.data = [{ id: "d", name: "Data", classification: "EUII", sample: "" }];
  assert.equal(saved(analyze(resumed)), undefined, "A successful zero-findings run clears old evidence");
  assert.throws(() => new IssueManager(undefined, ["misspelled-rule"]).analyze(input), /Unknown analyzer rule/);
});

for (const policyStatus of [undefined, "Unspecified"]) {
  test(`missing/unspecified node policies preserve auth and data findings (${policyStatus})`, () => {
    for (const kind of ["Edge_auth_not_accepted", "Edge_data_not_accepted", "Node_data_not_accepted"]) {
      const input = withPolicy([], ["ApiKey"], { policyStatus });
      if (!policyStatus) input.nodeTypes = [];
      input.data = [{ id: "d", name: "Data", classification: "EUII", sample: "" }];
      input.scenarios[0].edgeRequestData[IDS.edge] = ["d"];
      input.scenarios[0].nodeData[IDS.target] = { d: "ProcessingNoStorage" };
      input.issues = [finding(kind, kind.startsWith("Node") ? { targetKind: "node", targetId: IDS.target } : {})];
      expectRetained(input, "policy-unavailable");
    }
  });
}

test("partial directional/scenario coverage never narrows a retained finding", () => {
  const input = withPolicy([], [], { allowedDataTypes: [{ id: "*", retention: "*", action: "Deny" }] });
  input.nodes[0].type = "missing_sender_policy";
  input.data = [{ id: "d", name: "Data", classification: "EUII", sample: "" }];
  input.scenarios[0].edgeRequestData[IDS.edge] = ["d"];
  const second = structuredClone(input.scenarios[0]);
  second.id = "s_response";
  second.edgeRequestData = {};
  second.edgeResponseData[IDS.edge] = ["d"];
  input.scenarios.push(second);
  input.issues = [finding("Edge_data_not_accepted", { scenarioIds: [IDS.scenario, second.id] })];
  const partial = expectRetained(input, "policy-unavailable");
  input.issues = [];
  const newPartial = analyze(input).issues.find(issue => issue.kind === "Edge_data_not_accepted");
  assert.equal(newPartial.notEvaluatedReason, "policy-unavailable", "Known violations are still reported");
  assert.deepEqual(newPartial.scenarioIds, [IDS.scenario]);
  partial.nodes[0].type = "nt_test";
  const complete = analyze(partial);
  assert.deepEqual(saved(complete).scenarioIds, [IDS.scenario, second.id]);
  assert.equal(saved(complete).notEvaluatedReason, undefined);
  complete.nodeTypes[0].definition.allowedDataTypes[0].action = "Allow";
  assert.equal(saved(analyze(complete)), undefined);
});

test("unused missing policy is not needed to prove there is no attached data/auth violation", () => {
  for (const kind of ["Edge_auth_not_accepted", "Edge_data_not_accepted", "Node_data_not_accepted"]) {
    const input = documentFixture({
      issues: [finding(kind, kind.startsWith("Node") ? { targetKind: "node", targetId: IDS.target } : {})],
    });
    assert.equal(saved(analyze(input)), undefined);
  }
});

for (const [kind, field, id] of [
  ["Node_missing_deferred_geo", "geoBoundary", "DataKeptInGeoUnlessIndicatedByCaller"],
  ["Node_missing_deferred_retention", "postSubscriptionRetention", "ControlledByCallingService"],
]) {
  test(`${kind} survives missing node policy and guards unsupported raw settings`, () => {
    const input = withPolicy([], [], { allowedDataTypes: [{ id: "*", retention: "*", action: "Allow" }] });
    input.issues = [finding(kind, { targetKind: "node", targetId: IDS.target })];
    input.nodeTypes[0].definition[field] = { id };
    assert.equal(saved(analyze(normalizeDoc(input))).notEvaluatedReason, undefined);
    input.nodeTypes[0].definition.policyStatus = "Unspecified";
    assert.equal(saved(analyze(normalizeDoc(input))).notEvaluatedReason, undefined,
      "Explicit deferred settings remain evaluable even when auth/data policy is unspecified");
    // Geo/retention schema extraction is deferred; guard an unavailable raw
    // setting here without claiming unknown IDs survive today's strict schema.
    input.nodeTypes[0].definition[field] = { id: "MissingSetting" };
    expectRetained(input, "policy-unavailable");
    input.nodeTypes = [];
    expectRetained(normalizeDoc(input), "policy-unavailable");
  });
}

for (const kind of ["Edge_missing_production_identity", "Edge_invalid_production_identity"]) {
  test(`${kind} is retained as retired legacy evidence`, () => {
    for (const id of ["MissingAuth", "CustomAuthentication", "CertificateAuthentication"]) {
      const input = withFlow([id]);
      input.issues = [finding(kind)];
      const reason = kind === "Edge_managed_identity_mismatch" ? "policy-unavailable" : "rule-retired";
      const retained = expectRetained(input, reason);
      assert.ok(retained.issues.some(issue => issue.kind === "Edge_authentication_definition_review"));
      retained.edges[0].authenticationTypes = ["AnonymousAccess"];
      assert.deepEqual(saved(analyze(retained)), { ...input.issues[0], notEvaluatedReason: reason });
    }
  });
}

test("managed identity mismatch finding remains evaluable and clears when its conflict is resolved", () => {
  const input = withFlow(["EntraManagedIdentity"]);
  input.edges[0].productionIdentity = { kind: "AppId", appId: "12345678-1234-1234-1234-123456789abc" };
  const finding = analyze(input).issues.find(issue => issue.kind === "Edge_managed_identity_mismatch");
  assert.ok(finding);
  input.edges[0].productionIdentity = undefined;
  assert.equal(analyze(input).issues.some(issue => issue.kind === "Edge_managed_identity_mismatch"), false);
});

test("manual findings stay untouched, orphan cleanup and rule target identity stay precise", () => {
  const manual = finding(undefined, { kind: undefined });
  const input = documentFixture({ issues: [manual, finding("Unknown", { id: "i_orphan", targetId: "gone" })] });
  assert.strictEqual(analyze(input).issues.find(issue => issue.id === manual.id), manual);
  assert.equal(analyze(input).issues.some(issue => issue.id === "i_orphan"), false);
  input.issues = [finding("Node_must_have_servicetree")];
  expectRetained(input, "rule-unavailable");
});

test("evaluator errors abort the whole pass without mutating findings or propagation", () => {
  const input = withPolicy([], ["ApiKey"]);
  input.issues = [finding()];
  input.data = [{ id: "d", name: "Data", classification: "EUII", sample: "" }];
  input.scenarios[0].edgeRequestData[IDS.edge] = ["d"];
  input.nodeTypes[0].definition.allowedAuthMethods = null;
  const original = structuredClone(input);
  assert.throws(() => analyze(input));
  assert.deepEqual(input, original);
});

test("normalization preserves supported evaluation reasons and safe guidance without inventing success", () => {
  for (const reason of ["rule-unavailable", "policy-unavailable"]) {
    const input = documentFixture({ issues: [finding(undefined, { notEvaluatedReason: reason })] });
    assert.deepEqual(normalizeDoc(input).issues[0], input.issues[0]);
    input.issues[0].resolutionLink = "javascript:alert(1)";
    assert.equal(normalizeDoc(input).issues[0].resolutionLink, undefined);
    input.issues[0].notEvaluatedReason = "future-or-invalid-state";
    assert.equal(normalizeDoc(input).issues[0].notEvaluatedReason, "unknown");
    input.issues[0].kind = undefined;
    assert.equal(normalizeDoc(input).issues[0].notEvaluatedReason, undefined);
  }
});

test("retained findings round-trip native JSON and synthetic peers, then clear the marker on reevaluation", () => {
  const input = documentFixture({ issues: [finding("Edge_must_have_data")] });
  const paused = new IssueManager(undefined, []).analyze(input);
  const left = createYShape();
  const right = createYShape();
  try {
    reconcileLocalToY(left, normalizeDoc(JSON.parse(JSON.stringify(paused))));
    Y.applyUpdate(right.ydoc, Y.encodeStateAsUpdate(left.ydoc), REMOTE_ORIGIN);
    const remote = normalizeDoc(buildDocFromY(right));
    assert.deepEqual(remote.issues, paused.issues);
    const resumed = analyze(remote);
    reconcileLocalToY(right, resumed);
    const localEdit = structuredClone(paused);
    localEdit.issues[0].status = "Active";
    localEdit.issues[0].replies.push({ id: "ir_concurrent", text: "Concurrent review.", createdAt: 3456 });
    reconcileLocalToY(left, localEdit);
    Y.applyUpdate(right.ydoc, Y.encodeStateAsUpdate(left.ydoc, Y.encodeStateVector(right.ydoc)), REMOTE_ORIGIN);
    Y.applyUpdate(left.ydoc, Y.encodeStateAsUpdate(right.ydoc, Y.encodeStateVector(left.ydoc)), REMOTE_ORIGIN);
    const converged = normalizeDoc(buildDocFromY(left));
    assert.deepEqual(converged.issues, normalizeDoc(buildDocFromY(right)).issues);
    assert.equal(saved(converged).notEvaluatedReason, undefined);
    assert.equal(saved(converged).title, saved(resumed).title);
    assert.equal(saved(converged).status, "Active");
    assert.deepEqual(saved(converged).replies, localEdit.issues[0].replies);
  } finally {
    left.ydoc.destroy();
    right.ydoc.destroy();
  }
});

test("reports distinguish retained findings from user status and avoid certifying legacy results", () => {
  const doc = expectRetained(documentFixture({ issues: [finding()] }), "rule-unavailable");
  const html = buildReviewReportHtml({ doc, scenario: doc.scenarios[0], documentFileName: "test.tma", appVersion: "test" });
  assert.match(html, /Not re-evaluated: rule unavailable/);
  assert.match(html, /Resolved/);
  assert.match(html, /No evaluation limitation recorded/);
});
