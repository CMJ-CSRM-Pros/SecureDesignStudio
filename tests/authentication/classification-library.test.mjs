import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { modelFixture, catalogSnapshotFixture } from "../browser/fixture.mjs";

const library = await import("../../src/classificationLibrary.ts");
const types = await import("../../src/types.ts");
const snapshots = await import("../../src/catalogDefinitions.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { mapClassification } = await import("../../src/privacyManagerImport.ts");
const policy = await import("../../src/policy.ts");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");

function alternate() {
  return library.validateClassificationLibrary({
    id: "example-external", name: "Example external classifications", revision: "1",
    defaultId: "ExamplePublic",
    classifications: [
      { id: "ExamplePublic", label: "Example public", description: "Synthetic public category." },
      { id: "ExampleRestricted", label: "Active restricted label", description: "Synthetic restricted category." },
      { id: "ExampleDisabled", label: "Disabled category", disabled: true },
    ],
  });
}

function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; }, read: () => value };
}

test("Classification Library: shared Purview-aligned seed adds two types without changing prior IDs or presentation", () => {
  const seed = library.DEFAULT_CLASSIFICATION_LIBRARY;
  assert.equal(seed.defaultId, "EUII");
  assert.deepEqual(seed.classifications.map(item => item.id), types.DATA_CLASSIFICATIONS);
  assert.equal(seed.classifications.length, 12);
  assert.equal(seed.revision, "1.1.0");
  assert.equal(seed.guidanceUrl, "https://learn.microsoft.com/en-us/purview/purview-privacy");
  assert.doesNotMatch(JSON.stringify(seed), /eng\.ms|anonymized session|most sensitive|no direct customer-identifying/i);
  assert.ok(seed.classifications.every(item => !item.disabled));
  const expected = {
    "Customer Content": ["#dc2626", "#ffffff", 100], EUII: ["#ef4444", "#ffffff", 90],
    "Access Control Data": ["#a855f7", "#111827", 80], "Support Data": ["#ea580c", "#ffffff", 70],
    "Account Data": ["#db2777", "#ffffff", 60], EUPI: ["#f97316", "#111827", 50],
    OII: ["#eab308", "#111827", 40], "Feedback Data": ["#14b8a6", "#111827", 30],
    "System Metadata": ["#94a3b8", "#111827", 20], Other: ["#64748b", "#ffffff", 10],
  };
  for (const definition of seed.classifications) {
    if (expected[definition.id]) assert.deepEqual(Object.values(definition.presentation), expected[definition.id]);
    else {
      assert.ok(["Administrator Data", "Customer Data"].includes(definition.id));
      assert.equal(definition.presentation, undefined, "New categories have no invented sensitivity rank");
    }
    assert.equal(Object.isFrozen(definition), true);
  }
  assert.deepEqual(library.parseClassificationCatalog(JSON.parse(library.exportClassificationCatalog(seed))), seed);
});

test("Classification Library: common definitions are inherited unchanged unless explicitly overridden", async () => {
  const { resolveLibraries } = await import("../../src/libraries/registry.ts");
  const pkg = {
    format: "secure-design-studio-library", apiVersion: 1, id: "shared-fixture", name: "Shared fixture", version: "1.0.0",
    help: [{ id: "classification-guidance", title: "Extra guidance", text: "Synthetic supplemental guidance." }],
  };
  const core = resolveLibraries(), selected = resolveLibraries([{ source: "Synthetic", value: pkg }]);
  assert.equal(selected.statuses[0].state, "loaded");
  assert.strictEqual(selected.classifications, core.classifications);
  const duplicate = { ...pkg, catalogs: { classifications: structuredClone(core.classifications) } };
  assert.equal(resolveLibraries([{ source: "Duplicate", value: duplicate }]).statuses[0].state, "rejected");
  const explicit = resolveLibraries([{ source: "Explicit", value: {
    ...duplicate, overrides: [{ key: "classifications/default", from: "core" }],
  } }]);
  assert.equal(explicit.statuses[0].state, "loaded");
  assert.deepEqual(explicit.classifications, core.classifications);
});

test("Classification Library: older profiles retain their meaning without silently gaining new choices", () => {
  const old = {
    ...structuredClone(library.DEFAULT_CLASSIFICATION_LIBRARY), revision: "1.0.0",
    classifications: library.DEFAULT_CLASSIFICATION_LIBRARY.classifications
      .filter(def => !["Administrator Data", "Customer Data"].includes(def.id))
      .map(def => ({ ...def, description: "Historical saved description." })),
  };
  const serialized = library.exportClassificationCatalog(old);
  const target = storage(serialized);
  const loaded = library.loadClassificationLibrary(target);
  assert.deepEqual(loaded.library, old);
  assert.equal(target.read(), serialized);
  const merged = library.mergeClassificationLibrary(loaded.library, library.DEFAULT_CLASSIFICATION_LIBRARY);
  assert.equal(merged.classifications.length, 12);
  assert.equal(merged.revision, "1.0.0", "Explicit Merge keeps profile identity/revision/default");
});

test("Classification Library: new categories preserve IDs, snapshots, policies, imports and peer state", t => {
  const doc = normalizeDoc(modelFixture().doc);
  const ids = ["Administrator Data", "Customer Data"];
  const defs = library.classificationDefinitionsForLibrary(library.DEFAULT_CLASSIFICATION_LIBRARY);
  doc.data[0].classification = ids[0];
  doc.data[1].classification = ids[1];
  doc.catalogDefinitions = [ { ...defs.find(def => def.id === ids[0]), description: "Saved administrator meaning." } ];
  const captured = snapshots.withCatalogDefinitions(doc, defs);
  const reopened = normalizeDoc(JSON.parse(JSON.stringify(captured)));
  assert.deepEqual(reopened.data, captured.data);
  assert.deepEqual(reopened.catalogDefinitions, captured.catalogDefinitions);
  assert.equal(reopened.catalogDefinitions.find(def => def.id === ids[0]).description, "Saved administrator meaning.");
  for (const id of ids) {
    assert.equal(policy.isKnownClassification(id), true);
    assert.deepEqual(mapClassification(id), { classifications: [id], hadUnknown: false });
  }
  assert.deepEqual(mapClassification("Customer Content,Customer Data,Administrator data"), {
    classifications: ["Customer Content", "Customer Data", "Administrator Data"], hadUnknown: false,
  });
  assert.deepEqual(mapClassification("End User Pseudonymized Identifiers (EUPI)"), { classifications: ["EUPI"], hadUnknown: false });
  const missing = structuredClone(doc);
  delete missing.data[0].classification;
  assert.equal(normalizeDoc(missing).data[0].classification, "EUII", "Legacy normalization stays profile-independent");
  const a = createYShape(), b = createYShape();
  t.after(() => [a, b].forEach(shape => shape.ydoc.destroy()));
  reconcileLocalToY(a, reopened, defs);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(buildDocFromY(b).data, reopened.data);
  assert.deepEqual(buildDocFromY(b).catalogDefinitions, reopened.catalogDefinitions);
  const html = buildReviewReportHtml({ doc: reopened, scenario: reopened.scenarios[0], appVersion: "test",
    documentFileName: "synthetic.tma", classificationDefinitions: defs });
  for (const id of ids) assert.ok(html.includes(id));
});

test("Classification Library: explicit enabled default, unique entries and data-only schema", () => {
  const good = alternate();
  const candidates = [
    { ...good, classifications: [] },
    { ...good, defaultId: "Missing" },
    { ...good, defaultId: "ExampleDisabled" },
    { ...good, classifications: good.classifications.map(item => ({ ...item, disabled: true })) },
    { ...good, classifications: [...good.classifications, { ...good.classifications[0], id: "examplepublic" }] },
    { ...good, classifications: [...good.classifications, { id: "Another", label: "EXAMPLE PUBLIC" }] },
    { ...good, classifications: [{ ...good.classifications[0], disabled: "false" }] },
    { ...good, classifications: [{ ...good.classifications[0], script: "not allowed" }] },
    { ...good, classifications: [{ ...good.classifications[0], presentation: { color: "url(https://example.invalid)", foreground: "#ffffff", priority: 5 } }] },
    { ...good, classifications: [{ ...good.classifications[0], presentation: { color: "#112233", foreground: "#ffffff", priority: 101 } }] },
    { ...good, defaultId: "__proto__" }, { ...good, endpoint: "https://example.invalid" },
    { ...good, guidanceUrl: "javascript:alert(1)" }, { ...good, guidanceUrl: "mailto:example@example.invalid" },
    { ...good, guidanceUrl: "https://user:password@example.invalid/" },
    { ...good, classifications: Array.from({ length: 2001 }, (_, i) => ({ id: `Example${i}`, label: `Example ${i}` })) },
  ];
  for (const value of candidates) assert.throws(() => library.validateClassificationLibrary(value));
  assert.throws(() => library.parseClassificationCatalog({ ...good, format: "secure-design-studio-diagram", version: 1 }));
  assert.throws(() => library.parseClassificationCatalog({ ...good, format: library.CLASSIFICATION_CATALOG_FORMAT, version: 2 }));
  assert.equal(library.validateClassificationLibrary({ ...good, guidanceUrl: "https://example.invalid/help" }).guidanceUrl,
    "https://example.invalid/help");
});

test("Classification Library: profile replaces defaults instead of implicitly merging internal choices", () => {
  const serialized = library.exportClassificationCatalog(alternate());
  const target = storage(serialized);
  const loaded = library.loadClassificationLibrary(target);
  assert.equal(loaded.source, "profile");
  assert.equal(loaded.error, null);
  assert.equal(loaded.library.classifications.some(item => item.id === "EUII"), false);
  assert.equal(target.read(), serialized, "Loading never rewrites the profile");
  const empty = storage();
  assert.equal(library.loadClassificationLibrary(empty).source, "shipped");
  assert.equal(empty.read(), null);
});

test("Classification Library: storage denial, corruption, quota and stale tabs are explicit and atomic", () => {
  for (const raw of ["invalid JSON", '{"format":"wrong"}', ""]) {
    const target = storage(raw);
    const loaded = library.loadClassificationLibrary(target);
    assert.ok(loaded.error);
    assert.equal(loaded.source, "shipped");
    assert.equal(target.read(), raw);
    assert.throws(() => library.persistClassificationLibrary(alternate(), loaded.library, target));
    assert.equal(target.read(), raw);
  }
  const denied = library.loadClassificationLibrary({ getItem() { throw new Error("denied"); }, setItem() {} });
  assert.match(denied.error, /denied/);
  const target = storage();
  library.persistClassificationLibrary(alternate(), library.DEFAULT_CLASSIFICATION_LIBRARY, target);
  const saved = target.read();
  assert.throws(() => library.persistClassificationLibrary(library.DEFAULT_CLASSIFICATION_LIBRARY,
    library.DEFAULT_CLASSIFICATION_LIBRARY, target), /changed in another tab/);
  assert.equal(target.read(), saved);
  assert.throws(() => library.persistClassificationLibrary(alternate(), alternate(), {
    getItem: () => saved, setItem() { throw new Error("quota"); },
  }), /not saved.*quota/);
});

test("Classification Library: saved and disabled values stay readable without becoming new choices", () => {
  const active = alternate();
  const saved = catalogSnapshotFixture().doc.catalogDefinitions;
  const available = library.classificationDefinitionsForLibrary(active);
  assert.equal(types.dataClassificationLabel("ExampleRestricted", saved, available), "Partner restricted data");
  const options = library.classificationOptions(active, saved, "EUII");
  assert.deepEqual(options.filter(item => !item.disabled).map(item => item.id), ["ExamplePublic", "ExampleRestricted"]);
  assert.equal(options.find(item => item.id === "EUII").label, "Saved EUII label");
  assert.equal(options.find(item => item.id === "EUII").disabled, true);
  assert.equal(library.classificationOptions(active, saved).some(item => item.id === "EUII"), false);
  assert.equal(library.classificationOptions(active, saved, "ExampleDisabled").find(item => item.id === "ExampleDisabled").disabled, true);
  assert.equal(library.isEnabledClassification(active, "ExampleDisabled"), false);
  assert.equal(policy.isKnownClassification("EUII", active.classifications), false);
  assert.equal(policy.isKnownClassification("ExamplePublic", active.classifications), true);
});

test("Classification Library: active capture is referenced-only and never exports profile or presentation settings", () => {
  const active = alternate();
  const definitions = library.classificationDefinitionsForLibrary(active);
  const doc = normalizeDoc(modelFixture().doc);
  doc.data[0].classification = "ExamplePublic";
  const captured = snapshots.withCatalogDefinitions(doc, definitions);
  assert.deepEqual(captured.catalogDefinitions, [definitions[0]]);
  assert.deepEqual(captured.catalogDefinitions[0].library, { id: active.id, version: active.revision });
  assert.equal("defaultId" in captured.catalogDefinitions[0], false);
  assert.equal("disabled" in captured.catalogDefinitions[0], false);
  assert.equal("presentation" in captured.catalogDefinitions[0], false);
  assert.equal(types.dataClassificationLabel("EUPI", captured.catalogDefinitions, definitions), "EUPI (unresolved)");
  assert.doesNotThrow(() => snapshots.validateCatalogDefinitions(
    snapshots.withCatalogDefinitions(normalizeDoc(modelFixture().doc)).catalogDefinitions,
  ), "Shipped presentation metadata never leaks into snapshot schema");
});

test("Classification Library: native normalization and PMEXP mappings do not depend on active-list membership", () => {
  assert.deepEqual(mapClassification("End User Identifiable Information (EUII)"),
    { classifications: ["EUII"], hadUnknown: false });
  assert.deepEqual(mapClassification("constructor"), { classifications: ["Other"], hadUnknown: true });
  const doc = modelFixture().doc;
  doc.data[0].classification = "EUII";
  const normalized = normalizeDoc(doc);
  const defs = library.classificationDefinitionsForLibrary(alternate());
  assert.equal(normalized.data[0].classification, "EUII");
  assert.equal(types.dataClassificationLabel("EUII", normalized.catalogDefinitions, defs), "EUII (unresolved)");
  const captured = snapshots.withCatalogDefinitions(normalized, defs);
  assert.equal(captured.catalogDefinitions?.some(def => def.id === "EUII") ?? false, false);
});

test("Classification Library: peers with different lists preserve snapshots and do not backfill excluded defaults", t => {
  const a = createYShape(), b = createYShape();
  t.after(() => [a, b].forEach(shape => shape.ydoc.destroy()));
  const alternateDefs = library.classificationDefinitionsForLibrary(alternate());
  const defaultDefs = library.classificationDefinitionsForLibrary(library.DEFAULT_CLASSIFICATION_LIBRARY);
  const doc = snapshots.withCatalogDefinitions(normalizeDoc(modelFixture().doc), defaultDefs);
  reconcileLocalToY(a, doc, defaultDefs);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  const received = buildDocFromY(b);
  const before = structuredClone(received.catalogDefinitions);
  received.nodes[0].title = "Peer with different authoring choices";
  reconcileLocalToY(b, received, alternateDefs);
  assert.deepEqual(buildDocFromY(b).catalogDefinitions, before);
  assert.equal(b.ydoc.share.has("classificationLibrary"), false);
  const noDefinitions = { ...normalizeDoc(modelFixture().doc), catalogDefinitions: [] };
  reconcileLocalToY(b, noDefinitions, alternateDefs);
  assert.deepEqual(buildDocFromY(b).catalogDefinitions, [], "Reconciler does not recapture the shipped internal list");
});

test("Classification Library: explicit policy outcomes are unchanged and report labels use active context", () => {
  const doc = normalizeDoc(modelFixture().doc);
  doc.nodeTypes[0].definition = {
    ...doc.nodeTypes[0].definition, policyStatus: undefined,
    allowedDataTypes: [{ id: "EUII", retention: "*", action: "Deny" }, { id: "*", retention: "*", action: "Allow" }],
  };
  const defs = library.classificationDefinitionsForLibrary(alternate());
  const current = new IssueManager(defs).analyze(doc);
  const original = new IssueManager().analyze(doc);
  assert.deepEqual(current.issues.map(item => item.kind).sort(), original.issues.map(item => item.kind).sort());
  const html = buildReviewReportHtml({ doc, scenario: doc.scenarios[0], appVersion: "test",
    documentFileName: "synthetic.tma", classificationDefinitions: defs });
  assert.match(html, /EUII \(unresolved\)/);
});

test("Classification Library: merge keeps active identity/default and rejects disabling that default", () => {
  const current = library.DEFAULT_CLASSIFICATION_LIBRARY;
  const incoming = alternate();
  const before = structuredClone(current);
  const merged = library.mergeClassificationLibrary(current, incoming);
  for (const field of ["id", "name", "revision", "guidanceUrl", "defaultId"]) assert.equal(merged[field], current[field]);
  assert.equal(merged.classifications.length, 15);
  assert.equal(merged.classifications.some(item => item.id === "ExamplePublic"), true);
  assert.deepEqual(current, before);
  const disablesDefault = { ...incoming, classifications: [
    ...incoming.classifications, { id: "EUII", label: "Imported EUII", disabled: true },
  ] };
  assert.doesNotThrow(() => library.validateClassificationLibrary(disablesDefault), "Replace has a valid incoming default");
  assert.throws(() => library.mergeClassificationLibrary(current, disablesDefault), /defaultId/);
  const wrongCase = { ...incoming, classifications: [
    ...incoming.classifications, { id: "euii", label: "Different casing" },
  ] };
  assert.throws(() => library.mergeClassificationLibrary(current, wrongCase), /duplicate/);
});

test("Classification Library: repair requires the exact still-invalid stored value", () => {
  const target = storage("broken");
  library.repairClassificationLibrary(alternate(), "broken", target);
  assert.deepEqual(library.parseClassificationCatalog(JSON.parse(target.read())), alternate());
  const saved = target.read();
  assert.throws(() => library.repairClassificationLibrary(library.DEFAULT_CLASSIFICATION_LIBRARY, saved, target), /now valid/);
  assert.throws(() => library.repairClassificationLibrary(alternate(), "broken", target), /changed/);
  assert.equal(target.read(), saved);
});

test("Classification Library: deletion references include saved former built-in and document policy IDs", () => {
  const doc = normalizeDoc(modelFixture().doc);
  doc.data = [];
  doc.nodes[0].type = "Azure Storage (XStore)";
  doc.nodeTypes.push({ id: "Azure Storage (XStore)", label: "Saved storage", definition: {
    serviceTreeId: "", endpointRegex: "^$", allowedAuthMethods: [],
    allowedDataTypes: [{ id: "*", retention: "*", action: "Allow" }, { id: "EUPI", retention: "StorageOver48Hours", action: "Deny" }],
  } });
  doc.nodeTypes[0].definition.allowedDataTypes = [
    { id: "ExampleRestricted", retention: "*", action: "Deny" },
  ];
  const references = library.classificationReferencesInDocument(doc);
  assert.equal(references.has("EUPI"), true);
  assert.equal(references.has("ExampleRestricted"), true);
  assert.equal(references.has("*"), false);
});

test("Classification Library: autosave trim keeps profile history aligned with document history", async t => {
  const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let persisted;
  const localStorage = {
    getItem: () => persisted ?? null,
    setItem(_key, value) {
      const payload = JSON.parse(value);
      if (payload.past.length > 5) throw new Error("Synthetic quota");
      persisted = value;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  const past = Array.from({ length: 30 }, (_, index) => {
    const doc = modelFixture().doc;
    doc.scenarios[0].name = `History ${index}`;
    return doc;
  });
  saveAutosave({
    doc: modelFixture().doc, past, future: [], view: { activeScenarioId: null, filter: {} },
    classificationHistory: {
      past: past.map((_, index) => ({ ...alternate(), revision: String(index) })), future: [],
    },
  });
  const restored = loadAutosaveRaw();
  assert.equal(restored.past.length, 5);
  assert.deepEqual(restored.classificationHistory.past.map(item => item.revision), ["25", "26", "27", "28", "29"]);
  assert.equal(restored.past[0].scenarios[0].name, "History 25");
});
