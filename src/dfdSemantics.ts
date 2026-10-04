import { resolveNodeTypeDef, type DfdRole, type DfdValue, type InvalidDfdValue,
  type NodeTypeRef, type PsDocument, type PsEdge, type PsNode, type Scenario } from "./types";

export const DFD_ROLES: readonly DfdRole[] = ["Process", "DataStore", "ExternalInteractor"];
export const DFD_ROLE_LABELS: Record<DfdRole, string> = {
  Process: "Process", DataStore: "Data Store", ExternalInteractor: "External Interactor",
};
export const DFD_SCOPE_LABELS = {
  inScope: "In scope", outOfScope: "Out of scope", external: "External (black box)",
  unresolved: "Unresolved (review internals)", notMember: "Not in scenario", noScenario: "Select a scenario",
} as const;

export function isDfdRole(value: unknown): value is DfdRole {
  return typeof value === "string" && DFD_ROLES.includes(value as DfdRole);
}

function invalidValue(value: unknown, limit: number): InvalidDfdValue {
  const text = JSON.stringify(value) ?? String(value);
  return { invalid: text.slice(0, limit), ...(text.length > limit ? { truncated: true as const } : {}) };
}

export function normalizeDfdValue(value: unknown, limit = 16000): DfdValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.length <= limit) return value;
  if (value && typeof value === "object" && "invalid" in value
      && typeof value.invalid === "string") {
    return { invalid: value.invalid.slice(0, limit),
      ...(value.invalid.length > limit || ("truncated" in value && value.truncated === true)
        ? { truncated: true as const } : {}) };
  }
  return invalidValue(value, limit);
}

export function formatDfdValue(value: DfdValue | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value
    : `Unrecognized input${value.truncated ? " (truncated)" : ""}: ${value.invalid}`;
}

export function normalizeNodeScope(
  scenario: Pick<Scenario, "nodeScopeReasons" | "nodeScopeReasonsRecovery">,
  nodeIds: ReadonlySet<string>,
): Pick<Scenario, "nodeScopeReasons" | "nodeScopeReasonsRecovery"> {
  const raw: unknown = scenario.nodeScopeReasons;
  const recovery = scenario.nodeScopeReasonsRecovery;
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
    return { nodeScopeReasons: {}, nodeScopeReasonsRecovery: invalidValue(raw, 16000) };
  }
  const entries = Object.entries(raw ?? {}).filter(([id]) => nodeIds.has(id))
    .map(([id, value]) => [id, normalizeDfdValue(value)] as const)
    .filter((entry): entry is readonly [string, DfdValue] => entry[1] !== undefined);
  const savedRecovery = recovery === undefined ? undefined : normalizeDfdValue(recovery);
  return {
    ...(entries.length || raw !== undefined ? { nodeScopeReasons: Object.fromEntries(entries) } : {}),
    ...(savedRecovery && typeof savedRecovery !== "string" ? { nodeScopeReasonsRecovery: savedRecovery } : {}),
  };
}

export interface DfdRoleResolution {
  role: DfdRole;
  source: "override" | "catalog" | "legacy" | "fallback" | "unresolved";
  confidence: "explicit" | "default" | "fallback" | "unresolved";
  diagnostics: string[];
}

export function resolveDfdRole(node: PsNode, nodeTypes: readonly NodeTypeRef[] = []): DfdRoleResolution {
  const override = node.dfdRoleOverride;
  const value = override !== undefined ? override
    : node.dfdRoleLegacy === true ? undefined : resolveNodeTypeDef(node.type, nodeTypes)?.defaultDfdRole;
  if (value !== undefined) {
    if (isDfdRole(value)) return { role: value, source: override !== undefined ? "override" : "catalog",
      confidence: override !== undefined ? "explicit" : "default", diagnostics: [] };
    return { role: "Process", source: "unresolved", confidence: "unresolved",
      diagnostics: [`Unrecognized DFD role; conservatively review as Process. ${formatDfdValue(value)}`] };
  }
  return { role: "Process", source: node.dfdRoleLegacy === true ? "legacy" : "fallback",
    confidence: "fallback", diagnostics: [] };
}

export function resolveNodeReviewScope(
  node: PsNode, scenario: Scenario | null | undefined, nodeTypes: readonly NodeTypeRef[] = [],
) {
  const role = resolveDfdRole(node, nodeTypes);
  const storedReason = scenario?.nodeScopeReasons && Object.hasOwn(scenario.nodeScopeReasons, node.id)
    ? scenario.nodeScopeReasons[node.id] : undefined;
  const diagnostics = [...role.diagnostics];
  const reason = typeof storedReason === "string" ? storedReason.trim() : "";
  if (storedReason !== undefined && typeof storedReason !== "string") {
    diagnostics.push(`Unrecognized scope reason is inactive. ${formatDfdValue(storedReason)}`);
  }
  if (scenario?.nodeScopeReasonsRecovery) {
    diagnostics.push(`Scenario scope input needs repair. ${formatDfdValue(scenario.nodeScopeReasonsRecovery)}`);
  }
  let disposition: keyof typeof DFD_SCOPE_LABELS;
  if (!scenario) disposition = "noScenario";
  else if (!scenario.nodeIds.includes(node.id)) disposition = "notMember";
  else if (role.confidence === "unresolved") disposition = "unresolved";
  else if (role.role === "ExternalInteractor") {
    disposition = "external";
    if (storedReason !== undefined && formatDfdValue(storedReason).trim()) {
      diagnostics.push("External Interactors cannot be out of scope; the stored reason is inactive.");
    }
  } else disposition = reason ? "outOfScope" : "inScope";
  return { role, disposition, storedReason, effectiveReason: disposition === "outOfScope" ? reason : "",
    includeInternals: disposition === "inScope" || disposition === "unresolved", diagnostics };
}

export function resolveFlowReviewScope(edge: PsEdge, doc: PsDocument, scenario: Scenario | null | undefined) {
  const sourceNode = doc.nodes.find(node => node.id === edge.source);
  const targetNode = doc.nodes.find(node => node.id === edge.target);
  const source = sourceNode ? resolveNodeReviewScope(sourceNode, scenario, doc.nodeTypes) : undefined;
  const target = targetNode ? resolveNodeReviewScope(targetNode, scenario, doc.nodeTypes) : undefined;
  const diagnostics = [...(source?.diagnostics ?? []), ...(target?.diagnostics ?? [])];
  let disposition: "included" | "excluded" | "invalid" | "noScenario";
  if (!scenario) disposition = "noScenario";
  else if (!scenario.edgeIds.includes(edge.id) || !source || !target
      || source.disposition === "notMember" || target.disposition === "notMember") {
    disposition = "invalid";
    diagnostics.push("Flow or endpoint is missing from the scenario; this is a structural problem, not an exclusion.");
  } else disposition =
    (source.disposition === "external" && target.disposition === "outOfScope")
    || (target.disposition === "external" && source.disposition === "outOfScope") ? "excluded" : "included";
  return { disposition, source, target, diagnostics };
}

export function nodeDfdSummary(node: PsNode, doc: PsDocument, scenario?: Scenario | null): string {
  const scope = resolveNodeReviewScope(node, scenario, doc.nodeTypes);
  const prefix = `${DFD_ROLE_LABELS[scope.role.role]} (${scope.role.source})`;
  if (scenario) return `${prefix} - ${DFD_SCOPE_LABELS[scope.disposition]}${scope.effectiveReason ? `: ${scope.effectiveReason}` : ""}`;
  const memberships = doc.scenarios.filter(item => item.nodeIds.includes(node.id));
  return `${prefix} - ${memberships.length ? memberships.map(item => {
    const result = resolveNodeReviewScope(node, item, doc.nodeTypes);
    return `${item.name}: ${DFD_SCOPE_LABELS[result.disposition]}`;
  }).join("; ") : "No scenario membership"}`;
}

export function flowDfdSummary(edge: PsEdge, doc: PsDocument, scenario?: Scenario | null): string {
  const endpoint = (id: string) => {
    const node = doc.nodes.find(item => item.id === id);
    return node ? nodeDfdSummary(node, doc, scenario) : "Missing endpoint";
  };
  const result = resolveFlowReviewScope(edge, doc, scenario);
  return `${endpoint(edge.source)} -> ${endpoint(edge.target)}. LLM flow: ${result.disposition}. Fixed checks unchanged.`;
}
