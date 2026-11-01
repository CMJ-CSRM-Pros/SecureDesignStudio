import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
const { createFindingsWorkbook } = await import("../../src/findingsExport.ts");
const { emptyDocument } = await import("../../src/types.ts");

const when = new Date("2026-10-31T12:00:00Z");
const source = { documentSessionId: 3, scenarioId: "s_review", scenarioName: "Original review scenario", createdAt: 0, answer: "Snapshot, not deployment assurance." };
const finding = {
  id: "f_first", severity: "high", category: "Spoofing", title: "=HYPERLINK(\"https://example.invalid\",\"test\")",
  rationale: "Untrusted <script>text</script> & context.", recommendation: "Confirm the receiver contract.",
  references: [{ kind: "edge", id: "e_missing", label: "Original flow name" }],
  guidanceReferences: [{ typeId: "ApiKey", methodId: "ApiKey", definitionSource: "saved", revision: 2, updatedOn: "2026-10-31", sources: ["https://example.invalid/reference"] }],
};

function fixture() {
  const doc = emptyDocument();
  doc.scenarios = [{ id: "s_other", name: "Another scenario" }];
  doc.nodes = [{ id: "n_first", title: "Caller" }];
  doc.edges = [];
  doc.issues = [
    { id: "i_active", status: "Active", targetKind: "node", targetId: "n_first", scenarioIds: [],
      title: "+SUM(1,2)", description: "Active issue", createdAt: 0, replies: [
        { id: "r_first", createdAt: 1000, text: "@SUM(A1:A2)" },
      ] },
    { id: "i_resolved", status: "Resolved", targetKind: "edge", targetId: "e_deleted", scenarioIds: ["s_other", "s_missing"],
      title: "Resolved issue", description: "Retained even when filtered out.", justification: "Reviewed",
      kind: "historical_rule", notEvaluatedReason: "rule-retired", createdAt: 2000, replies: [],
      resolutionLink: "https://example.invalid/guidance?one=1&two=2" },
  ];
  return doc;
}

function open(bytes) {
  const files = unzipSync(bytes);
  const parse = name => {
    const errors = [];
    const document = new DOMParser({ onError: (level, message) => { if (level !== "warning") errors.push(message); } })
      .parseFromString(strFromU8(files[name]), "application/xml");
    assert.deepEqual(errors, [], name);
    return document;
  };
  for (const name of Object.keys(files)) if (name.endsWith(".xml") || name.endsWith(".rels")) parse(name);
  const sheets = [...parse("xl/workbook.xml").getElementsByTagName("sheet")].map((sheet, index) => {
    const document = parse(`xl/worksheets/sheet${index + 1}.xml`);
    const rows = [...document.getElementsByTagName("row")].map(row =>
      [...row.getElementsByTagName("c")].map(cell => {
        assert.equal(cell.getAttribute("t"), "inlineStr", "Every user-controlled value is a text cell");
        assert.equal(cell.getElementsByTagName("f").length, 0, "No formulas");
        return cell.getElementsByTagName("t")[0]?.textContent ?? "";
      }));
    return { name: sheet.getAttribute("name"), document, rows };
  });
  return { files, sheets, sheet: name => sheets.find(sheet => sheet.name === name) };
}

test("findings workbook exports every saved status/scenario and unaccepted AI result without mutating state", () => {
  const doc = fixture();
  const findings = [finding, { ...finding, id: "f_second", title: "Not yet accepted" }];
  const before = structuredClone({ doc, findings });
  const accepted = new Set(["f_first"]);
  const result = open(createFindingsWorkbook(doc, findings, accepted, source, when));
  assert.deepEqual(result.sheets.map(sheet => sheet.name), [
    "Export info", "AI findings", "Issues", "Issue replies", "Nodes", "Edges", "Boundaries",
    "Scenarios", "Scenario edges", "Data", "Work", "Comments", "Comment replies",
    "Deviations", "Changes", "Text annotations", "Definitions",
  ]);
  const ai = result.sheet("AI findings").rows;
  assert.equal(ai.length, 3);
  assert.equal(ai[1][6], "Yes");
  assert.equal(ai[2][6], "No");
  assert.equal(ai[1][7], "Original review scenario (s_review)");
  assert.match(ai[1][8], /Original flow name.*e_missing/);
  assert.match(ai[1][9], /Authentication ApiKey/);
  const issues = result.sheet("Issues").rows;
  assert.equal(issues.length, 3);
  assert.equal(issues[1][1], "Active");
  assert.equal(issues[1][11], "All scenarios");
  assert.equal(issues[2][1], "Resolved");
  assert.match(issues[2][4], /retired/);
  assert.match(issues[2][10], /e_deleted.*not in current model/);
  assert.match(issues[2][11], /Another scenario \(s_other\)\n\(missing scenario\) \(s_missing\)/);
  assert.equal(issues[1][12], "1970-01-01T00:00:00.000Z");
  assert.deepEqual(result.sheet("Issue replies").rows[1], ["i_active", "r_first", "1970-01-01T00:00:01.000Z", "@SUM(A1:A2)"]);
  assert.deepEqual({ doc, findings }, before);
  assert.deepEqual([...accepted], ["f_first"]);
});

test("workbook values remain inert text, with escaped XML and no external relationships or macros", () => {
  const doc = fixture();
  doc.issues[0].description = '=<unsafe>&"quoted"\n\t0000123';
  const result = open(createFindingsWorkbook(doc, [finding], new Set(), source, when));
  assert.equal(result.sheet("AI findings").rows[1][3], finding.title);
  assert.equal(result.sheet("AI findings").rows[1][4], finding.rationale);
  assert.equal(result.sheet("Issues").rows[1][6], doc.issues[0].description);
  for (const [name, bytes] of Object.entries(result.files)) {
    assert.doesNotMatch(name, /vba|macro|externalLink/i);
    assert.doesNotMatch(strFromU8(bytes), /<f[ >]|TargetMode="External"|<hyperlink[ >]/);
  }
  assert.match(strFromU8(result.files["xl/styles.xml"]), /name val="Arial"/);
  for (const sheet of result.sheets) {
    assert.equal(sheet.document.getElementsByTagName("pane")[0].getAttribute("state"), "frozen");
    assert.equal(sheet.document.getElementsByTagName("autoFilter").length, 1);
  }
});

test("long descriptions and replies are retained in numbered segments instead of being truncated", () => {
  const doc = fixture();
  const long = "A".repeat(32_766) + "🔒" + "\nOriginal complete text.".repeat(2000);
  doc.issues[0].description = long;
  doc.issues[0].replies[0].text = long + "Reply end.";
  const result = open(createFindingsWorkbook(doc, [], new Set(), null, when));
  const chunks = result.sheet("Long text").rows.slice(1);
  assert.ok(chunks.length > 2);
  assert.equal(chunks.filter(row => row[0] === "Issues").map(row => row[4]).join(""), long);
  assert.equal(chunks.filter(row => row[0] === "Issue replies").map(row => row[4]).join(""), long + "Reply end.");
  assert.ok(chunks.every(row => row[4].length <= 32_767));
  assert.match(result.sheet("Issues").rows[1][6], /Full text preserved in Long text rows/);
});

test("XML controls and literal SpreadsheetML escapes are preserved safely", () => {
  const doc = fixture();
  doc.issues[0].description = "_x0041_\u0000\rText";
  const result = open(createFindingsWorkbook(doc, [], new Set(), null, when));
  assert.equal(result.sheet("Issues").rows[1][6], "_x005F_x0041__x0000__x000D_Text");
  assert.doesNotMatch(strFromU8(result.files["xl/worksheets/sheet3.xml"]), /\u0000|\r/);
  const literals = ["_x0041_x0042_", "_x005f_x005F_", "_X0041_", "prefix_x0000_x0041_suffix"];
  const prefixes = ["_x0041", "_x0000", "_x005F", "_xD800", "literal_"];
  const suffixes = ["\u0000", "\u0001", "\r", "\ufffe", "\uffff", "\ud800", "\udc00", "\n", "\t", "_x0042_", "g", ""];
  for (const text of [...literals, ...prefixes.flatMap(prefix => suffixes.map(suffix => prefix + suffix))]) {
    doc.issues[0].description = text;
    const encoded = open(createFindingsWorkbook(doc, [], new Set(), null, when)).sheet("Issues").rows[1][6];
    assert.equal(encoded.replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16))), text,
      "A single SpreadsheetML decoding pass preserves overlapping literals and adjacent controls");
  }
});

test("empty review exports valid header-only data sheets and explicitly unknown analysis context", () => {
  const result = open(createFindingsWorkbook(emptyDocument(), [], new Set(), null, when));
  assert.equal(result.sheet("AI findings").rows.length, 1);
  assert.equal(result.sheet("Issues").rows.length, 1);
  assert.equal(result.sheet("Issue replies").rows.length, 1);
  assert.equal(result.sheet("Export info").rows.find(row => row[0] === "AI analysis scenario")[1], "Not recorded");
});

test("unsupported row counts and invalid timestamps fail explicitly", () => {
  const doc = fixture();
  doc.issues[0].createdAt = NaN;
  assert.throws(() => createFindingsWorkbook(doc, [], new Set(), null, when), /timestamp is invalid/);
  doc.issues = new Array(1_048_576);
  assert.throws(() => createFindingsWorkbook(doc, [], new Set(), null, when), /worksheet row limit/);
  const manyReplies = fixture();
  manyReplies.issues[0].replies = new Array(1_048_576);
  assert.throws(() => createFindingsWorkbook(manyReplies, [], new Set(), null, when), /discussion exceeds/);
});

test("all inspector tabs export complete model records, directional scenario data and comparison context", () => {
  const doc = fixture();
  doc.nodes[0].metadata = { custom: "=1+2" };
  doc.edges = [{ id: "e_export", title: "Flow", source: "n_first", target: "n_missing", description: "All fields",
    authenticationTypes: ["ApiKey"], requiredAccessRights: "Read only", waypoints: [{ id: "w_1", x: 4, y: 7 }],
    metadata: { custom: "Unrecognized metadata survives" } }];
  doc.scenarios[0] = { ...doc.scenarios[0], description: "Second scenario", nodeIds: ["n_first"], boundaryIds: [],
    edgeIds: ["e_export"], edgeNumbers: { e_export: 27 }, nodeData: { n_first: { d_1: "Session" } },
    edgeRequestData: { e_export: ["d_1"] }, edgeResponseData: { e_export: ["d_2"] } };
  doc.data = [
    { id: "d_1", name: "=Untrusted data", classification: "EUPI", sample: "Sample <text>" },
    { id: "d_2", name: "Response data", classification: "EUII", sample: "0000123" },
  ];
  doc.workItems = [{ id: "wi_1", description: "+Work text", link: "https://example.invalid/work" }];
  doc.comments = [{ id: "c_1", scenarioId: "s_other", targetKind: "edge", targetId: "e_export",
    status: "Resolved", createdAt: 0, text: "A".repeat(34_000),
    replies: [{ id: "cr_1", text: "=Reply text", createdAt: 1000 }] }];
  doc.deviations = [{ id: "dev_1", kind: "other", key: "key", title: "Deviation", status: "Active",
    description: "Description", explanation: "Explanation", scenarioIds: [], evidenceIds: ["ev_1"], createdAt: 0, updatedAt: 1000 }];
  doc.boundaries = [{ id: "b_1", title: "Boundary", type: "security", nodeIds: ["n_first"], position: { x: 1, y: 2 },
    size: { width: 100, height: 100 }, inboundAllow: "443" }];
  doc.textAnnotations = [{ id: "a_1", text: "Canvas note", position: { x: 1, y: 1 }, size: { width: 100, height: 50 } }];
  const changes = [{ id: "chg_1", category: "edge", description: "Flow updated", target: { kind: "edge", id: "e_export" },
    scenarioId: "s_other", scenarioName: "Another scenario", edgeNumber: 27 }];
  const before = structuredClone(doc);
  const result = open(createFindingsWorkbook(doc, [], new Set(), null, when, { fileName: "before.tma", changes }));
  assert.equal(result.sheet("Export info").rows.find(row => row[0] === "Comparison file")[1], "before.tma");
  assert.deepEqual(result.sheet("Scenario edges").rows[1], ["s_other", "Another scenario", "e_export", "27", "d_1", "d_2"]);
  assert.equal(result.sheet("Data").rows[1][1], "=Untrusted data");
  assert.equal(result.sheet("Data").rows[2][3], "0000123");
  assert.deepEqual(result.sheet("Comment replies").rows[1], ["c_1", "cr_1", "1970-01-01T00:00:01.000Z", "=Reply text"]);
  for (const [sheetName, source] of [
    ["Nodes", doc.nodes], ["Edges", doc.edges], ["Boundaries", doc.boundaries], ["Scenarios", doc.scenarios],
    ["Data", doc.data], ["Work", doc.workItems], ["Comments", doc.comments], ["Deviations", doc.deviations],
    ["Text annotations", doc.textAnnotations], ["Changes", changes],
  ]) {
    const sheet = result.sheet(sheetName);
    const column = sheet.rows[0].indexOf("Complete record (JSON)");
    assert.ok(column >= 0);
    const fullRecords = sheet.rows.slice(1).map((row, index) => {
      const overflow = result.sheet("Long text")?.rows.slice(1).filter(part =>
        part[0] === sheetName && part[1] === String(index + 2) && part[2] === "Complete record (JSON)");
      return JSON.parse(overflow?.length ? overflow.map(part => part[4]).join("") : row[column]);
    });
    assert.deepEqual(fullRecords, source, sheetName);
  }
  assert.deepEqual(doc, before, "Export is read-only");
});
