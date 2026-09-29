import { SERVICES } from "./services";

export type AssistantMode = "chat" | "analyze";

export interface AssistantReference {
  kind: "node" | "edge" | "boundary";
  id: string;
  label: string;
}

export interface AssistantFinding {
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

export interface AssistantRequest {
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
  if (!SERVICES.assistant.enabled) {
    throw new Error(SERVICES.assistant.message);
  }

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
  return parseResponse(payload);
}
