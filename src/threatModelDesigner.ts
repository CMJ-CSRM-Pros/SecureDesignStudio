import { parseDesignResult } from "../shared/designContract";
import type { AuthTypeDef } from "./authentication";
import { withAuthenticationDefinitions } from "./authentication";
import { classificationDefinitionsForLibrary, isEnabledClassification, type ClassificationLibrary } from "./classificationLibrary";
import { allowedAuthMethodsForNode } from "./policy";
import { nodeRect, containsRect, boundaryRect, expandRectToContain, placeNodeOutsideBoundary, overlapRatio } from "./boundaryGeometry";
import { resolveDfdRole, resolveNodeReviewScope } from "./dfdSemantics";
import { buildAiGuidanceContext, effectiveGuidanceNodeTypes, resolveAiDesignGuidance } from "./aiDesignGuidance";
import { propagateScenarioEdgeData } from "./dataPropagation";
import { catalogDefinitionsFor, resolveNodeTypeDef, uid, type NodeTypeRef, type PsDocument, type PsNode, type Scenario } from "./types";

export interface DesignerCatalog {
  nodeTypes: readonly NodeTypeRef[];
  authentication: readonly AuthTypeDef[];
  classifications: ClassificationLibrary;
}

export interface DesignRequestSnapshot {
  scenarioId: string | null;
  documentKey: string;
  catalogKey: string;
  scope?: readonly string[];
  context: ReturnType<typeof buildDesignerContext>;
}

function selectedScenario(doc: PsDocument, scenarioId: string | null): Scenario | undefined {
  const scenario = doc.scenarios.find(item => item.id === scenarioId);
  if (!scenario && (scenarioId !== null || doc.scenarios.length > 0)) {
    throw new Error("Choose a scenario before designing with AI.");
  }
  return scenario;
}

// A planned scope narrows catalog entries and guidance to the selected types plus
// every type already used in the scenario; it never hides model content.
export function buildDesignerContext(
  doc: PsDocument, scenarioId: string | null, catalog: DesignerCatalog, scope?: readonly string[],
) {
  catalog = { ...catalog, nodeTypes: effectiveGuidanceNodeTypes(doc.nodeTypes, catalog.nodeTypes) };
  const scenario = selectedScenario(doc, scenarioId);
  const nodes = doc.nodes.filter(item => scenario?.nodeIds.includes(item.id));
  const available = catalog.nodeTypes.filter(type => resolveNodeTypeDef(type.id, catalog.nodeTypes));
  const scopeIds = scope ? new Set([...scope, ...nodes.map(node => node.type)]) : undefined;
  const offered = scopeIds ? available.filter(type => scopeIds.has(type.id)) : available;
  const edgesById = new Map(doc.edges.map(edge => [edge.id, edge]));
  const edges = (scenario?.edgeIds ?? []).flatMap(id => {
    const edge = edgesById.get(id);
    return edge ? [edge] : [];
  });
  const dataIds = new Set([
    ...Object.values(scenario?.edgeRequestData ?? {}).flat(),
    ...Object.values(scenario?.edgeResponseData ?? {}).flat(),
    ...Object.values(scenario?.nodeData ?? {}).flatMap(Object.keys),
  ]);
  const authentication = catalog.authentication.filter(method =>
    !method.disabled && !method.legacy && !method.unavailableReason && !method.unresolved);
  const sharedInOtherScenarios = (kind: "nodeIds" | "edgeIds" | "boundaryIds", id: string) =>
    doc.scenarios.some(other => other.id !== scenarioId && other[kind].includes(id));
  const context = {
    aiDesignGuidance: buildAiGuidanceContext(doc, catalog.nodeTypes,
      scopeIds ? catalog.nodeTypes.map(type => type.id).filter(id => scopeIds.has(id)) : catalog.nodeTypes.map(type => type.id),
      nodes.filter(node => resolveNodeReviewScope(node, scenario, catalog.nodeTypes).includeInternals)),
    scenario: scenario ? {
      id: scenario.id, name: scenario.name, description: scenario.description,
      nodeIds: scenario.nodeIds, edgeIds: scenario.edgeIds, boundaryIds: scenario.boundaryIds,
      edgeNumbers: scenario.edgeNumbers, edgeRequestData: scenario.edgeRequestData,
      edgeResponseData: scenario.edgeResponseData, nodeData: scenario.nodeData,
    } : null,
    flowOrder: (scenario?.edgeIds ?? []).map((id, index) => {
      const edge = edgesById.get(id);
      return { id, position: index + 1, number: scenario?.edgeNumbers[id] ?? null,
        source: edge?.source ?? null, target: edge?.target ?? null, title: edge?.title ?? null };
    }),
    editPolicy: {
      deletionScope: "global",
      routingScope: "global; new endpoints join every scenario using the redirected connection",
      dataAttachmentScope: "selected scenario",
      boundaryMembershipScope: "global",
      flowOrderScope: "selected scenario; explicit complete edgeOrder also renumbers 1..N",
    },
    nodes: nodes.map(node =>
      ({ id: node.id, title: node.title, type: node.type,
        ...(resolveNodeReviewScope(node, scenario, catalog.nodeTypes).includeInternals ? { description: node.description } : {}),
        reviewContext: resolveNodeReviewScope(node, scenario, catalog.nodeTypes).includeInternals ? "interior" : "endpoint-only",
        dfdRole: resolveDfdRole(node, catalog.nodeTypes).role,
        sharedInOtherScenarios: sharedInOtherScenarios("nodeIds", node.id) })),
    edges: edges.map(({ id, source, target, title, description, authenticationTypes, audience, requiredAccessRights }) =>
      ({ id, source, target, title, description, authenticationTypes, audience, requiredAccessRights,
        sharedInOtherScenarios: sharedInOtherScenarios("edgeIds", id) })),
    boundaries: doc.boundaries.filter(item => scenario?.boundaryIds.includes(item.id))
      .map(({ id, type, title, nodeIds }) => ({ id, type, title, nodeIds,
        sharedInOtherScenarios: sharedInOtherScenarios("boundaryIds", id) })),
    data: doc.data.filter(item => dataIds.has(item.id)).map(({ id, name, classification }) => ({ id, name, classification })),
    catalog: {
      unspecifiedNodeType: { id: "", label: "Unspecified component", description: "Use for people, browsers and generic components without a suitable catalog entry; set their DFD role separately." },
      nodeTypes: offered.map(type => {
        const definition = resolveNodeTypeDef(type.id, catalog.nodeTypes);
        return { id: type.id, label: type.label, description: definition?.description ?? "",
          defaultDfdRole: definition?.defaultDfdRole,
          allowedAuthenticationIds: allowedAuthMethodsForNode({
            id: "", type: type.id, title: "", description: "", serviceTreeId: "", endpointRegex: "", position: { x: 0, y: 0 },
          }, catalog.nodeTypes, authentication).filter(id => authentication.some(method => method.id === id)) };
      }),
      authentication: authentication.map(({ id, label, description }) => ({ id, label, description })),
      classifications: catalogDefinitionsFor("classification", doc.catalogDefinitions,
        classificationDefinitionsForLibrary(catalog.classifications))
        .filter(item => isEnabledClassification(catalog.classifications, item.id))
        .map(({ id, label, description }) => ({ id, label, description })),
    },
    ...(scopeIds ? { catalogScope: {
      nodeTypeIds: offered.map(type => type.id),
      availableNodeTypes: available.length,
      note: "Planned subset of the component library; omitted types were not selected for this request.",
    } } : {}),
  };
  return context;
}

// Compact planning projection: the full type index without descriptions or guidance.
export function buildDesignPlanContext(doc: PsDocument, scenarioId: string | null, catalog: DesignerCatalog) {
  catalog = { ...catalog, nodeTypes: effectiveGuidanceNodeTypes(doc.nodeTypes, catalog.nodeTypes) };
  const scenario = selectedScenario(doc, scenarioId);
  const guided = new Set(catalog.nodeTypes.map(type => type.id)
    .filter(id => resolveAiDesignGuidance(id, doc.nodeTypes, catalog.nodeTypes)));
  return {
    scenario: scenario ? { id: scenario.id, name: scenario.name, description: scenario.description } : null,
    nodes: doc.nodes.filter(item => scenario?.nodeIds.includes(item.id)).map(node =>
      ({ id: node.id, title: node.title, type: node.type, dfdRole: resolveDfdRole(node, catalog.nodeTypes).role })),
    edges: (scenario?.edgeIds ?? []).flatMap(id => doc.edges.filter(edge => edge.id === id))
      .map(({ id, source, target, title }) => ({ id, source, target, title })),
    boundaries: doc.boundaries.filter(item => scenario?.boundaryIds.includes(item.id))
      .map(({ id, type, title }) => ({ id, type, title })),
    nodeTypeIndex: catalog.nodeTypes.flatMap(type => {
      const definition = resolveNodeTypeDef(type.id, catalog.nodeTypes);
      return definition ? [{ id: type.id, label: type.label, category: definition.category ?? "",
        defaultDfdRole: definition.defaultDfdRole ?? "", hasGuidance: guided.has(type.id) }] : [];
    }),
  };
}

// Geometry measurements may arrive during inference; semantic edits must invalidate it.
export function designerDocumentKey(doc: PsDocument): string {
  return JSON.stringify({
    ...doc,
    nodes: doc.nodes.map(({ position, size, ...node }) => node),
    edges: doc.edges.map(({ waypoints, ...edge }) => edge),
    boundaries: doc.boundaries.map(({ position, size, ...boundary }) => boundary),
  });
}

export function describeDesignerChanges(before: PsDocument, after: PsDocument): string {
  const counts = { added: 0, updated: 0, deleted: 0, rerouted: 0 };
  for (const kind of ["nodes", "edges", "boundaries", "data"] as const) {
    const old = new Map(before[kind].map(item => [item.id, JSON.stringify(item)]));
    const current = new Set(after[kind].map(item => item.id));
    for (const item of after[kind]) {
      if (!old.has(item.id)) counts.added++;
      else if (old.get(item.id) !== JSON.stringify(item)) counts.updated++;
    }
    counts.deleted += before[kind].filter(item => !current.has(item.id)).length;
  }
  counts.rerouted = after.edges.filter(edge => before.edges.some(previous =>
    previous.id === edge.id && (previous.source !== edge.source || previous.target !== edge.target))).length;
  const scenarios = after.scenarios.filter(item =>
    JSON.stringify(before.scenarios.find(previous => previous.id === item.id)) !== JSON.stringify(item)).length;
  const reordered = after.scenarios.filter(item => {
    const previous = before.scenarios.find(candidate => candidate.id === item.id);
    return previous && (JSON.stringify(previous.edgeIds) !== JSON.stringify(item.edgeIds) ||
      JSON.stringify(previous.edgeNumbers) !== JSON.stringify(item.edgeNumbers));
  }).length;
  let privacyNodes = 0;
  for (const scenario of after.scenarios) {
    const previous = before.scenarios.find(item => item.id === scenario.id);
    for (const [nodeId, values] of Object.entries(scenario.nodeData)) {
      if (Object.keys(values).some(id => !Object.prototype.hasOwnProperty.call(previous?.nodeData[nodeId] ?? {}, id))) privacyNodes++;
    }
  }
  return `${counts.added} added, ${counts.updated} updated, ${counts.deleted} deleted; ${counts.rerouted} connections rerouted; ${scenarios} scenarios changed.` +
    (reordered ? ` Flow order or numbering updated in ${reordered} scenarios.` : "") +
    (privacyNodes ? ` Privacy data recorded on ${privacyNodes} receiving nodes; review retention in Properties > Privacy.` : "");
}

export function applyDesignerResult(
  doc: PsDocument, scenarioId: string | null, value: unknown, catalog: DesignerCatalog, scope?: readonly string[],
): { doc: PsDocument; scenarioId: string | null; warning?: string } {
  catalog = { ...catalog, nodeTypes: effectiveGuidanceNodeTypes(doc.nodeTypes, catalog.nodeTypes) };
  const scenario = selectedScenario(doc, scenarioId);
  const result = parseDesignResult(value, { existingScenario: Boolean(scenario) });
  const design = result.design;
  if (!design) return { doc, scenarioId };
  const name = design.scenario.name ?? scenario?.name;
  const description = design.scenario.description ?? scenario?.description;
  if (name === undefined || description === undefined) {
    throw new Error("AI design requires a scenario name and description. No changes were applied.");
  }
  const context = buildDesignerContext(doc, scenarioId, catalog, scope);
  const removal = design.remove ?? { nodeIds: [], edgeIds: [], boundaryIds: [] };
  const validateRemovals = (requested: string[], available: readonly { id: string }[]) => {
    for (const id of requested) {
      if (!available.some(item => item.id === id)) {
        throw new Error(`AI cannot delete an unknown element or one outside the selected scenario (${id}). No changes were applied.`);
      }
    }
    return new Set(requested);
  };
  const removedNodes = validateRemovals(removal.nodeIds, context.nodes);
  const removedEdges = validateRemovals(removal.edgeIds, context.edges);
  const removedBoundaries = validateRemovals(removal.boundaryIds, context.boundaries);
  const allIds = new Set([
    ...doc.nodes, ...doc.edges, ...doc.boundaries, ...doc.data, ...doc.scenarios,
    ...doc.comments, ...doc.issues, ...doc.workItems, ...doc.deviations, ...(doc.textAnnotations ?? []),
  ].map(item => item.id));
  const identifiers = (existing: readonly { id: string }[], changes: readonly { id: string }[], prefix: string) => {
    const map = new Map(existing.map(item => [item.id, item.id]));
    for (const item of changes) {
      if (map.has(item.id)) continue;
      if (allIds.has(item.id)) throw new Error("AI tried to edit an element outside the selected scenario. No changes were applied.");
      const permanentId = uid(prefix);
      if (allIds.has(permanentId)) throw new Error("Could not allocate a unique model identifier. Retry the request.");
      allIds.add(permanentId);
      map.set(item.id, permanentId);
    }
    return map;
  };
  const nodeIds = identifiers(context.nodes, design.nodes, "n");
  const edgeIds = identifiers(context.edges, design.edges, "e");
  const boundaryIds = identifiers(context.boundaries, design.boundaries, "b");
  const dataIds = identifiers(context.data, design.data, "d");
  for (const id of removedNodes) nodeIds.delete(id);
  for (const id of removedEdges) edgeIds.delete(id);
  for (const id of removedBoundaries) boundaryIds.delete(id);
  const reference = (map: Map<string, string>, id: string) => {
    const found = map.get(id);
    if (!found) throw new Error(`AI design references an unknown element (${id}). No changes were applied.`);
    return found;
  };
  const nodes = new Map(doc.nodes.filter(item => !removedNodes.has(item.id)).map(item => [item.id, item]));
  const edges = new Map(doc.edges.filter(item => !removedEdges.has(item.id)).map(item => [item.id, item]));
  const boundaries = new Map(doc.boundaries.filter(item => !removedBoundaries.has(item.id)).map(item => [
    item.id, item.nodeIds.some(id => removedNodes.has(id))
      ? { ...item, nodeIds: item.nodeIds.filter(id => !removedNodes.has(id)) } : item,
  ]));
  const data = new Map(doc.data.map(item => [item.id, item]));
  const types = new Map(doc.nodeTypes.map(item => [item.id, item]));
  const startY = Math.max(0, ...doc.nodes.map(node => node.position.y + nodeRect(node).size.height),
    ...doc.boundaries.map(boundary => boundary.position.y + boundary.size.height)) + 120;
  const rows = new Map<string, { row: number; count: number }>();
  for (const item of design.nodes) {
    const type = catalog.nodeTypes.find(type => type.id === item.type);
    if (item.type !== "" && (!type || !context.catalog.nodeTypes.some(entry => entry.id === type.id))) {
      throw new Error("AI selected an unavailable component type. No changes were applied.");
    }
    const id = reference(nodeIds, item.id);
    const previous = nodes.get(id);
    const enclosing = design.boundaries.filter(boundary => boundary.nodeIds.includes(item.id));
    const group = enclosing.map(boundary => boundary.id).sort().join("|");
    if (!rows.has(group)) rows.set(group, { row: rows.size, count: 0 });
    const row = rows.get(group)!;
    // New members align with the authored members, not an unrelated ingress actor.
    const anchors = doc.nodes.filter(node => !removedNodes.has(node.id) && enclosing.some(boundary =>
      boundary.nodeIds.includes(node.id) || (boundary.membershipMode !== "replace" &&
        boundaries.get(boundary.id)?.nodeIds.includes(node.id))));
    const startX = anchors.length ? Math.min(...anchors.map(node => node.position.x)) : 120;
    const position = previous?.position ?? { x: startX + row.count++ * 340, y: startY + row.row * 260 };
    const node: PsNode = {
      ...previous, id, title: item.title, description: item.description, type: item.type,
      dfdRoleOverride: item.dfdRole, dfdRoleLegacy: false, position,
      size: previous?.size ?? { width: 220, height: 100 },
      serviceTreeId: previous?.serviceTreeId ?? "", endpointRegex: previous?.endpointRegex ?? "",
    };
    if (previous && previous.type !== node.type) {
      delete node.geoBoundary;
      delete node.postSubscriptionRetention;
    }
    nodes.set(id, node);
    if (type) types.set(type.id, type);
  }
  for (const item of design.data) {
    if (!isEnabledClassification(catalog.classifications, item.classification)) {
      throw new Error("AI selected an unavailable classification. No changes were applied.");
    }
    const id = reference(dataIds, item.id);
    data.set(id, { ...data.get(id), id, name: item.name, classification: item.classification, sample: data.get(id)?.sample ?? "" });
  }
  const nextScenario: Scenario = scenario ? {
    ...scenario, name, description, nodeIds: [...scenario.nodeIds], edgeIds: [...scenario.edgeIds],
    edgeNumbers: { ...scenario.edgeNumbers }, boundaryIds: [...scenario.boundaryIds],
    edgeRequestData: { ...scenario.edgeRequestData }, edgeResponseData: { ...scenario.edgeResponseData },
  } : {
    id: uid("s"), name, description, nodeIds: [], edgeIds: [], boundaryIds: [], edgeNumbers: {},
    nodeData: {}, edgeRequestData: {}, edgeResponseData: {},
  };
  const newAssumptions = [...new Set(result.assumptions)].filter(assumption => !nextScenario.description.includes(assumption));
  if (newAssumptions.length) {
    nextScenario.description += `\n\nAI design assumptions (unverified):\n${newAssumptions.map(assumption => `- ${assumption}`).join("\n")}`;
  }
  const union = (left: string[], right: string[]) => [...new Set([...left, ...right])];
  nextScenario.nodeIds = union(nextScenario.nodeIds, design.nodes.map(item => reference(nodeIds, item.id)));
  let number = Math.max(0, ...Object.values(nextScenario.edgeNumbers));
  const reroutedEdges = new Set<string>();
  for (const item of design.edges) {
    const id = reference(edgeIds, item.id);
    const source = reference(nodeIds, item.source);
    const target = reference(nodeIds, item.target);
    if (source === target) throw new Error("AI design contains a self-referencing flow. No changes were applied.");
    const previous = edges.get(id);
    const redirected = previous !== undefined && (previous.source !== source || previous.target !== target);
    const authentication = item.authenticationType === null ? undefined
      : catalog.authentication.find(method => method.id === item.authenticationType);
    if (item.authenticationType !== null && (!authentication || authentication.disabled || authentication.legacy || authentication.unavailableReason || authentication.unresolved ||
        !allowedAuthMethodsForNode(nodes.get(target), [...types.values()], catalog.authentication).includes(authentication.id))) {
      throw new Error("AI selected authentication unavailable to the target component. No changes were applied.");
    }
    const edge = {
      ...previous, id, source, target, title: item.title, description: item.description,
      ...(authentication ? { authenticationTypes: [authentication.id] } : {}),
      waypoints: previous?.waypoints ?? [],
    };
    if (redirected) {
      reroutedEdges.add(id);
      edge.waypoints = [];
      delete edge.sourceHandle;
      delete edge.targetHandle;
      if (!authentication) delete edge.authenticationTypes;
      if (previous.source !== source) delete edge.productionIdentity;
      if (previous.target !== target) {
        delete edge.audience;
        delete edge.constraints;
        delete edge.requiredAccessRights;
      }
    }
    edges.set(id, edge);
    if (!nextScenario.edgeIds.includes(id)) {
      nextScenario.edgeIds.push(id);
      nextScenario.edgeNumbers[id] = ++number;
    }
    const requests = item.requestDataIds.map(id => reference(dataIds, id));
    const responses = item.responseDataIds.map(id => reference(dataIds, id));
    nextScenario.edgeRequestData[id] = item.dataMode === "replace" ? requests : union(nextScenario.edgeRequestData[id] ?? [], requests);
    nextScenario.edgeResponseData[id] = item.dataMode === "replace" ? responses : union(nextScenario.edgeResponseData[id] ?? [], responses);
  }
  // Rerouting may save an incident edge from a component deletion in this batch.
  for (const edge of edges.values()) {
    if (removedNodes.has(edge.source) || removedNodes.has(edge.target)) {
      removedEdges.add(edge.id);
      edges.delete(edge.id);
    }
  }
  for (const node of nodes.values()) {
    if (!doc.nodes.some(previous => previous.id === node.id && previous.type !== node.type)) continue;
    const allowed = allowedAuthMethodsForNode(node, [...types.values()], catalog.authentication);
    if ([...edges.values()].some(edge => edge.target === node.id && edge.authenticationTypes?.some(id => !allowed.includes(id)))) {
      throw new Error("The proposed component type conflicts with an existing incoming flow's authentication. No changes were applied.");
    }
  }
  const excludedMembers = new Map<string, string[]>();
  for (const item of design.boundaries) {
    const id = reference(boundaryIds, item.id);
    const previous = boundaries.get(id);
    const requestedMembers = item.nodeIds.map(id => {
      // A shared boundary exposes its global member IDs even outside this scenario.
      if (previous?.nodeIds.includes(id) && nodes.has(id)) return id;
      return reference(nodeIds, id);
    });
    const members = item.membershipMode === "replace" ? requestedMembers : union(previous?.nodeIds ?? [], requestedMembers);
    if (!previous && !members.length) throw new Error("A new AI boundary must contain at least one node. No changes were applied.");
    const excluded = previous?.nodeIds.filter(id => !members.includes(id)) ?? [];
    if (excluded.length) excludedMembers.set(id, excluded);
    const memberNodes = members.map(id => {
      const node = nodes.get(id);
      if (!node) throw new Error("AI design boundary contains a missing node.");
      return node;
    });
    const x = Math.min(...memberNodes.map(node => node.position.x)) - 48;
    const y = Math.min(...memberNodes.map(node => node.position.y)) - 64;
    let rect = memberNodes.length ? {
      position: { x, y },
      size: {
        width: Math.max(...memberNodes.map(node => node.position.x + nodeRect(node).size.width)) - x + 48,
        height: Math.max(...memberNodes.map(node => node.position.y + nodeRect(node).size.height)) - y + 48,
      },
    } : { position: previous!.position, size: previous!.size };
    if (previous) {
      if (members.every(id => previous.nodeIds.includes(id))) {
        rect = { position: previous.position, size: previous.size };
      } else {
        const left = Math.min(rect.position.x, previous.position.x);
        const top = Math.min(rect.position.y, previous.position.y);
        rect = { position: { x: left, y: top }, size: {
          width: Math.max(rect.position.x + rect.size.width, previous.position.x + previous.size.width) - left,
          height: Math.max(rect.position.y + rect.size.height, previous.position.y + previous.size.height) - top,
        } };
      }
    }
    if ([...nodes.values()].some(node => !members.includes(node.id) && !excluded.includes(node.id) && containsRect(rect, nodeRect(node)))) {
      throw new Error("The proposed boundary would enclose unrelated nodes. Move those nodes apart or request a smaller boundary; no changes were applied.");
    }
    if (previous && previous.type !== item.type) throw new Error("Change existing boundary types in the editor; AI did not alter the model.");
    boundaries.set(id, { ...previous, id, title: item.title, type: item.type, nodeIds: members, ...rect });
    nextScenario.boundaryIds = union(nextScenario.boundaryIds, [id]);
  }
  for (const [boundaryId, excluded] of excludedMembers) {
    for (const nodeId of excluded) {
      const node = nodes.get(nodeId)!;
      const boundary = boundaries.get(boundaryId)!;
      if (overlapRatio(nodeRect(node), boundaryRect(boundary)) === 0) continue;
      const remaining = [...boundaries.values()].filter(item => item.nodeIds.includes(nodeId));
      const moved = { ...node, position: placeNodeOutsideBoundary(node, boundary, remaining) };
      nodes.set(nodeId, moved);
      for (const other of remaining) {
        boundaries.set(other.id, { ...other, ...expandRectToContain(boundaryRect(other), nodeRect(moved)) });
      }
    }
  }
  for (const [boundaryId, excluded] of excludedMembers) {
    const boundary = boundaries.get(boundaryId)!;
    if (excluded.some(id => overlapRatio(nodeRect(nodes.get(id)!), boundaryRect(boundary)) > 0)) {
      throw new Error("The requested boundary memberships conflict geometrically. No changes were applied.");
    }
  }
  for (const boundary of boundaries.values()) {
    const previousBoundary = doc.boundaries.find(item => item.id === boundary.id);
    for (const node of nodes.values()) {
      if (boundary.nodeIds.includes(node.id) || !containsRect(boundaryRect(boundary), nodeRect(node))) continue;
      const previousNode = doc.nodes.find(item => item.id === node.id);
      if (!previousBoundary || !previousNode || previousBoundary.nodeIds.includes(node.id) ||
          !containsRect(boundaryRect(previousBoundary), nodeRect(previousNode))) {
        throw new Error("The final boundary layout would enclose unrelated nodes. No changes were applied.");
      }
    }
  }
  const omitRemoved = <T,>(values: Record<string, T>, removed: Set<string>): Record<string, T> =>
    Object.fromEntries(Object.entries(values).filter(([id]) => !removed.has(id)));
  let scenarios = (scenario ? doc.scenarios.map(item => item.id === scenario.id ? nextScenario : item)
    : [...doc.scenarios, nextScenario]).map(item => {
    let nodeIds = item.nodeIds.filter(id => !removedNodes.has(id));
    const edgeIds = item.edgeIds.filter(id => !removedEdges.has(id));
    for (const id of edgeIds) {
      if (!reroutedEdges.has(id)) continue;
      const edge = edges.get(id)!;
      nodeIds = union(nodeIds, [edge.source, edge.target]);
    }
    return {
      ...item, nodeIds, edgeIds, boundaryIds: item.boundaryIds.filter(id => !removedBoundaries.has(id)),
      edgeNumbers: omitRemoved(item.edgeNumbers, removedEdges),
      edgeRequestData: omitRemoved(item.edgeRequestData, removedEdges),
      edgeResponseData: omitRemoved(item.edgeResponseData, removedEdges),
      nodeData: omitRemoved(item.nodeData, removedNodes),
      ...(item.nodeScopeReasons ? { nodeScopeReasons: omitRemoved(item.nodeScopeReasons, removedNodes) } : {}),
    };
  });
  const emptyOrderWithEdits = design.edgeOrder?.length === 0 &&
    (design.nodes.length > 0 || design.edges.length > 0 || design.boundaries.length > 0 ||
      design.data.length > 0 || removal.nodeIds.length > 0 || removal.edgeIds.length > 0 ||
      removal.boundaryIds.length > 0);
  const warning = emptyOrderWithEdits && scenarios.find(item => item.id === nextScenario.id)!.edgeIds.length > 0
    ? "AI returned an empty flow order. Existing flow order and numbers were preserved; new connections were appended. Review the sequence."
    : undefined;
  if (design.edgeOrder != null && !warning) {
    const orderedIds = design.edgeOrder.map(id => reference(edgeIds, id));
    const target = scenarios.find(item => item.id === nextScenario.id)!;
    const surviving = new Set(target.edgeIds);
    if (orderedIds.length !== surviving.size || new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some(id => !surviving.has(id))) {
      throw new Error("AI flow order must include every remaining connection in the selected scenario exactly once. No changes were applied.");
    }
    scenarios = scenarios.map(item => item.id !== target.id ? item : {
      ...item, edgeIds: orderedIds, edgeNumbers: Object.fromEntries(orderedIds.map((id, index) => [id, index + 1])),
    });
  }
  const editedEdges = new Set(design.edges.map(edge => reference(edgeIds, edge.id)));
  const incomingEdges = [...edges.values()].filter(edge => editedEdges.has(edge.id));
  if (incomingEdges.length) {
    scenarios = scenarios.map(item => item.id === nextScenario.id ? propagateScenarioEdgeData(item, incomingEdges) : item);
  }
  const targetRemoved = (item: { targetKind?: string; targetId?: string }) =>
    item.targetId !== undefined && (item.targetKind === "node" ? removedNodes.has(item.targetId)
      : item.targetKind === "edge" ? removedEdges.has(item.targetId) : false);
  const next = withAuthenticationDefinitions({
    ...doc, nodeTypes: [...types.values()], nodes: [...nodes.values()], edges: [...edges.values()],
    boundaries: [...boundaries.values()], data: [...data.values()],
    scenarios,
    comments: doc.comments.filter(item => !targetRemoved(item)),
    issues: doc.issues.filter(item => !targetRemoved(item)),
    // Preserve evidence-backed exceptions even when their model target is removed.
    deviations: doc.deviations.map(item => {
      if (!targetRemoved(item)) return item;
      const { targetKind, targetId, ...retained } = item;
      return retained;
    }),
  }, catalog.authentication);
  return { doc: JSON.stringify(next) === JSON.stringify(doc) ? doc : next, scenarioId: nextScenario.id,
    ...(warning ? { warning } : {}) };
}
