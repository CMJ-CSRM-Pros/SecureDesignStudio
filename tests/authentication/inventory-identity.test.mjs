import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { documentFixture } from "./catalog-fixtures.mjs";

const { CORE_LIBRARIES, resolveLibraries } = await import("../../src/libraries/registry.ts");
const { inventoryIdError, inventoryFieldFor } = await import("../../src/inventoryIdentity.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { nodeTypeMetadataDefaults } = await import("../../src/nodeTypeMetadata.ts");
const { validateMetadataFields } = await import("../../src/libraries/validation.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { diffDocuments } = await import("../../src/diff.ts");
const { exportTm7 } = await import("../../src/tm7Export.ts");
const { parseTm7 } = await import("../../src/tm7Import.ts");
const { DOMParser } = await import("@xmldom/xmldom");
const { exportVsdx } = await import("../../src/vsdxExport.ts");
const { unzipSync, strFromU8 } = await import("fflate");

test("inventory: core offers optional ordinary-text Inventory ID and no ServiceTree requirement", () => {
  const field = inventoryFieldFor(CORE_LIBRARIES.fields);
  assert.equal(field.label, "Inventory ID");
  assert.equal(field.storage, "serviceTreeId");
  assert.equal(field.validation, undefined);
  assert.equal(CORE_LIBRARIES.nodes.length, 164);
  assert.ok(CORE_LIBRARIES.nodes.every(type => type.definition.policyStatus === "Unspecified"));
  const blank = documentFixture(); blank.nodes.forEach(node => node.serviceTreeId = "");
  assert.equal(new IssueManager().analyze(blank).issues.some(issue => issue.kind === "Node_must_have_servicetree"), false);
  assert.equal(inventoryIdError("ASSET-123"), undefined);
  assert.equal(inventoryIdError(""), undefined);
  assert.ok(inventoryIdError("bad\nvalue"));
  assert.ok(inventoryIdError("x".repeat(4001)));
  assert.throws(() => validateMetadataFields([{
    id: "other", target: "node", storage: "metadata", label: "Other", validation: "guid",
  }]), /only on the inventory identity binding/);
  assert.equal(nodeTypeMetadataDefaults({ serviceTreeId: "ASSET-123", endpointRegex: "^$", policyStatus: "Unspecified" }).values.serviceTreeId, "ASSET-123");
});

function customRegistry() {
  return resolveLibraries([{ source: "Synthetic", value: {
    format: "secure-design-studio-library", apiVersion: 1, id: "inventory-fixture", name: "Inventory fixture", version: "1.0.0",
    overrides: [{ key: "fields/servicetreeid", from: "core" }],
    fields: [{ id: "serviceTreeId", target: "node", storage: "serviceTreeId", label: "ServiceTreeId", validation: "guid" }],
    rules: [{ id: "Node_must_have_servicetree", target: "node", fieldId: "serviceTreeId", check: "required",
      title: "Inventory identity missing", description: "Synthetic requirement." }],
  } }]);
}

test("inventory: selected field contract validates GUIDs and activates only its declared requirement", () => {
  const registry = customRegistry();
  assert.equal(registry.statuses[0].state, "loaded");
  assert.ok(inventoryIdError("ASSET-123", inventoryFieldFor(registry.fields)));
  const doc = documentFixture(); doc.nodes[0].serviceTreeId = "";
  const first = new IssueManager(undefined, undefined, registry.rules, registry.fields).analyze(doc);
  const issue = first.issues.find(issue => issue.kind === "Node_must_have_servicetree");
  assert.ok(issue);
  issue.status = "Resolved";
  const absent = new IssueManager().analyze(first);
  assert.equal(absent.issues.find(item => item.id === issue.id).notEvaluatedReason, "rule-unavailable");
  assert.equal(absent.issues.find(item => item.id === issue.id).status, "Resolved");
});

test("inventory: native documents and node definitions retain the existing JSON key with ordinary text", () => {
  const input = documentFixture();
  input.nodes[0].serviceTreeId = "ASSET-123";
  input.nodes[0].type = "Inventory fixture";
  input.nodeTypes = [{ id: "Inventory fixture", label: "Inventory fixture", definition: {
    serviceTreeId: "ASSET-456", endpointRegex: "^$", allowedAuthMethods: [], allowedDataTypes: [], policyStatus: "Unspecified",
  } }];
  const saved = normalizeDoc(input);
  assert.equal(saved.nodes[0].serviceTreeId, "ASSET-123");
  assert.equal(saved.nodeTypes.find(type => type.id === "Inventory fixture").definition.serviceTreeId, "ASSET-456");
  assert.equal("inventoryId" in saved.nodes[0], false);
  const next = structuredClone(saved); next.nodes[0].serviceTreeId = "ASSET-789";
  assert.match(diffDocuments(saved, next).find(change => change.description.includes("ASSET-789")).description, /Inventory ID/);
  assert.match(diffDocuments(saved, next, undefined, "ServiceTreeId").find(change => change.description.includes("ASSET-789")).description, /ServiceTreeId/);
});

test("inventory: reports and TM7 use selected labels and keep legacy ST imports", () => {
  const doc = normalizeDoc(documentFixture()); doc.nodes[0].serviceTreeId = "ASSET-123";
  const options = { doc, scenario: doc.scenarios[0], documentFileName: "fixture.tma", appVersion: "test" };
  assert.match(buildReviewReportHtml(options), /<th>Inventory ID<\/th>/);
  assert.match(buildReviewReportHtml({ ...options, inventoryLabel: "ServiceTreeId" }), /<th>ServiceTreeId<\/th>/);
  for (const inventoryLabel of ["Inventory ID", "ServiceTreeId"]) {
    const zip = unzipSync(exportVsdx(doc, { inventoryLabel }));
    assert.ok(Object.entries(zip).filter(([name]) => /^visio\/pages\/page\d+\.xml$/.test(name))
      .some(([, bytes]) => strFromU8(bytes).includes(`${inventoryLabel}: ASSET-123`)));
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: DOMParser });
  try {
    const xml = exportTm7(doc);
    assert.match(xml, /Inventory ID: ASSET-123/);
    for (const name of ["Inventory ID", "ServiceTreeId", "ST"]) {
      const loaded = parseTm7(xml.replaceAll("Inventory ID:", `${name}:`));
      assert.ok(loaded.doc.nodes.some(node => node.serviceTreeId === "ASSET-123"));
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "DOMParser", previous);
    else delete globalThis.DOMParser;
  }
});

test("inventory: package icon allowlist exactly matches existing bundled assets", async () => {
  const keys = [];
  const walk = async (relative = "") => {
    for (const entry of await readdir(join("src", "assets", "node-icons", relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".svg")) keys.push(path.replaceAll("\\", "/"));
    }
  };
  await walk();
  assert.deepEqual(JSON.parse(await readFile("src/data/nodeIconKeys.json", "utf8")), keys.sort());
});
