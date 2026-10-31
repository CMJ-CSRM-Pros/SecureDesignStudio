import { resolveNodeTypeDef, type NodeTypeRef, type PsDocument } from "./types";
import type { AuthTypeDef } from "./authentication";
import {
  AUTHENTICATION_GUIDANCE_ABSENT, AUTHENTICATION_GUIDANCE_UNRESOLVED,
  validateAiDesignGuidance, validateAiGuidanceContext,
  type AiDesignGuidance, type AiGuidanceContextEntry, type AiGuidanceReference,
  type AuthenticationGuidanceContextEntry, type AuthenticationGuidanceMissingEntry,
  type CommunicationGuidanceContextEntry,
} from "../shared/aiDesignGuidance";

export function effectiveGuidanceNodeTypes(saved: readonly NodeTypeRef[], available: readonly NodeTypeRef[]): NodeTypeRef[] {
  const types = new Map(available.map(type => [type.id, type]));
  for (const type of saved) if (type.definition) types.set(type.id, type);
  return [...types.values()];
}

export function resolveAiDesignGuidance(
  typeId: string, saved: readonly NodeTypeRef[], available: readonly NodeTypeRef[],
): AiGuidanceContextEntry | undefined {
  const definition = resolveNodeTypeDef(typeId, effectiveGuidanceNodeTypes(saved, available));
  const guidance = validateAiDesignGuidance(definition?.aiDesignGuidance);
  if (!guidance) return undefined;
  return {
    typeId,
    definitionSource: saved.some(type => type.id === typeId && type.definition) ? "saved"
      : available.some(type => type.id === typeId && type.definition) ? "available" : "core",
    ...guidance, sources: guidance.sources ?? [], appliesToNodeIds: [],
  };
}

export function buildAiGuidanceContext(
  doc: PsDocument, available: readonly NodeTypeRef[], typeIds: readonly string[],
  interiorNodes: readonly { id: string; type: string }[] = [],
): AiGuidanceContextEntry[] {
  const entries = [...new Set(typeIds)].flatMap(typeId => {
    const guidance = resolveAiDesignGuidance(typeId, doc.nodeTypes, available);
    return guidance ? [{ ...guidance, appliesToNodeIds: interiorNodes.filter(node => node.type === typeId).map(node => node.id) }] : [];
  });
  validateAiGuidanceContext(entries);
  return entries;
}

// Unlike the full catalog editor, this mutation must not normalize policies or
// propagate metadata defaults to instances merely because guidance was edited.
export function withNodeTypeGuidance(
  doc: PsDocument, available: readonly NodeTypeRef[], typeId: string, value: AiDesignGuidance | undefined,
): PsDocument {
  const guidance = validateAiDesignGuidance(value);
  const effective = resolveNodeTypeDef(typeId, effectiveGuidanceNodeTypes(doc.nodeTypes, available));
  if (!effective) throw new Error("Define the unavailable node type in Node Type Catalog before adding guidance.");
  const { id, label, ...definition } = effective;
  if (JSON.stringify(definition.aiDesignGuidance) === JSON.stringify(guidance)) return doc;
  const nextDefinition = { ...definition };
  if (guidance) nextDefinition.aiDesignGuidance = guidance;
  else delete nextDefinition.aiDesignGuidance;
  const next = { id, label, definition: nextDefinition };
  return { ...doc, nodeTypes: doc.nodeTypes.some(type => type.id === id)
    ? doc.nodeTypes.map(type => type.id === id ? next : type) : [...doc.nodeTypes, next] };
}

// Whole-definition, saved-first resolution: a saved definition without guidance
// never borrows library guidance, and unresolved placeholders have none.
export function resolveAuthenticationGuidanceDefinition(
  methodId: string, doc: Pick<PsDocument, "authenticationDefinitions">, available: readonly AuthTypeDef[],
): { definition: AuthTypeDef; definitionSource: "saved" | "available" } | undefined {
  const saved = doc.authenticationDefinitions?.find(definition => definition.id === methodId);
  const definition = saved ?? available.find(candidate => candidate.id === methodId);
  return definition && !definition.unresolved ? { definition, definitionSource: saved ? "saved" : "available" } : undefined;
}

// Binds method guidance to the supplied flows that use it (legacy multi-auth
// binds each method). Offered IDs add unbound design choices; callers must pass
// only offered, selectable methods. Validation and budgets remain the caller's.
export function buildAuthenticationGuidanceContext(
  doc: Pick<PsDocument, "authenticationDefinitions">, available: readonly AuthTypeDef[],
  edges: readonly { id: string; authenticationTypes?: readonly string[] }[],
  offered: readonly string[] = [],
): { authenticationGuidance: AuthenticationGuidanceContextEntry[]; authenticationGuidanceMissing: AuthenticationGuidanceMissingEntry[] } {
  const entries = new Map<string, AuthenticationGuidanceContextEntry>();
  const missing: AuthenticationGuidanceMissingEntry[] = [];
  const entry = (methodId: string, appliesToEdgeIds: string[]): AuthenticationGuidanceContextEntry | string => {
    const resolved = resolveAuthenticationGuidanceDefinition(methodId, doc, available);
    if (!resolved) return AUTHENTICATION_GUIDANCE_UNRESOLVED;
    const guidance = resolved.definition.aiDesignGuidance;
    if (!guidance) return AUTHENTICATION_GUIDANCE_ABSENT;
    return { methodId, definitionSource: resolved.definitionSource, content: guidance.content,
      sources: [...(guidance.sources ?? [])], revision: guidance.revision, updatedOn: guidance.updatedOn, appliesToEdgeIds };
  };
  for (const edge of edges) {
    for (const methodId of new Set(edge.authenticationTypes ?? [])) {
      const existing = entries.get(methodId);
      if (existing) {
        existing.appliesToEdgeIds.push(edge.id);
        continue;
      }
      const resolved = entry(methodId, [edge.id]);
      if (typeof resolved === "string") missing.push({ edgeId: edge.id, methodId, reason: resolved });
      else entries.set(methodId, resolved);
    }
  }
  for (const methodId of new Set(offered)) {
    if (entries.has(methodId)) continue;
    const resolved = entry(methodId, []);
    if (typeof resolved !== "string") entries.set(methodId, resolved);
  }
  return { authenticationGuidance: [...entries.values()], authenticationGuidanceMissing: missing };
}

export function guidanceReferencesForFinding(
  context: {
    aiDesignGuidance?: AiGuidanceContextEntry[];
    communicationGuidance?: CommunicationGuidanceContextEntry[];
    authenticationGuidance?: AuthenticationGuidanceContextEntry[];
    edges?: readonly { id: string; source: string; target: string; protocolId?: string }[];
    boundaries?: readonly { id: string; nodeIds: string[] }[];
  },
  references: readonly { kind: string; id: string }[],
): AiGuidanceReference[] {
  const nodeIds = new Set(references.filter(ref => ref.kind === "node").map(ref => ref.id));
  for (const ref of references) if (ref.kind === "edge") {
    const edge = context.edges?.find(edge => edge.id === ref.id);
    if (edge) { nodeIds.add(edge.source); nodeIds.add(edge.target); }
  }
  for (const ref of references) if (ref.kind === "boundary") {
    for (const id of context.boundaries?.find(boundary => boundary.id === ref.id)?.nodeIds ?? []) nodeIds.add(id);
  }
  // Each kind is projected from its own collection with explicit fields so an
  // entry cannot carry another kind's identifier into accepted provenance.
  const provenance = (entry: { definitionSource: AiGuidanceReference["definitionSource"]; revision: number; updatedOn: string; sources?: string[] }) => ({
    definitionSource: entry.definitionSource, revision: entry.revision, updatedOn: entry.updatedOn, sources: [...(entry.sources ?? [])],
  });
  const nodeReferences = (context.aiDesignGuidance ?? [])
    .filter(entry => entry.appliesToNodeIds.some(id => nodeIds.has(id)))
    .map(entry => ({ typeId: entry.typeId, ...provenance(entry) }));
  const edgeIds = new Set(references.filter(ref => ref.kind === "edge").map(ref => ref.id));
  const communicationReferences = (context.communicationGuidance ?? [])
    .filter(entry => entry.appliesToEdgeIds.some(id => edgeIds.has(id)))
    .map(entry => ({ typeId: entry.protocolId, protocolId: entry.protocolId, ...provenance(entry) }));
  const authenticationReferences = (context.authenticationGuidance ?? [])
    .filter(entry => entry.appliesToEdgeIds.some(id => edgeIds.has(id)))
    .map(entry => ({ typeId: entry.methodId, methodId: entry.methodId, ...provenance(entry) }));
  return [...nodeReferences, ...communicationReferences, ...authenticationReferences];
}

export function formatGuidanceReferences(references: readonly AiGuidanceReference[] | undefined): string {
  if (!references?.length) return "";
  return "\n\nAI design guidance supplied as unverified reference context (not deployment evidence):\n"
    + references.map(ref => `${ref.methodId ? `Authentication ${ref.methodId}` : ref.protocolId ? `Protocol ${ref.protocolId}` : ref.typeId} · revision ${ref.revision} · edited ${ref.updatedOn} · ${ref.definitionSource}`
      + (ref.sources.length ? `\nSources: ${ref.sources.join(", ")}` : "\nNo sources supplied.")).join("\n");
}
