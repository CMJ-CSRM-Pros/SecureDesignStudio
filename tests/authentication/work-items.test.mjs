import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import * as Y from "yjs";

const { normalizeWorkItem, workItemFromFinding } = await import("../../src/workItems.ts");
const { emptyDocument, WORK_ITEM_SEVERITIES } = await import("../../src/types.ts");
const { normalizeDoc, StoreProvider, useStore } = await import("../../src/store.tsx");
const { UiShellProvider } = await import("../../src/uiShell.tsx");
const { diffDocuments } = await import("../../src/diff.ts");
const { createFindingsWorkbook } = await import("../../src/findingsExport.ts");
const { saveAutosave, loadAutosaveRaw } = await import("../../src/autosave.ts");
const { capturePristineHtml, buildStandaloneHtml, readEmbeddedDoc } = await import("../../src/embeddedDoc.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");

const receipt = (status = "submitted") => ({
  operationId: "operation_synthetic", destinationKey: "https://dev.azure.com/synthetic/project",
  status, attemptedAt: 1234, adoId: 42, url: "https://dev.azure.com/synthetic/project/_workitems/edit/42",
  error: "Safe synthetic diagnostic",
});
const work = (status = "submitted") => ({
  id: "wi_review", description: "  Preserve description\r\n\nΩ 😀 </script>  ",
  link: "https://example.invalid/legacy", title: "  Review name Ω  ", decision: "accepted",
  severity: "2 - High",
  workItemType: "Bug", weaknessType: "Specific finding weakness",
  submission: receipt(status),
});
const fixture = (item = work()) => normalizeDoc({ ...emptyDocument(), workItems: [item] });
const wrapped = doc => ({ format: "secure-design-studio-diagram", version: 2, doc, view: { activeScenarioId: null, filter: {} } });

function localEnvironment(t, embedded = null) {
  const storage = new Map(), oldWindow = globalThis.window, oldDocument = globalThis.document;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Network access is forbidden in work-item tests."); };
  globalThis.window = { localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  globalThis.document = { getElementById: id =>
    id === "ps-embedded-doc" && embedded ? { textContent: JSON.stringify(embedded) } : null };
  t.after(() => {
    globalThis.fetch = oldFetch;
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

test("work items: findings transfer every field, severity and original scenario into a pending draft", () => {
  const analysis = { documentSessionId: 1, scenarioId: "s_original", scenarioName: "Original scenario", createdAt: 1234,
    answer: "Overall analysis summary" };
  for (const [severity, expected] of [
    ["critical", "1 - Critical"], ["high", "2 - High"], ["medium", "3 - Medium"], ["low", "4 - Low"],
  ]) {
    const finding = {
      id: "finding_original", title: "Complete finding", severity, category: "Privacy",
      workItemType: "Task", weaknessType: "Finding-specific classification",
      rationale: "Complete rationale\nwith exact details.", recommendation: "Full recommended action",
      references: [
        { kind: "node", id: "n_missing", label: "Original missing node" },
        { kind: "edge", id: "e_original", label: "Original flow" },
        { kind: "boundary", id: "b_original", label: "Original boundary" },
      ],
      guidanceReferences: [{ typeId: "synthetic", revision: 3, updatedOn: "2026-10-08",
        definitionSource: "saved", sources: ["https://example.invalid/guidance"] }],
    };
    const before = structuredClone({ finding, analysis });
    const draft = workItemFromFinding(finding, analysis);
    assert.equal(draft.title, finding.title);
    assert.equal(draft.severity, expected);
    assert.equal(draft.workItemType, finding.workItemType);
    assert.equal(draft.weaknessType, finding.weaknessType);
    assert.equal(draft.decision, "pending");
    assert.equal(draft.link, "");
    for (const value of [
      finding.title, finding.category, finding.severity, finding.id, finding.rationale, finding.recommendation,
      analysis.scenarioName, analysis.scenarioId,
      ...finding.references.flatMap(reference => [reference.kind, reference.id, reference.label]),
      "synthetic", "revision 3", "https://example.invalid/guidance", "not deployment evidence",
    ]) assert.ok(draft.description.includes(value), `Description retains ${value}`);
    assert.deepEqual(normalizeWorkItem({ id: "wi_finding", ...draft }), { id: "wi_finding", ...draft });
    assert.deepEqual({ finding, analysis }, before);
    assert.doesNotMatch(workItemFromFinding(finding, null).description, /Scenario:/);
  }
});

test("work items: populated creation is atomic and ordinary blank creation is unchanged", t => {
  localEnvironment(t);
  const store = readStore();
  const draft = { title: "Finding title", description: "Full finding context", severity: "2 - High",
    workItemType: "Task", weaknessType: "Task classification" };
  const item = store.createWorkItem(draft);
  assert.deepEqual(item, { id: item.id, ...draft, link: "", decision: "pending" });
  assert.equal(store.getCurrentWorkItem(item.id), item);
  const blank = store.createWorkItem();
  assert.deepEqual(blank, { id: blank.id, title: "", description: "", link: "", decision: "pending" });
});

test("work items: legacy defaults retain description/link, ID recovery and dangerous-link sanitization", () => {
  const legacy = { id: "wi_legacy", description: " \r\nOriginal Ω  ", link: "example.com/partial" };
  assert.deepEqual(normalizeWorkItem(legacy), { ...legacy, title: "", decision: "pending" });
  assert.deepEqual(fixture(legacy).workItems, [normalizeWorkItem(legacy)]);
  assert.deepEqual(normalizeDoc(emptyDocument()).workItems, []);
  assert.match(normalizeWorkItem({ id: "", description: 7, link: null }).id, /^wi_/);
  assert.equal(normalizeWorkItem({ description: 7 }).description, "");
  for (const scheme of ["javascript", "data", "vbscript", "file"]) {
    assert.equal(normalizeWorkItem({ ...legacy, link: ` \t${scheme.toUpperCase()} :payload` }).link, "");
  }
  for (const link of ["java\tscript:alert(1)", "jav\nascript:alert(1)", "\u0001javascript:alert(1)"]) {
    const item = { ...work(), link };
    const expected = { ...item, link: "" };
    assert.deepEqual(normalizeWorkItem(item), expected);
    assert.deepEqual(fixture(item).workItems, [expected]);
  }
});

test("work items: exact text and every decision/receipt outcome normalize without truncation", () => {
  const long = "  <untrusted>& Ω 😀\r\n".repeat(5000);
  for (const decision of ["pending", "accepted", "rejected"]) {
    for (const status of ["submitting", "submitted", "failed", "unknown"]) {
      const item = { ...work(status), decision, title: long, description: long, weaknessType: long,
        submission: { ...receipt(status), error: long } };
      const before = structuredClone(item);
      assert.deepEqual(normalizeWorkItem(item), item);
      assert.deepEqual(item, before);
      assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(fixture(item)))).workItems, [item]);
    }
  }
});

const invalidPatches = [
  { title: null }, { title: 2 }, { title: ["text"] },
  { decision: null }, { decision: true }, { decision: "Accepted" },
  ...[null, "", 2, "High", "5 - Unknown", [], {}].map(severity => ({ severity })),
  ...[null, "", 2, "bug", "User Story", [], {}].map(workItemType => ({ workItemType })),
  ...[null, 2, [], {}].map(weaknessType => ({ weaknessType })),
  { submission: null }, { submission: [] }, { submission: "submitted" },
  ...["operationId", "destinationKey", "status", "attemptedAt"].map(key => {
    const submission = receipt(); delete submission[key]; return { submission };
  }),
  ...["", "created", null, 2].map(status => ({ submission: { ...receipt(), status } })),
  ...[-1, NaN, Infinity, "1234", null].map(attemptedAt => ({ submission: { ...receipt(), attemptedAt } })),
  ...[0, -2, 1.5, Number.MAX_SAFE_INTEGER + 1, "42", null].map(adoId => ({ submission: { ...receipt(), adoId } })),
  ...["javascript:alert(1)", "data:text/plain,x", "file:///x", "http://example.invalid", "relative/path",
    "https://user:password@example.invalid", null, 7].map(url => ({ submission: { ...receipt(), url } })),
  { submission: { ...receipt(), error: {} } },
  { submission: { ...receipt(), token: "SYNTHETIC_DO_NOT_ECHO" } },
];

test("work items: malformed new values reject atomically with no private input in diagnostics", () => {
  for (const patch of invalidPatches) {
    for (const normalize of [normalizeWorkItem, item => fixture(item)]) {
      assert.throws(() => normalize({ ...work(), ...patch }),
        error => /[Ww]ork item|Submission/.test(error.message) && !error.message.includes("SYNTHETIC_DO_NOT_ECHO"));
    }
  }
});

test("work items: diff covers title, decision and every receipt field, ignores legacy defaults and key order", () => {
  const legacy = { id: "wi_review", description: "", link: "" };
  const before = { ...emptyDocument(), workItems: [legacy] };
  assert.deepEqual(diffDocuments(before, fixture(legacy)), []);
  const doc = fixture();
  for (const patch of [{ title: "Changed name" }, { decision: "rejected" }, { severity: "1 - Critical" }, { severity: undefined },
    { workItemType: "Task" }, { workItemType: undefined }, { weaknessType: "Changed weakness" }, { weaknessType: undefined },
    ...Object.keys(receipt()).map(key => ({ submission: {
      ...receipt(), [key]: key === "attemptedAt" || key === "adoId" ? 77 : key === "status" ? "failed" : `changed ${key}`,
    } })),
    { submission: undefined }]) {
    const after = structuredClone(doc); Object.assign(after.workItems[0], patch);
    const changes = diffDocuments(doc, after);
    assert.equal(changes.length, 1, JSON.stringify(patch));
    assert.equal(changes[0].category, "workItem");
  }
  const reordered = structuredClone(doc);
  reordered.workItems[0].submission = Object.fromEntries(Object.entries(receipt()).reverse());
  assert.deepEqual(diffDocuments(doc, reordered), []);
});

test("work items: latest-cell lookup survives queued edits and detects same-ID model replacement", t => {
  localEnvironment(t);
  const store = readStore();
  const created = store.createWorkItem();
  assert.equal(created.title, "");
  assert.equal(created.decision, "pending");
  assert.equal(store.getCurrentWorkItem(created.id), created);
  store.updateWorkItem(created.id, { title: "Accepted work", decision: "accepted", severity: "3 - Medium" });
  const expected = store.getCurrentWorkItem(created.id);
  assert.notEqual(expected, created);
  assert.equal(expected.title, "Accepted work");
  assert.equal(expected.severity, "3 - Medium");
  store.createWorkItem();
  assert.equal(store.getCurrentWorkItem(created.id), expected, "Unrelated work does not replace the retained object");
  store.updateWorkItem(created.id, { submission: receipt("submitting") });
  assert.notEqual(store.getCurrentWorkItem(created.id), expected);
  assert.equal(store.getCurrentWorkItem(created.id).submission.status, "submitting");
  const beforeInvalid = store.getCurrentWorkItem(created.id);
  assert.throws(() => store.updateWorkItem(created.id, { decision: "bad" }));
  assert.throws(() => store.updateWorkItem(created.id, { severity: "bad" }));
  assert.equal(store.getCurrentWorkItem(created.id), beforeInvalid);
  store.importJson(wrapped(fixture({ ...work(), id: created.id })));
  assert.notEqual(store.getCurrentWorkItem(created.id), beforeInvalid);
  assert.equal(store.getCurrentWorkItem(created.id).title, work().title);
  store.newDocument();
  assert.equal(store.getCurrentWorkItem(created.id), undefined);
});

test("work items: ordinary undo/redo restore review state without pretending to undo external writes", t => {
  localEnvironment(t, wrapped(fixture()));
  const store = readStore();
  store.updateWorkItem("wi_review", { decision: "rejected", severity: "4 - Low",
    workItemType: "Task", weaknessType: "Updated task weakness", submission: receipt("unknown") });
  assert.equal(store.getCurrentWorkItem("wi_review").decision, "rejected");
  store.undo();
  assert.deepEqual(store.getCurrentWorkItem("wi_review"), work());
  store.redo();
  assert.deepEqual(store.getCurrentWorkItem("wi_review"), { ...work("unknown"), decision: "rejected", severity: "4 - Low",
    workItemType: "Task", weaknessType: "Updated task weakness" });
  store.updateWorkItem("wi_review", { severity: undefined, workItemType: undefined, weaknessType: undefined });
  assert.equal(store.getCurrentWorkItem("wi_review").severity, undefined);
  assert.equal(store.getCurrentWorkItem("wi_review").workItemType, undefined);
  assert.equal(store.getCurrentWorkItem("wi_review").weaknessType, undefined);
  store.undo();
  assert.equal(store.getCurrentWorkItem("wi_review").severity, "4 - Low");
  assert.equal(store.getCurrentWorkItem("wi_review").workItemType, "Task");
  assert.equal(store.getCurrentWorkItem("wi_review").weaknessType, "Updated task weakness");
});

test("work items: every severity round-trips and legacy files do not acquire an assumed severity", () => {
  for (const severity of WORK_ITEM_SEVERITIES) {
    assert.deepEqual(normalizeWorkItem({ ...work(), severity }), { ...work(), severity });
    assert.equal(fixture({ ...work(), severity }).workItems[0].severity, severity);
  }
  assert.equal(Object.hasOwn(normalizeWorkItem({ id: "wi_legacy", description: "", link: "" }), "severity"), false);
});

test("work items: native wrapper/bare import, autosave/history and embedded HTML preserve receipts", t => {
  const item = { ...work(), workItemType: "Task", weaknessType: "Task classification" };
  const doc = fixture(item);
  localEnvironment(t, wrapped(doc));
  const store = readStore();
  assert.deepEqual(JSON.parse(store.exportJson()).doc.workItems, doc.workItems);
  for (const input of [doc, wrapped(doc)]) {
    store.importJson(input);
    assert.deepEqual(store.getCurrentWorkItem("wi_review"), item);
  }
  const before = store.getCurrentWorkItem("wi_review");
  assert.throws(() => store.importJson(wrapped({ ...doc, workItems: [{ ...work(), title: false }] })));
  assert.equal(store.getCurrentWorkItem("wi_review"), before);
  saveAutosave({ doc, past: [doc], future: [doc], view: wrapped(doc).view });
  const saved = loadAutosaveRaw();
  for (const value of [saved.doc, saved.past[0], saved.future[0]]) {
    assert.deepEqual(normalizeDoc(value).workItems, doc.workItems);
  }
  capturePristineHtml("<!doctype html><html><body></body></html>");
  const html = buildStandaloneHtml(JSON.stringify(wrapped(doc)));
  assert.equal(html.includes("</script>  "), false);
  const payload = html.match(/id="ps-embedded-doc">([\s\S]*?)<\/script>/)[1];
  globalThis.document = { getElementById: () => ({ textContent: payload }) };
  assert.deepEqual(normalizeDoc(readEmbeddedDoc().doc).workItems, doc.workItems);
});

for (const location of ["current", "past", "future", "embedded"]) {
  test(`work items: malformed ${location} recovery retains stored source`, t => {
    const valid = fixture(), invalid = { ...valid, workItems: [{ ...work(), decision: 3 }] };
    const storage = localEnvironment(t, location === "embedded" ? wrapped(invalid) : null);
    const raw = JSON.stringify({ version: 1, doc: location === "current" ? invalid : valid,
      past: location === "past" ? [invalid] : [], future: location === "future" ? [invalid] : [] });
    storage.set("secure-design-studio:autosave:v1", raw);
    const store = readStore();
    assert.match(store.documentRecoveryError, /recovery is paused.*decision/i);
    assert.equal(storage.get("secure-design-studio:autosave:v1"), raw);
    assert.equal(store.getCurrentWorkItem("wi_review"), undefined);
  });
}

test("work items: Yjs peers preserve receipts, converge independent fields, reconnect and delete", t => {
  const a = createYShape(), b = createYShape(), reconnect = createYShape();
  t.after(() => [a, b, reconnect].forEach(shape => shape.ydoc.destroy()));
  const transfer = (source, target) => Y.applyUpdate(target.ydoc, Y.encodeStateAsUpdate(source.ydoc));
  reconcileLocalToY(a, fixture());
  transfer(a, b);
  assert.deepEqual(buildDocFromY(b).workItems, [work()]);
  const da = buildDocFromY(a), db = buildDocFromY(b);
  da.workItems[0].title = "Peer A";
  da.workItems[0].workItemType = "Task";
  db.workItems[0].submission = receipt("unknown");
  db.workItems[0].severity = "1 - Critical";
  db.workItems[0].weaknessType = "Peer B weakness";
  reconcileLocalToY(a, da); reconcileLocalToY(b, db);
  transfer(a, b); transfer(b, a); transfer(a, reconnect);
  const expected = [{ ...work("unknown"), title: "Peer A", severity: "1 - Critical",
    workItemType: "Task", weaknessType: "Peer B weakness" }];
  for (const shape of [a, b, reconnect]) assert.deepEqual(buildDocFromY(shape).workItems, expected);
  const next = buildDocFromY(a); next.workItems = [];
  reconcileLocalToY(a, next); transfer(a, b);
  assert.deepEqual(buildDocFromY(b).workItems, []);
});

function workbook(bytes) {
  const files = unzipSync(bytes), parse = name =>
    new DOMParser().parseFromString(strFromU8(files[name]), "application/xml");
  return [...parse("xl/workbook.xml").getElementsByTagName("sheet")].map((sheet, index) => {
    const xml = parse(`xl/worksheets/sheet${index + 1}.xml`);
    const rows = [...xml.getElementsByTagName("row")].map(row =>
      [...row.getElementsByTagName("c")].map(cell => {
        assert.equal(cell.getAttribute("t"), "inlineStr");
        assert.equal(cell.getElementsByTagName("f").length, 0);
        return cell.getElementsByTagName("t")[0]?.textContent ?? "";
      }));
    return { name: sheet.getAttribute("name"), rows };
  });
}

test("work items: real XLSX includes pending/rejected/failed/unknown and every receipt as inert full text", () => {
  const doc = fixture(), long = "=HYPERLINK(\"untrusted\") Ω 😀\n".repeat(3000);
  doc.workItems = [work(), { ...work("failed"), id: "wi_failed", decision: "rejected" },
    { ...work("unknown"), id: "wi_unknown", title: long, description: long,
      submission: { ...receipt("unknown"), error: long } },
    normalizeWorkItem({ id: "wi_pending", description: "Legacy", link: "example.com" })];
  const before = structuredClone(doc);
  const sheets = workbook(createFindingsWorkbook(doc, [], new Set(), null, new Date(0)));
  const rows = sheets.find(sheet => sheet.name === "Work").rows;
  const headings = rows[0], values = header => rows.slice(1).map(row => row[headings.indexOf(header)]);
  assert.deepEqual(headings.slice(0, 3), ["Work item ID", "Description", "Link"]);
  assert.deepEqual(values("Decision"), ["accepted", "rejected", "accepted", "pending"]);
  assert.deepEqual(values("Severity"), ["2 - High", "2 - High", "2 - High", ""]);
  assert.deepEqual(values("Work Item Type"), ["Bug", "Bug", "Bug", ""]);
  assert.deepEqual(values("Weakness Type"), ["Specific finding weakness", "Specific finding weakness", "Specific finding weakness", ""]);
  assert.deepEqual(values("Submission status"), ["submitted", "failed", "unknown", ""]);
  assert.equal(values("ADO ID")[0], "42");
  assert.equal(values("Attempted UTC")[0], "1970-01-01T00:00:01.234Z");
  assert.equal(values("ADO URL")[0], receipt().url);
  assert.deepEqual(JSON.parse(values("Complete record (JSON)")[0]), work());
  const chunks = sheets.find(sheet => sheet.name === "Long text").rows.slice(1);
  for (const header of ["Name", "Description", "Submission error"]) {
    assert.equal(chunks.filter(row => row[0] === "Work" && row[2] === header).map(row => row[4]).join(""), long);
  }
  assert.deepEqual(doc, before);
});
