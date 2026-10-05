import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser } from "@xmldom/xmldom";
import * as Y from "yjs";
const { parseTm7, Tm7ImportError } = await import("../../src/tm7Import.ts");
const { prepareTm7Export } = await import("../../src/tm7Export.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { emptyDocument } = await import("../../src/types.ts");
const { createYShape, isYShapeEmpty } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, reconcileCurrentDocumentToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { calculateScenarioDeletionImpact } = await import("../../src/scenarioDeletion.ts");
const { diffDocuments, isChangeNavigable } = await import("../../src/diff.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");
const { buildDfdReviewContext } = await import("../../src/dfdReviewContext.ts");
const { capturePristineHtml, buildStandaloneHtml, readEmbeddedDoc } = await import("../../src/embeddedDoc.ts");
const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
const { annotationTextFromEditor } = await import("../../src/textAnnotations.ts");
globalThis.DOMParser = DOMParser;
const guid = n => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zero = "00000000-0000-0000-0000-000000000000";
const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const property = text => `<Properties><anyType><DisplayName>Name</DisplayName><Value>${escape(text)}</Value></anyType></Properties>`;
const border = (id, text, kind = "GE.A", x = 10) =>
  `<KeyValueOfguidanyType><Key>${id}</Key><Value i:type="${kind === "GE.A" ? "StencilRectangle" : "StencilEllipse"}"><Guid>${id}</Guid><GenericTypeId>${kind}</GenericTypeId><TypeId>${kind}</TypeId>${property(text)}<Left>${x}</Left><Top>20</Top><Width>320</Width><Height>140</Height></Value></KeyValueOfguidanyType>`;
const flow = (id, source, target, label = " loose & <label>\n\n tail ") =>
  `<KeyValueOfguidanyType><Key>${id}</Key><Value i:type="Connector"><Guid>${id}</Guid><GenericTypeId>GE.DF</GenericTypeId>${property(label)}<SourceGuid>${source}</SourceGuid><TargetGuid>${target}</TargetGuid><SourceX>10</SourceX><SourceY>20</SourceY><TargetX>50</TargetX><TargetY>60</TargetY></Value></KeyValueOfguidanyType>`;
const tab = (id, borders, lines = "") => `<DrawingSurfaceModel><Guid>${id}</Guid>${property("Synthetic tab")}<Borders>${borders}</Borders><Lines>${lines}</Lines></DrawingSurfaceModel>`;
const xml = tabs => `<ThreatModel xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><DrawingSurfaceList>${tabs}</DrawingSurfaceList></ThreatModel>`;
const annotation = (id = guid(3), text = "  safe <script> Ω 😀\n\n trailing  ") =>
  ({ id, text, position: { x: 10, y: 20 }, size: { width: 320, height: 140 } });
const nodes = border(guid(1), "A", "GE.P") + border(guid(2), "B", "GE.P");

test("Annotations: textarea no-op edits retain exact bytes and real edits retain uniform source newline style", () => {
  for (const separator of ["\n", "\r\n", "\r"]) {
    const source = ` first${separator}${separator} Ω  `;
    assert.equal(annotationTextFromEditor(" first\n\n Ω  ", source), source);
    assert.equal(annotationTextFromEditor(" first\n\n Ω  !\nend", source), `${source}!${separator}end`);
  }
  const mixed = " first\r\nsecond\rlast\n ";
  assert.equal(annotationTextFromEditor(" first\nsecond\nlast\n ", mixed), mixed);
});

for (const missing of ["", zero]) for (const ends of ["source", "target", "both"]) {
  test(`TM7 unattached: ${ends} ${missing ? "zero" : "blank"} is explicitly omitted, full label retained`, () => {
    const result = parseTm7(xml(tab(guid(10), nodes,
      flow(guid(4), ends !== "target" ? missing : guid(1), ends !== "source" ? missing : guid(2)) +
      flow(guid(5), guid(1), guid(2), "One") + flow(guid(6), guid(1), guid(2), "Parallel"))));
    assert.equal(result.summary.skippedDanglingEdgeCount, 1);
    assert.equal(result.summary.edgeCount, 2);
    assert.deepEqual(result.doc.scenarios[0].edgeIds, [guid(5), guid(6)]);
    const a = result.doc.textAnnotations[0];
    assert.equal(a.text, " loose & <label>\n\n tail ");
    assert.deepEqual(a.position, { x: 30, y: 40 });
    assert.notEqual(a.id, guid(4));
    assert.deepEqual(result.doc.scenarios[0].textAnnotationIds, [a.id]);
    const warning = result.diagnostics.find(message => message.startsWith("Omitted unattached"));
    assert.ok(warning.includes(guid(4)) && warning.includes("Synthetic tab") && warning.includes(ends === "both" ? "source and target" : ends));
  });
}
test("TM7 unattached: empty labels are not invented; nonzero or malformed opposite endpoints still fail", () => {
  assert.equal(parseTm7(xml(tab(guid(10), nodes, flow(guid(4), "", zero, "")))).doc.textAnnotations, undefined);
  for (const source of [guid(99), "not-a-guid"]) {
    assert.throws(() => parseTm7(xml(tab(guid(10), nodes, flow(guid(4), source, zero)))), Tm7ImportError);
  }
});
test("TM7 unattached: a valid same-ID occurrence never resurrects an invalid tab occurrence", () => {
  for (const reverse of [false, true]) {
    const a = tab(guid(10), nodes, flow(guid(4), "", guid(2)));
    const b = tab(guid(11), nodes, flow(guid(4), guid(1), guid(2)));
    const result = parseTm7(xml(reverse ? b + a : a + b));
    assert.equal(result.doc.edges.length, 1);
    assert.deepEqual(result.doc.scenarios.find(s => s.id === guid(10)).edgeIds, []);
    assert.deepEqual(result.doc.scenarios.find(s => s.id === guid(11)).edgeIds, [guid(4)]);
    assert.notEqual(result.doc.textAnnotations[0].id, guid(4));
  }
});
test("TM7 annotations: exact whitespace, blank lines, Unicode, empty text and source geometry survive alone", () => {
  for (const text of ["", " \t\n\n  ", annotation().text]) {
    const result = parseTm7(xml(tab(guid(10), border(guid(3), text))));
    assert.equal(result.summary.annotationCount, 1);
    assert.equal(result.summary.skippedAnnotationCount, 0);
    assert.equal(result.doc.nodes.length, 0);
    assert.deepEqual(result.doc.textAnnotations, [annotation(guid(3), text)]);
    assert.deepEqual(normalizeDoc(result.doc).textAnnotations, [annotation(guid(3), text)]);
  }
});
test("TM7 annotations: differing shared text or geometry is cloned with explicit provenance", () => {
  const result = parseTm7(xml(tab(guid(10), border(guid(3), "First")) +
    tab(guid(11), border(guid(3), "Second")) + tab(guid(12), border(guid(3), "First", "GE.A", 99))));
  assert.deepEqual(result.doc.textAnnotations.map(a => [a.text, a.position.x]), [["First", 10], ["Second", 10], ["First", 99]]);
  assert.equal(new Set(result.doc.textAnnotations.map(a => a.id)).size, 3);
  assert.equal(result.diagnostics.filter(message => message.includes("preserved as separate annotation")).length, 2);
  assert.deepEqual(result.doc.scenarios.map(s => s.textAnnotationIds.length), [1, 1, 1]);
});
test("TM7 annotations: duplicate, cross-kind, cross-tab, malformed geometry and DTD protections remain strict", () => {
  for (const bad of [
    xml(tab(guid(10), border(guid(3), "") + border(guid(3), ""))),
    xml(tab(guid(10), border(guid(3), "")) + tab(guid(11), border(guid(3), "", "GE.P"))),
    xml(tab(guid(10), border(guid(10), ""))),
    xml(tab(guid(10), border(guid(3), "").replace("<Width>320</Width>", "<Width>bad</Width>"))),
    xml(tab(guid(10), border(guid(3), "").replace("<TypeId>GE.A</TypeId>", "<TypeId>GE.P</TypeId>"))),
    `<!DOCTYPE ThreatModel [<!ENTITY x "unsafe">]>${xml(tab(guid(10), border(guid(3), "")))}`,
    xml(tab(guid(10), nodes, flow(guid(4), guid(1), guid(99))) + tab(guid(11), border(guid(99), "", "GE.P"))),
  ]) assert.throws(() => parseTm7(bad), Tm7ImportError);
});
test("Annotations: native validation preserves optional legacy shape, rejects malformed payload and prunes stale membership", () => {
  const legacy = normalizeDoc(emptyDocument());
  assert.equal("textAnnotations" in legacy, false);
  const source = parseTm7(xml(tab(guid(10), border(guid(3), annotation().text)))).doc;
  source.scenarios[0].textAnnotationIds.push("gone", guid(3));
  const normal = normalizeDoc(source);
  assert.deepEqual(normal.scenarios[0].textAnnotationIds, [guid(3)]);
  assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(normal))), normal);
  for (const change of [
    d => { d.textAnnotations = {}; }, d => { d.textAnnotations[0].text = 3; },
    d => { d.textAnnotations[0].position.x = NaN; }, d => { d.textAnnotations[0].size.width = 0; },
    d => { d.textAnnotations[0].id = d.scenarios[0].id; }, d => { d.scenarios[0].textAnnotationIds = 3; },
  ]) { const d = structuredClone(normal); change(d); assert.throws(() => normalizeDoc(d)); }
});
test("Annotations: standard GE.A native export/reimport retains text, GUID and documented translated geometry on each tab", () => {
  const input = normalizeDoc(parseTm7(xml(tab(guid(10), border(guid(3), annotation().text)) +
    tab(guid(11), border(guid(3), annotation().text)))).doc);
  const prepared = prepareTm7Export(input);
  assert.equal(prepared.references.filter(r => r.kind === "annotation").length, 2);
  assert.match(prepared.xml, /i:type="StencilRectangle"/);
  const output = parseTm7(prepared.xml).doc;
  assert.deepEqual(output.textAnnotations, [{ ...annotation(), position: { x: 50, y: 50 } }]);
  assert.deepEqual(output.scenarios.map(s => s.textAnnotationIds), [[guid(3)], [guid(3)]]);
  input.textAnnotations[0].text = "  CR\rLF\nCRLF\r\n\t ";
  assert.equal(parseTm7(prepareTm7Export(input).xml).doc.textAnnotations[0].text, input.textAnnotations[0].text);
});
test("Annotations: two current Yjs peers seed text-only rooms, concurrently edit, reconnect and delete", () => {
  const doc = normalizeDoc({ ...emptyDocument(), textAnnotations: [annotation()] });
  doc.nodeTypes.sort((a, b) => a.id.localeCompare(b.id));
  const a = createYShape(), b = createYShape();
  assert.equal(isYShapeEmpty(a), true);
  reconcileLocalToY(a, doc);
  assert.equal(isYShapeEmpty(a), false);
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(buildDocFromY(b), doc);
  const da = buildDocFromY(a), db = buildDocFromY(b);
  da.textAnnotations[0].text = "Peer A\n\n ";
  db.textAnnotations[0].position.x = 150;
  reconcileLocalToY(a, da); reconcileLocalToY(b, db);
  const ua = Y.encodeStateAsUpdate(a.ydoc), ub = Y.encodeStateAsUpdate(b.ydoc);
  Y.applyUpdate(a.ydoc, ub); Y.applyUpdate(b.ydoc, ua);
  assert.deepEqual(buildDocFromY(a), buildDocFromY(b));
  assert.deepEqual(buildDocFromY(a).textAnnotations, [{ ...annotation(), text: "Peer A\n\n ", position: { x: 150, y: 20 } }]);
  const deleted = buildDocFromY(a); deleted.textAnnotations = [];
  reconcileLocalToY(a, deleted); Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
  assert.deepEqual(buildDocFromY(b), deleted);
  a.ydoc.destroy(); b.ydoc.destroy();
});
test("Annotations: scenario cascade, diff navigation, safe full report and explicit untrusted review context", () => {
  const doc = normalizeDoc(parseTm7(xml(tab(guid(10), border(guid(3), annotation().text)))).doc);
  assert.deepEqual([...calculateScenarioDeletionImpact(doc, guid(10)).orphanAnnotationIds], [guid(3)]);
  doc.scenarios.push({ ...doc.scenarios[0], id: guid(11), textAnnotationIds: [guid(3)] });
  assert.equal(calculateScenarioDeletionImpact(doc, guid(10)).orphanAnnotationIds.size, 0);
  const after = structuredClone(doc); after.textAnnotations[0].text += " changed";
  const change = diffDocuments(doc, after).find(c => c.category === "annotation");
  assert.equal(isChangeNavigable(change, after), true);
  assert.equal(change.target.kind, "annotation");
  const report = buildReviewReportHtml({ doc, scenario: doc.scenarios[0], documentFileName: "synthetic.tma", appVersion: "test" });
  assert.ok(report.includes(escape(annotation().text)));
  assert.equal(report.includes("<script>"), false);
  const context = buildDfdReviewContext(doc, doc.scenarios[0]);
  assert.equal(context.nodes.length, 0); assert.equal(context.edges.length, 0);
  assert.equal(context.textAnnotations[0].text, annotation().text);
  assert.match(context.textAnnotations[0].context, /Untrusted/);
});

test("Annotations: current complete replacement clears notes while an absent-field legacy writer retains notes and memberships", () => {
  const original = normalizeDoc(parseTm7(xml(tab(guid(10), border(guid(3), "Untrusted preserved text")))).doc);
  const a = createYShape(), b = createYShape();
  try {
    reconcileCurrentDocumentToY(a, original);
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const legacy = structuredClone(original);
    delete legacy.textAnnotations;
    delete legacy.scenarios[0].textAnnotationIds;
    legacy.scenarios[0].description = "Legacy unrelated update";
    reconcileLocalToY(a, legacy);
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    assert.deepEqual(buildDocFromY(b).textAnnotations, original.textAnnotations);
    assert.deepEqual(buildDocFromY(b).scenarios[0].textAnnotationIds, [guid(3)]);
    assert.equal(buildDocFromY(b).scenarios[0].description, "Legacy unrelated update");
    const before = structuredClone(legacy);
    reconcileCurrentDocumentToY(a, legacy);
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    assert.deepEqual(legacy, before, "An explicit current replacement does not mutate the local legacy model");
    assert.deepEqual(buildDocFromY(b).textAnnotations, []);
    assert.equal(buildDocFromY(b).scenarios[0].textAnnotationIds, undefined);
    reconcileCurrentDocumentToY(a, original);
    reconcileCurrentDocumentToY(a, emptyDocument());
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    assert.deepEqual(buildDocFromY(b).textAnnotations, []);
    assert.deepEqual(buildDocFromY(b).scenarios, []);
    reconcileCurrentDocumentToY(a, { ...original, textAnnotations: [],
      scenarios: original.scenarios.map(s => ({ ...s, textAnnotationIds: [] })) });
    assert.deepEqual(buildDocFromY(a).textAnnotations, []);
  } finally {
    a.ydoc.destroy(); b.ydoc.destroy();
  }
});

test("Annotations: autosave history and standalone HTML retain complete portable payload without script injection", () => {
  const originalDocument = globalThis.document, originalWindow = globalThis.window,
    originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const doc = normalizeDoc({ ...emptyDocument(), textAnnotations: [annotation(guid(3), " \n</script><script>alert(1)</script> Ω\n ")] });
  const wrapper = { format: "secure-design-studio-diagram", version: 2, doc, view: { activeScenarioId: null, filter: {} } };
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  } });
  globalThis.window = { localStorage: globalThis.localStorage };
  try {
    saveAutosave({ doc, past: [doc], future: [doc], view: wrapper.view });
    const saved = loadAutosaveRaw();
    assert.deepEqual(saved.doc, doc); assert.deepEqual(saved.past, [doc]); assert.deepEqual(saved.future, [doc]);
    capturePristineHtml("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    const html = buildStandaloneHtml(JSON.stringify(wrapper));
    assert.equal(html.includes("</script><script>alert"), false);
    const payload = html.match(/<script[^>]*id="ps-embedded-doc"[^>]*>([\s\S]*?)<\/script>/)[1];
    globalThis.document = { getElementById: () => ({ textContent: payload }) };
    assert.deepEqual(readEmbeddedDoc(), wrapper);
    assert.deepEqual(normalizeDoc(readEmbeddedDoc().doc), doc);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else delete globalThis.localStorage;
  }
});
