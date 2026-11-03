import { AdoRequestError, adoPatch, normalizeAdoConfiguration, validateAdoProjectPath, type AdoConfiguration } from "../shared/adoContract";
import type { PsWorkItem, WorkSubmissionReceipt } from "./types";
import { submissionEligible, workDraft, workQueueCounts } from "./workSubmission";

export const ADO_EXCEL_COLUMNS = [
  "ID", "Title", "Assigned To", "State", "Tags", "ServiceTree ID", "Review Team",
  "Created Date", "Work Item Type", "Review Type", "Area Path",
  "Weakness Type", "Team ID", "Security Reviewer", "Description", "Severity",
] as const;
const creationExcluded = new Set<string>(["ID", "Created Date", "State", "Assigned To"]);
export const ADO_CSV_COLUMNS = ADO_EXCEL_COLUMNS.filter(name => !creationExcluded.has(name));
export type AdoExportTable = { headers: readonly string[]; rows: string[][] };
export type AdoWorkExport = {
  configuration: AdoConfiguration;
  table: AdoExportTable;
  workIds: string[];
};

export function prepareAdoWorkExport(
  items: readonly PsWorkItem[], configuration: unknown,
  journal: Record<string, WorkSubmissionReceipt>,
): AdoWorkExport {
  const config = normalizeAdoConfiguration(configuration);
  if ((config.descriptionField ?? "System.Description") !== "System.Description") {
    throw new Error("This CSV template uses Description (System.Description). Save that description field before exporting.");
  }
  if (!config.inventoryId || !config.reviewer) {
    throw new Error("Set Inventory ID and Reviewer in the saved ADO destination before exporting.");
  }
  const { inventoryId, reviewer } = config;
  const defaults = new Map(Object.entries(config.defaults).map(([name, value]) => [name.toLowerCase(), value]));
  const textDefault = (name: string, required = true): string => {
    const value = defaults.get(name.toLowerCase());
    if (!required && value === undefined) return "";
    if (typeof value !== "string" || (required && !value.trim())) {
      throw new Error(`Set ${name} to ${required ? "nonempty " : ""}text in the saved ADO field defaults before exporting.`);
    }
    return value;
  };
  const area = textDefault("System.AreaPath");
  validateAdoProjectPath(config.project, "System.AreaPath", area);
  const reviewTeam = textDefault("Custom.ReviewTeam");
  const teamId = textDefault("Custom.TeamID");
  const assignee = textDefault("System.AssignedTo", false);
  const reviewType = textDefault("Custom.ReviewType", false);
  const batch = items.filter(item => submissionEligible(item, journal));
  if (!batch.length) {
    const counts = workQueueCounts(items, journal);
    throw new Error(items.length === 0
      ? "There are no Work items to export. Create work from Findings or use Add work item, then review and Accept it."
      : `Accept at least one unlinked work item before exporting for ADO. ${counts.pending} pending review; ${counts.rejected} rejected; ${counts.linked} linked; ${counts.recorded} recorded or uncertain ADO results. Leave Link blank for new work only; do not clear genuine tracker links or prior results to recreate work.`);
  }
  if (batch.length > 1_000) {
    throw new Error("Azure Boards CSV import supports at most 1,000 items per file. Reduce the accepted batch before exporting.");
  }
  if (new Set(items.map(item => item.id)).size !== items.length) {
    throw new Error("Duplicate SDS work IDs must be corrected before exporting for ADO.");
  }
  const rows = batch.map(item => {
    const label = `Work item ${items.indexOf(item) + 1}`;
    if (!item.workItemType) throw new Error(`${label}: choose Work item type Bug or Task before exporting for ADO.`);
    if (!item.severity) throw new Error(`${label}: choose a Severity before exporting for ADO.`);
    if (!item.description.trim()) throw new Error(`${label}: enter a Description before exporting for ADO.`);
    let patch: ReturnType<typeof adoPatch>;
    try { patch = adoPatch(workDraft(item), config); }
    catch (cause) {
      if (cause instanceof AdoRequestError) throw new AdoRequestError(`${label}: ${cause.message}`);
      throw cause;
    }
    const fields = new Map(patch.map(entry => [entry.path.toLowerCase(), entry.value]));
    const textField = (name: string, optional = false): string => {
      const value = fields.get(`/fields/${name.toLowerCase()}`);
      if (optional && value === undefined) return "";
      if (typeof value !== "string") throw new Error(`The ADO export requires a text value for ${name}.`);
      return value;
    };
    const row = [
      "", textField("System.Title"), assignee, "",
      textField("System.Tags"), inventoryId, reviewTeam, "",
      item.workItemType, reviewType, area, textField("Custom.WeaknessType", true), teamId, reviewer,
      textField("System.Description"), item.severity,
    ];
    if (row.some(value => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) {
      throw new Error(`${label}: an ADO export field contains unsupported control characters. Correct the work or destination defaults before exporting.`);
    }
    return row;
  });
  return { configuration: config, table: { headers: ADO_EXCEL_COLUMNS, rows }, workIds: batch.map(item => item.id) };
}

export function createAdoWorkCsv(prepared: AdoWorkExport): string {
  const indices = prepared.table.headers.flatMap((name, index) => creationExcluded.has(name) ? [] : [index]);
  const rows = [indices.map(index => prepared.table.headers[index]),
    ...prepared.table.rows.map(row => indices.map(index => row[index]))];
  if (rows.some(row => row.some(value => /^[\s\uFEFF]*[=+\-@]/.test(value)))) {
    throw new Error("A CSV field starts with a spreadsheet formula character. CSV quoting cannot make it safe in Excel. Use the text-safe ADO Excel template or revise that value; no CSV was exported.");
  }
  return "\uFEFF" + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n";
}
