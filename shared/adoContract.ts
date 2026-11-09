export const WORK_ITEM_SEVERITIES = [
  "1 - Critical", "2 - High", "3 - Medium", "4 - Low",
] as const;
export type WorkItemSeverity = (typeof WORK_ITEM_SEVERITIES)[number];

export function isWorkItemSeverity(value: unknown): value is WorkItemSeverity {
  return WORK_ITEM_SEVERITIES.some(severity => severity === value);
}

export const WORK_ITEM_TYPES = ["Bug", "Task"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export function isWorkItemType(value: unknown): value is WorkItemType {
  return WORK_ITEM_TYPES.some(type => type === value);
}

export interface AdoConfiguration {
  organizationUrl: string;
  project: string;
  inventoryId?: string;
  reviewer?: string;
  descriptionField?: string;
  defaults: Record<string, string | number | boolean>;
}

export interface AdoAuthentication {
  tenantId: string;
  clientId: string;
}

export interface AdoDraft {
  title: string;
  description: string;
  severity?: WorkItemSeverity;
  workItemType?: WorkItemType;
  weaknessType?: string;
}

export class AdoRequestError extends Error {
  readonly uncertain: boolean;

  constructor(message: string, uncertain = false) {
    super(message);
    this.name = "AdoRequestError";
    this.uncertain = uncertain;
  }
}

export const ADO_MAX_REQUEST_BYTES = 500_000;
export const ADO_ERROR_BODY_BYTES = 16_384;
export const ADO_LOCAL_ORIGIN = "http://localhost:5173";
const safeFieldReference = /^(?:System|Microsoft\.VSTS|Custom)\.[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;

export function safeAdoFieldNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const field of value.slice(0, 100)) {
    if (typeof field !== "string" || field.length > 128 || !safeFieldReference.test(field) ||
      seen.has(field.toLowerCase())) continue;
    seen.add(field.toLowerCase());
    result.push(field);
    if (result.length === 10) break;
  }
  return result;
}

export function adoErrorFieldNames(value: unknown): string[] {
  if (!isAdoRecord(value)) return [];
  const candidates: unknown[] = [];
  const references = (record: Record<string, unknown>) => {
    for (const [key, entry] of Object.entries(record).slice(0, 100)) {
      if (/^(?:fieldReferenceName|fieldReferenceNames|referenceName)$/i.test(key)) {
        candidates.push(...(Array.isArray(entry) ? entry.slice(0, 100) : [entry]));
      } else if (/^fieldReferenceInfo$/i.test(key) && isAdoRecord(entry)) {
        for (const [name, field] of Object.entries(entry).slice(0, 100)) {
          if (/^(?:fieldReferenceName|referenceName)$/i.test(name)) candidates.push(field);
        }
      }
    }
  };
  references(value);
  if (isAdoRecord(value.customProperties)) references(value.customProperties);
  if (typeof value.message === "string") {
    const message = value.message.slice(0, 8_192);
    // Only field-labelled references, not arbitrary quoted values in the error.
    const reference = "((?:System|Microsoft\\.VSTS|Custom)\\.[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)*)";
    for (const expression of [
      new RegExp("\\bfield(?:\\s+reference(?:\\s+name)?)?\\s*[:=]?\\s*[\"'(\\[]?\\s*" + reference + "\\b", "gi"),
      new RegExp("(?:^|[\\s\"'(\\[])" + reference + "[\"')\\]]*\\s+field\\b", "gi"),
    ]) candidates.push(...Array.from(message.matchAll(expression), match => match[1]));
  }
  return safeAdoFieldNames(candidates);
}
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeAdoAuthentication(value: unknown): AdoAuthentication {
  if (!isAdoRecord(value) || Object.keys(value).some(key => !["tenantId", "clientId"].includes(key)) ||
    typeof value.tenantId !== "string" || typeof value.clientId !== "string" ||
    !guid.test(value.tenantId.trim()) || !guid.test(value.clientId.trim())) {
    throw new AdoRequestError("Azure DevOps sign-in is not configured for this deployment. Contact the SDS administrator.");
  }
  return { tenantId: value.tenantId.trim().toLowerCase(), clientId: value.clientId.trim().toLowerCase() };
}

const allowedSystemDefaults = new Set([
  "system.areapath", "system.iterationpath", "system.assignedto",
  "system.tags", "system.state", "system.reason",
]);
const retiredDefaults = new Set([
  "custom.weaknesstype", "custom.riskrating", "microsoft.vsts.common.priority",
  "microsoft.vsts.cmmi.blocked", "microsoft.vsts.cmmi.rootcause", "microsoft.vsts.common.severity",
]);
const protectedField = /^(title|description|id|rev|revision|history|relations?|links?|url|createdby|createddate|changedby|changeddate|authorizedas|authorizeddate|reviseddate|activatedby|activateddate|resolvedby|resolveddate|closedby|closeddate|statechangedate|watermark|workitemtype|teamproject|externallinkcount|relatedlinkcount|hyperlinkcount|attachedfilecount)$/i;

export function isAdoRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AdoRequestError("ADO configuration contains an invalid text field.");
  }
  return value.trim();
}

export function normalizeAdoConfiguration(value: unknown): AdoConfiguration {
  if (!isAdoRecord(value) || Object.keys(value).some(key =>
    !["organizationUrl", "project", "workItemType", "tenantId", "clientId", "inventoryId", "reviewer", "descriptionField", "defaults"].includes(key))) {
    throw new AdoRequestError("Invalid ADO configuration.");
  }
  const organizationUrl = requiredText(value.organizationUrl);
  // Match source text so URL normalization cannot hide credentials, ports or dot segments.
  if (!/^https:\/\/dev\.azure\.com\/[a-z0-9][a-z0-9-]*\/?$/i.test(organizationUrl)) {
    throw new AdoRequestError("Use an organization URL of the form https://dev.azure.com/organization.");
  }
  const project = requiredText(value.project);
  if (/[\\/?#]/.test(project) || project === "." || project === "..") {
    throw new AdoRequestError("Invalid ADO project.");
  }
  let inventoryId: string | undefined;
  if (value.inventoryId !== undefined) {
    inventoryId = requiredText(value.inventoryId).toLowerCase();
    if (!guid.test(inventoryId)) throw new AdoRequestError("Inventory ID must be a valid GUID.");
  }
  let reviewer: string | undefined;
  if (value.reviewer !== undefined) {
    reviewer = requiredText(value.reviewer);
    if (!/^[^\s@;]+@[^\s@;]+$/.test(reviewer)) {
      throw new AdoRequestError("Reviewer must be an email address or UPN.");
    }
  }
  let descriptionField: string | undefined;
  if (value.descriptionField !== undefined) {
    descriptionField = requiredText(value.descriptionField);
    if (/^System\.Description$/i.test(descriptionField)) {
      descriptionField = "System.Description";
    } else if (descriptionField.length > 128 ||
      (retiredDefaults.has(descriptionField.toLowerCase()) || descriptionField.toLowerCase() === "custom.securityreviewer") ||
      !/^(?:Microsoft\.VSTS|Custom)\.[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/i.test(descriptionField) ||
      descriptionField.split(".").some(part => protectedField.test(part) && !/^description$/i.test(part))) {
      throw new AdoRequestError("Use System.Description or an unprotected Microsoft.VSTS or Custom description field reference.");
    }
  }
  if (!isAdoRecord(value.defaults)) throw new AdoRequestError("ADO field defaults must be an object.");
  const defaults: AdoConfiguration["defaults"] = {};
  const seen = new Set<string>();
  for (const [name, fieldValue] of Object.entries(value.defaults)) {
    const lower = name.toLowerCase();
    if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i.test(name) ||
      seen.has(lower) || lower === (descriptionField ?? "System.Description").toLowerCase() ||
      name.split(".").some(part => protectedField.test(part)) ||
      (lower.startsWith("system.") && !allowedSystemDefaults.has(lower)) ||
      !["string", "number", "boolean"].includes(typeof fieldValue) ||
      (typeof fieldValue === "number" && !Number.isFinite(fieldValue))) {
      throw new AdoRequestError("ADO field defaults contain an unsupported or protected field.");
    }
    seen.add(lower);
    if (retiredDefaults.has(lower)) continue;
    defaults[name] = fieldValue as string | number | boolean;
    if (inventoryId && lower === "system.tags" && typeof fieldValue !== "string") {
      throw new AdoRequestError("System.Tags must be text when Inventory ID is configured.");
    }
  }
  return {
    organizationUrl: organizationUrl.replace(/\/$/, "").toLowerCase(),
    // Legacy registration and global work-item fields are never used or emitted.
    project,
    ...(inventoryId ? { inventoryId } : {}), ...(reviewer ? { reviewer } : {}),
    ...(descriptionField ? { descriptionField } : {}), defaults,
  };
}

export function destinationKey(config: AdoConfiguration): string {
  const normalized = normalizeAdoConfiguration(config);
  return JSON.stringify([
    normalized.organizationUrl, normalized.project.toLowerCase(),
  ]);
}

export function validateAdoProjectPath(
  project: string, field: "System.AreaPath" | "System.IterationPath", value: unknown,
): void {
  if (typeof value !== "string" || !value.trim() || value.includes("/") ||
    value.split("\\").some(segment => !segment.trim())) {
    throw new AdoRequestError(`defaults.${field} must be a nonempty path with single backslash separators (written as \\\\ in JSON). Remove this field to use the ADO default.`);
  }
  if (value.toLowerCase() !== project.toLowerCase() &&
    !value.toLowerCase().startsWith(`${project.toLowerCase()}\\`)) {
    throw new AdoRequestError(`defaults.${field} must equal project ${JSON.stringify(project)} or be a child path within that project.`);
  }
}

export function parseAdoConfigurationJson(text: string): AdoConfiguration {
  if (new TextEncoder().encode(text).length > ADO_MAX_REQUEST_BYTES) {
    throw new AdoRequestError("Configuration JSON must not exceed 500,000 UTF-8 bytes.");
  }
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new AdoRequestError("The ADO configuration JSON is invalid. Use a complete JSON object with double-quoted property names and no trailing commas."); }
  if (!isAdoRecord(value) ||
    ["organizationUrl", "project", "defaults"].some(field => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new AdoRequestError("Paste the complete ADO configuration containing organizationUrl, project and defaults, not a defaults-only object.");
  }
  for (const field of ["organizationUrl", "project"]) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      throw new AdoRequestError(`The ${field} property must be nonempty text.`);
    }
  }
  const config = normalizeAdoConfiguration({
    ...value,
    inventoryId: typeof value.inventoryId === "string" && !value.inventoryId.trim() ? undefined : value.inventoryId,
    reviewer: typeof value.reviewer === "string" && !value.reviewer.trim() ? undefined : value.reviewer,
  });
  for (const field of ["System.AreaPath", "System.IterationPath"] as const) {
    const key = Object.keys(config.defaults).find(name => name.toLowerCase() === field.toLowerCase());
    if (key !== undefined) validateAdoProjectPath(config.project, field, config.defaults[key]);
  }
  if (new TextEncoder().encode(JSON.stringify(config, null, 2) + "\n").length > ADO_MAX_REQUEST_BYTES) {
    throw new AdoRequestError("Formatted configuration JSON must not exceed 500,000 UTF-8 bytes so the saved editor and downloaded file remain reloadable.");
  }
  return config;
}

export function normalizeAdoDraft(draft: unknown): AdoDraft & {
  workItemType: WorkItemType; severity: WorkItemSeverity;
} {
  if (!isAdoRecord(draft) || Object.keys(draft).some(key => !["title", "description", "severity", "workItemType", "weaknessType"].includes(key)) ||
    typeof draft.title !== "string" || !draft.title.trim() ||
    draft.title.trim().length > 255 || /[\u0000-\u001f\u007f]/.test(draft.title) ||
    typeof draft.description !== "string") {
    throw new AdoRequestError("Enter a nonempty title of at most 255 characters and a plain-text description.");
  }
  if (!isWorkItemType(draft.workItemType)) {
    throw new AdoRequestError("Choose a Work item type (Bug or Task) on each Work item.");
  }
  if (!isWorkItemSeverity(draft.severity)) {
    throw new AdoRequestError("Choose a severity (Critical, High, Medium or Low) on each Bug or Task; template severity is not used.");
  }
  let weaknessType: string | undefined;
  if (draft.weaknessType !== undefined) {
    if (typeof draft.weaknessType !== "string") throw new AdoRequestError("Weakness Type must be text when provided.");
    const text = draft.weaknessType.trim();
    if (text) {
      if (/[\u0000-\u001f\u007f]/.test(draft.weaknessType)) {
        throw new AdoRequestError("Weakness Type must not contain control characters.");
      }
      weaknessType = text;
    }
  }
  return {
    title: draft.title.trim(), description: draft.description, workItemType: draft.workItemType,
    severity: draft.severity, ...(weaknessType !== undefined ? { weaknessType } : {}),
  };
}

export function adoPatch(value: unknown, configuration: unknown) {
  const config = normalizeAdoConfiguration(configuration);
  const draft = normalizeAdoDraft(value);
  const defaults = { ...config.defaults };
  for (const name of Object.keys(defaults)) {
    if (name.toLowerCase() === "microsoft.vsts.common.severity" ||
      (config.reviewer && name.toLowerCase() === "custom.securityreviewer")) {
      delete defaults[name];
    }
  }
  if (config.inventoryId) {
    const tagField = Object.keys(defaults).find(name => name.toLowerCase() === "system.tags");
    const tags = tagField ? String(defaults[tagField]) : "";
    if (tagField) delete defaults[tagField];
    defaults["System.Tags"] = [
      ...tags.split(";").map(tag => tag.trim()).filter(tag => tag && !/^serviceoid\s*:/i.test(tag)),
      `ServiceOID:${config.inventoryId}`,
    ].join("; ");
  }
  if (config.reviewer) defaults["Custom.SecurityReviewer"] = config.reviewer;
  defaults["Microsoft.VSTS.Common.Severity"] = draft.severity;
  if (draft.weaknessType !== undefined) defaults["Custom.WeaknessType"] = draft.weaknessType;
  const html = draft.description.replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
    .replace(/\r\n?|\n/g, "<br>");
  return [
    { op: "add", path: "/fields/System.Title", value: draft.title.trim() },
    { op: "add", path: `/fields/${config.descriptionField ?? "System.Description"}`, value: html },
    ...Object.entries(defaults).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ op: "add", path: `/fields/${name}`, value })),
  ];
}

export function adoEndpoint(config: AdoConfiguration, workItemType: WorkItemType, validateOnly: boolean): string {
  const normalized = normalizeAdoConfiguration(config);
  if (!isWorkItemType(workItemType)) throw new AdoRequestError("Choose a Work item type (Bug or Task) on each Work item.");
  return `${normalized.organizationUrl}/${encodeURIComponent(normalized.project)}` +
    `/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.1` +
    (validateOnly ? "&validateOnly=true" : "");
}

export function adoItemUrl(config: AdoConfiguration, id: number): string {
  const normalized = normalizeAdoConfiguration(config);
  return `${normalized.organizationUrl}/${encodeURIComponent(normalized.project)}/_workitems/edit/${id}`;
}
