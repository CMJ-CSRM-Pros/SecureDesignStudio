import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import * as Y from "yjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { documentFixture } from "./catalog-fixtures.mjs";

const { normalizeDoc, StoreProvider, useStore } = await import("../../src/store.tsx");
const { UiShellProvider } = await import("../../src/uiShell.tsx");
const { removeThreatNoteScenario } = await import("../../src/threatNotes.ts");
const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
const { capturePristineHtml, buildStandaloneHtml } = await import("../../src/embeddedDoc.ts");
const { parseTm7 } = await import("../../src/tm7Import.ts");
const { prepareTm7Export } = await import("../../src/tm7Export.ts");
const { diffDocuments } = await import("../../src/diff.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");

export function threatFixture() {
  const doc = documentFixture();
  const note = (id, targetKind, targetId) => ({
    id, origin: "authored-threat", targetKind, targetId, scenarioIds: [doc.scenarios[0].id],
    title: `Synthetic ${id}`, description: `Threat <script>literal</script> & text\nMitigation remains proposed: ${id}`,
    justification: `Optional reason\n${id}`, status: "Active", createdAt: 10, replies: [],
  });
  doc.issues = [
    note("i_node", "node", doc.nodes[0].id),
    note("i_flow_one", "edge", doc.edges[0].id),
    { ...note("i_flow_two", "edge", doc.edges[0].id), status: "Resolved", justification: "" },
    { ...note("i_ordinary", "node", doc.nodes[1].id), origin: undefined, justification: undefined },
  ];
  return doc;
}

const all = (root, name) => [...root.getElementsByTagNameNS("*", name)];
const direct = (root, name) => [...root.childNodes].find(n => n.nodeType === 1 && n.localName === name);
const text = (root, name) => direct(root, name)?.textContent ?? "";
const read = xml => new DOMParser().parseFromString(xml, "text/xml");
const props = value => Object.fromEntries(all(direct(value, "Properties"), "KeyValueOfstringstring")
  .map(entry => [text(entry, "Key"), text(entry, "Value")]));

test("threat notes: native JSON preserves deliberate origin and exact optional prose", () => {
  const doc = threatFixture(), result = normalizeDoc(JSON.parse(JSON.stringify(doc)));
  for (let i = 0; i < 3; i++) {
    assert.equal(result.issues[i].origin, "authored-threat");
    assert.equal(result.issues[i].description, doc.issues[i].description);
    assert.equal(result.issues[i].justification ?? "", doc.issues[i].justification);
  }
  assert.equal(result.issues[3].origin, undefined);
  for (const change of [
    i => { i.justification = {}; },
    i => { i.origin = "guessed"; },
    i => { i.kind = "AnalyzerRule"; },
    i => { i.targetId = "missing"; },
    i => { i.scenarioIds = ["missing"]; },
  ]) {
    const bad = threatFixture(); change(bad.issues[0]);
    assert.throws(() => normalizeDoc(bad), /threat note/i);
  }
});

test("threat notes: human status and Analyze never infer mitigation completion or change authored text", () => {
  const doc = normalizeDoc(threatFixture());
  assert.equal(doc.issues.filter(i => i.origin === "authored-threat").length, 3);
  assert.deepEqual(new IssueManager().analyze(doc).issues.filter(i => i.origin === "authored-threat"),
    doc.issues.filter(i => i.origin === "authored-threat"));
});

function localEnvironment(t, embedded = null) {
  const storage = new Map(), oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) } };
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
  renderToStaticMarkup(createElement(UiShellProvider, null, createElement(StoreProvider, null, createElement(Probe))));
  return store;
}
function save(doc, past = [], future = []) {
  saveAutosave({ doc, past, future, view: { activeScenarioId: doc.scenarios[0].id, filter: {} } });
}

test("threat notes: real store authoring permits blanks, rejects invalid edits and never promotes ordinary issues", t => {
  localEnvironment(t); save(threatFixture());
  const store = readStore(), doc = store.doc;
  const created = store.addIssue("node", doc.nodes[0].id, [], "", "", { origin: "authored-threat" });
  assert.equal(created.origin, "authored-threat");
  assert.equal(created.justification, undefined);
  assert.equal(created.status, "Active");
  const ordinary = store.addIssue("edge", doc.edges[0].id, [], "Accepted AI", "Not provenance");
  assert.equal(ordinary.origin, undefined);
  assert.throws(() => store.addIssue("node", "missing", [], "", "", { origin: "authored-threat" }), /threat note/i);
  assert.throws(() => store.updateIssue(doc.issues[0].id, { justification: [] }), /threat note/i);
  const malformed = threatFixture(); malformed.issues[0].description = {};
  assert.throws(() => store.importJson(malformed), /threat note/i);
  assert.deepEqual(JSON.parse(store.exportJson()).doc.issues, JSON.parse(JSON.stringify(doc.issues)));
});

test("threat notes: losing final explicit scenario removes, never broadens, while global and ordinary behavior stays", () => {
  const note = threatFixture().issues[0], sid = note.scenarioIds[0];
  assert.deepEqual(removeThreatNoteScenario(note, sid), []);
  assert.deepEqual(removeThreatNoteScenario({ ...note, scenarioIds: [sid, "s_other"] }, sid)[0].scenarioIds, ["s_other"]);
  assert.deepEqual(removeThreatNoteScenario({ ...note, scenarioIds: [] }, sid)[0].scenarioIds, []);
  assert.deepEqual(removeThreatNoteScenario({ ...note, origin: undefined, justification: undefined }, sid)[0].scenarioIds, []);
});

test("threat notes: .tma, autosave history and embedded HTML retain exact Unicode/CRLF/blank text safely", t => {
  localEnvironment(t);
  const doc = threatFixture();
  doc.issues[0].description = "  \u03bb \ud83d\udd12\r\n<script>literal</script>  ";
  doc.issues[0].justification = "\t \r\n";
  const prior = structuredClone(doc), future = structuredClone(doc);
  prior.issues[0].status = "Resolved"; future.issues[0].description = "Future body";
  save(doc, [prior], [future]);
  const raw = loadAutosaveRaw(), store = readStore();
  assert.equal(store.canUndo, true); assert.equal(store.canRedo, true);
  assert.equal(normalizeDoc(raw.doc).issues[0].description, doc.issues[0].description);
  assert.equal(normalizeDoc(raw.past[0]).issues[0].status, "Resolved");
  assert.equal(normalizeDoc(raw.future[0]).issues[0].description, "Future body");
  capturePristineHtml("<html><body>Synthetic app</body></html>");
  const html = buildStandaloneHtml(store.exportJson());
  assert.equal(html.includes("<script>literal</script>"), false);
  const wrapper = JSON.parse(html.match(/id="ps-embedded-doc">([\s\S]*?)<\/script>/)[1]);
  assert.equal(normalizeDoc(wrapper.doc).issues[0].description, doc.issues[0].description);
  assert.equal(normalizeDoc(wrapper.doc).issues[0].justification, doc.issues[0].justification);
});

for (const source of ["current", "past", "future", "embedded"]) {
  test(`threat notes: malformed ${source} pauses recovery without overwriting evidence`, t => {
    const malformed = threatFixture(); malformed.issues[0].justification = { raw: "KEEP_RAW_EVIDENCE" };
    const storage = localEnvironment(t, source === "embedded" ? { doc: malformed } : null);
    save(source === "current" ? malformed : threatFixture(), source === "past" ? [malformed] : [],
      source === "future" ? [malformed] : []);
    const before = storage.get("secure-design-studio:autosave:v1"), store = readStore();
    assert.match(store.documentRecoveryError, /recovery is paused.*Threat note/);
    assert.equal(storage.get("secure-design-studio:autosave:v1"), before);
    assert.equal(store.documentRecoveryError.includes("KEEP_RAW_EVIDENCE"), false);
  });
}

test("threat notes: unsupported TM7 re-import explicitly warns and never invents severity from legacy High", () => {
  const oldParser = globalThis.DOMParser; globalThis.DOMParser = DOMParser;
  try {
    const xml = prepareTm7Export(threatFixture()).xml.replaceAll("<b:Priority />", "<b:Priority>High</b:Priority>");
    const imported = parseTm7(xml);
    assert.deepEqual(imported.doc.issues, []);
    assert.match(imported.diagnostics.join("\n"), /Native threat instances.*not imported/);
    assert.equal(JSON.stringify(imported.doc).includes('"severity"'), false);
  } finally {
    if (oldParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = oldParser;
  }
});

test("threat notes: review and diff include exact body, justification, applicability and human status", () => {
  const doc = normalizeDoc(threatFixture());
  const html = buildReviewReportHtml({ doc, scenario: doc.scenarios[0], appVersion: "test" });
  assert.match(html, /Authored threat note/);
  assert.match(html, /Optional reason/);
  assert.match(html, /&lt;script&gt;literal&lt;\/script&gt;/);
  for (const [field, value] of [["title", "New title"], ["description", "New\nbody"], ["justification", "New\nreason"], ["status", "Resolved"], ["scenarioIds", []]]) {
    const after = structuredClone(doc); after.issues[0][field] = value;
    const changes = diffDocuments(doc, after);
    assert.equal(changes.length, 1, field);
    assert.match(changes[0].description, /threat note/i);
    assert.equal(changes[0].target.id, doc.nodes[0].id);
  }
});

test("threat notes: compatible Yjs peers preserve note provenance and optional fields", () => {
  const doc = normalizeDoc(threatFixture()), a = createYShape(), b = createYShape();
  reconcileLocalToY(a, doc);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(normalizeDoc(buildDocFromY(b)).issues.slice().sort((a, b) => a.id.localeCompare(b.id)),
    doc.issues.slice().sort((a, b) => a.id.localeCompare(b.id)));
  a.ydoc.destroy(); b.ydoc.destroy();
});

test("threat notes: native records aggregate same interaction without dropping prose or forging priority/status", () => {
  const doc = threatFixture(), before = structuredClone(doc), result = prepareTm7Export(doc);
  const root = read(result.xml), records = all(root, "KeyValueOfstringThreatpc_P0_PhOB");
  assert.equal(records.length, 2);
  const values = records.map(r => direct(r, "Value"));
  const node = values.find(v => text(v, "FlowGuid") === "00000000-0000-0000-0000-000000000000");
  const flow = values.find(v => v !== node);
  assert.equal(text(node, "SourceGuid"), result.references.find(r => r.entityId === doc.nodes[0].id).objectGuid);
  assert.equal(text(flow, "FlowGuid"), result.references.find(r => r.entityId === doc.edges[0].id).objectGuid);
  for (const value of values) {
    assert.equal(text(value, "TypeId"), "");
    assert.equal(direct(value, "TypeId").hasAttribute("i:nil"), false);
    assert.equal(text(value, "State"), "AutoGenerated");
    assert.equal(props(value).Priority, "");
    assert.equal(text(value, "Priority"), "");
    assert.equal(props(value).UserThreatCategory, "User-defined");
    assert.match(props(value).UserThreatDescription, /SDS severity: Unspecified/);
  }
  for (const issue of doc.issues.slice(1, 3)) {
    assert.ok(props(flow).UserThreatDescription.includes(issue.description));
    assert.ok(props(flow).UserThreatDescription.includes(issue.id));
    assert.ok(props(flow).UserThreatDescription.includes(issue.status));
  }
  assert.ok(props(flow).StateInformation.includes(doc.issues[1].justification));
  assert.equal(result.xml.includes(doc.issues[3].title), false);
  assert.match(result.diagnostics.join("\n"), /aggregat/i);
  assert.match(result.diagnostics.join("\n"), /priority.*High|High.*priority/i);
  assert.match(result.diagnostics.join("\n"), /both current and legacy Priority and display High/);
  assert.deepEqual(doc, before);
});

test("threat notes: native XML retains authored CRLF, tabs and Unicode without executing markup", () => {
  const doc = threatFixture();
  const authored = "  \u03bb \ud83d\udd12\r\n\t<script>literal</script> & text  ";
  doc.issues[0].description = authored; doc.issues[0].justification = authored;
  const result = prepareTm7Export(doc), records = all(read(result.xml), "KeyValueOfstringThreatpc_P0_PhOB");
  const node = records.map(r => direct(r, "Value")).find(v => text(v, "FlowGuid") === "00000000-0000-0000-0000-000000000000");
  assert.ok(props(node).UserThreatDescription.includes(authored), "Authored line endings survive XML parsing");
  assert.ok(props(node).StateInformation.includes(authored));
  assert.equal(result.xml.includes("<script>literal</script>"), false);
});

test("threat notes: repeated tabs use one represented occurrence and disclose projection; invalid targets block", () => {
  const doc = threatFixture();
  doc.scenarios.push({ ...structuredClone(doc.scenarios[0]), id: "s_repeat", name: "Repeated tab" });
  doc.issues[1].scenarioIds.push("s_repeat");
  const result = prepareTm7Export(doc);
  assert.equal(all(read(result.xml), "KeyValueOfstringThreatpc_P0_PhOB").length, 2);
  assert.match(result.diagnostics.join("\n"), /tab.*project|project.*tab/i);
  assert.ok(result.xml.includes("Repeated tab"));
  doc.issues[1].scenarioIds = ["absent"];
  assert.throws(() => prepareTm7Export(doc), /threat note/i);
});

test("threat notes: parallel flows never aggregate together; title renames never change target keys", () => {
  const doc = threatFixture();
  doc.edges.push({ ...doc.edges[0], id: "e_parallel", title: doc.edges[0].title });
  doc.scenarios[0].edgeIds.push("e_parallel"); doc.scenarios[0].edgeNumbers.e_parallel = 8;
  doc.issues[2].targetId = "e_parallel";
  const result = prepareTm7Export(doc), records = all(read(result.xml), "KeyValueOfstringThreatpc_P0_PhOB");
  assert.equal(records.length, 3);
  const keys = records.map(r => text(r, "Key"));
  assert.equal(new Set(keys).size, 3);
  doc.scenarios[0].name = "Renamed scenario"; doc.edges[0].title = "Renamed flow";
  assert.deepEqual(all(read(prepareTm7Export(doc).xml), "KeyValueOfstringThreatpc_P0_PhOB").map(r => text(r, "Key")), keys);
  doc.issues[1].id = doc.issues[0].id;
  assert.throws(() => prepareTm7Export(doc), /duplicate.*ID/);
});

test("threat notes: no-scenario fallback supports global notes, but no emitted target is a blocker", () => {
  const doc = threatFixture(); doc.scenarios = [];
  doc.issues.forEach(issue => { issue.scenarioIds = []; });
  const result = prepareTm7Export(doc);
  assert.equal(all(read(result.xml), "KeyValueOfstringThreatpc_P0_PhOB").length, 2);
  assert.ok(result.references.every(ref => ref.scenarioId === null));
  const unrepresented = threatFixture();
  unrepresented.issues[0].scenarioIds = [];
  unrepresented.scenarios[0].nodeIds = [];
  unrepresented.scenarios[0].edgeIds = [];
  unrepresented.issues = [unrepresented.issues[0]];
  assert.throws(() => prepareTm7Export(unrepresented), /no exported target occurrence/);
});

test("threat notes: synthetic concurrent fields, status, clearing and reconnect preserve independent authorship", () => {
  const a = createYShape(), b = createYShape(), reconnect = createYShape();
  try {
    reconcileLocalToY(a, normalizeDoc(threatFixture()));
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const first = buildDocFromY(a), second = buildDocFromY(b);
    first.issues.find(i => i.id === "i_node").description = "Peer A\nbody";
    second.issues.find(i => i.id === "i_node").justification = "Peer B\nreason";
    second.issues.find(i => i.id === "i_flow_one").status = "Resolved";
    reconcileLocalToY(a, first); reconcileLocalToY(b, second);
    const updateA = Y.encodeStateAsUpdate(a.ydoc), updateB = Y.encodeStateAsUpdate(b.ydoc);
    Y.applyUpdate(a.ydoc, updateB); Y.applyUpdate(b.ydoc, updateA);
    const merged = normalizeDoc(buildDocFromY(a)), node = merged.issues.find(i => i.id === "i_node");
    assert.equal(node.description, "Peer A\nbody"); assert.equal(node.justification, "Peer B\nreason");
    assert.equal(merged.issues.find(i => i.id === "i_flow_one").status, "Resolved");
    delete node.justification; reconcileLocalToY(a, merged);
    Y.applyUpdate(reconnect.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    assert.deepEqual(normalizeDoc(buildDocFromY(reconnect)).issues, normalizeDoc(buildDocFromY(a)).issues);
    assert.equal(normalizeDoc(buildDocFromY(reconnect)).issues.find(i => i.id === "i_node").justification, undefined);
  } finally {
    a.ydoc.destroy(); b.ydoc.destroy(); reconnect.ydoc.destroy();
  }
});
