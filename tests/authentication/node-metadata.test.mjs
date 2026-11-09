import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { documentFixture } from "./catalog-fixtures.mjs";

const { resolveLibraries } = await import("../../src/libraries/registry.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { nodeTypeMetadataDefaults } = await import("../../src/nodeTypeMetadata.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const nodeType = {
  id: "Legacy Service (v1)", label: "Legacy service",
  definition: {
    serviceTreeId: "11111111-1111-4111-8111-111111111111",
    endpointRegex: "^https://legacy\\.example\\.invalid/",
    allowedAuthMethods: [{ id: "ApiKey", status: "Allowed" }],
    allowedDataTypes: [{ id: "*", retention: "*", action: "Deny" }],
  },
};

test("node metadata: package IDs retain spaces and parentheses without weakening package identity validation", () => {
  const pkg = {
    format: "secure-design-studio-library", apiVersion: 1,
    id: "legacy-fixture", name: "Legacy fixture", version: "1.0.0", catalogs: { nodes: [nodeType] },
  };
  const result = resolveLibraries([{ source: "Synthetic", value: pkg }]);
  assert.equal(result.statuses[0].state, "loaded", result.statuses[0].message);
  assert.equal(result.nodes.find(type => type.id === nodeType.id).id, nodeType.id);
  for (const invalid of ["__proto__", " constructor", "bad<id>", "", "x".repeat(129)]) {
    const bad = structuredClone(pkg);
    bad.catalogs.nodes[0].id = invalid;
    assert.equal(resolveLibraries([{ source: "Invalid", value: bad }]).statuses[0].state, "rejected");
  }
  assert.equal(resolveLibraries([{ source: "Invalid package identity", value: { ...pkg, id: "Package with spaces" } }])
    .statuses[0].state, "rejected");
});

function legacyModel() {
  const doc = documentFixture();
  doc.nodes[0].type = nodeType.id;
  doc.nodes[0].serviceTreeId = "22222222-2222-4222-8222-222222222222";
  doc.nodes[0].endpointRegex = "^https://saved\\.example\\.invalid/";
  doc.nodeTypes = [{ id: nodeType.id, label: nodeType.label }];
  return doc;
}

test("node metadata: unknown references do not become fabricated saved definitions", () => {
  const doc = legacyModel();
  const normalized = normalizeDoc(doc);
  assert.equal(normalized.nodeTypes.find(type => type.id === nodeType.id).definition, undefined);
  const strings = normalizeDoc({ ...doc, nodeTypes: [nodeType.id] });
  assert.equal(strings.nodeTypes.find(type => type.id === nodeType.id).definition, undefined);
  const restored = normalizeDoc(JSON.parse(JSON.stringify(normalized)), [nodeType]);
  assert.deepEqual(restored.nodeTypes.find(type => type.id === nodeType.id).definition.allowedAuthMethods,
    nodeType.definition.allowedAuthMethods);
  assert.equal(restored.nodes[0].serviceTreeId, doc.nodes[0].serviceTreeId);
  assert.equal(restored.nodes[0].endpointRegex, doc.nodes[0].endpointRegex);
  const explicit = structuredClone(doc);
  explicit.nodeTypes[0].definition = { serviceTreeId: "", endpointRegex: "^$", allowedAuthMethods: [], allowedDataTypes: [], policyStatus: "Unspecified" };
  assert.equal(normalizeDoc(explicit, [nodeType]).nodeTypes.find(type => type.id === nodeType.id).definition.policyStatus, "Unspecified",
    "An explicitly saved definition still wins");
});

test("node metadata: omitted or unspecified defaults never erase retained instance values", () => {
  assert.deepEqual(nodeTypeMetadataDefaults(undefined), { values: {} });
  const unspecified = { serviceTreeId: "", endpointRegex: "^$", policyStatus: "Unspecified" };
  const node = legacyModel().nodes[0];
  assert.deepEqual({ ...node, ...nodeTypeMetadataDefaults(unspecified).values }, node);
  assert.deepEqual(nodeTypeMetadataDefaults({ ...unspecified, endpointRegex: "^https://public\\.example\\.invalid/" }).values,
    { endpointRegex: "^https://public\\.example\\.invalid/" });
  assert.deepEqual(nodeTypeMetadataDefaults({ serviceTreeId: "", endpointRegex: "^$" }).values, { endpointRegex: "^$" },
    "An explicit curated non-addressable endpoint remains a supplied default");
});

test("node metadata: invalid defaults are diagnosed and never partially applied", () => {
  for (const definition of [
    { ...nodeType.definition, endpointRegex: "^?$" },
    { ...nodeType.definition, serviceTreeId: "not-a-guid" },
  ]) {
    const result = nodeTypeMetadataDefaults(definition, {
      id: "serviceTreeId", target: "node", storage: "serviceTreeId", label: "ServiceTreeId", validation: "guid",
    });
    assert.deepEqual(result.values, {});
    assert.match(result.error, /invalid/);
  }
});

test("node metadata: unavailable ID-only references survive peer transport and later definition availability", () => {
  const a = createYShape(), b = createYShape();
  try {
    const input = normalizeDoc(legacyModel());
    reconcileLocalToY(a, input);
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const received = buildDocFromY(b);
    assert.equal(received.nodeTypes.find(type => type.id === nodeType.id).definition, undefined);
    assert.deepEqual(received.nodes[0], input.nodes[0]);
    const restored = normalizeDoc(received, [nodeType]);
    assert.deepEqual(restored.nodeTypes.find(type => type.id === nodeType.id).definition.allowedDataTypes,
      nodeType.definition.allowedDataTypes);
  } finally { a.ydoc.destroy(); b.ydoc.destroy(); }
});
