import { SERVICES } from "./services";
import {
  designAuthenticationPlanChoices, designCatalogChoices, designPlanChoices, designProtocolPlanChoices,
  parseDesignPlan, parseDesignResult, validateDesignApplicationIds, validateDesignCatalog,
  type DesignPlan, type DesignResult, type DesignTurn,
} from "../shared/designContract";
import type { DesignRequestSnapshot, buildDesignPlanContext } from "./threatModelDesigner";
import {
  assertAiRequestBudget, jsonByteLength, validateAiRequestGuidance,
  MAX_AI_REQUEST_BYTES, MAX_GUIDANCE_CONTEXT_BYTES,
  type AiGuidanceReference,
} from "../shared/aiDesignGuidance";
import { guidanceReferencesForFinding } from "./aiDesignGuidance";
import type { AiProviderId } from "../shared/aiProviders";

export type AssistantMode = "chat" | "analyze";

export interface AssistantReference {
  kind: "node" | "edge" | "boundary";
  id: string;
  label: string;
}

export interface AssistantFinding {
  guidanceReferences?: AiGuidanceReference[];
  id: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  rationale: string;
  recommendation: string;
  references: AssistantReference[];
}

export interface AssistantResponse {
  answer: string;
  references: AssistantReference[];
  findings: AssistantFinding[];
}

export interface AssistantAnalysisSnapshot {
  documentSessionId: number;
  scenarioId: string;
  scenarioName: string;
  createdAt: number;
  answer: string;
}

export interface AssistantRequest {
  provider?: AiProviderId;
  mode: AssistantMode;
  question: string;
  context: unknown;
}

function isReference(value: unknown): value is AssistantReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AssistantReference>;
  return (
    (candidate.kind === "node" ||
      candidate.kind === "edge" ||
      candidate.kind === "boundary") &&
    typeof candidate.id === "string" &&
    typeof candidate.label === "string"
  );
}

function isFinding(value: unknown): value is AssistantFinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AssistantFinding>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.category === "string" &&
    ["critical", "high", "medium", "low"].includes(candidate.severity ?? "") &&
    typeof candidate.title === "string" &&
    typeof candidate.rationale === "string" &&
    typeof candidate.recommendation === "string" &&
    Array.isArray(candidate.references) &&
    candidate.references.every(isReference)
  );
}

function parseResponse(value: unknown): AssistantResponse {
  if (!value || typeof value !== "object") {
    throw new Error("The Design Assistant returned an invalid response.");
  }
  const candidate = value as Partial<AssistantResponse>;
  if (
    typeof candidate.answer !== "string" ||
    !Array.isArray(candidate.references) ||
    !candidate.references.every(isReference) ||
    !Array.isArray(candidate.findings) ||
    !candidate.findings.every(isFinding)
  ) {
    throw new Error("The Design Assistant returned an invalid response.");
  }
  return candidate as AssistantResponse;
}

export async function askDesignAssistant(
  request: AssistantRequest,
  signal?: AbortSignal,
): Promise<AssistantResponse> {
  const response = parseResponse(await requestAssistant(request, signal));
  // Provenance comes from the exact request, never from model-authored citations.
  const context = request.context as Parameters<typeof guidanceReferencesForFinding>[0];
  return { ...response, findings: response.findings.map(finding => ({
    ...finding, guidanceReferences: guidanceReferencesForFinding(context, finding.references),
  })) };
}

export async function askThreatModelDesigner(
  request: { mode: "design"; question: string; context: DesignRequestSnapshot["context"]; history: DesignTurn[]; provider?: AiProviderId },
  signal?: AbortSignal,
): Promise<DesignResult> {
  const result = parseDesignResult(await requestAssistant(request, signal), { existingScenario: request.context.scenario !== null });
  validateDesignCatalog(result, designCatalogChoices(request.context.catalog));
  validateDesignApplicationIds(result, request.context);
  return result;
}

// Planning step: the model sees only the compact type, protocol and
// authentication indexes and selects the entries whose guidance design needs.
export async function planThreatModelDesign(
  request: { mode: "design-plan"; question: string; context: DesignPlanContext; history: DesignTurn[]; provider?: AiProviderId },
  signal?: AbortSignal,
): Promise<DesignPlan> {
  return parseDesignPlan(await requestAssistant(request, signal), designPlanChoices(request.context),
    designProtocolPlanChoices(request.context), designAuthenticationPlanChoices(request.context));
}

export type DesignPlanContext = ReturnType<typeof buildDesignPlanContext>;

export interface DesignSelection {
  nodeTypeIds?: readonly string[];
  protocolIds?: readonly string[];
  authenticationIds?: readonly string[];
}

// Heuristic for skipping the planning call; not a provider token or rate-limit guarantee.
export const SINGLE_CALL_CONTEXT_BYTES = 96_000;

type DesignRequest = {
  mode: "design"; question: string; context: DesignRequestSnapshot["context"]; history: DesignTurn[]; provider?: AiProviderId;
};
type SnapshotKeys = Pick<DesignRequestSnapshot, "scenarioId" | "documentKey" | "catalogKey">;

const errorText = (cause: unknown) => cause && typeof cause === "object" && "message" in cause
  ? String((cause as { message: unknown }).message) : String(cause);

function measured(request: { context: unknown }): string {
  const context = (request.context ?? {}) as Record<string, unknown>;
  const guidance = jsonByteLength({
    aiDesignGuidance: context.aiDesignGuidance ?? [], communicationGuidance: context.communicationGuidance ?? [],
    ...(context.authenticationGuidance === undefined ? {} : { authenticationGuidance: context.authenticationGuidance }),
  });
  return ` Measured request ${jsonByteLength(request)} of ${MAX_AI_REQUEST_BYTES} bytes; guidance ${guidance} of ${MAX_GUIDANCE_CONTEXT_BYTES} bytes.`;
}

function assertRequestFits(request: { mode: string; context: unknown }): void {
  validateAiRequestGuidance(request);
  assertAiRequestBudget(request);
}

export function assertPinnedDesignSnapshot(pinned: SnapshotKeys, current: SnapshotKeys | undefined): void {
  if (!current || current.scenarioId !== pinned.scenarioId || current.documentKey !== pinned.documentKey
      || current.catalogKey !== pinned.catalogKey) {
    throw new Error("The model, scenario or catalog changed while AI was selecting design guidance. No design request was sent and no changes were applied; send your prompt again.");
  }
}

// Every planned ID must resolve in the scoped design context; nothing is dropped.
export function assertDesignPlanResolved(plan: DesignPlan, context: unknown): void {
  const catalog = (context && typeof context === "object"
    ? (context as { catalog?: unknown }).catalog : undefined) as Record<string, unknown> | undefined;
  const entries = (key: string) => (Array.isArray(catalog?.[key]) ? catalog![key] as unknown[] : [])
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  const check = (selected: readonly string[] | undefined, key: string, kind: string) => {
    const offered = entries(key);
    for (const id of selected ?? []) {
      const entry = offered.find(item => item.id === id);
      if (!entry || (key === "authentication" && entry.hasGuidance === true && entry.guidanceSupplied !== true)) {
        throw new Error(`AI design plan selected ${kind} "${id}", which is no longer available with its guidance. No design request was sent and no changes were applied; send your prompt again.`);
      }
    }
  };
  check(plan.nodeTypeIds, "nodeTypes", "component type");
  check(plan.protocolIds, "protocols", "communication protocol");
  check(plan.authenticationIds, "authentication", "authentication method");
}

// Reports supplied authentication cards and proposals made without one.
export function describeAuthenticationGuidanceCoverage(
  context: {
    authenticationGuidance?: readonly { methodId: string; appliesToEdgeIds: readonly string[] }[];
    authenticationGuidanceMissing?: readonly { methodId: string }[];
    catalogScope?: unknown;
  },
  result?: DesignResult | null,
): string {
  const supplied = context.authenticationGuidance ?? [];
  const suppliedIds = new Set(supplied.map(entry => entry.methodId));
  const unbound = supplied.filter(entry => !entry.appliesToEdgeIds.length).map(entry => entry.methodId);
  // Planned requests name their selections; single-call requests offer every card.
  const labels = [
    ...supplied.filter(entry => entry.appliesToEdgeIds.length).map(entry => `${entry.methodId} (in use)`),
    ...(context.catalogScope ? unbound.map(id => `${id} (selected)`)
      : unbound.length ? [`${unbound.length} other available method${unbound.length === 1 ? "" : "s"}`] : []),
  ];
  const missing = [...new Set((context.authenticationGuidanceMissing ?? []).map(entry => entry.methodId))];
  const proposed = [...new Set((result?.design?.edges ?? [])
    .flatMap(edge => edge.authenticationType ? [edge.authenticationType] : []))].filter(id => !suppliedIds.has(id));
  return [
    labels.length ? `Authentication guidance supplied: ${labels.join(", ")}.` : "",
    missing.length ? `In-use authentication without guidance: ${missing.join(", ")}.` : "",
    proposed.length ? `Proposed authentication without supplied guidance: ${proposed.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

// One optional selection round, then one fully checked design request. Required
// in-use context is checked before any call. A small catalog whose complete
// candidate (all component, protocol and authentication guidance) fits the
// single-call heuristic and budgets is sent once; otherwise the model selects
// guidance once. Nothing is batched, retried or truncated, and the caller
// applies a validated response only after it returns.
export async function runThreatModelDesign(options: {
  question: string;
  history: DesignTurn[];
  provider?: AiProviderId;
  prepareDesign: (selection?: DesignSelection) => DesignRequestSnapshot;
  preparePlan: () => DesignPlanContext;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  singleCallContextBytes?: number;
}): Promise<{ response: DesignResult; expected: DesignRequestSnapshot; plan?: DesignPlan; scopeNote: string; coverage: string }> {
  const { question, history, provider, prepareDesign, preparePlan, signal, onStatus } = options;
  const designRequest = (context: DesignRequestSnapshot["context"]): DesignRequest =>
    ({ mode: "design", question, context, history, ...(provider ? { provider } : {}) });
  const required: DesignSelection = { nodeTypeIds: [], protocolIds: [], authenticationIds: [] };
  let pinned: DesignRequestSnapshot | undefined;
  try {
    pinned = prepareDesign(required);
    assertRequestFits(designRequest(pinned.context));
  } catch (cause) {
    throw new Error(`Required design context cannot be sent: ${errorText(cause)}${pinned ? measured(designRequest(pinned.context)) : ""} Guidance for components, protocols and authentication methods already used in this scenario must fit with the prompt and conversation before more guidance can be selected. Shorten that guidance, the prompt or conversation, or choose a smaller scenario. No AI request was sent.`);
  }

  let direct: DesignRequestSnapshot | null = null;
  try {
    // The single-call candidate carries every offered method's guidance with
    // the complete component and protocol catalogs; it is used only if it fits.
    const candidate = prepareDesign({
      authenticationIds: pinned.context.catalog.authentication.map(method => method.id),
    });
    if (jsonByteLength(candidate.context) <= (options.singleCallContextBytes ?? SINGLE_CALL_CONTEXT_BYTES)) {
      assertRequestFits(designRequest(candidate.context));
      direct = candidate;
    }
  } catch {
    direct = null;
  }
  if (direct) {
    const response = await askThreatModelDesigner(designRequest(direct.context), signal);
    return { response, expected: direct, scopeNote: "", coverage: describeAuthenticationGuidanceCoverage(direct.context, response) };
  }

  const planContext = preparePlan();
  const planRequest = { mode: "design-plan" as const, question, context: planContext, history, ...(provider ? { provider } : {}) };
  try {
    assertRequestFits(planRequest);
  } catch (cause) {
    throw new Error(`Design planning request cannot be sent: ${errorText(cause)}${measured(planRequest)} The compact component, protocol and authentication indexes plus the conversation must fit. No AI request was sent.`);
  }
  onStatus?.("Selecting the component types, communication profiles and authentication guidance this design needs…");
  const plan = await planThreatModelDesign(planRequest, signal);
  if (signal?.aborted) throw new Error("The design request was cancelled after planning. No design request was sent and no changes were applied.");
  const selected = (cause: unknown, request?: DesignRequest) => new Error(`Selected design guidance cannot be sent: ${errorText(cause)}${request ? measured(request) : ""} One planning request was sent; no design request was sent and no changes were applied. Ask for a narrower design task.`);
  let expected: DesignRequestSnapshot;
  try {
    expected = prepareDesign({ nodeTypeIds: plan.nodeTypeIds, protocolIds: plan.protocolIds, authenticationIds: plan.authenticationIds });
  } catch (cause) {
    let current: DesignRequestSnapshot | undefined;
    try { current = prepareDesign(required); } catch { current = undefined; }
    assertPinnedDesignSnapshot(pinned, current);
    throw selected(cause);
  }
  assertPinnedDesignSnapshot(pinned, expected);
  assertDesignPlanResolved(plan, expected.context);
  const request = designRequest(expected.context);
  try {
    assertRequestFits(request);
  } catch (cause) {
    throw selected(cause, request);
  }
  const offered = expected.context.catalogScope?.nodeTypeIds.length ?? 0;
  const summary = `${offered} of ${planContext.nodeTypeIndex.length} component types, ${expected.context.catalog.protocols.length} communication profiles and ${expected.context.authenticationGuidance.length} authentication guidance cards`;
  onStatus?.(`Designing with ${summary}…`);
  const response = await askThreatModelDesigner(request, signal);
  return { response, expected, plan, scopeNote: ` Used ${summary}.`,
    coverage: describeAuthenticationGuidanceCoverage(expected.context, response) };
}

async function requestAssistant(
  request: AssistantRequest | { mode: "design" | "design-plan"; question: string; context: unknown; history: DesignTurn[]; provider?: AiProviderId },
  signal?: AbortSignal,
): Promise<unknown> {
  if (!SERVICES.assistant.enabled) {
    throw new Error(SERVICES.assistant.message);
  }
  // Mode-specific guidance kinds, bindings and budgets are checked before fetch.
  validateAiRequestGuidance(request);
  assertAiRequestBudget(request);

  const response = await fetch(SERVICES.assistant.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Design Assistant request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}
