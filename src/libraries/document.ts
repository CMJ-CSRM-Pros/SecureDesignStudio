import type { PsDocument, PsNode, PsEdge, NodeTypeRef, CatalogDefinitionSnapshot } from "../types";
import { classificationDefinitionsForLibrary } from "../classificationLibrary";
import { withCatalogDefinitions } from "../catalogDefinitions";
import { withAuthenticationDefinitions, authenticationUnavailableReason, type AuthTypeDef } from "../authentication";
import type { LibraryRegistry, MetadataField } from "./contracts";

export function libraryNodeTypes(doc: PsDocument, registry: LibraryRegistry): NodeTypeRef[] {
  const result = new Map(doc.nodeTypes.map(type => [type.id, type]));
  for (const type of registry.nodes) {
    if (registry.provenance[`nodes/${type.id.toLowerCase()}`] !== "core") result.set(type.id, type);
  }
  for (const type of doc.nodeTypes) {
    if (type.definition || !result.has(type.id)) result.set(type.id, type);
  }
  return [...result.values()];
}

export function metadataFieldsFor(entity: PsNode | PsEdge, target: "node" | "edge", registry: LibraryRegistry): MetadataField[] {
  const result = new Map(registry.fields.filter(field => field.target === target).map(field => [field.id, field]));
  for (const field of entity.metadataFields ?? []) if (field.target === target) result.set(field.id, field);
  for (const id of Object.keys(entity.metadata ?? {})) {
    if (!result.has(id)) result.set(id, { id, label: `${id} (unresolved)`, target, storage: "metadata" });
  }
  return [...result.values()];
}

export function metadataValue(entity: PsNode | PsEdge, field: MetadataField): string {
  if (field.storage === "metadata") return entity.metadata?.[field.id] ?? "";
  if ("serviceTreeId" in entity && field.storage === "serviceTreeId") return entity.serviceTreeId;
  return "endpointRegex" in entity ? entity.endpointRegex : "";
}

export function withLibraryDefinitions(
  doc: PsDocument, registry: LibraryRegistry, profile: readonly AuthTypeDef[] = registry.authentication,
  classifications: readonly CatalogDefinitionSnapshot[] = classificationDefinitionsForLibrary(registry.classifications),
): PsDocument {
  if (!registry.statuses.some(status => status.state === "loaded")) return doc;
  let next = doc;
  const usedTypes = new Set(doc.nodes.map(node => node.type));
  const nodes = new Map(doc.nodeTypes.map(type => [type.id, type]));
  let changed = false;
  for (const type of registry.nodes) {
    if (registry.provenance[`nodes/${type.id.toLowerCase()}`] === "core"
        || !usedTypes.has(type.id) || nodes.get(type.id)?.definition) continue;
    nodes.set(type.id, { ...type, definition: type.definition ? { ...type.definition, catalogSource: "Document" } : undefined });
    changed = true;
  }
  if (changed) next = { ...next, nodeTypes: [...nodes.values()] };
  const captureFields = <T extends PsNode | PsEdge>(entity: T, target: "node" | "edge"): T => {
    if (!entity.metadata) return entity;
    const fields = metadataFieldsFor(entity, target, registry)
      .filter(field => field.storage === "metadata" && Object.hasOwn(entity.metadata!, field.id));
    if (JSON.stringify(fields) === JSON.stringify(entity.metadataFields ?? [])) return entity;
    return { ...entity, metadataFields: fields };
  };
  const nextNodes = next.nodes.map(node => captureFields(node, "node"));
  const nextEdges = next.edges.map(edge => captureFields(edge, "edge"));
  if (nextNodes.some((node, i) => node !== next.nodes[i]) || nextEdges.some((edge, i) => edge !== next.edges[i])) {
    next = { ...next, nodes: nextNodes, edges: nextEdges };
  }
  const optionalAuth = registry.authentication.filter(def =>
    registry.provenance[`authentication/${def.id.toLowerCase()}`] !== "core")
    .map(def => profile.find(item => item.id === def.id) ?? def)
    .filter(def => !authenticationUnavailableReason(def, registry.authentication));
  if (optionalAuth.length) {
    const captured = withAuthenticationDefinitions(next, optionalAuth);
    if (JSON.stringify(captured.authenticationDefinitions) !== JSON.stringify(next.authenticationDefinitions ?? [])) next = captured;
  }
  return withCatalogDefinitions(next, [...classifications, ...registry.taxonomy]);
}
