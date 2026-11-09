import type { AdoConfiguration, AdoDraft } from "./adoClient";
import type { PsWorkItem, WorkSubmissionReceipt } from "./types";
import { normalizeWorkItem } from "./workItems";

export const ADO_CONFIG_KEY = "secure-design-studio:ado-configuration:v1";
export const ADO_JOURNAL_KEY = "secure-design-studio:ado-submission-journal:v1";
export const ADO_LOCK_NAME = "secure-design-studio:ado-submission";

type StoragePort = Pick<Storage, "getItem" | "setItem">;
type Journal = Record<string, WorkSubmissionReceipt>;
export type BatchResult = { workId: string; title: string; receipt: WorkSubmissionReceipt };
export type WorkEligibility = "eligible" | "pending" | "rejected" | "linked" | "recorded";
export type SubmissionClient = {
  validate(draft: AdoDraft): Promise<void>;
  create(draft: AdoDraft): Promise<{ id: number; url: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readSubmissionJournal(storage: StoragePort): Journal {
  const raw = storage.getItem(ADO_JOURNAL_KEY);
  if (!raw) return Object.create(null);
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error("The ADO submission journal is invalid. Submission is blocked; preserve it for recovery.");
  const journal: Journal = Object.create(null);
  for (const [id, entry] of Object.entries(value)) {
    const receipt = normalizeWorkItem({ id, description: "", link: "", submission: entry }).submission;
    if (!receipt) throw new Error("The ADO submission journal has a missing outcome. Submission is blocked.");
    journal[id] = receipt;
  }
  return journal;
}

function writeReceipt(storage: StoragePort, id: string, receipt: WorkSubmissionReceipt): void {
  const journal = readSubmissionJournal(storage);
  journal[id] = receipt;
  const encoded = JSON.stringify(journal);
  storage.setItem(ADO_JOURNAL_KEY, encoded);
  if (storage.getItem(ADO_JOURNAL_KEY) !== encoded) {
    throw new Error("The ADO submission journal could not be saved. No further items will be submitted.");
  }
}

export function effectiveReceipt(item: PsWorkItem, journal: Journal): WorkSubmissionReceipt | undefined {
  const durable = Object.hasOwn(journal, item.id) ? journal[item.id] : undefined;
  if (item.submission?.status === "submitted" && (!durable || durable.operationId === item.submission.operationId)) {
    return item.submission;
  }
  if (durable && durable.status !== "failed") return durable;
  if (item.submission && item.submission.status !== "failed") return item.submission;
  return durable ?? item.submission;
}

export function submissionEligible(item: PsWorkItem, journal: Journal): boolean {
  return workItemEligibility(item, journal) === "eligible";
}

export function workItemEligibility(item: PsWorkItem, journal: Journal): WorkEligibility {
  const receipt = effectiveReceipt(item, journal);
  if (receipt && receipt.status !== "failed") return "recorded";
  if (item.link.trim()) return "linked";
  if (item.decision === "rejected") return "rejected";
  return item.decision === "accepted" ? "eligible" : "pending";
}

export function workQueueCounts(items: readonly PsWorkItem[], journal: Journal): Record<WorkEligibility, number> {
  const counts = { eligible: 0, pending: 0, rejected: 0, linked: 0, recorded: 0 };
  for (const item of items) counts[workItemEligibility(item, journal)]++;
  return counts;
}

export function workDraft(item: PsWorkItem): AdoDraft {
  return {
    title: item.title?.trim() ?? "", description: item.description,
    ...(item.severity !== undefined ? { severity: item.severity } : {}),
    ...(item.workItemType !== undefined ? { workItemType: item.workItemType } : {}),
    ...(item.weaknessType !== undefined ? { weaknessType: item.weaknessType } : {}),
  };
}

export async function submitWorkBatch(options: {
  items: readonly PsWorkItem[];
  destination: string;
  client: SubmissionClient;
  storage: StoragePort;
  isCurrent: (item: PsWorkItem) => boolean;
  onReceipt: (item: PsWorkItem, receipt: WorkSubmissionReceipt) => void;
}): Promise<BatchResult[]> {
  const { client, storage, isCurrent, onReceipt, destination } = options;
  const journal = readSubmissionJournal(storage);
  const batch = options.items.filter(item => submissionEligible(item, journal));
  if (!batch.length) throw new Error("No accepted, unlinked work items are eligible for submission.");
  if (new Set(batch.map(item => item.id)).size !== batch.length) {
    throw new Error("Duplicate SDS work IDs must be corrected before submission.");
  }
  // Validate the entire frozen payload set before the first external write.
  for (const item of batch) {
    if (!isCurrent(item)) throw new Error("Work changed during submission preparation. Review it and submit again.");
    await client.validate(workDraft(item));
  }
  const results: BatchResult[] = [];
  for (const item of batch) {
    if (!isCurrent(item)) throw new Error("Work changed during submission. Earlier results are saved; remaining items were not submitted.");
    const receipt: WorkSubmissionReceipt = {
      operationId: crypto.randomUUID(), destinationKey: destination,
      attemptedAt: Date.now(), status: "submitting",
    };
    writeReceipt(storage, item.id, receipt);
    onReceipt(item, receipt);
    let outcome: WorkSubmissionReceipt;
    try {
      const created = await client.create(workDraft(item));
      outcome = { ...receipt, status: "submitted", adoId: created.id, url: created.url };
    } catch (error) {
      const uncertain = !(error instanceof Error && "uncertain" in error && error.uncertain === false);
      outcome = {
        ...receipt, status: uncertain ? "unknown" : "failed",
        error: uncertain
          ? "Creation may have succeeded. Check ADO before taking any further action; automatic retry is blocked."
          : error instanceof Error ? error.message : "ADO rejected this work item.",
      };
    }
    // Keep the outcome visible even if durable storage fails after ADO accepted it.
    onReceipt(item, outcome);
    results.push({ workId: item.id, title: workDraft(item).title, receipt: outcome });
    writeReceipt(storage, item.id, outcome);
    if (outcome.status === "unknown") break;
  }
  return results;
}

export function configurationSummary(config: AdoConfiguration): string {
  return `${config.organizationUrl} / ${config.project}`;
}
