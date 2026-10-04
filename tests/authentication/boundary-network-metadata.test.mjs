import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Y from "yjs";
import { documentFixture } from "./catalog-fixtures.mjs";

const { normalizeDoc, StoreProvider, useStore } = await import("../../src/store.tsx");
const { UiShellProvider } = await import("../../src/uiShell.tsx");
const { BoundaryDetails } = await import("../../src/components/BoundaryDetails.tsx");
const { diffDocuments } = await import("../../src/diff.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { buildDfdReviewContext } = await import("../../src/dfdReviewContext.ts");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
const { capturePristineHtml, buildStandaloneHtml } = await import("../../src/embeddedDoc.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");

const fields = ["inboundAllow", "inboundDeny", "outboundAllow", "outboundDeny"];
const labels = ["Inbound Allow", "Inbound Deny", "Outbound Allow", "Outbound Deny"];
const text = "  Synthetic service: 192.0.2.10:443\r\n\tNot a policy grammar; \u03bb \ud83d\udd12\n<script>literal & \"text\"</script>  ";
const values = Object.fromEntries(fields.map((key, i) => [key, `${text}\n${labels[i]}`]));
const storageKey = "secure-design-studio:autosave:v1";
const notes = boundary => Object.fromEntries(fields.map(key => [key, boundary[key]]));

function fixture() {
  const doc = documentFixture();
  doc.boundaries = [{
    id: "b_network", type: "security", title: "Synthetic network",
    position: { x: 0, y: 0 }, size: { width: 800, height: 400 }, nodeIds: [],
    ...values,
  }];
  doc.scenarios[0].boundaryIds = ["b_network"];
  doc.scenarios.push({ ...structuredClone(doc.scenarios[0]), id: "s_second", name: "Second scenario" });
  return doc;
}

function localEnvironment(t, embedded = null) {
  const storage = new Map();
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  globalThis.document = { getElementById: id =>
    id === "ps-embedded-doc" && embedded ? { textContent: JSON.stringify(embedded) } : null };
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
  });
  return storage;
}

function readStore(showBoundary = false) {
  let store;
  function Probe() {
    store = useStore();
    return showBoundary ? createElement(BoundaryDetails, { boundary: store.doc.boundaries[0] }) : null;
  }
  const markup = renderToStaticMarkup(createElement(UiShellProvider, null,
    createElement(StoreProvider, null, createElement(Probe))));
  return { store, markup };
}

function save(doc, past = [], future = []) {
  saveAutosave({ doc, past, future, view: { activeScenarioId: doc.scenarios[0].id, filter: {} } });
}

test("boundary network: four optional exact strings, no network grammar or imposed text limit", () => {
  const input = fixture(), before = structuredClone(input);
  assert.deepEqual(notes(normalizeDoc(input).boundaries[0]), values);
  assert.deepEqual(input, before);
  for (const key of fields) {
    for (const value of [undefined, null, "", "\r\n\t ", "not an IP, tag, port or protocol", text.repeat(100)]) {
      input.boundaries[0][key] = value;
      assert.equal(normalizeDoc(input).boundaries[0][key], value === null || value === "" ? undefined : value);
    }
    for (const value of [false, 42, [], {}, { text: "do not coerce me" }]) {
      input.boundaries[0][key] = value;
      assert.throws(() => normalizeDoc(input), /boundary.*text|text.*boundary/i);
    }
    input.boundaries[0][key] = values[key];
  }
  const legacy = fixture();
  for (const key of fields) delete legacy.boundaries[0][key];
  for (const key of fields) assert.equal(normalizeDoc(legacy).boundaries[0][key], undefined);
});

test("boundary network: native JSON, shared IDs and unrelated/subtype/privacy edits preserve text", () => {
  const input = fixture();
  const normalized = normalizeDoc(input);
  const reopened = normalizeDoc(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(notes(reopened.boundaries[0]), values);
  assert.deepEqual(reopened.scenarios.map(s => s.boundaryIds), [["b_network"], ["b_network"]]);
  const edited = structuredClone(reopened);
  Object.assign(edited.boundaries[0], { title: "Changed", securitySubtype: "SyntheticSubtype", position: { x: 20, y: 30 } });
  assert.deepEqual(notes(normalizeDoc(edited).boundaries[0]), values);
  edited.boundaries[0].type = "privacy";
  const inactive = normalizeDoc(edited);
  assert.deepEqual(notes(inactive.boundaries[0]), values);
  const restored = normalizeDoc(JSON.parse(JSON.stringify(inactive)));
  restored.boundaries[0].type = "security";
  assert.deepEqual(notes(normalizeDoc(restored).boundaries[0]), values);
});

test("boundary network: changes compare each field, keep author spacing, and suppress blank noise", () => {
  const previous = normalizeDoc(fixture());
  for (const [i, key] of fields.entries()) {
    const current = structuredClone(previous);
    current.boundaries[0][key] += "\nNew declared intent";
    const changes = diffDocuments(previous, current);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].category, "boundary");
    assert.ok(changes[0].description.includes(labels[i]));
    assert.equal(changes[0].target.kind, "boundary");
    assert.equal(changes[0].target.id, "b_network");
    assert.equal(changes[0].target.scenarioId, previous.scenarios[0].id);
    const blank = structuredClone(previous);
    delete blank.boundaries[0][key];
    for (const value of ["", " \r\n\t "]) {
      const equivalent = structuredClone(blank);
      equivalent.boundaries[0][key] = value;
      assert.deepEqual(diffDocuments(blank, equivalent), []);
    }
    current.boundaries[0][key] = `${previous.boundaries[0][key]} `;
    assert.equal(diffDocuments(previous, current).length, 1);
  }
});

test("boundary network: review report escapes full multiline declared intent and hides inactive text", () => {
  const doc = normalizeDoc(fixture());
  doc.boundaries.push({ ...doc.boundaries[0], id: "b_absent", inboundAllow: "OUTSIDE_SCENARIO_MARKER" });
  const render = () => buildReviewReportHtml({
    doc, scenario: doc.scenarios[0], documentFileName: "synthetic.tma", appVersion: "test",
  });
  const html = render();
  for (const label of labels) assert.ok(html.includes(label));
  assert.ok(html.includes("&lt;script&gt;literal &amp; &quot;text&quot;&lt;/script&gt;"));
  assert.ok(html.includes("192.0.2.10:443\r\n\tNot a policy grammar"));
  assert.match(html, /white-space:\s*pre-wrap/);
  assert.match(html, /declared intent/i);
  assert.match(html, /not.*(enforcement|compliance)/i);
  assert.equal(html.includes("<script>literal"), false);
  assert.equal(html.includes("OUTSIDE_SCENARIO_MARKER"), false);
  for (const key of fields) doc.boundaries[0][key] = " \n ";
  assert.match(render(), /Undocumented/);
  Object.assign(doc.boundaries[0], values, { type: "privacy" });
  assert.equal(render().includes("192.0.2.10:443"), false);
  assert.match(render(), /Inactive/);
  assert.deepEqual(notes(doc.boundaries[0]), values);
});

test("boundary network: Assistant keeps active exact text, omits inactive/nonmember notes, preserves E2 exclusions", () => {
  const doc = normalizeDoc(fixture()), scenario = doc.scenarios[0];
  doc.boundaries.push({ ...doc.boundaries[0], id: "b_private", type: "privacy", inboundAllow: "INACTIVE_MARKER" });
  doc.boundaries.push({ ...doc.boundaries[0], id: "b_elsewhere", inboundAllow: "OTHER_SCENARIO_MARKER" });
  scenario.boundaryIds.push("b_private");
  doc.boundaries[0].nodeIds = [doc.nodes[0].id, "not-a-member"];
  doc.nodes[0].dfdRoleOverride = "ExternalInteractor";
  doc.nodes[1].description = "EXCLUDED_INTERIOR_MARKER";
  scenario.nodeScopeReasons = { [doc.nodes[1].id]: "Infrastructure" };
  const before = structuredClone(doc);
  const context = buildDfdReviewContext(doc, scenario);
  assert.deepEqual(notes(context.boundaries[0]), values);
  assert.deepEqual(context.boundaries[0].nodeIds, [doc.nodes[0].id]);
  assert.equal(context.edges.length, 0);
  assert.equal(context.nodes[1].reviewContext, "endpoint-only");
  for (const key of fields) assert.equal(Object.hasOwn(context.boundaries[1], key), false);
  for (const marker of ["INACTIVE_MARKER", "OTHER_SCENARIO_MARKER", "EXCLUDED_INTERIOR_MARKER"]) {
    assert.equal(JSON.stringify(context).includes(marker), false);
  }
  assert.deepEqual(doc, before);
  assert.deepEqual(buildDfdReviewContext(doc, null).boundaries, []);
});

test("boundary network: autosave/history and portable HTML preserve native data without executable markup", t => {
  localEnvironment(t);
  const doc = normalizeDoc(fixture()), prior = structuredClone(doc), future = structuredClone(doc);
  prior.boundaries[0].inboundAllow = "Prior\nvalue";
  future.boundaries[0].inboundAllow = "Future\nvalue";
  save(doc, [prior], [future]);
  const saved = loadAutosaveRaw();
  assert.deepEqual(notes(normalizeDoc(saved.doc).boundaries[0]), values);
  assert.equal(normalizeDoc(saved.past[0]).boundaries[0].inboundAllow, "Prior\nvalue");
  assert.equal(normalizeDoc(saved.future[0]).boundaries[0].inboundAllow, "Future\nvalue");
  capturePristineHtml("<html><body>Portable synthetic app</body></html>");
  const wrapper = { format: "secure-design-studio-diagram", version: 2, doc };
  const html = buildStandaloneHtml(JSON.stringify(wrapper));
  assert.equal(html.includes("</script>  "), false);
  const payload = html.match(/id="ps-embedded-doc">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(notes(normalizeDoc(JSON.parse(payload).doc).boundaries[0]), values);
});

test("boundary network: valid embedded startup takes precedence over unrelated autosave", t => {
  localEnvironment(t, { format: "secure-design-studio-diagram", version: 2, doc: fixture() });
  const other = fixture();
  other.boundaries[0].inboundAllow = "Autosave must not replace the embedded model";
  save(other);
  const { store } = readStore();
  assert.equal(store.documentRecoveryError, null);
  assert.deepEqual(notes(store.doc.boundaries[0]), values);
});

test("boundary network: declared intent never changes deterministic findings or existing authored discussion", () => {
  const before = new IssueManager().analyze(normalizeDoc(fixture()));
  before.issues.forEach(issue => {
    issue.status = "Resolved";
    issue.replies = [{ id: "reply", text: "Existing decision", createdAt: 10 }];
  });
  before.issues.push({
    id: "manual", targetKind: "node", targetId: before.nodes[0].id,
    scenarioIds: [before.scenarios[0].id], title: "Authored note", description: "Retain",
    status: "Active", createdAt: 10, replies: [],
  });
  const after = structuredClone(before);
  for (const key of fields) after.boundaries[0][key] = "Deny all; allow all; no inference";
  assert.deepEqual(new IssueManager().analyze(after).issues, new IssueManager().analyze(before).issues);
  assert.deepEqual(after.issues, before.issues);
});

test("boundary network: real store startup/export, blank creation, scenario clone and invalid update/Open", t => {
  localEnvironment(t);
  save(fixture());
  const { store } = readStore();
  assert.deepEqual(notes(store.doc.boundaries[0]), values);
  const exported = JSON.parse(store.exportJson());
  assert.equal(exported.format, "secure-design-studio-diagram");
  assert.deepEqual(notes(normalizeDoc(exported.doc).boundaries[0]), values);
  const created = store.createBoundary("security", { x: 0, y: 0 }, { width: 300, height: 200 });
  assert.notEqual(created.id, "b_network");
  for (const key of fields) assert.equal(created[key], undefined);
  const cloned = store.cloneScenario(store.doc.scenarios[0].id, "Clone");
  assert.deepEqual(cloned.boundaryIds, ["b_network"]);
  assert.notEqual(cloned.id, store.doc.scenarios[0].id);
  for (const key of fields) {
    assert.throws(() => store.updateBoundary("b_network", { [key]: 42 }), /boundary.*text|text.*boundary/i);
    const malformed = fixture();
    malformed.boundaries[0][key] = { private: "not text" };
    assert.throws(() => store.importJson(malformed), /boundary.*text|text.*boundary/i);
    assert.throws(() => store.importJson({ format: exported.format, version: 2, doc: malformed }), /boundary.*text|text.*boundary/i);
  }
  assert.deepEqual(notes(store.doc.boundaries[0]), values);
});

test("boundary network: four associated multiline controls only for security, with inactive privacy explanation", t => {
  localEnvironment(t);
  save(fixture());
  const { markup } = readStore(true);
  assert.equal((markup.match(/<textarea/g) ?? []).length, 4);
  for (const label of labels) assert.match(markup, new RegExp(`<label>${label}<textarea[^>]*aria-describedby=`));
  assert.match(markup, /Blank means undocumented/);
  assert.match(markup, /shared across scenarios/);
  assert.match(markup, /declared intent/i);
  const privateDoc = fixture();
  privateDoc.boundaries[0].type = "privacy";
  save(privateDoc);
  const inactive = readStore(true);
  assert.equal(inactive.markup.includes("<textarea"), false);
  assert.match(inactive.markup, /retained.*inactive/i);
  assert.deepEqual(notes(inactive.store.doc.boundaries[0]), values);
});

for (const source of ["current", "past", "future", "embedded"]) {
  test(`boundary network: malformed ${source} pauses recovery without overwriting raw evidence`, t => {
    const malformed = fixture();
    malformed.boundaries[0].inboundAllow = { raw: "DO_NOT_DISCARD" };
    const storage = localEnvironment(t, source === "embedded" ? { doc: malformed } : null);
    const valid = fixture();
    save(source === "current" ? malformed : valid, source === "past" ? [malformed] : [], source === "future" ? [malformed] : []);
    const raw = storage.get(storageKey);
    const { store } = readStore();
    assert.match(store.documentRecoveryError, /recovery is paused/i);
    assert.match(store.documentRecoveryError, /boundary.*text|text.*boundary/i);
    assert.equal(store.documentRecoveryError.includes("DO_NOT_DISCARD"), false);
    assert.equal(storage.get(storageKey), raw);
  });
}

for (const firstInvalid of ["rights", "boundary"]) {
  test(`boundary network: combined E3/E5 history recovery preserves both guards (${firstInvalid} first)`, t => {
    const storage = localEnvironment(t);
    const valid = fixture();
    valid.edges[0].requiredAccessRights = "Read\n  shared flow";
    const invalidRights = structuredClone(valid), invalidBoundary = structuredClone(valid);
    invalidRights.edges[0].requiredAccessRights = { raw: "RIGHTS_EVIDENCE" };
    invalidBoundary.boundaries[0].outboundDeny = { raw: "BOUNDARY_EVIDENCE" };
    const past = firstInvalid === "rights" ? invalidRights : invalidBoundary;
    const future = firstInvalid === "rights" ? invalidBoundary : invalidRights;
    save(valid, [past], [future]);
    const before = storage.get(storageKey), first = readStore().store;
    assert.match(first.documentRecoveryError, firstInvalid === "rights"
      ? /recovery is paused.*requiredAccessRights/ : /recovery is paused.*Boundary Outbound Deny/);
    assert.equal(storage.get(storageKey), before);
    assert.doesNotMatch(first.documentRecoveryError, /RIGHTS_EVIDENCE|BOUNDARY_EVIDENCE/);
    save(valid, [valid], [future]);
    const afterFirstRepair = storage.get(storageKey), second = readStore().store;
    assert.match(second.documentRecoveryError, firstInvalid === "rights"
      ? /recovery is paused.*Boundary Outbound Deny/ : /recovery is paused.*requiredAccessRights/);
    assert.equal(storage.get(storageKey), afterFirstRepair);
    save(valid, [valid], [valid]);
    const recovered = readStore().store;
    assert.equal(recovered.documentRecoveryError, null);
    assert.equal(recovered.canUndo, true);
    assert.equal(recovered.canRedo, true);
    assert.deepEqual(notes(recovered.doc.boundaries[0]), values);
    assert.equal(recovered.doc.edges[0].requiredAccessRights, valid.edges[0].requiredAccessRights);
  });
}

test("boundary network: synthetic peers preserve concurrent fields, privacy state, reconnect and clearing", t => {
  const a = createYShape(), b = createYShape(), reconnect = createYShape();
  t.after(() => [a, b, reconnect].forEach(shape => shape.ydoc.destroy()));
  const doc = normalizeDoc(fixture());
  reconcileLocalToY(a, doc);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(notes(buildDocFromY(b).boundaries[0]), values);
  const first = buildDocFromY(a), second = buildDocFromY(b);
  first.boundaries[0].inboundAllow = "First peer\nallow";
  second.boundaries[0].outboundDeny = "Second peer\ndeny";
  reconcileLocalToY(a, first);
  reconcileLocalToY(b, second);
  const updateA = Y.encodeStateAsUpdate(a.ydoc), updateB = Y.encodeStateAsUpdate(b.ydoc);
  Y.applyUpdate(a.ydoc, updateB); Y.applyUpdate(b.ydoc, updateA);
  const merged = buildDocFromY(a);
  assert.equal(merged.boundaries[0].inboundAllow, "First peer\nallow");
  assert.equal(merged.boundaries[0].outboundDeny, "Second peer\ndeny");
  assert.deepEqual(buildDocFromY(b), merged);
  merged.boundaries[0].type = "privacy";
  reconcileLocalToY(a, normalizeDoc(merged));
  Y.applyUpdate(reconnect.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(notes(buildDocFromY(reconnect).boundaries[0]), notes(merged.boundaries[0]));
  const cleared = buildDocFromY(reconnect);
  for (const key of fields) delete cleared.boundaries[0][key];
  reconcileLocalToY(reconnect, cleared);
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(reconnect.ydoc));
  for (const key of fields) assert.equal(buildDocFromY(a).boundaries[0][key], undefined);
  a.boundaries.get("b_network").set("inboundAllow", { malformed: true });
  assert.throws(() => buildDocFromY(a), /boundary.*text|text.*boundary/i);
});
