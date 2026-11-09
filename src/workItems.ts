import { uid, type PsWorkItem, type WorkSubmissionReceipt } from "./types";
import { isWorkItemSeverity, isWorkItemType } from "../shared/adoContract";
import type { AssistantAnalysisSnapshot, AssistantFinding } from "./designAssistant";
import { formatGuidanceReferences } from "./aiDesignGuidance";

const findingSeverities = {
  critical: "1 - Critical", high: "2 - High", medium: "3 - Medium", low: "4 - Low",
} as const satisfies Record<AssistantFinding["severity"], NonNullable<PsWorkItem["severity"]>>;

export function workItemFromFinding(
  finding: AssistantFinding, analysis: AssistantAnalysisSnapshot | null,
): Pick<PsWorkItem, "title" | "description" | "severity" | "workItemType" | "weaknessType" | "decision" | "link"> {
  return {
    title: finding.title,
    severity: findingSeverities[finding.severity],
    ...(finding.workItemType !== undefined ? { workItemType: finding.workItemType } : {}),
    ...(finding.weaknessType !== undefined ? { weaknessType: finding.weaknessType } : {}),
    decision: "pending",
    link: "",
    description: [
      finding.title,
      `Finding ID: ${finding.id}\nCategory: ${finding.category}\nSeverity: ${finding.severity}`,
      ...(analysis ? [`Scenario: ${analysis.scenarioName} (${analysis.scenarioId})`] : []),
      `Rationale:\n${finding.rationale}`,
      `Recommended action:\n${finding.recommendation}`,
      `Diagram references:\n${finding.references.length
        ? finding.references.map(reference => `- ${reference.kind}: ${reference.label} (${reference.id})`).join("\n")
        : "None supplied."}`,
    ].join("\n\n") + formatGuidanceReferences(finding.guidanceReferences),
  };
}

const DANGEROUS_SCHEME_RE = /^\s*(javascript|data|vbscript|file)\s*:/i;
const RECEIPT_FIELDS = new Set([
  "operationId", "destinationKey", "status", "attemptedAt", "adoId", "url", "error",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be nonempty text.`);
  }
  return value;
}

function normalizeReceipt(value: unknown): WorkSubmissionReceipt {
  const source = record(value, "Work item submission");
  for (const key of Object.keys(source)) {
    if (!RECEIPT_FIELDS.has(key)) throw new Error("Work item submission contains an unsupported field.");
  }
  const operationId = requiredText(source.operationId, "Submission operationId");
  const destinationKey = requiredText(source.destinationKey, "Submission destinationKey");
  const status = source.status;
  if (status !== "submitting" && status !== "submitted" && status !== "failed" && status !== "unknown") {
    throw new Error("Work item submission status is invalid.");
  }
  if (typeof source.attemptedAt !== "number" || !Number.isFinite(source.attemptedAt) || source.attemptedAt < 0) {
    throw new Error("Work item submission attemptedAt must be a nonnegative finite timestamp.");
  }
  const receipt: WorkSubmissionReceipt = { operationId, destinationKey, status, attemptedAt: source.attemptedAt };
  if (source.adoId !== undefined) {
    if (typeof source.adoId !== "number" || !Number.isSafeInteger(source.adoId) || source.adoId <= 0) {
      throw new Error("Work item submission adoId must be a positive safe integer.");
    }
    receipt.adoId = source.adoId;
  }
  if (source.url !== undefined) {
    if (typeof source.url !== "string") throw new Error("Work item submission url must be text.");
    let url: URL;
    try { url = new URL(source.url); }
    catch { throw new Error("Work item submission url must be an absolute HTTPS URL."); }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Work item submission url must be an absolute HTTPS URL without credentials.");
    }
    receipt.url = source.url;
  }
  if (source.error !== undefined) {
    if (typeof source.error !== "string") throw new Error("Work item submission error must be text.");
    receipt.error = source.error;
  }
  return receipt;
}

export function normalizeWorkItem(value: unknown): PsWorkItem {
  const source = record(value, "Work item");
  if (source.title !== undefined && typeof source.title !== "string") {
    throw new Error("Work item title must be text.");
  }
  if (source.decision !== undefined && source.decision !== "pending" &&
      source.decision !== "accepted" && source.decision !== "rejected") {
    throw new Error("Work item decision is invalid.");
  }
  if (source.severity !== undefined && !isWorkItemSeverity(source.severity)) {
    throw new Error("Work item severity is invalid.");
  }
  if (source.workItemType !== undefined && !isWorkItemType(source.workItemType)) {
    throw new Error("Work item type must be Bug or Task.");
  }
  if (source.weaknessType !== undefined && typeof source.weaknessType !== "string") {
    throw new Error("Work item Weakness Type must be text.");
  }
  const rawLink = typeof source.link === "string" ? source.link : "";
  const item: PsWorkItem = {
    id: typeof source.id === "string" && source.id.trim()
      ? source.id
      : uid("wi"),
    description: typeof source.description === "string" ? source.description : "",
    link: DANGEROUS_SCHEME_RE.test(rawLink.replace(/[\u0000-\u0020]/g, "")) ? "" : rawLink,
    title: source.title === undefined ? "" : source.title,
    decision: source.decision === undefined ? "pending" : source.decision,
  };
  if (source.severity !== undefined) item.severity = source.severity;
  if (source.workItemType !== undefined) item.workItemType = source.workItemType;
  if (source.weaknessType !== undefined) item.weaknessType = source.weaknessType;
  if (source.submission !== undefined) item.submission = normalizeReceipt(source.submission);
  return item;
}
