import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";

const { prepareAdoWorkExport, createAdoWorkCsv, ADO_EXCEL_COLUMNS, ADO_CSV_COLUMNS } = await import("../../src/adoExport.ts");
const { createAdoWorkWorkbook } = await import("../../src/findingsExport.ts");
const config = () => ({
  organizationUrl: "https://dev.azure.com/synthetic", project: "Synthetic Project",
  inventoryId: "33333333-3333-4333-8333-333333333333", reviewer: "reviewer@example.invalid",
  defaults: {
    "System.AreaPath": "Synthetic Project\\Security", "System.AssignedTo": "Owner <owner@example.invalid>",
    "System.State": "Active", "System.IterationPath": "Synthetic Project\\Sprint 1",
    "System.Tags": "Review; ServiceOID:old", "Custom.ReviewTeam": "Synthetic review team",
    "Custom.RiskRating": 2, "Custom.WeaknessType": "Legacy global weakness",
    "Microsoft.VSTS.Common.Priority": 2, "Microsoft.VSTS.CMMI.Blocked": "No", "Microsoft.VSTS.CMMI.RootCause": "Unknown",
    "Custom.TeamID": "44444444-4444-4444-8444-444444444444", "Custom.SecurityReviewer": "not-the-reviewer@example.invalid",
    "Custom.Unlisted": "NEVER-EXPORTED",
  },
});
const work = (patch = {}) => ({
  id: "wi_export", title: 'Review "quoted", full title', description: 'Full rationale & evidence\r\nRecommended action: <test> 😀',
  severity: "2 - High", workItemType: "Bug", weaknessType: "Work-specific weakness", decision: "accepted", link: "", ...patch,
});
const prepare = (items = [work()], configuration = config(), journal = {}) => prepareAdoWorkExport(items, configuration, journal);

function parseCsv(input) {
  const rows = [], row = [];
  let value = "", quoted = false;
  for (let index = input.charCodeAt(0) === 0xfeff ? 1 : 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\r" || char === "\n")) {
      row.push(value); value = "";
      if (char !== ",") {
        rows.push([...row]); row.length = 0;
        if (char === "\r" && input[index + 1] === "\n") index++;
      }
    } else value += char;
  }
  assert.equal(quoted, false);
  return rows;
}

function worksheets(bytes) {
  const files = unzipSync(bytes);
  const parse = path => new DOMParser().parseFromString(strFromU8(files[path]), "application/xml");
  assert.equal(Object.keys(files).some(path => /externalLinks|vbaProject|connections/i.test(path)), false);
  const sheets = [...parse("xl/workbook.xml").getElementsByTagName("sheet")];
  return Object.fromEntries(sheets.map((sheet, index) => {
    const document = parse(`xl/worksheets/sheet${index + 1}.xml`);
    assert.equal(document.getElementsByTagName("f").length, 0);
    return [sheet.getAttribute("name"), [...document.getElementsByTagName("row")].map(row =>
      [...row.getElementsByTagName("c")].map(cell => {
        assert.equal(cell.getAttribute("t"), "inlineStr");
        return cell.getElementsByTagName("t")[0]?.textContent ?? "";
      }))];
  }));
}

test("ADO export: exact columns and per-item classification omit risk, priority and obsolete defaults", () => {
  const input = work(), configuration = config(), before = structuredClone({ input, configuration });
  const prepared = prepare([input], configuration);
  assert.deepEqual(prepared.table.headers, [
    "ID", "Title", "Assigned To", "State", "Tags", "ServiceTree ID", "Review Team", "Created Date",
    "Work Item Type", "Review Type", "Area Path", "Weakness Type", "Team ID", "Security Reviewer",
    "Description", "Severity",
  ]);
  assert.deepEqual(prepared.workIds, [input.id]);
  const values = Object.fromEntries(prepared.table.headers.map((name, index) => [name, prepared.table.rows[0][index]]));
  assert.equal(values.Title, input.title);
  assert.equal(values.ID, "");
  assert.equal(values.State, "", "The configured Active state must not create active items");
  assert.equal(values["Created Date"], "");
  assert.equal(values["Assigned To"], configuration.defaults["System.AssignedTo"]);
  assert.equal(values["ServiceTree ID"], configuration.inventoryId);
  assert.equal(values.Tags, `Review; ServiceOID:${configuration.inventoryId}`);
  assert.equal(values["Security Reviewer"], configuration.reviewer);
  assert.equal(values["Review Team"], configuration.defaults["Custom.ReviewTeam"]);
  assert.equal(values["Weakness Type"], input.weaknessType);
  assert.equal(values["Work Item Type"], input.workItemType);
  assert.equal(values["Team ID"], configuration.defaults["Custom.TeamID"]);
  assert.equal(values["Review Type"], "");
  assert.equal(Object.hasOwn(values, "Risk Rating"), false);
  assert.equal(Object.hasOwn(values, "Priority"), false);
  assert.equal(values.Severity, "2 - High");
  assert.equal(values.Description, 'Full rationale &amp; evidence<br>Recommended action: &lt;test&gt; 😀');
  assert.doesNotMatch(JSON.stringify(prepared.table), /NEVER-EXPORTED|Iteration Path|Submission status|Legacy global weakness|Risk Rating|Priority|RootCause|Blocked/);
  assert.deepEqual({ input, configuration }, before);
  for (const severity of ["1 - Critical", "2 - High", "3 - Medium", "4 - Low"]) {
    const row = prepare([work({ severity })]).table.rows[0];
    assert.equal(row[8], "Bug");
    assert.equal(row[15], severity);
  }
  assert.equal(ADO_EXCEL_COLUMNS.length, 16);
  assert.equal(ADO_CSV_COLUMNS.length, 12);
});

test("ADO export: one file mixes Bugs and Tasks without sharing their classifications", () => {
  const items = [work(), work({ id: "wi_task", title: "Follow-up task", workItemType: "Task",
    weaknessType: "Task-specific weakness", severity: "4 - Low" })];
  const prepared = prepare(items);
  for (const [rowIndex, item] of items.entries()) {
    const row = prepared.table.rows[rowIndex];
    assert.equal(row[prepared.table.headers.indexOf("Work Item Type")], item.workItemType);
    assert.equal(row[prepared.table.headers.indexOf("Weakness Type")], item.weaknessType);
    assert.equal(row[prepared.table.headers.indexOf("Severity")], item.severity);
  }
  const csvRows = parseCsv(createAdoWorkCsv(prepared));
  const xlsxRows = worksheets(createAdoWorkWorkbook(prepared))["ADO import"];
  const indices = ADO_CSV_COLUMNS.map(header => ADO_EXCEL_COLUMNS.indexOf(header));
  assert.deepEqual(csvRows, xlsxRows.map(row => indices.map(index => row[index])));
  for (const workItemType of ["Bug", "Task"]) {
    for (const field of ["workItemType", "severity"]) {
      assert.throws(() => prepare([work({ workItemType, [field]: undefined })]));
    }
  }
});

test("ADO export: optional Weakness Type stays blank for Bugs and Tasks without a legacy fallback", () => {
  for (const workItemType of ["Bug", "Task"]) {
    for (const weaknessType of [undefined, "", "   ", "\t\r\n"]) {
      const item = work({ workItemType, weaknessType });
      const before = { ...item };
      const prepared = prepare([item]);
      const column = prepared.table.headers.indexOf("Weakness Type");
      assert.equal(prepared.table.rows[0][column], "");
      assert.equal(worksheets(createAdoWorkWorkbook(prepared))["ADO import"][1][column], "");
      const csv = parseCsv(createAdoWorkCsv(prepared));
      assert.equal(csv[1][csv[0].indexOf("Weakness Type")], "");
      assert.deepEqual(item, before);
    }
  }
});

test("ADO export: creation CSV is UTF-8/BOM RFC-style quoted data with only the documented new-item subset", () => {
  const prepared = prepare();
  const csv = createAdoWorkCsv(prepared);
  assert.equal(csv[0], "\uFEFF");
  assert.ok(csv.endsWith("\r\n"));
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], [...ADO_CSV_COLUMNS]);
  assert.deepEqual(rows[1], prepared.table.rows[0].filter((_, index) =>
    !["ID", "Assigned To", "State", "Created Date"].includes(ADO_EXCEL_COLUMNS[index])));
  assert.equal(rows[1][0], work().title, "Quotes and commas round-trip exactly");
  assert.doesNotMatch(csv, /Owner &lt;|owner@example.invalid|Created Date|Assigned To|NEVER-EXPORTED/);
  const multiline = config();
  multiline.defaults["Custom.ReviewType"] = 'Quoted "review", with\nmultiple lines';
  assert.equal(parseCsv(createAdoWorkCsv(prepare([work()], multiline)))[1][5], multiline.defaults["Custom.ReviewType"]);
});

test("ADO export: configured defaults resolve without case-dependent omissions and optional columns remain blank", () => {
  const configuration = config();
  configuration.defaults = Object.fromEntries(Object.entries(configuration.defaults).map(([name, value]) => [name.toLowerCase(), value]));
  assert.deepEqual(prepare(undefined, configuration).table, prepare().table);
  delete configuration.defaults["system.assignedto"];
  configuration.defaults["custom.reviewtype"] = "Synthetic review";
  const row = prepare(undefined, configuration).table.rows[0];
  assert.equal(row[2], "");
  assert.equal(row[9], "Synthetic review");
});

test("ADO export: worksheet has all approved columns, blank generated values and inert full strings, not connected metadata", () => {
  const prepared = prepare([work({ title: "=HYPERLINK(\"hostile\")" })]);
  const sheets = worksheets(createAdoWorkWorkbook(prepared));
  assert.deepEqual(Object.keys(sheets), ["ADO import", "Import instructions"]);
  assert.deepEqual(sheets["ADO import"], [[...ADO_EXCEL_COLUMNS], ...prepared.table.rows]);
  assert.ok(sheets["Import instructions"].some(row => row.join(" ").includes("not a connected")));
  const csvRows = parseCsv(createAdoWorkCsv(prepare()));
  const xlsxRows = worksheets(createAdoWorkWorkbook(prepare()))["ADO import"];
  const indices = ADO_CSV_COLUMNS.map(header => ADO_EXCEL_COLUMNS.indexOf(header));
  assert.deepEqual(csvRows, xlsxRows.map(row => indices.map(index => row[index])));
});

test("ADO export: accepted-only duplicate safeguards include receipts, journal recovery and external links", () => {
  const receipt = status => ({ operationId: "synthetic", destinationKey: "synthetic", status, attemptedAt: 1 });
  const items = [
    work(), work({ id: "wi_pending", decision: "pending" }), work({ id: "wi_rejected", decision: "rejected" }),
    work({ id: "wi_linked", link: "https://example.invalid/tracker" }),
    ...["submitting", "submitted", "unknown"].map(status => work({ id: status, submission: receipt(status) })),
    work({ id: "wi_journal" }), work({ id: "wi_failed", submission: receipt("failed") }),
  ];
  assert.deepEqual(prepare(items, config(), { wi_journal: receipt("unknown") }).workIds, ["wi_export", "wi_failed"]);
  assert.throws(() => prepare([work({ decision: "pending" })]), /Accept at least one/);
  assert.throws(() => prepare([work({ decision: "pending" })]), /1 pending review; 0 rejected; 0 linked; 0 recorded/);
  assert.throws(() => prepare([work({ link: "https://example.invalid/existing" })]), /0 pending review; 0 rejected; 1 linked; 0 recorded/);
  assert.throws(() => prepare([], config()), /There are no Work items.*Create work from Findings/);
  assert.throws(() => prepare([work(), work()]), /Duplicate SDS/);
  assert.equal(prepare(Array.from({ length: 1_000 }, (_, i) => work({ id: `wi_${i}` }))).table.rows.length, 1_000);
  assert.throws(() => prepare(Array.from({ length: 1_001 }, (_, i) => work({ id: `wi_${i}` }))), /1,000/);
});

test("ADO export: missing values and wrong destinations block the whole export, without guessing sources", () => {
  for (const name of ["System.AreaPath", "Custom.ReviewTeam", "Custom.TeamID"]) {
    const configuration = config();
    delete configuration.defaults[name];
    assert.throws(() => prepare(undefined, configuration), new RegExp(name.replaceAll(".", "\\.")));
  }
  for (const name of ["inventoryId", "reviewer"]) {
    const configuration = config(); delete configuration[name];
    assert.throws(() => prepare(undefined, configuration), /Inventory ID and Reviewer/);
  }
  const other = config(); other.project = "Other Project";
  assert.throws(() => prepare(undefined, other), /System.AreaPath.*project "Other Project"/);
  const alternate = config(); alternate.descriptionField = "Microsoft.VSTS.TCM.ReproSteps";
  assert.throws(() => prepare(undefined, alternate), /System.Description/);
  assert.throws(() => prepare([work({ severity: undefined })]), /Severity/);
  assert.throws(() => prepare([work({ workItemType: undefined })]), /Work item type/);
  assert.throws(() => prepare([work({ decision: "pending" }), work({ id: "bad", severity: undefined })]), /Work item 2:.*Severity/);
  assert.throws(() => prepare([work({ decision: "pending" }), work({ id: "bad", title: "" })]), /Work item 2:.*title/);
  assert.throws(() => prepare([work(), work({ id: "bad", description: "" })]), /Description/);
  assert.throws(() => prepare([work({ title: "" })]), /title/);
  assert.throws(() => prepare([work({ description: "NUL\u0000text" })]), /control characters/);
});

test("ADO export: CSV never exports executable cell prefixes and Excel never splits import text into placeholders", () => {
  for (const prefix of ["=", "+", "-", "@", "\t ="]) {
    assert.throws(() => createAdoWorkCsv(prepare([work({ title: `${prefix}unsafe` })])), /formula character|plain-text/);
  }
  const hostile = config();
  hostile.defaults["Custom.ReviewTeam"] = "\t=1+1";
  assert.throws(() => createAdoWorkCsv(prepare(undefined, hostile)), /formula character/);
  assert.equal(worksheets(createAdoWorkWorkbook(prepare(undefined, hostile)))["ADO import"][1][6], "\t=1+1");
  const big = work({ description: "x".repeat(32_768) });
  const prepared = prepare([big]);
  assert.throws(() => createAdoWorkWorkbook(prepared), /32,767/);
  assert.equal(parseCsv(createAdoWorkCsv(prepared))[1][10], big.description);
  assert.equal(worksheets(createAdoWorkWorkbook(prepare([work({ description: "x".repeat(32_767) })])))["ADO import"][1][14].length, 32_767);
});
