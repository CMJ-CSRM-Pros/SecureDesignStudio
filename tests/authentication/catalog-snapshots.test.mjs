import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { strFromU8, unzipSync } from "fflate";
import { catalogSnapshotFixture, modelFixture } from "../browser/fixture.mjs";

const snapshots = await import("../../src/catalogDefinitions.ts");
const types = await import("../../src/types.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { createYShape, isYShapeEmpty, REMOTE_ORIGIN } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { diffDocuments } = await import("../../src/diff.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { exportVsdx } = await import("../../src/vsdxExport.ts");
const { exportTm7 } = await import("../../src/tm7Export.ts");
const canonical = (values = []) => [...values].sort((a, b) => snapshots.catalogDefinitionKey(a).localeCompare(snapshots.catalogDefinitionKey(b)));
const definition = () => ({ kind: "classification", id: "ExampleRestricted", label: "Synthetic label" });

test("catalog snapshots: strict atomic data-only validation and duplicate scope", () => {
  const input = catalogSnapshotFixture().doc.catalogDefinitions;
  assert.deepEqual(snapshots.validateCatalogDefinitions(input), input);
  assert.equal(snapshots.validateCatalogDefinitions([definition(), { ...definition(), kind: "tenant" }]).length, 2);
  for (const invalid of [
    null, {}, [definition(), definition()], Array.from({ length: 2001 }, definition),
    [{ ...definition(), id: "__proto__" }], [{ ...definition(), kind: "retention" }],
    [{ ...definition(), label: "" }], [{ ...definition(), label: "x".repeat(161) }],
    [{ ...definition(), description: "x".repeat(4001) }],
    [{ ...definition(), behavior: { execute: true } }], [{ ...definition(), endpoint: "https://example.invalid" }],
    [{ ...definition(), library: { id: "example", version: "1", script: "anything" } }],
    [{ ...definition(), library: { id: "example" } }],
    [{ ...definition(), library: { id: "constructor", version: "1" } }],
    [{ ...definition(), library: { id: "example", version: "x".repeat(129) } }],
  ]) {
    assert.throws(() => snapshots.validateCatalogDefinitions(invalid));
    assert.throws(() => normalizeDoc({ ...modelFixture().doc, catalogDefinitions: invalid }));
  }
  const literal = [{ ...definition(), description: "Literal </script><script> text." }];
  assert.deepEqual(snapshots.validateCatalogDefinitions(literal), literal, "Text is data, not executable capabilities");
});

test("catalog snapshots: capture references only and never silently replace a saved definition", () => {
  const doc = normalizeDoc(modelFixture().doc);
  const captured = snapshots.withCatalogDefinitions(doc);
  assert.deepEqual(captured.catalogDefinitions.map(d => [d.kind, d.id]), [
    ["classification", "EUII"], ["classification", "EUPI"],
  ]);
  assert.equal(doc.catalogDefinitions, undefined);
  assert.strictEqual(snapshots.withCatalogDefinitions(captured), captured, "No-op capture preserves object identity");
  const saved = normalizeDoc(catalogSnapshotFixture().doc);
  const before = structuredClone(saved);
  const resolved = snapshots.withCatalogDefinitions(saved);
  for (const def of saved.catalogDefinitions) assert.deepEqual(
    resolved.catalogDefinitions.find(d => snapshots.catalogDefinitionKey(d) === snapshots.catalogDefinitionKey(def)), def,
  );
  assert.deepEqual(saved, before);
  assert.equal(types.dataClassificationLabel("EUII", saved.catalogDefinitions), "Saved EUII label");
  assert.equal(types.dataClassificationLabel("EUII"), "EUII", "Profile/global defaults never change");
  assert.equal(types.dataClassificationLabel("MissingDefinition", saved.catalogDefinitions), "MissingDefinition (unresolved)");
  assert.equal(types.productionIdentityTenantLabel("ExampleTenant", saved.catalogDefinitions), "Partner tenant");
  const unused = { kind: "classification", id: "Unused", label: "Do not distribute unrelated library metadata" };
  const withUnused = { ...saved, catalogDefinitions: [...saved.catalogDefinitions, unused] };
  assert.equal(snapshots.withCatalogDefinitions(withUnused).catalogDefinitions.some(def => def.id === "Unused"), false);
  assert.ok(withUnused.catalogDefinitions.includes(unused), "Dependency capture does not mutate imported data");
});

test("catalog snapshots: policy-only dependencies captured without expanding built-in node catalog", () => {
  const doc = normalizeDoc(modelFixture().doc);
  doc.data = [];
  doc.nodeTypes[0].definition.allowedDataTypes = [
    { id: "Customer Content", retention: "*", action: "Deny" }, { id: "*", retention: "*", action: "Allow" },
  ];
  doc.nodeTypes[0].definition.defaultPrivacyBoundary = "GeoBoundary";
  const captured = snapshots.withCatalogDefinitions(doc);
  assert.deepEqual(captured.catalogDefinitions.map(d => [d.kind, d.id]), [
    ["privacyBoundary", "GeoBoundary"], ["classification", "Customer Content"],
  ]);
});

test("catalog snapshots: native round-trip, saved-first labels and semantic comparison", () => {
  const doc = snapshots.withCatalogDefinitions(normalizeDoc(catalogSnapshotFixture().doc));
  assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(doc))), doc);
  const reordered = { ...doc, catalogDefinitions: [...doc.catalogDefinitions].reverse() };
  assert.deepEqual(diffDocuments(doc, reordered), []);
  const changed = structuredClone(doc);
  changed.catalogDefinitions[0].label = "Changed saved label";
  const changes = diffDocuments(doc, changed).filter(change => change.category === "catalogDefinition");
  assert.equal(changes.length, 1);
  assert.match(changes[0].description, /Changed saved catalog definition/);
  const report = buildReviewReportHtml({
    doc, scenario: doc.scenarios[0], documentFileName: "synthetic.tma", appVersion: "test",
  });
  assert.match(report, /Partner restricted data/);
  assert.match(report, /Partner tenant/);
  const pages = Object.entries(unzipSync(exportVsdx(doc)))
    .filter(([name]) => /^visio\/pages\/page\d+\.xml$/.test(name))
    .map(([, bytes]) => strFromU8(bytes)).join("\n");
  assert.match(pages, /Partner restricted data/);
  assert.match(pages, /Partner privacy perimeter/);
  assert.match(exportTm7(doc), /Partner trust perimeter/);
});

test("catalog snapshots: node-catalog conflicts reject without mutating either input", () => {
  const current = [definition()];
  const incoming = [{ ...definition(), label: "Different" }];
  assert.throws(() => snapshots.mergeCatalogDefinitions(current, incoming), /conflict/);
  assert.deepEqual(current, [definition()]);
  assert.equal(incoming[0].label, "Different");
  assert.deepEqual(snapshots.mergeCatalogDefinitions(current, [definition()]), current);
  const maximum = Array.from({ length: 2000 }, (_, index) => ({
    ...definition(), id: `Synthetic${index}`,
  }));
  assert.throws(() => snapshots.mergeCatalogDefinitions(maximum, [definition()]), /2000 snapshots/);
  assert.equal(maximum.length, 2000, "An oversized combined import leaves existing definitions intact");
});

test("catalog snapshots: Yjs definition-only rooms, peer edits, no-op and reconnect", t => {
  const source = createYShape(), peer = createYShape(), reconnect = createYShape();
  t.after(() => [source, peer, reconnect].forEach(shape => shape.ydoc.destroy()));
  assert.equal(isYShapeEmpty(source), true);
  source.catalogDefinitions.set(snapshots.catalogDefinitionKey(definition()), definition());
  assert.equal(isYShapeEmpty(source), false);
  const doc = snapshots.withCatalogDefinitions(normalizeDoc(catalogSnapshotFixture().doc));
  reconcileLocalToY(source, doc);
  Y.applyUpdate(peer.ydoc, Y.encodeStateAsUpdate(source.ydoc), REMOTE_ORIGIN);
  const received = buildDocFromY(peer);
  assert.deepEqual(canonical(received.catalogDefinitions), canonical(doc.catalogDefinitions));
  let updates = 0;
  peer.ydoc.on("update", () => updates++);
  reconcileLocalToY(peer, received);
  assert.equal(updates, 0);
  received.nodes[0].title = "Unrelated peer edit";
  reconcileLocalToY(peer, received);
  Y.applyUpdate(source.ydoc, Y.encodeStateAsUpdate(peer.ydoc, Y.encodeStateVector(source.ydoc)), REMOTE_ORIGIN);
  Y.applyUpdate(reconnect.ydoc, Y.encodeStateAsUpdate(source.ydoc), REMOTE_ORIGIN);
  assert.deepEqual(canonical(buildDocFromY(reconnect).catalogDefinitions), canonical(doc.catalogDefinitions));
});

test("catalog snapshots: absent legacy field is not deletion; invalid versions/entries fail before writes", t => {
  const shape = createYShape();
  t.after(() => shape.ydoc.destroy());
  const doc = normalizeDoc(catalogSnapshotFixture().doc);
  reconcileLocalToY(shape, doc);
  const before = canonical(buildDocFromY(shape).catalogDefinitions);
  const legacy = structuredClone(doc);
  delete legacy.catalogDefinitions;
  reconcileLocalToY(shape, legacy);
  assert.deepEqual(canonical(buildDocFromY(shape).catalogDefinitions), before);
  const invalid = { ...doc, catalogDefinitions: [{ ...definition(), script: "not allowed" }] };
  const encoded = Y.encodeStateAsUpdate(shape.ydoc);
  assert.throws(() => reconcileLocalToY(shape, invalid));
  assert.deepEqual(Y.encodeStateAsUpdate(shape.ydoc), encoded);
  shape.meta.set("catalogDefinitionsVersion", 99);
  assert.throws(() => buildDocFromY(shape), /unsupported catalog/);
  assert.throws(() => reconcileLocalToY(shape, doc), /unsupported catalog/);
});

test("catalog snapshots: concurrent snapshot replacement stays atomic", t => {
  const a = createYShape(), b = createYShape();
  t.after(() => [a, b].forEach(shape => shape.ydoc.destroy()));
  const doc = normalizeDoc(catalogSnapshotFixture().doc);
  reconcileLocalToY(a, doc);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  const first = { ...definition(), label: "First", library: { id: "first", version: "1" } };
  const second = { ...definition(), label: "Second", library: { id: "second", version: "2" } };
  const key = snapshots.catalogDefinitionKey(first);
  a.catalogDefinitions.set(key, first);
  b.catalogDefinitions.set(key, second);
  const updateA = Y.encodeStateAsUpdate(a.ydoc), updateB = Y.encodeStateAsUpdate(b.ydoc);
  Y.applyUpdate(a.ydoc, updateB); Y.applyUpdate(b.ydoc, updateA);
  assert.deepEqual(a.catalogDefinitions.get(key), b.catalogDefinitions.get(key));
  assert.ok([JSON.stringify(first), JSON.stringify(second)].includes(JSON.stringify(a.catalogDefinitions.get(key))));
});

test("catalog snapshots: explicit removal and mismatched keys are handled without silent defaults", t => {
  const shape = createYShape();
  t.after(() => shape.ydoc.destroy());
  reconcileLocalToY(shape, normalizeDoc(catalogSnapshotFixture().doc));
  reconcileLocalToY(shape, types.emptyDocument());
  assert.equal(shape.catalogDefinitions.size, 0);
  shape.catalogDefinitions.set("wrong-key", definition());
  assert.throws(() => buildDocFromY(shape), /key does not match/);
});

test("catalog snapshots: capture cannot produce a document beyond the validation limit", () => {
  const doc = modelFixture().doc;
  doc.catalogDefinitions = Array.from({ length: 2000 }, (_, index) => ({
    kind: "classification", id: `Synthetic${index}`, label: `Synthetic ${index}`,
  }));
  doc.data.push(...doc.catalogDefinitions.map(def => ({ id: `d_${def.id}`, name: def.id, classification: def.id, sample: "" })));
  assert.throws(() => snapshots.withCatalogDefinitions(doc), /2000-definition limit/);
});
