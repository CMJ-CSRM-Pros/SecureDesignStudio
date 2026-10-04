import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { sampleExpectations } from "./sample-expectations.mjs";

const { normalizeDoc } = await import("../../src/store.tsx");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { AUTH_TYPE_DEFS, PRODUCTION_IDENTITY_TENANT_DEFS, DATA_CLASSIFICATIONS, RETENTION_TYPES, NODE_TYPE_DEF_MAP } =
  await import("../../src/types.ts");
const { containsRect, overlapRatio, nodeRect, boundaryRect } = await import("../../src/boundaryGeometry.ts");
const { resolveDfdRole, resolveNodeReviewScope, resolveFlowReviewScope } = await import("../../src/dfdSemantics.ts");
const { buildDfdReviewContext } = await import("../../src/dfdReviewContext.ts");
const { withAuthenticationDefinitions } = await import("../../src/authentication.ts");
const { withCatalogDefinitions } = await import("../../src/catalogDefinitions.ts");
const { isAuthoredThreatNote } = await import("../../src/threatNotes.ts");
const sampleDirectory = new URL("../../samples/", import.meta.url);
const sampleFiles = readdirSync(sampleDirectory).filter(name => name.endsWith(".tma")).sort();

test("sample gallery retains all five independently named examples", () => {
  assert.deepEqual(sampleFiles, Object.keys(sampleExpectations).sort());
});

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label}: duplicate IDs`);
}

for (const file of sampleFiles) {
  test(`sample: ${file} uses current, complete and intentional model contracts`, () => {
    const input = JSON.parse(readFileSync(new URL(file, sampleDirectory), "utf8"));
    const { doc } = input;
    const expected = sampleExpectations[file];
    assert.deepEqual(doc.nodes.map(node => node.id).sort(), Object.keys(expected.nodes).sort());
    assert.deepEqual(doc.data.map(item => item.id).sort(), Object.keys(expected.classifications).sort());
    assert.deepEqual(doc.scenarios.map(scenario => scenario.id).sort(), Object.keys(expected.scenarios).sort());
    assert.deepEqual(doc.edges.map(edge => edge.id).sort(), Object.keys(expected.endpoints).sort());
    assert.equal(input.format, "secure-design-studio-diagram");
    assert.equal(input.version, 2);
    assert.equal(doc.version, 1);
    assert.equal(input.view.activeScenarioId, "s_secure", "Open on the reference design");
    const normalized = normalizeDoc(doc);
    for (const key of ["nodes", "edges", "boundaries", "scenarios", "data", "comments", "workItems",
      "issues", "authenticationDefinitions", "catalogDefinitions"]) {
      assert.deepEqual(JSON.parse(JSON.stringify(normalized[key])), doc[key],
        `${key} must not require legacy migration or implicit geometry repair`);
    }
    assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(normalized))), normalized,
      "The complete native model is normalization-idempotent");
    assert.deepEqual(withCatalogDefinitions(withAuthenticationDefinitions(normalized, AUTH_TYPE_DEFS)), normalized,
      "Saved dependencies are complete without replacing profile libraries");
    for (const type of doc.nodeTypes) {
      assert.deepEqual(JSON.parse(JSON.stringify(normalized.nodeTypes.find(item => item.id === type.id))), type);
      assert.ok(["Process", "DataStore", "ExternalInteractor"].includes(type.definition.defaultDfdRole));
      assert.equal(type.definition.policyStatus, "Unspecified", "Role defaults do not fabricate service policy");
      assert.deepEqual(type.definition.allowedAuthMethods, []);
      assert.deepEqual(type.definition.allowedDataTypes, []);
      if (type.id.startsWith("azure.")) {
        const registered = NODE_TYPE_DEF_MAP[type.id];
        assert.ok(registered, "Specific Azure service must actually be registered");
        assert.equal(type.label, registered.label);
        assert.equal(type.definition.icon, registered.icon);
        assert.deepEqual(type.definition.resourceProviders, registered.resourceProviders);
      }
    }
    const auth = new Map(AUTH_TYPE_DEFS.map(def => [def.id, def]));
    const nodes = new Map(doc.nodes.map(node => [node.id, node]));
    const edges = new Map(doc.edges.map(edge => [edge.id, edge]));
    const data = new Set(doc.data.map(item => item.id));
    const boundaries = new Map(doc.boundaries.map(boundary => [boundary.id, boundary]));
    const scenarios = new Map(doc.scenarios.map(scenario => [scenario.id, scenario]));
    unique([...nodes.keys(), ...edges.keys(), ...data, ...boundaries.keys(), ...scenarios.keys(),
      ...doc.comments.map(comment => comment.id), ...doc.workItems.map(item => item.id), ...doc.issues.map(issue => issue.id),
      ...doc.edges.flatMap(edge => edge.waypoints.map(point => point.id))], "Document");
    for (const [label, items] of Object.entries({ nodes: doc.nodes, edges: doc.edges, data: doc.data,
      boundaries: doc.boundaries, scenarios: doc.scenarios })) unique(items.map(item => item.id), label);
    for (const node of doc.nodes) {
      assert.deepEqual([node.type, resolveDfdRole(node, doc.nodeTypes).role], expected.nodes[node.id],
        `${node.id}: actual service and effective DFD role must match the architecture`);
      assert.ok(doc.nodeTypes.some(type => type.id === node.type));
      assert.equal(node.serviceTreeId, "", "Examples must not invent service ownership");
      assert.ok(node.description.length > 50);
      assert.match(node.color, /^#[0-9a-f]{6}$/);
      assert.equal(node.dfdRoleLegacy, false, "Refreshed nodes explicitly adopt authored role semantics");
      assert.ok(["catalog", "override"].includes(resolveDfdRole(node, doc.nodeTypes).source));
      if (node.endpointRegex) {
        const regex = new RegExp(node.endpointRegex);
        const host = node.endpointRegex.match(/^\^https:\/\/(.+)\(\?:\/\|\$\)$/)?.[1]?.replaceAll("\\.", ".");
        assert.ok(host?.endsWith(".example"), "Endpoint examples use reserved .example hosts");
        assert.ok(regex.test(`https://${host}/v1/example`));
        assert.ok(!regex.test(`https://${host}.attacker.test/`), "Host prefix is not an origin boundary");
        assert.ok(!regex.test(`https://${host.replaceAll(".", "X")}/`), "Host dots must be escaped");
      }
    }
    for (const edge of doc.edges) {
      assert.deepEqual([edge.source, edge.target], expected.endpoints[edge.id], `${edge.id}: intended request direction`);
      assert.ok(nodes.has(edge.source) && nodes.has(edge.target), `${edge.id}: valid endpoints`);
      assert.equal(edge.authenticationTypes.length, 1);
      const definition = auth.get(edge.authenticationTypes[0]);
      assert.ok(definition && !definition.legacy, `${edge.id}: a current, unambiguous built-in method`);
      if (definition.behavior.audience) assert.ok(edge.audience?.trim());
      assert.deepEqual(edge.authenticationTypes, [expected.authentication[edge.id]]);
      if (definition.behavior.productionIdentity === "required") {
        assert.ok(edge.productionIdentity, `${edge.id}: caller identity`);
      }
      if (edge.productionIdentity?.kind === "AppId") {
        assert.ok(PRODUCTION_IDENTITY_TENANT_DEFS.some(tenant => tenant.id === edge.productionIdentity.tenant));
        const digit = String(expected.clientIds[edge.id]);
        assert.equal(edge.productionIdentity.appId,
          `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
          `${edge.id}: production identity belongs to the named calling application, not a blanket chain identity`);
        assert.match(edge.description, /not the human/);
      }
      assert.equal(edge.productionIdentity?.kind === "ManagedIdentity", definition.behavior.managedIdentity);
      for (const field of ["sourceHandle", "targetHandle"]) {
        assert.ok(["top", "right", "bottom", "left"].includes(edge[field]), `${edge.id}: explicit routing`);
      }
      assert.ok(edge.waypoints.length);
      assert.match(edge.requiredAccessRights, /^Reference requirement: /);
      assert.ok(edge.requiredAccessRights.length <= 4000);
      if (expected.protectedRights[edge.id]) assert.match(edge.requiredAccessRights, expected.protectedRights[edge.id]);
    }
    for (const boundary of doc.boundaries) {
      assert.ok(boundary.nodeIds.length, `${boundary.id}: explicit membership`);
      unique(boundary.nodeIds, boundary.id);
      for (const id of boundary.nodeIds) {
        assert.ok(nodes.has(id));
        assert.ok(containsRect(boundaryRect(boundary), nodeRect(nodes.get(id))), `${id} is inside ${boundary.id}`);
      }
      for (const node of doc.nodes.filter(node => !boundary.nodeIds.includes(node.id))) {
        assert.equal(overlapRatio(nodeRect(node), boundaryRect(boundary)), 0,
          `${node.id} must not visually belong to ${boundary.id}`);
      }
    }
    for (const item of doc.data) {
      assert.ok(DATA_CLASSIFICATIONS.includes(item.classification));
      assert.equal(item.classification, expected.classifications[item.id], `${item.id}: intended privacy category`);
      assert.ok(item.sample && !/real (card|patient)/i.test(item.sample));
    }
    for (const scenario of doc.scenarios) {
      assert.ok(scenario.description.includes("Synthetic"), "State the limits of the example in the model");
      assert.deepEqual(scenario.edgeIds, expected.scenarios[scenario.id], "Meaningful request sequence, not inferred from file");
      assert.deepEqual([...scenario.nodeIds].sort(),
        [...new Set(expected.scenarios[scenario.id].flatMap(id => expected.endpoints[id]))].sort(),
        "Every intended external participant and subject must be visible in the scenario");
      assert.equal(scenario.nodeScopeReasons, undefined, "Subject processes/stores must not be excluded");
      for (const [ids, known] of [[scenario.nodeIds, nodes], [scenario.edgeIds, edges], [scenario.boundaryIds, boundaries]]) {
        unique(ids, scenario.id);
        for (const id of ids) assert.ok(known.has(id), `${scenario.id}: ${id} exists`);
      }
      assert.deepEqual(Object.keys(scenario.edgeNumbers).sort(), [...scenario.edgeIds].sort());
      assert.deepEqual(scenario.edgeIds.map(id => scenario.edgeNumbers[id]),
        scenario.edgeIds.map((_, index) => index + 1));
      for (const id of scenario.edgeIds) {
        const edge = edges.get(id);
        assert.ok(scenario.nodeIds.includes(edge.source) && scenario.nodeIds.includes(edge.target));
        assert.ok(!edge.problem, "All variants are ideal reference designs, not deliberate insecure examples");
        assert.ok(scenario.edgeRequestData[id].length, "Every request has a meaningful payload");
      }
      for (const bucket of [scenario.edgeRequestData, scenario.edgeResponseData]) {
        assert.deepEqual(Object.keys(bucket).sort(), [...scenario.edgeIds].sort());
        for (const ids of Object.values(bucket)) {
          unique(ids, "Data attachment");
          for (const id of ids) assert.ok(data.has(id));
        }
      }
      for (const [id, items] of Object.entries(scenario.nodeData)) {
        assert.ok(scenario.nodeIds.includes(id));
        for (const [dataId, retention] of Object.entries(items)) {
          assert.ok(data.has(dataId));
          assert.ok(RETENTION_TYPES.includes(retention));
          assert.notEqual(retention, "", "Reference recipients need a stated retention decision");
        }
        for (const id of scenario.nodeIds) {
          const scope = resolveNodeReviewScope(nodes.get(id), scenario, doc.nodeTypes);
          assert.deepEqual(scope.diagnostics, []);
          if (scope.role.role === "ExternalInteractor") {
            assert.equal(scope.disposition, "external");
            assert.equal(scope.storedReason, undefined, "External is a black box, not out-of-scope infrastructure");
          }
          else assert.equal(scope.disposition, "inScope", `${id}: subject interior stays in scope`);
        }
        assert.ok(scenario.nodeIds.some(id => resolveDfdRole(nodes.get(id), doc.nodeTypes).role === "ExternalInteractor"),
          "Every reference scenario has a visible external participant");
      }
    }
    for (const comment of doc.comments) {
      const scenario = scenarios.get(comment.scenarioId);
      assert.ok(scenario);
      assert.ok((comment.targetKind === "node" ? scenario.nodeIds : scenario.edgeIds).includes(comment.targetId));
    }
    const analyzed = new IssueManager().analyze(normalized);
    assert.deepEqual(analyzed.scenarios, normalized.scenarios,
      "Analyze must not add accidentally omitted directional retention entries");
    assert.equal(doc.issues.length, 2);
    assert.deepEqual(new Set(doc.issues.map(issue => issue.targetKind)), new Set(["node", "edge"]));
    for (const note of doc.issues) {
      assert.ok(isAuthoredThreatNote(note));
      assert.equal(note.status, "Active");
      assert.match(note.description, /^Reference review concern: /);
      assert.ok(note.justification.length > 50);
      assert.ok(note.scenarioIds.length);
      for (const id of note.scenarioIds) {
        assert.ok((note.targetKind === "node" ? scenarios.get(id).nodeIds : scenarios.get(id).edgeIds).includes(note.targetId));
      }
    }
    assert.deepEqual(analyzed.issues.filter(isAuthoredThreatNote), normalized.issues,
      "Analyze cannot rewrite authored notes or convert them to generated findings");
    const actual = analyzed.issues.filter(issue => issue.kind).map(issue => [issue.kind, issue.targetId]).sort();
    assert.deepEqual(actual, [], "Ideal examples have no known deterministic gaps; declared controls still require evidence");
    for (const issue of analyzed.issues.filter(issue => issue.kind)) {
      assert.deepEqual(issue.scenarioIds, issue.kind === "Edge_missing_production_identity" ? [] : ["s_risky"]);
      for (const baseline of doc.scenarios.filter(scenario => scenario.id !== "s_risky")) {
        assert.ok(issue.scenarioIds.length
          ? !issue.scenarioIds.includes(baseline.id)
          : !(issue.targetKind === "edge" ? baseline.edgeIds : baseline.nodeIds).includes(issue.targetId),
        "Reference scenarios must not inherit teaching findings");
      }
    }
    const again = new IssueManager().analyze(analyzed);
    assert.deepEqual(again, analyzed, "Repeated analysis preserves finding identities and state");
    assert.ok(doc.edges.every(edge => !edge.problem));
    assert.ok(doc.comments.some(comment => comment.scenarioId === "s_secure"));
    assert.ok(doc.comments.some(comment => comment.scenarioId === "s_risky"));
    assert.ok(doc.workItems.length, "Provide actionable follow-up exercises");
  });
}

test("ideal samples keep subject interiors, external crossings and privacy directions explicit", () => {
  const read = file => JSON.parse(readFileSync(new URL(file, sampleDirectory), "utf8")).doc;
  const ai = read("ai-document-assistant.tma");
  const provider = ai.nodes.find(node => node.id === "n_model");
  assert.equal(provider.type, "azure.ai.openai");
  assert.equal(ai.nodeTypes.find(type => type.id === provider.type).definition.defaultDfdRole, "Process");
  assert.equal(provider.dfdRoleOverride, "ExternalInteractor");
  for (const file of sampleFiles) {
    const doc = read(file);
    assert.ok(doc.nodes.some(node => resolveDfdRole(node, doc.nodeTypes).role === "DataStore"));
    assert.ok(doc.nodes.some(node => resolveDfdRole(node, doc.nodeTypes).role === "ExternalInteractor"));
    assert.ok(doc.edges.some(edge => edge.requiredAccessRights));
    for (const scenario of doc.scenarios) {
      const expectedExcluded = [];
      assert.deepEqual(doc.edges.filter(edge => scenario.edgeIds.includes(edge.id) &&
        resolveFlowReviewScope(edge, doc, scenario).disposition === "excluded").map(edge => edge.id), expectedExcluded);
      const projected = buildDfdReviewContext(doc, scenario);
      assert.deepEqual(projected.scenario.edgeIds,
        doc.edges.filter(edge => scenario.edgeIds.includes(edge.id) && !expectedExcluded.includes(edge.id)).map(edge => edge.id));
      assert.deepEqual(projected.scenario.edgeNumbers, Object.fromEntries(Object.entries(scenario.edgeNumbers)
        .filter(([id]) => !expectedExcluded.includes(id))), "Scenario sequence numbers survive scope projection");
      assert.equal(projected.reviewScope.fixedChecks, "unchanged");
    }
  }
  const baseline = ai.scenarios.find(scenario => scenario.id === "s_secure");
  const review = ai.scenarios.find(scenario => scenario.id === "s_risky");
  assert.equal(resolveNodeReviewScope(ai.nodes.find(node => node.id === "n_app"), baseline, ai.nodeTypes).disposition, "inScope");
  assert.equal(resolveNodeReviewScope(ai.nodes.find(node => node.id === "n_app"), review, ai.nodeTypes).disposition, "inScope");
  assert.equal(buildDfdReviewContext(ai, baseline).nodes.find(node => node.id === "n_app").reviewContext, "interior");
  const aiMetrics = ai.scenarios.find(s => s.id === "s_risky");
  assert.deepEqual(aiMetrics.edgeRequestData.e_log, ["d_metrics"]);
  assert.deepEqual(aiMetrics.edgeRequestData.e_generate, ["d_question", "d_document"]);
  assert.equal(aiMetrics.nodeData.n_logs.d_metrics, "StorageOver48Hours");
  assert.equal(aiMetrics.nodeData.n_vector.d_identity, "ProcessingNoStorage", "Caller permissions are not stored document ACLs");
  assert.equal(aiMetrics.nodeData.n_vector.d_acl, "StorageOver48Hours");
  assert.deepEqual(aiMetrics.edgeResponseData.e_retrieve, ["d_document", "d_acl"]);
  assert.equal(aiMetrics.nodeData.n_gateway.d_acl, "ProcessingNoStorage");
  assert.match(ai.data.find(item => item.id === "d_identity").sample, /validatedCallerGroups/);
  assert.doesNotMatch(ai.data.find(item => item.id === "d_identity").sample, /"documentAcl"/);
  for (const [file, id, subtype] of [
    ["customer-profile-service.tma", "b_prod", "VNet"],
    ["ai-document-assistant.tma", "b_ai", "Subnet"],
  ]) {
    const boundary = read(file).boundaries.find(item => item.id === id);
    assert.equal(boundary.securitySubtype, subtype);
    for (const field of ["inboundAllow", "inboundDeny", "outboundAllow", "outboundDeny"]) {
      assert.match(boundary[field], /^Reference intent: /);
    }
  }
  const saas = read("multi-tenant-saas-platform.tma");
  for (const id of ["e_gateway", "e_service", "e_db"]) {
    for (const scenario of saas.scenarios.filter(scenario => scenario.id !== "s_risky")) {
      assert.ok(scenario.edgeIds.includes(id));
      assert.equal(scenario.requiredAccessRights, undefined, "Access rights belong to the shared flow");
    }
  }
  assert.deepEqual(saas.scenarios[0].edgeResponseData.e_db, ["d_tenant"]);
  assert.deepEqual(saas.scenarios[1].edgeResponseData.e_db, ["d_tenant_b"]);
  assert.deepEqual(saas.scenarios[2].edgeResponseData.e_export, ["d_export"]);
  assert.deepEqual(saas.scenarios[2].edgeRequestData.e_export,
    ["d_export_query", "d_tenant_id", "d_case", "d_admin"]);
  assert.doesNotMatch(saas.data.find(item => item.id === "d_export").sample, /tenant-synthetic-b|record-synthetic-b/);
  assert.equal(saas.scenarios[2].nodeData.n_db.d_tenant, "StorageOver48Hours", "SQL owns the underlying Tenant A content");
  assert.equal(saas.scenarios[2].nodeData.n_db.d_export, "ProcessingNoStorage");
  assert.equal(saas.scenarios[2].nodeData.n_support.d_export, "ProcessingNoStorage");
  for (const scenario of saas.scenarios) {
    const partition = scenario.id === "s_tenant_b" ? "d_tenant_id_b" : "d_tenant_id";
    assert.equal(scenario.nodeData.n_db[partition], "StorageOver48Hours", "Persisted SQL tenant partition association");
    for (const id of ["n_web", "n_gateway", "n_service"]) {
      if (scenario.nodeData[id]?.[partition]) assert.equal(scenario.nodeData[id][partition], "ProcessingNoStorage");
    }
    for (const claim of ["d_identity", "d_identity_b", "d_export_query", "d_subject", "d_subject_b"]) {
      if (scenario.nodeData.n_db[claim]) assert.equal(scenario.nodeData.n_db[claim], "ProcessingNoStorage");
    }
  }
  const health = read("healthcare-data-exchange.tma").scenarios[1];
  assert.deepEqual(health.edgeRequestData.e_lab, ["d_order_ref", "d_patient_ref", "d_test"], "No full chart leaves for the lab");
  assert.deepEqual(health.edgeRequestData.e_result, ["d_order_ref", "d_patient_ref", "d_result", "d_event"]);
  assert.deepEqual(health.edgeRequestData.e_result_store, ["d_order_ref", "d_patient_ref", "d_result", "d_event"]);
  assert.deepEqual(health.edgeRequestData.e_order_store, ["d_order_ref", "d_patient_ref", "d_test", "d_assignment"]);
  assert.deepEqual(health.edgeResponseData.e_order_lookup, ["d_patient_ref", "d_assignment"]);
  assert.equal(health.nodeData.n_ehr.d_assignment, "StorageOver48Hours");
  assert.ok(health.edgeNumbers.e_order_store < health.edgeNumbers.e_lab);
  assert.ok(health.edgeNumbers.e_result < health.edgeNumbers.e_order_lookup &&
    health.edgeNumbers.e_order_lookup < health.edgeNumbers.e_result_store);
  assert.deepEqual(health.edgeResponseData.e_access, ["d_patient", "d_order_ref", "d_ack"], "Initial response does not contain a future result");
  assert.equal(health.nodeData.n_ehr.d_result, "StorageOver48Hours");
  const profile = read("customer-profile-service.tma").scenarios[1];
  assert.deepEqual(profile.edgeRequestData.e_telemetry, ["d_metrics"], "No contact export to analytics");
  assert.equal(profile.nodeData.n_db.d_subject, "StorageOver48Hours", "Persistent profile ownership mapping");
});

test("payment is registered Azure SQL DataStore through normalization, native reopen and TM7", async () => {
  const { prepareTm7Export } = await import("../../src/tm7Export.ts");
  const { DOMParser } = await import("@xmldom/xmldom");
  const doc = normalizeDoc(JSON.parse(readFileSync(new URL("payment-processing.tma", sampleDirectory), "utf8")).doc);
  for (const candidate of [doc, normalizeDoc(JSON.parse(JSON.stringify(doc)))]) {
    const ledger = candidate.nodes.find(node => node.id === "n_ledger");
    assert.equal(ledger.type, "azure.databases.sql", "Renaming Database without changing service identity is not a fix");
    assert.equal(ledger.dfdRoleLegacy, false);
    assert.equal(ledger.dfdRoleOverride, undefined, "No Process override on the SQL store");
    assert.equal(resolveDfdRole(ledger, candidate.nodeTypes).role, "DataStore");
    assert.equal(candidate.nodeTypes.find(type => type.id === ledger.type).definition.defaultDfdRole, "DataStore");
    for (const scenario of candidate.scenarios) {
      assert.deepEqual(scenario.edgeRequestData.e_ledger, ["d_order_ref", "d_transaction", "d_attempt", "d_event"]);
      assert.deepEqual(scenario.edgeRequestData.e_order_read, ["d_subject", "d_order_ref", "d_attempt"]);
      assert.deepEqual(scenario.edgeResponseData.e_order_read, ["d_order"]);
      assert.deepEqual(scenario.edgeRequestData.e_provider, ["d_order_ref", "d_order", "d_token", "d_attempt"],
        "Merchant attempt exists before the request; provider event ID does not");
      assert.equal(scenario.nodeData.n_ledger.d_attempt, "StorageOver48Hours");
      assert.equal(scenario.nodeData.n_ledger.d_token, undefined, "A payment token is not ledger content");
      assert.equal(scenario.nodeData.n_ledger.d_transaction, "StorageOver48Hours");
      assert.equal(scenario.nodeData.n_ledger.d_order, "StorageOver48Hours");
      for (const [id, values] of Object.entries(scenario.nodeData)) {
        if (values.d_token !== undefined) assert.equal(values.d_token, "ProcessingNoStorage", id);
      }
    }
    assert.deepEqual(candidate.scenarios[0].edgeResponseData.e_provider, ["d_order_ref", "d_transaction", "d_attempt", "d_event"]);
    for (const id of ["e_checkout", "e_intent"]) {
      assert.deepEqual(candidate.scenarios[1].edgeResponseData[id], ["d_order_ref", "d_pending"], "Async acceptance is not a final result");
    }
    assert.deepEqual(candidate.scenarios[1].edgeResponseData.e_provider, ["d_order_ref", "d_pending", "d_attempt"]);
    assert.deepEqual(candidate.scenarios[1].edgeRequestData.e_callback, ["d_order_ref", "d_transaction", "d_attempt", "d_event"]);
    const exported = prepareTm7Export(candidate);
    const xml = new DOMParser().parseFromString(exported.xml, "text/xml");
    for (const reference of exported.references.filter(ref => ref.entityId === "n_ledger")) {
      const element = [...xml.getElementsByTagName("*")].find(element => element.getAttribute("z:Id") === reference.serializationId);
      assert.ok(element, "SQL stencil serialized");
      assert.match(element.toString(), /GE\.DS/);
      assert.doesNotMatch(element.toString(), /<[^>]*TypeId>GE\.P</);
    }
  }
});
