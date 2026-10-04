import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Y from "yjs";
import { documentFixture } from "./catalog-fixtures.mjs";

const { normalizeDoc, StoreProvider, useStore } = await import("../../src/store.tsx");
const { UiShellProvider } = await import("../../src/uiShell.tsx");
const { normalizeRequiredAccessRights, formatRequiredAccessRights } = await import("../../src/types.ts");
const { diffDocuments } = await import("../../src/diff.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { buildDfdReviewContext } = await import("../../src/dfdReviewContext.ts");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
const { capturePristineHtml, buildStandaloneHtml } = await import("../../src/embeddedDoc.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");

const rights = "  Azure RBAC: Storage Blob Data Reader\nRead/write/execute: /synthetic\n  Keep \u03bb \ud83d\udd12 & <scope> exactly.  ";
const storageKey = "secure-design-studio:autosave:v1";
function fixture(value = rights) {
  const doc = documentFixture();
  doc.edges[0].requiredAccessRights = value;
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
function readStore() {
  let store;
  function Probe() { store = useStore(); return null; }
  renderToStaticMarkup(createElement(UiShellProvider, null,
    createElement(StoreProvider, null, createElement(Probe))));
  return store;
}

test("flow rights: exact optional text and UTF-16 bound, without parsing or truncation", () => {
  for (const value of [undefined, null, ""]) {
    assert.equal(normalizeRequiredAccessRights(value), undefined);
    assert.equal(formatRequiredAccessRights(normalizeRequiredAccessRights(value)), "");
  }
  for (const value of [rights, "\r\n\t ", "No permissions required", "\ud83d\udd12".repeat(2000), "x".repeat(4000)]) {
    assert.equal(normalizeRequiredAccessRights(value), value);
  }
  assert.equal(formatRequiredAccessRights(" \n\t"), "");
  assert.equal(formatRequiredAccessRights(rights), rights);
  for (const value of [false, 42, ["Read"], { private: "DO_NOT_ECHO" }, "\ud83d\udd12".repeat(2001), "x".repeat(4001)]) {
    assert.throws(() => normalizeRequiredAccessRights(value, "e_bad"), error =>
      /requiredAccessRights/.test(error.message) && /e_bad/.test(error.message)
      && /4000/.test(error.message) && !error.message.includes("DO_NOT_ECHO"));
  }
});

test("flow rights: normalize legacy blanks, exact text, parallel edges and shared scenario identity", () => {
  const doc = fixture();
  doc.edges.push({ ...doc.edges[0], id: "e_parallel", requiredAccessRights: "Write only" });
  doc.scenarios[0].edgeIds.push("e_parallel");
  doc.scenarios[0].edgeNumbers.e_parallel = 8;
  doc.scenarios.push({ ...structuredClone(doc.scenarios[0]), id: "s_shared" });
  const normalized = normalizeDoc(doc);
  assert.equal(normalized.edges[0].requiredAccessRights, rights);
  assert.equal(normalized.edges[1].requiredAccessRights, "Write only");
  assert.deepEqual(normalized.scenarios.map(s => s.edgeIds), doc.scenarios.map(s => s.edgeIds));
  assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(normalized))), normalized);
  for (const value of [null, ""]) {
    assert.equal(normalizeDoc(fixture(value)).edges[0].requiredAccessRights, undefined);
  }
  const legacy = documentFixture();
  assert.equal(normalizeDoc(legacy).edges[0].requiredAccessRights, undefined);
  for (const value of [[], {}, true, 12, "x".repeat(4001)]) {
    assert.throws(() => normalizeDoc(fixture(value)), /requiredAccessRights/);
  }
});

test("flow rights: one navigable edge diff, blank equivalence and meaningful whitespace", () => {
  const before = normalizeDoc(documentFixture()), after = structuredClone(before);
  after.scenarios.push({ ...structuredClone(after.scenarios[0]), id: "s_second" });
  before.scenarios = structuredClone(after.scenarios);
  after.edges[0].requiredAccessRights = rights;
  const changes = diffDocuments(before, after);
  assert.equal(changes.length, 1);
  assert.match(changes[0].description, /Updated required access rights/);
  assert.deepEqual(changes[0].target, { kind: "edge", id: after.edges[0].id });
  assert.equal(changes[0].scenarioId, after.scenarios[0].id);
  assert.equal(changes[0].edgeNumber, 7);
  for (const value of ["", " \n\t"]) {
    after.edges[0].requiredAccessRights = value;
    assert.deepEqual(diffDocuments(before, after), []);
  }
  before.edges[0].requiredAccessRights = rights;
  after.edges[0].requiredAccessRights = rights.trim();
  assert.equal(diffDocuments(before, after).length, 1);
});

test("flow rights: report associates escaped, full multiline text with each included flow", () => {
  const doc = fixture("</script><script>not code</script>\n  read & write");
  doc.edges.push({ ...doc.edges[0], id: "e_blank", title: "Blank flow", requiredAccessRights: " \n " },
    { ...doc.edges[0], id: "e_other", title: "Hidden flow", requiredAccessRights: "NOT_IN_SCENARIO" });
  doc.scenarios[0].edgeIds.push("e_blank");
  doc.scenarios[0].edgeNumbers.e_blank = 8;
  const html = buildReviewReportHtml({ doc: normalizeDoc(doc), scenario: doc.scenarios[0],
    documentFileName: "synthetic.tma", appVersion: "test" });
  assert.match(html, /<th>Required access rights<\/th>/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;not code&lt;\/script&gt;\n  read &amp; write/);
  assert.match(html, /white-space:\s*pre-wrap/);
  assert.match(html, /declared design intent/i);
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g);
  assert.ok(rows.some(row => row.includes("Review flow") && row.includes("Caller")
    && row.includes("Receiver") && row.includes("read &amp; write")));
  assert.ok(rows.some(row => row.includes("Blank flow") && /Unspecified<\/span>/.test(row)));
  assert.equal(html.includes("<script>not code"), false);
  assert.equal(html.includes("NOT_IN_SCENARIO"), false);
});

test("flow rights: existing Assistant context preserves included flows without bypassing E2 exclusions", () => {
  const doc = normalizeDoc(fixture()), scenario = doc.scenarios[0], edge = doc.edges[0];
  assert.equal(buildDfdReviewContext(doc, scenario).edges[0].requiredAccessRights, rights);
  doc.nodes[0].dfdRoleOverride = "ExternalInteractor";
  scenario.nodeScopeReasons = { [doc.nodes[1].id]: "Owned elsewhere" };
  doc.nodes[1].description = "EXCLUDED_INTERNALS";
  const excluded = JSON.stringify(buildDfdReviewContext(doc, scenario));
  assert.equal(excluded.includes("EXCLUDED_INTERNALS"), false);
  assert.equal(excluded.includes("Azure RBAC"), false);
  assert.deepEqual(buildDfdReviewContext(doc, scenario).edges, []);
  assert.deepEqual(buildDfdReviewContext(doc, null).edges, []);
  doc.nodes[0].dfdRoleOverride = "Process";
  assert.equal(buildDfdReviewContext(doc, scenario).edges[0].id, edge.id);
  assert.equal(buildDfdReviewContext(doc, scenario).edges[0].requiredAccessRights, rights);
});

test("flow rights: independent authentication, identity and deterministic findings", () => {
  const before = normalizeDoc(documentFixture());
  before.edges[0].authenticationTypes = ["ApiKey"];
  before.edges[0].productionIdentity = { kind: "ManagedIdentity" };
  before.edges[0].audience = "synthetic audience";
  before.edges[0].constraints = "synthetic token constraints";
  before.issues = new IssueManager().analyze(before).issues;
  const after = structuredClone(before);
  after.edges[0].requiredAccessRights = rights;
  assert.deepEqual(new IssueManager().analyze(after).issues, new IssueManager().analyze(before).issues);
  const normalized = normalizeDoc(after);
  for (const key of ["authenticationTypes", "productionIdentity", "audience", "constraints"]) {
    assert.deepEqual(normalized.edges[0][key], before.edges[0][key]);
  }
  assert.equal(normalized.edges[0].requiredAccessRights, rights);
});

test("flow rights: autosave history and portable HTML preserve exact strings and script escaping", t => {
  localEnvironment(t);
  const before = normalizeDoc(documentFixture()), after = normalizeDoc(fixture(rights + "\n</script>"));
  saveAutosave({ doc: after, past: [before], future: [after],
    view: { activeScenarioId: after.scenarios[0].id, filter: {} } });
  const saved = loadAutosaveRaw();
  assert.equal(normalizeDoc(saved.doc).edges[0].requiredAccessRights, rights + "\n</script>");
  assert.deepEqual(normalizeDoc(saved.past[0]), before);
  assert.deepEqual(normalizeDoc(saved.future[0]), after);
  capturePristineHtml("<html><body></body></html>");
  const html = buildStandaloneHtml(JSON.stringify({ format: "secure-design-studio-diagram", version: 2, doc: after }));
  const payload = /id="ps-embedded-doc">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.deepEqual(normalizeDoc(JSON.parse(payload).doc), after);
});

test("flow rights: real store startup/export and invalid Open/update retain the current model", t => {
  localEnvironment(t, { format: "secure-design-studio-diagram", version: 2, doc: fixture() });
  const store = readStore(), before = store.exportJson();
  assert.equal(JSON.parse(before).doc.edges[0].requiredAccessRights, rights);
  for (const value of [fixture(27), { format: "secure-design-studio-diagram", version: 2, doc: fixture("x".repeat(4001)) }]) {
    assert.throws(() => store.importJson(value), /requiredAccessRights/);
  }
  assert.throws(() => store.updateEdge(store.doc.edges[0].id, { requiredAccessRights: "x".repeat(4001) }), /requiredAccessRights/);
  assert.equal(store.exportJson(), before);
  assert.equal(store.canUndo, false);
});

for (const location of ["current", "past", "future", "embedded"]) {
  test(`flow rights: malformed ${location} recovery pauses without overwriting stored text`, t => {
    const valid = fixture(), invalid = fixture({ text: "DO_NOT_ECHO" });
    const storage = localEnvironment(t, location === "embedded" ? invalid : null);
    const raw = JSON.stringify({ version: 1, doc: location === "current" ? invalid : valid,
      past: location === "past" ? [invalid] : [], future: location === "future" ? [invalid] : [] });
    storage.set(storageKey, raw);
    const store = readStore();
    assert.match(store.documentRecoveryError ?? "", /recovery is paused.*requiredAccessRights/);
    assert.equal(store.documentRecoveryError.includes("DO_NOT_ECHO"), false);
    assert.equal(storage.get(storageKey), raw);
    assert.equal(store.doc.edges.length, 0);
  });
}

test("flow rights: synthetic peers retain, concurrently converge, reconnect, clear and reject malformed state", t => {
  const a = createYShape(), b = createYShape(), c = createYShape();
  t.after(() => [a, b, c].forEach(shape => shape.ydoc.destroy()));
  const doc = normalizeDoc(fixture()), id = doc.edges[0].id;
  reconcileLocalToY(a, doc);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.equal(buildDocFromY(b).edges[0].requiredAccessRights, rights);
  a.edges.get(id).set("requiredAccessRights", "Peer A\nread");
  b.edges.get(id).set("requiredAccessRights", "Peer B\nwrite");
  const updateA = Y.encodeStateAsUpdate(a.ydoc), updateB = Y.encodeStateAsUpdate(b.ydoc);
  Y.applyUpdate(a.ydoc, updateB); Y.applyUpdate(b.ydoc, updateA);
  assert.deepEqual(buildDocFromY(a), buildDocFromY(b));
  assert.ok(["Peer A\nread", "Peer B\nwrite"].includes(buildDocFromY(a).edges[0].requiredAccessRights));
  Y.applyUpdate(c.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(buildDocFromY(c), buildDocFromY(a));
  a.edges.get(id).delete("requiredAccessRights");
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.equal(buildDocFromY(b).edges[0].requiredAccessRights, undefined);
  b.edges.get(id).set("requiredAccessRights", { invalid: true });
  assert.throws(() => buildDocFromY(b), /requiredAccessRights/);
  assert.deepEqual(b.edges.get(id).get("requiredAccessRights"), { invalid: true });
});
