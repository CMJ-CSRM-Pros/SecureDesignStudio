import { strToU8, zipSync } from "fflate";
import type { AssistantAnalysisSnapshot, AssistantFinding } from "./designAssistant";
import { ISSUE_NOT_EVALUATED_LABELS, type PsDocument } from "./types";
import { formatGuidanceReferences } from "./aiDesignGuidance";

export const FINDINGS_WORKBOOK_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CELL_LIMIT = 32_767;
const ROW_LIMIT = 1_048_576;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

type Sheet = { name: string; headers: string[]; rows: string[][]; widths: number[] };

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

// SpreadsheetML escapes preserve XML-forbidden characters and literal escape sequences.
function cellText(value: string): string {
  return xml(value.replace(/_(?=x[0-9a-f]{4})/gi, "_x005F_")
    .replace(/[\u0000-\u0008\u000b-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      char => `_x${char.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}_`));
}

function columnName(index: number): string {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}

function timestamp(value: number | undefined): string {
  if (value === undefined) return "";
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new Error("A review timestamp is invalid. Nothing was exported.");
  }
  return new Date(value).toISOString();
}

function worksheet(sheet: Sheet): string {
  if (sheet.rows.length + 1 > ROW_LIMIT) {
    throw new Error(`"${sheet.name}" exceeds Excel's worksheet row limit. Nothing was exported.`);
  }
  const lastColumn = columnName(sheet.headers.length - 1);
  const rows = [sheet.headers, ...sheet.rows].map((row, rowIndex) =>
    `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="26" customHeight="1"' : ""}>${row.map((value, colIndex) =>
      `<c r="${columnName(colIndex)}${rowIndex + 1}" t="inlineStr" s="${rowIndex === 0 ? 1 : 0}"><is><t xml:space="preserve">${cellText(value)}</t></is></c>`
    ).join("")}</row>`).join("");
  return `${XML}<worksheet xmlns="${SML}"><dimension ref="A1:${lastColumn}${sheet.rows.length + 1}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="45"/>'
    + `<cols>${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`
    + `<sheetData>${rows}</sheetData><autoFilter ref="A1:${lastColumn}${sheet.rows.length + 1}"/></worksheet>`;
}

const STYLES = `${XML}<styleSheet xmlns="${SML}">
<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F6CBD"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function createFindingsWorkbook(
  doc: PsDocument,
  findings: readonly AssistantFinding[],
  acceptedIds: ReadonlySet<string>,
  analysis: AssistantAnalysisSnapshot | null,
  exportedAt = new Date(),
): Uint8Array {
  if (doc.issues.length >= ROW_LIMIT || findings.length >= ROW_LIMIT) {
    throw new Error("The review exceeds Excel's worksheet row limit. Nothing was exported.");
  }
  let replies = 0;
  for (const issue of doc.issues) {
    replies += issue.replies.length;
    if (replies >= ROW_LIMIT) throw new Error("The issue discussion exceeds Excel's worksheet row limit. Nothing was exported.");
  }
  const targetName = (kind: string, id: string) => {
    const records = kind === "node" ? doc.nodes : kind === "edge" ? doc.edges : doc.boundaries;
    return records.find(record => record.id === id)?.title ?? `${id} (not in current model)`;
  };
  const scenarios = (ids: readonly string[]) => ids.length
    ? ids.map(id => `${doc.scenarios.find(scenario => scenario.id === id)?.name ?? "(missing scenario)"} (${id})`).join("\n")
    : "All scenarios";
  const sheets: Sheet[] = [
    {
      name: "Export info", headers: ["Field", "Value"], widths: [30, 95],
      rows: [
        ["Source", "SecureDesignStudio"],
        ["Exported UTC", exportedAt.toISOString()],
        ["Scope", "All retained AI findings and all saved issues, including resolved and filtered-out entries across every scenario."],
        ["AI analysis scenario", analysis ? `${analysis.scenarioName} (${analysis.scenarioId})` : "Not recorded"],
        ["AI analysis UTC", timestamp(analysis?.createdAt)],
        ["AI analysis answer", analysis?.answer ?? ""],
        ["Interpretation", "AI findings are unverified proposals. Accepted findings also appear as separate saved issues when applicable; no records are deduplicated."],
        ["Long text", "Values beyond Excel's cell length limit are preserved in numbered parts in the Long text sheet. No text is silently truncated."],
        ["Safety", "All values, including URLs and formula-like text, are text cells. This workbook contains no formulas, macros or external links."],
        ["Editable model", "Keep the native .tma file as the editable model backup. This workbook is a review snapshot."],
      ],
    },
    {
      name: "AI findings",
      headers: ["Finding ID", "Severity", "Category", "Title", "Rationale", "Recommended action", "Accepted", "Analysis scenario", "References", "Guidance provenance"],
      widths: [26, 13, 22, 42, 64, 64, 15, 32, 54, 64],
      rows: findings.map(finding => [
        finding.id, finding.severity, finding.category, finding.title, finding.rationale, finding.recommendation,
        acceptedIds.has(finding.id) ? "Yes" : "No",
        analysis ? `${analysis.scenarioName} (${analysis.scenarioId})` : "Not recorded",
        finding.references.map(reference => `${reference.kind}: ${reference.label} (${reference.id})`).join("\n"),
        formatGuidanceReferences(finding.guidanceReferences).trim(),
      ]),
    },
    {
      name: "Issues",
      headers: ["Issue ID", "Status", "Origin", "Analyzer rule", "Evaluation state", "Title", "Description", "Justification", "Target kind", "Target ID", "Target name", "Scenarios", "Created UTC", "Resolution guidance", "Guidance provenance"],
      widths: [26, 14, 23, 30, 38, 42, 70, 55, 14, 26, 35, 40, 27, 45, 64],
      rows: doc.issues.map(issue => [
        issue.id, issue.status, issue.origin ?? (issue.kind ? "Analyzer" : "Manual / accepted finding"),
        issue.kind ?? "", issue.notEvaluatedReason ? ISSUE_NOT_EVALUATED_LABELS[issue.notEvaluatedReason] : "",
        issue.title, issue.description, issue.justification ?? "", issue.targetKind, issue.targetId,
        targetName(issue.targetKind, issue.targetId), scenarios(issue.scenarioIds),
        timestamp(issue.createdAt), issue.resolutionLink ?? "", formatGuidanceReferences(issue.guidanceReferences).trim(),
      ]),
    },
    {
      name: "Issue replies", headers: ["Issue ID", "Reply ID", "Created UTC", "Discussion text"],
      widths: [26, 26, 27, 100],
      rows: doc.issues.flatMap(issue => issue.replies.map(reply =>
        [issue.id, reply.id, timestamp(reply.createdAt), reply.text])),
    },
  ];
  const overflow: Sheet = {
    name: "Long text", headers: ["Sheet", "Record row", "Column", "Part", "Full text segment"],
    widths: [22, 14, 28, 10, 100], rows: [],
  };
  for (const sheet of sheets) {
    sheet.rows = sheet.rows.map((row, rowIndex) => row.map((value, columnIndex) => {
      if (value.length <= CELL_LIMIT) return value;
      const start = overflow.rows.length + 2;
      let part = 0;
      for (let offset = 0; offset < value.length;) {
        if (overflow.rows.length >= ROW_LIMIT - 1) {
          throw new Error("The complete review text exceeds Excel's worksheet row limit. Nothing was exported.");
        }
        let end = Math.min(value.length, offset + CELL_LIMIT);
        if (end < value.length && /[\ud800-\udbff]/.test(value[end - 1])) end--;
        overflow.rows.push([sheet.name, String(rowIndex + 2), sheet.headers[columnIndex], String(++part), value.slice(offset, end)]);
        offset = end;
      }
      return `Full text preserved in Long text rows ${start}-${overflow.rows.length + 1} (${part} parts).`;
    }));
  }
  if (overflow.rows.length) sheets.push(overflow);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"),
    "_rels/.rels": strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`${XML}<workbook xmlns="${SML}" xmlns:r="${REL}"><sheets>${sheets.map((sheet, index) =>
      `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) =>
      `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheet(sheet)); });
  return zipSync(files, { level: 6 });
}
