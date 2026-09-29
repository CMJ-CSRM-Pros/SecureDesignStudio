import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import * as Y from "yjs";
import { documentFixture } from "./catalog-fixtures.mjs";

const types = await import("../../src/types.ts");
const { resolveLibraries, CORE_LIBRARIES } = await import("../../src/libraries/registry.ts");
const { withLibraryDefinitions } = await import("../../src/libraries/document.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { DEFAULT_CLASSIFICATION_LIBRARY } = await import("../../src/classificationLibrary.ts");
const synthetic = [
  { kind: "privacyBoundary", id: "M365ComplianceBoundary", label: "Historical privacy", description: "Synthetic portable privacy definition." },
  { kind: "securityBoundary", id: "CoreServicesIslands", label: "Historical security", description: "Synthetic portable security definition." },
  { kind: "deviation", id: "ests-relationship", label: "Historical identity evidence" },
];
const registry = resolveLibraries([{ source: "Synthetic", value: {
  format: "secure-design-studio-library", apiVersion: 1,
  id: "taxonomy-fixture", name: "Taxonomy fixture", version: "1.0.0", catalogs: { taxonomy: synthetic },
} }]);

test("taxonomy: core retains only the agreed boundaries and generic evidence kinds", async () => {
  assert.deepEqual(types.PRIVACY_BOUNDARY_TYPE_DEFS.map(def => def.id), ["GeoBoundary"]);
  assert.deepEqual(types.SECURITY_BOUNDARY_TYPE_DEFS.map(def => def.id), ["IFrame", "Csp", "Azure", "UserBrowser", "UserTenantTrust"]);
  assert.equal(types.DEVIATION_KINDS.includes("ests-relationship"), false);
  const source = JSON.parse(await readFile("src/data/deviationTypes.json", "utf8"));
  assert.deepEqual(types.DEVIATION_KINDS, source.map(def => def.id));
  assert.deepEqual(CORE_LIBRARIES.classifications, DEFAULT_CLASSIFICATION_LIBRARY);
  assert.equal(DEFAULT_CLASSIFICATION_LIBRARY.defaultId, "EUII", "Classification extraction is not this checkpoint");
});

test("taxonomy: saved definitions retain labels but cannot enable missing authoring choices", () => {
  for (const def of synthetic) {
    assert.ok(types.catalogDefinitionsFor(def.kind, synthetic).some(item => item.id === def.id));
    assert.equal(types.catalogDefinitionChoices(def.kind, synthetic, CORE_LIBRARIES.taxonomy).some(item => item.id === def.id), false);
    assert.ok(types.catalogDefinitionChoices(def.kind, synthetic, registry.taxonomy).some(item => item.id === def.id));
    assert.throws(() => types.assertCatalogSelection(def.kind, def.id, undefined, CORE_LIBRARIES.taxonomy), /requires an available library/);
    assert.doesNotThrow(() => types.assertCatalogSelection(def.kind, def.id, def.id, CORE_LIBRARIES.taxonomy));
    assert.doesNotThrow(() => types.assertCatalogSelection(def.kind, "", def.id, CORE_LIBRARIES.taxonomy));
    assert.doesNotThrow(() => types.assertCatalogSelection(def.kind, def.id, undefined, registry.taxonomy));
  }
});

function model() {
  const doc = documentFixture();
  doc.boundaries = [
    { id: "b_p", type: "privacy", privacySubtype: synthetic[0].id, title: "Privacy", position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, nodeIds: [] },
    { id: "b_s", type: "security", securitySubtype: synthetic[1].id, title: "Security", position: { x: 400, y: 0 }, size: { width: 300, height: 200 }, nodeIds: [] },
  ];
  doc.scenarios[0].boundaryIds = ["b_p", "b_s"];
  doc.deviations = [{
    id: "dv_old", key: "synthetic:old", kind: synthetic[2].id, title: "Historical evidence",
    description: "Synthetic", explanation: "Preserve", status: "Resolved", scenarioIds: [doc.scenarios[0].id],
    evidenceIds: ["synthetic:1"], createdAt: 1, updatedAt: 2,
  }];
  return doc;
}

test("taxonomy: capture is referenced-only, saved-first and preserved through native and peer round-trips", () => {
  const doc = model();
  const captured = withLibraryDefinitions(doc, registry);
  assert.equal(captured.catalogDefinitions.length, 3);
  captured.catalogDefinitions[0] = { ...captured.catalogDefinitions[0], label: "Saved different label" };
  const again = withLibraryDefinitions(captured, registry);
  assert.equal(again.catalogDefinitions[0].label, "Saved different label");
  const reopened = normalizeDoc(JSON.parse(JSON.stringify(again)));
  assert.deepEqual(reopened.catalogDefinitions, again.catalogDefinitions);
  assert.deepEqual(reopened.deviations, captured.deviations);
  const left = createYShape(), right = createYShape();
  try {
    reconcileLocalToY(left, reopened);
    Y.applyUpdate(right.ydoc, Y.encodeStateAsUpdate(left.ydoc));
    const peer = buildDocFromY(right);
    assert.equal(peer.boundaries.find(item => item.id === "b_p").privacySubtype, synthetic[0].id);
    assert.equal(peer.boundaries.find(item => item.id === "b_s").securitySubtype, synthetic[1].id);
    assert.equal(peer.deviations[0].kind, synthetic[2].id);
    assert.equal(peer.catalogDefinitions.find(def => def.id === synthetic[0].id).label, "Saved different label");
  } finally { left.ydoc.destroy(); right.ydoc.destroy(); }
});

test("taxonomy: absent snapshots stay unresolved; reports display saved evidence rather than replacing IDs", () => {
  const doc = normalizeDoc(model());
  assert.equal(types.privacyBoundaryTypeLabel(synthetic[0].id), `${synthetic[0].id} (unresolved)`);
  assert.equal(types.securityBoundaryTypeLabel(synthetic[1].id), `${synthetic[1].id} (unresolved)`);
  assert.equal(types.deviationKindLabel(synthetic[2].id), `${synthetic[2].id} (unresolved)`);
  doc.catalogDefinitions = synthetic;
  const html = buildReviewReportHtml({ doc, scenario: doc.scenarios[0], documentFileName: "synthetic.tma", appVersion: "test" });
  assert.match(html, /Historical privacy/);
  assert.match(html, /Historical security/);
  assert.match(html, /Historical identity evidence/);
  assert.equal(doc.deviations[0].kind, "ests-relationship");
});
