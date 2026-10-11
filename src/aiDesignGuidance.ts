import { resolveNodeTypeDef, type NodeTypeRef, type PsDocument } from "./types";
import {
  validateAiDesignGuidance, validateAiGuidanceContext,
  type AiDesignGuidance, type AiGuidanceContextEntry, type AiGuidanceReference,
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

export function guidanceReferencesForFinding(
  context: {
    aiDesignGuidance?: AiGuidanceContextEntry[];
    edges?: readonly { id: string; source: string; target: string }[];
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
  return (context.aiDesignGuidance ?? []).filter(entry => entry.appliesToNodeIds.some(id => nodeIds.has(id)))
    .map(({ content, appliesToNodeIds, ...reference }) => reference);
}

export function formatGuidanceReferences(references: readonly AiGuidanceReference[] | undefined): string {
  if (!references?.length) return "";
  return "\n\nAI design guidance supplied as unverified reference context (not deployment evidence):\n"
    + references.map(ref => `${ref.typeId} · revision ${ref.revision} · edited ${ref.updatedOn} · ${ref.definitionSource}`
      + (ref.sources.length ? `\nSources: ${ref.sources.join(", ")}` : "\nNo sources supplied.")).join("\n");
}
