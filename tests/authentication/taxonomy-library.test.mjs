import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Y from "yjs";
import { documentFixture } from "./catalog-fixtures.mjs";

const types = await import("../../src/types.ts");
const { resolveLibraries, CORE_LIBRARIES } = await import("../../src/libraries/registry.ts");
const { withLibraryDefinitions } = await import("../../src/libraries/document.ts");
const { withCatalogDefinitions } = await import("../../src/catalogDefinitions.ts");
const { normalizeDoc, StoreProvider, useStore } = await import("../../src/store.tsx");
const { UiShellProvider } = await import("../../src/uiShell.tsx");
const { LibraryProvider } = await import("../../src/libraries/LibraryProvider.tsx");
const { CatalogDefinitionsNotice } = await import("../../src/components/CatalogDefinitionsNotice.tsx");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { DEFAULT_CLASSIFICATION_LIBRARY } = await import("../../src/classificationLibrary.ts");
const newSecurityIds = ["VNet", "Subnet", "Container", "Process", "Machine"];
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
  assert.deepEqual(types.SECURITY_BOUNDARY_TYPE_DEFS.map(def => def.id), [
    "IFrame", "Csp", "Azure", "UserBrowser", "UserTenantTrust", ...newSecurityIds,
  ]);
  assert.equal(types.DEVIATION_KINDS.includes("ests-relationship"), false);
  const source = JSON.parse(await readFile("src/data/deviationTypes.json", "utf8"));
  assert.deepEqual(types.DEVIATION_KINDS, source.map(def => def.id));
  assert.deepEqual(CORE_LIBRARIES.classifications, DEFAULT_CLASSIFICATION_LIBRARY);
  assert.equal(DEFAULT_CLASSIFICATION_LIBRARY.defaultId, "EUII", "Classification extraction is not this checkpoint");
});

test("taxonomy: all five security additions are available and capture portable descriptions", () => {
  assert.equal(registry.statuses[0].state, "loaded");
  const doc = documentFixture();
  doc.boundaries = newSecurityIds.map((id, index) => ({
    id: `b_${id}`, type: "security", securitySubtype: id, title: id,
    position: { x: index * 400, y: 0 }, size: { width: 300, height: 200 }, nodeIds: [],
  }));
  doc.scenarios[0].boundaryIds = doc.boundaries.map(boundary => boundary.id);
  const captured = withCatalogDefinitions(doc, CORE_LIBRARIES.taxonomy);
  assert.ok(Array.isArray(captured.catalogDefinitions));
  assert.deepEqual(captured.catalogDefinitions.map(def => def.id), newSecurityIds);
  for (const id of newSecurityIds) {
    const definition = captured.catalogDefinitions.find(def => def.id === id);
    assert.equal(definition.kind, "securityBoundary");
    assert.equal(definition.label, id);
    assert.ok(definition.description.length > 40);
    assert.equal(types.securityBoundaryTypeDescription(id), definition.description);
    for (const available of [CORE_LIBRARIES.taxonomy, registry.taxonomy]) {
      assert.ok(types.catalogDefinitionChoices("securityBoundary", [], available).some(def => def.id === id));
      assert.doesNotThrow(() => types.assertCatalogSelection("securityBoundary", id, undefined, available));
    }
  }
  const reopened = normalizeDoc(JSON.parse(JSON.stringify(captured)));
  assert.deepEqual(reopened.boundaries, captured.boundaries);
  assert.deepEqual(reopened.catalogDefinitions, captured.catalogDefinitions);
});

test("taxonomy: new security IDs require explicit package overrides, including case-insensitive collisions", () => {
  for (const id of newSecurityIds) {
    const candidate = {
      source: "Synthetic collision", value: {
        format: "secure-design-studio-library", apiVersion: 1,
        id: "boundary-overlay", name: "Boundary overlay", version: "1.0.0",
        catalogs: { taxonomy: [{ kind: "securityBoundary", id: id.toLowerCase(), label: "Package meaning" }] },
      },
    };
    const rejected = resolveLibraries([candidate]);
    assert.equal(rejected.statuses[0].state, "rejected");
    assert.match(rejected.statuses[0].message, /requires an explicit override of core/);
    assert.equal(types.securityBoundaryTypeLabel(id, [], rejected.taxonomy), id);
    candidate.value.catalogs.taxonomy[0].id = id;
    candidate.value.overrides = [{ key: `taxonomy/securityBoundary/${id}`, from: "core" }];
    const overridden = resolveLibraries([candidate]);
    assert.equal(overridden.statuses[0].state, "loaded");
    assert.equal(types.securityBoundaryTypeLabel(id, [], overridden.taxonomy), "Package meaning");
  }
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

function renderNotice(doc, available = CORE_LIBRARIES) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { getElementById: id => id === "ps-embedded-doc" ? { textContent: JSON.stringify(doc) } : null },
  });
  let renderedDoc;
  function NoticeProbe() {
    renderedDoc = useStore().doc;
    return createElement(CatalogDefinitionsNotice);
  }
  try {
    const markup = renderToStaticMarkup(createElement(LibraryProvider, { registry: available },
      createElement(UiShellProvider, null, createElement(StoreProvider, null, createElement(NoticeProbe)))));
    return { markup, doc: renderedDoc };
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else delete globalThis.document;
  }
}

test("taxonomy: notice distinguishes installed matches, label conflicts and description-only conflicts", () => {
  for (const kind of ["securityBoundary", "privacyBoundary", "deviation"]) {
    const installed = registry.taxonomy.find(def => def.kind === kind && def.id === synthetic.find(def => def.kind === kind).id);
    for (const changes of [{ label: "Saved alternate label" }, { description: "Saved alternate description" }, {}]) {
      const saved = { ...installed, ...changes };
      const doc = { ...model(), catalogDefinitions: [saved] };
      const before = structuredClone(doc);
      const rendered = renderNotice(doc, registry);
      assert.match(rendered.markup, Object.keys(changes).length
        ? /Differs from installed definition; saved definition retained\./
        : /Saved in diagram\./);
      assert.doesNotMatch(rendered.markup, /Document-only definition\./);
      assert.ok(rendered.markup.includes(`<strong>${saved.label}</strong>`));
      if (saved.description) assert.ok(rendered.markup.includes(`<p>${saved.description}</p>`));
      assert.match(rendered.markup, /Library metadata: taxonomy-fixture @ 1\.0\.0 \(unverified\)/);
      assert.deepEqual(rendered.doc.catalogDefinitions.find(def => def.kind === kind && def.id === saved.id), saved);
      assert.deepEqual(doc, before);
    }
  }
});

test("taxonomy: notice retains core and classification comparisons and document-only meaning", () => {
  const doc = model();
  doc.data = [{ id: "d_example", name: "Example", classification: "EUII", sample: "" }];
  doc.boundaries[1].securitySubtype = "IFrame";
  doc.catalogDefinitions = [
    { kind: "securityBoundary", id: "IFrame", label: "Saved iframe label" },
    { kind: "classification", id: "EUII", label: "Saved classification label" },
  ];
  const core = renderNotice(doc);
  assert.equal(core.markup.match(/Differs from installed definition; saved definition retained\./g)?.length, 2);
  assert.deepEqual(core.doc.catalogDefinitions, doc.catalogDefinitions);

  const savedOnly = { ...model(), catalogDefinitions: [synthetic[1]] };
  const absent = renderNotice(savedOnly);
  assert.match(absent.markup, /Document-only definition\./);
  assert.deepEqual(absent.doc.catalogDefinitions, savedOnly.catalogDefinitions);
  const sameLabel = resolveLibraries([{ source: "Synthetic other ID", value: {
    format: "secure-design-studio-library", apiVersion: 1,
    id: "other-boundary", name: "Other boundary", version: "1.0.0",
    catalogs: { taxonomy: [{ ...synthetic[1], id: "example:different-id" }] },
  } }]);
  assert.equal(sameLabel.statuses[0].state, "loaded");
  assert.match(renderNotice(savedOnly, sameLabel).markup, /Document-only definition\./);
  assert.equal(renderNotice(documentFixture()).markup, "");
});

test("taxonomy: ID-only fallback captures available meaning but never invents an absent snapshot", () => {
  const doc = model();
  const unavailable = withCatalogDefinitions(normalizeDoc(doc), CORE_LIBRARIES.taxonomy);
  assert.equal(unavailable.boundaries[1].securitySubtype, synthetic[1].id);
  assert.equal(unavailable.catalogDefinitions, undefined, "Absent snapshots remain absent");
  assert.equal(types.securityBoundaryTypeLabel(synthetic[1].id, unavailable.catalogDefinitions), `${synthetic[1].id} (unresolved)`);
  const captured = withLibraryDefinitions(doc, registry);
  const installed = registry.taxonomy.find(def => def.kind === "securityBoundary" && def.id === synthetic[1].id);
  assert.deepEqual(captured.catalogDefinitions.find(def => def.id === synthetic[1].id), installed);
  const saved = { ...installed, description: "Original author meaning differs from the recipient's library." };
  const retained = withLibraryDefinitions({ ...doc, catalogDefinitions: [saved] }, registry);
  assert.deepEqual(retained.catalogDefinitions.find(def => def.id === saved.id), saved);
});

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
