// Diff engine that compares a "previous" PsDocument against the current one
// and emits a flat list of human-readable change descriptions.
//
// Conventions:
//  - Entities are matched by id across versions. There is no fuzzy matching.
//  - Strictly positional fields (node.position, edge.waypoints, boundary
//    position/size) are intentionally ignored.
//  - When a parent entity is wholesale added/removed (a scenario, node, or
//    edge), child-level changes that fall under it are suppressed to keep
//    the change list signal-heavy.
//  - Auth methods and per-scenario edge-data attachments are compared with
//    set semantics; ordering differences don't count as changes.
//  - Ordinary comments/issues are excluded; explicit authored threat notes
//    are model facts and are compared independently of analyzer findings.

import {
  authTypeLabel,
  authenticationCatalogFor,
  sameAuthenticationDefinition,
  type AuthTypeDef,
  dataClassificationLabel,
  privacyBoundaryTypeLabel,
  securityBoundaryTypeLabel,
  BOUNDARY_NETWORK_FIELDS,
  formatBoundaryNetworkText,
  RETENTION_LABELS,
  canonicalGeoBoundary,
  canonicalPostSubscriptionRetention,
  canonicalProductionIdentity,
  formatGeoBoundary,
  formatPostSubscriptionRetention,
  formatProductionIdentity,
  formatRequiredAccessRights,
} from "./types";
import { catalogDefinitionKey } from "./catalogDefinitions";
import { formatDfdValue, resolveDfdRole } from "./dfdSemantics";
import { isAuthoredThreatNote } from "./threatNotes";
import type {
  AuthenticationType,
  CatalogDefinitionSnapshot,
  PsBoundary,
  PsData,
  PsDeviation,
  PsDocument,
  PsEdge,
  PsNode,
  PsWorkItem,
  Scenario,
} from "./types";

export type ChangeCategory =
  | "scenario"
  | "node"
  | "edge"
  | "boundary"
  | "data"
  | "deviation"
  | "workItem"
  | "nodeType"
  | "authentication"
  | "catalogDefinition"
  | "membership"
  | "attachment";

function metadataKey(entity: PsNode | PsEdge): string {
  return JSON.stringify({
    values: Object.entries(entity.metadata ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    fields: [...(entity.metadataFields ?? [])].sort((a, b) => a.id.localeCompare(b.id))
      .map(field => [field.id, field.target, field.storage, field.label, field.description, field.library?.id, field.library?.version]),
  });
}

export interface ChangeTarget {
  kind: "node" | "edge" | "boundary" | "scenario";
  id: string;
  // When the change is scoped to a specific scenario (e.g. data attachment
  // added in scenario X), navigating should also activate that scenario so
  // the user sees the relevant context.
  scenarioId?: string;
}

export interface ChangeItem {
  id: string;
  category: ChangeCategory;
  description: string;
  // Optional target for navigation. If omitted at diff time, the target is
  // gone in the current document. Clickability is also re-validated against
  // the current doc at render time (the doc may have changed since diff was
  // generated).
  target?: ChangeTarget;
  // Optional scenario context, used by edge-category rows so the panel can
  // display "[scenario] #N" prefixes, sort within edges by scenario then
  // edge sequence number, and navigate the user to that scenario when the
  // row is clicked.
  scenarioId?: string;
  scenarioName?: string;
  edgeNumber?: number;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `chg_${counter}_${Date.now().toString(36)}`;
}

// ---------- Label helpers ----------

function nodeLabel(n: PsNode | undefined, id: string): string {
  const t = n?.title?.trim();
  return t && t.length > 0 ? t : id;
}
function edgeLabel(e: PsEdge | undefined, id: string): string {
  const t = e?.title?.trim();
  return t && t.length > 0 ? t : "(untitled)";
}
function boundaryLabel(b: PsBoundary | undefined, id: string): string {
  const t = b?.title?.trim();
  return t && t.length > 0 ? t : `(${b?.type ?? "boundary"})`;
}
function scenarioLabel(s: Scenario | undefined, id: string): string {
  const t = s?.name?.trim();
  return t && t.length > 0 ? t : id;
}
function dataLabel(d: PsData | undefined, id: string): string {
  const t = d?.name?.trim();
  return t && t.length > 0 ? t : id;
}
function workItemLabel(w: PsWorkItem | undefined, id: string): string {
  const t = w?.description?.trim();
  return t && t.length > 0 ? t : id;
}
function deviationLabel(d: PsDeviation | undefined, id: string): string {
  const t = d?.title?.trim() || d?.key?.trim();
  return t && t.length > 0 ? t : id;
}

function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function authListLabel(list: AuthenticationType[] | undefined, catalog: readonly AuthTypeDef[]): string {
  if (!list || list.length === 0) return "(none)";
  return [...list]
    .map((a) => authTypeLabel(a, catalog))
    .sort()
    .join(", ");
}

function edgePath(
  e: PsEdge,
  srcMap: Map<string, PsNode>,
  tgtMap: Map<string, PsNode>
): string {
  const src = nodeLabel(srcMap.get(e.source), e.source);
  const tgt = nodeLabel(tgtMap.get(e.target), e.target);
  return `${src} → ${edgeLabel(e, e.id)} → ${tgt}`;
}

// ---------- Diff entry point ----------

export function diffDocuments(
  prev: PsDocument,
  curr: PsDocument,
  classificationDefinitions?: readonly CatalogDefinitionSnapshot[],
  inventoryLabel = "Inventory ID",
): ChangeItem[] {
  const changes: ChangeItem[] = [];
  const previousNotes = new Map(prev.issues.filter(isAuthoredThreatNote).map(note => [note.id, note]));
  const currentNotes = new Map(curr.issues.filter(isAuthoredThreatNote).map(note => [note.id, note]));
  for (const id of new Set([...previousNotes.keys(), ...currentNotes.keys()])) {
    const before = previousNotes.get(id), after = currentNotes.get(id);
    if (before && after && before.title === after.title && before.description === after.description &&
        (before.justification ?? "") === (after.justification ?? "") && before.status === after.status &&
        before.targetKind === after.targetKind && before.targetId === after.targetId &&
        sameSet(before.scenarioIds, after.scenarioIds)) continue;
    const note = after ?? before!;
    changes.push({ id: nextId(), category: note.targetKind,
      description: `${!before ? "Added" : !after ? "Removed" : "Changed"} authored threat note "${note.title || "(untitled)"}"`,
      ...(after ? { target: { kind: after.targetKind, id: after.targetId, scenarioId: after.scenarioIds[0] } } : {}),
    });
  }
  const previousDefinitions = new Map((prev.catalogDefinitions ?? []).map((def) => [catalogDefinitionKey(def), def]));
  const currentDefinitions = new Map((curr.catalogDefinitions ?? []).map((def) => [catalogDefinitionKey(def), def]));
  for (const key of new Set([...previousDefinitions.keys(), ...currentDefinitions.keys()])) {
    const before = previousDefinitions.get(key);
    const after = currentDefinitions.get(key);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const definition = after ?? before!;
      changes.push({
        id: nextId(), category: "catalogDefinition",
        description: `${!before ? "Added" : !after ? "Removed" : "Changed"} saved catalog definition "${definition.label}" (${definition.kind}: ${definition.id})`,
      });
    }
  }
  const previousAuth = authenticationCatalogFor(prev);
  const currentAuth = authenticationCatalogFor(curr);
  const previousAuthMap = new Map(previousAuth.map(def => [def.id, def]));
  const currentAuthMap = new Map(currentAuth.map(def => [def.id, def]));
  for (const id of new Set([...previousAuthMap.keys(), ...currentAuthMap.keys()])) {
    const before = previousAuthMap.get(id);
    const after = currentAuthMap.get(id);
    if (!before || !after || !sameAuthenticationDefinition(before, after)) {
      changes.push({
        id: nextId(), category: "authentication",
        description: `${!before ? "Added" : !after ? "Removed" : "Changed"} authentication definition "${after?.label ?? before?.label}" (${id})${before && after ? `: Method, Description, availability or explicit behavior metadata differs` : ""}`,
      });
    }
  }

  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const currNodes = new Map(curr.nodes.map((n) => [n.id, n]));
  const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
  const currEdges = new Map(curr.edges.map((e) => [e.id, e]));
  const prevBounds = new Map(prev.boundaries.map((b) => [b.id, b]));
  const currBounds = new Map(curr.boundaries.map((b) => [b.id, b]));
  const prevScenarios = new Map(prev.scenarios.map((s) => [s.id, s]));
  const currScenarios = new Map(curr.scenarios.map((s) => [s.id, s]));
  const prevData = new Map(prev.data.map((d) => [d.id, d]));
  const currData = new Map(curr.data.map((d) => [d.id, d]));
  const prevNodeTypes = new Map(prev.nodeTypes.map((type) => [type.id, type]));
  const currNodeTypes = new Map(curr.nodeTypes.map((type) => [type.id, type]));

  // Track wholesale add/remove so we can suppress cascading child changes.
  const newScenarioIds = new Set<string>();
  const removedScenarioIds = new Set<string>();
  const newNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  const newEdgeIds = new Set<string>();
  const removedEdgeIds = new Set<string>();
  const newBoundIds = new Set<string>();
  const removedBoundIds = new Set<string>();

  // ----- Document-local node type definitions -----
  for (const [id, type] of currNodeTypes) {
    const previous = prevNodeTypes.get(id);
    if (!previous) {
      if (type.definition) {
        changes.push({
          id: nextId(),
          category: "nodeType",
          description: `Added node type "${type.label}"`,
        });
      }
      continue;
    }
    if (
      previous.label !== type.label ||
      JSON.stringify(previous.definition) !== JSON.stringify(type.definition)
    ) {
      changes.push({
        id: nextId(),
        category: "nodeType",
        description: previous.definition
          ? `Updated node type "${type.label}"`
          : `Customized built-in node type "${type.label}"`,
      });
    }
  }
  for (const [id, type] of prevNodeTypes) {
    const current = currNodeTypes.get(id);
    if (type.definition && !current?.definition) {
      changes.push({
        id: nextId(),
        category: "nodeType",
        description: current
          ? `Reset node type "${current.label}" to its built-in definition`
          : `Removed node type "${type.label}"`,
      });
    }
  }

  // ----- Scenarios -----
  for (const [id, s] of currScenarios) {
    if (!prevScenarios.has(id)) {
      newScenarioIds.add(id);
      changes.push({
        id: nextId(),
        category: "scenario",
        description: `Created scenario "${scenarioLabel(s, id)}"`,
        target: { kind: "scenario", id },
      });
    } else {
      const ps = prevScenarios.get(id)!;
      for (const nodeId of new Set([...Object.keys(ps.nodeScopeReasons ?? {}), ...Object.keys(s.nodeScopeReasons ?? {})])) {
        if (JSON.stringify(ps.nodeScopeReasons?.[nodeId]) !== JSON.stringify(s.nodeScopeReasons?.[nodeId])) {
          changes.push({ id: nextId(), category: "scenario", scenarioId: id, scenarioName: s.name,
            description: `Changed scope reason for "${nodeLabel(currNodes.get(nodeId), nodeId)}" in "${s.name}" from "${formatDfdValue(ps.nodeScopeReasons?.[nodeId]) || "(blank)"}" to "${formatDfdValue(s.nodeScopeReasons?.[nodeId]) || "(blank)"}"`,
            target: currNodes.has(nodeId) ? { kind: "node", id: nodeId, scenarioId: id } : { kind: "scenario", id } });
        }
      }
      if (JSON.stringify(ps.nodeScopeReasonsRecovery) !== JSON.stringify(s.nodeScopeReasonsRecovery)) {
        changes.push({ id: nextId(), category: "scenario",
          description: `Changed recovered scope input in "${s.name}"`, target: { kind: "scenario", id } });
      }
      if ((ps.name ?? "") !== (s.name ?? "")) {
        changes.push({
          id: nextId(),
          category: "scenario",
          description: `Renamed scenario "${scenarioLabel(ps, id)}" → "${scenarioLabel(s, id)}"`,
          target: { kind: "scenario", id },
        });
      }
      if ((ps.description ?? "") !== (s.description ?? "")) {
        changes.push({
          id: nextId(),
          category: "scenario",
          description: `Updated description on scenario "${scenarioLabel(s, id)}"`,
          target: { kind: "scenario", id },
        });
      }
    }
  }
  for (const [id, s] of prevScenarios) {
    if (!currScenarios.has(id)) {
      removedScenarioIds.add(id);
      changes.push({
        id: nextId(),
        category: "scenario",
        description: `Removed scenario "${scenarioLabel(s, id)}"`,
      });
    }
  }

  // ----- Nodes -----
  for (const [id, n] of currNodes) {
    if (!prevNodes.has(id)) {
      newNodeIds.add(id);
      changes.push({
        id: nextId(),
        category: "node",
        description: `Added node "${nodeLabel(n, id)}"`,
        target: { kind: "node", id },
      });
    } else {
      const pn = prevNodes.get(id)!;
      const beforeRole = resolveDfdRole(pn, prev.nodeTypes);
      const afterRole = resolveDfdRole(n, curr.nodeTypes);
      if (JSON.stringify([pn.dfdRoleOverride, pn.dfdRoleLegacy, beforeRole])
          !== JSON.stringify([n.dfdRoleOverride, n.dfdRoleLegacy, afterRole])) {
        changes.push({ id: nextId(), category: "node",
          description: `Changed DFD role of "${nodeLabel(n, id)}": ${beforeRole.role} (${beforeRole.source}) -> ${afterRole.role} (${afterRole.source})`,
          target: { kind: "node", id } });
      }
      if (metadataKey(pn) !== metadataKey(n)) {
        changes.push({ id: nextId(), category: "node",
          description: `Changed custom metadata on node "${nodeLabel(n, id)}"`, target: { kind: "node", id } });
      }
      if ((pn.title ?? "") !== (n.title ?? "")) {
        changes.push({
          id: nextId(),
          category: "node",
          description: `Renamed node "${nodeLabel(pn, id)}" → "${nodeLabel(n, id)}"`,
          target: { kind: "node", id },
        });
      }
      if ((pn.type ?? "") !== (n.type ?? "")) {
        changes.push({
          id: nextId(),
          category: "node",
          description: `Changed type of node "${nodeLabel(n, id)}" from "${pn.type || "(unset)"}" to "${n.type || "(unset)"}"`,
          target: { kind: "node", id },
        });
      }
      if ((pn.serviceTreeId ?? "") !== (n.serviceTreeId ?? "")) {
        changes.push({
          id: nextId(),
          category: "node",
          description: `Changed ${inventoryLabel} of node "${nodeLabel(n, id)}" from "${pn.serviceTreeId || "(unset)"}" to "${n.serviceTreeId || "(unset)"}"`,
          target: { kind: "node", id },
        });
      }
      if ((pn.endpointRegex ?? "") !== (n.endpointRegex ?? "")) {
        changes.push({
          id: nextId(),
          category: "node",
          description: `Changed EndpointRegex of node "${nodeLabel(n, id)}" from "${pn.endpointRegex || "(unset)"}" to "${n.endpointRegex || "(unset)"}"`,
          target: { kind: "node", id },
        });
      }
      if ((pn.description ?? "") !== (n.description ?? "")) {
        changes.push({
          id: nextId(),
          category: "node",
          description: `Updated description on node "${nodeLabel(n, id)}"`,
          target: { kind: "node", id },
        });
      }
      // Geo-boundary instance override. We label these as "override" changes
      // explicitly to disambiguate them from the type-level value (which
      // isn't part of the diff — type catalogs are code-defined).
      {
        const prevCanon = canonicalGeoBoundary(pn.geoBoundary);
        const currCanon = canonicalGeoBoundary(n.geoBoundary);
        if (prevCanon !== currCanon) {
          let desc: string;
          if (!pn.geoBoundary && n.geoBoundary) {
            desc = `Set geo boundary override on node "${nodeLabel(n, id)}" to "${formatGeoBoundary(n.geoBoundary)}"`;
          } else if (pn.geoBoundary && !n.geoBoundary) {
            desc = `Cleared geo boundary override on node "${nodeLabel(n, id)}" (was "${formatGeoBoundary(pn.geoBoundary)}")`;
          } else {
            desc = `Changed geo boundary override on node "${nodeLabel(n, id)}" from "${formatGeoBoundary(pn.geoBoundary)}" to "${formatGeoBoundary(n.geoBoundary)}"`;
          }
          changes.push({
            id: nextId(),
            category: "node",
            description: desc,
            target: { kind: "node", id },
          });
        }
      }
      // Post-subscription retention instance override. Same labeling pattern.
      {
        const prevCanon = canonicalPostSubscriptionRetention(
          pn.postSubscriptionRetention
        );
        const currCanon = canonicalPostSubscriptionRetention(
          n.postSubscriptionRetention
        );
        if (prevCanon !== currCanon) {
          let desc: string;
          if (!pn.postSubscriptionRetention && n.postSubscriptionRetention) {
            desc = `Set post-subscription retention override on node "${nodeLabel(n, id)}" to "${formatPostSubscriptionRetention(n.postSubscriptionRetention)}"`;
          } else if (pn.postSubscriptionRetention && !n.postSubscriptionRetention) {
            desc = `Cleared post-subscription retention override on node "${nodeLabel(n, id)}" (was "${formatPostSubscriptionRetention(pn.postSubscriptionRetention)}")`;
          } else {
            desc = `Changed post-subscription retention override on node "${nodeLabel(n, id)}" from "${formatPostSubscriptionRetention(pn.postSubscriptionRetention)}" to "${formatPostSubscriptionRetention(n.postSubscriptionRetention)}"`;
          }
          changes.push({
            id: nextId(),
            category: "node",
            description: desc,
            target: { kind: "node", id },
          });
        }
      }
      // position intentionally ignored
    }
  }
  for (const [id, n] of prevNodes) {
    if (!currNodes.has(id)) {
      removedNodeIds.add(id);
      changes.push({
        id: nextId(),
        category: "node",
        description: `Removed node "${nodeLabel(n, id)}"`,
      });
    }
  }

  // ----- Edges -----
  // For each edge, resolve a "primary" scenario context: the first scenario
  // in document order that contains the edge. Used to tag edge-category
  // change items with scenarioName + edgeNumber so the panel can group by
  // scenario and order numerically within each scenario.
  const edgePrimaryScenario = new Map<
    string,
    { scenarioId: string; scenarioName: string; edgeNumber?: number }
  >();
  for (const s of curr.scenarios) {
    for (const eid of s.edgeIds) {
      if (edgePrimaryScenario.has(eid)) continue;
      edgePrimaryScenario.set(eid, {
        scenarioId: s.id,
        scenarioName: s.name,
        edgeNumber: s.edgeNumbers?.[eid],
      });
    }
  }
  // Fall back to previous-doc scenarios for edges that no longer exist in
  // the current doc (e.g. removed-edge rows).
  for (const s of prev.scenarios) {
    for (const eid of s.edgeIds) {
      if (edgePrimaryScenario.has(eid)) continue;
      edgePrimaryScenario.set(eid, {
        scenarioId: s.id,
        scenarioName: s.name,
        edgeNumber: s.edgeNumbers?.[eid],
      });
    }
  }
  const tagEdge = (
    item: Omit<ChangeItem, "id"> & { id?: string },
    edgeId: string,
  ): ChangeItem => {
    const ctx = edgePrimaryScenario.get(edgeId);
    return {
      ...item,
      id: item.id ?? nextId(),
      scenarioId: ctx?.scenarioId,
      scenarioName: ctx?.scenarioName,
      edgeNumber: ctx?.edgeNumber,
    };
  };

  for (const [id, e] of currEdges) {
    if (!prevEdges.has(id)) {
      newEdgeIds.add(id);
      changes.push(
        tagEdge(
          {
            category: "edge",
            description: `Added edge ${edgePath(e, currNodes, currNodes)}`,
            target: { kind: "edge", id },
          },
          id,
        ),
      );
    } else {
      const pe = prevEdges.get(id)!;
      const pAuth = pe.authenticationTypes ?? [];
      const cAuth = e.authenticationTypes ?? [];
      if (!sameSet(pAuth, cAuth)) {
        changes.push(
          tagEdge(
            {
              category: "edge",
              description: `Changed auth type from ${edgePath(e, currNodes, currNodes)} from [${authListLabel(pAuth, previousAuth)}] to [${authListLabel(cAuth, currentAuth)}]`,
              target: { kind: "edge", id },
            },
            id,
          ),
        );
      }
      if ((pe.title ?? "") !== (e.title ?? "")) {
        changes.push(
          tagEdge(
            {
              category: "edge",
              description: `Renamed edge "${edgeLabel(pe, id)}" → "${edgeLabel(e, id)}"`,
              target: { kind: "edge", id },
            },
            id,
          ),
        );
      }
      if (pe.source !== e.source || pe.target !== e.target) {
        changes.push(
          tagEdge(
            {
              category: "edge",
              description: `Changed endpoints of edge "${edgeLabel(e, id)}" from ${nodeLabel(prevNodes.get(pe.source), pe.source)} → ${nodeLabel(prevNodes.get(pe.target), pe.target)} to ${nodeLabel(currNodes.get(e.source), e.source)} → ${nodeLabel(currNodes.get(e.target), e.target)}`,
              target: { kind: "edge", id },
            },
            id,
          ),
        );
      }
      if ((pe.audience ?? "") !== (e.audience ?? "")) {
        changes.push(
          tagEdge(
            {
              category: "edge",
              description: `Updated audience on edge ${edgePath(e, currNodes, currNodes)}`,
              target: { kind: "edge", id },
            },
            id,
          ),
        );
      }
      if ((pe.constraints ?? "") !== (e.constraints ?? "")) {
        changes.push(
          tagEdge(
            {
              category: "edge",
              description: `Updated constraints on edge ${edgePath(e, currNodes, currNodes)}`,
              target: { kind: "edge", id },
            },
            id,
          ),
        );
      }
      if (formatRequiredAccessRights(pe.requiredAccessRights) !== formatRequiredAccessRights(e.requiredAccessRights)) {
        changes.push(tagEdge({
          category: "edge",
          description: `Updated required access rights on edge ${edgePath(e, currNodes, currNodes)}`,
          target: { kind: "edge", id },
        }, id));
      }
      if ((pe.problem === true) !== (e.problem === true)) {
        changes.push(
          tagEdge(
            {
              category: "edge",
              description: e.problem
                ? `Marked edge ${edgePath(e, currNodes, currNodes)} as a problem flow`
                : `Cleared problem flag on edge ${edgePath(e, currNodes, currNodes)}`,
              target: { kind: "edge", id },
            },
            id,
          ),
        );
      }
      if ((pe.description ?? "") !== (e.description ?? "")) {
        changes.push(
          tagEdge(
            {
              category: "edge",
              description: `Updated description on edge ${edgePath(e, currNodes, currNodes)}`,
              target: { kind: "edge", id },
            },
            id,
          ),
        );
      }
      if (metadataKey(pe) !== metadataKey(e)) {
        changes.push(tagEdge({ category: "edge",
          description: `Changed custom metadata on edge ${edgePath(e, currNodes, currNodes)}`,
          target: { kind: "edge", id } }, id));
      }
      // Production identity: single combined change record per edge so the
      // diff stays readable. Uses a canonical key (trimmed/lowercased for
      // GUIDs) so whitespace-only edits don't show up as changes.
      {
        const pCanon = canonicalProductionIdentity(pe.productionIdentity);
        const cCanon = canonicalProductionIdentity(e.productionIdentity);
        if (pCanon !== cCanon) {
          const ePath = edgePath(e, currNodes, currNodes);
          let desc: string;
          if (!pe.productionIdentity && e.productionIdentity) {
            desc = `Set production identity on edge ${ePath} to ${formatProductionIdentity(e.productionIdentity, curr.catalogDefinitions)}`;
          } else if (pe.productionIdentity && !e.productionIdentity) {
            desc = `Cleared production identity on edge ${ePath} (was ${formatProductionIdentity(pe.productionIdentity, prev.catalogDefinitions)})`;
          } else {
            desc = `Changed production identity on edge ${ePath} from ${formatProductionIdentity(pe.productionIdentity!, prev.catalogDefinitions)} to ${formatProductionIdentity(e.productionIdentity!, curr.catalogDefinitions)}`;
          }
          changes.push(
            tagEdge(
              {
                category: "edge",
                description: desc,
                target: { kind: "edge", id },
              },
              id,
            ),
          );
        }
      }
      // waypoints intentionally ignored (positional)
    }
  }
  for (const [id, e] of prevEdges) {
    if (!currEdges.has(id)) {
      removedEdgeIds.add(id);
      changes.push(
        tagEdge(
          {
            category: "edge",
            description: `Removed edge ${edgePath(e, prevNodes, prevNodes)}`,
          },
          id,
        ),
      );
    }
  }

  // ----- Boundaries -----
  for (const [id, b] of currBounds) {
    if (!prevBounds.has(id)) {
      newBoundIds.add(id);
      changes.push({
        id: nextId(),
        category: "boundary",
        description: `Added ${b.type} boundary "${boundaryLabel(b, id)}"`,
        target: { kind: "boundary", id },
      });
    } else {
      const pb = prevBounds.get(id)!;
      if (pb.type !== b.type) {
        changes.push({
          id: nextId(),
          category: "boundary",
          description: `Changed boundary "${boundaryLabel(b, id)}" type from "${pb.type}" to "${b.type}"`,
          target: { kind: "boundary", id },
        });
      }
      if ((pb.privacySubtype ?? "") !== (b.privacySubtype ?? "")) {
        const pl = pb.privacySubtype
          ? privacyBoundaryTypeLabel(pb.privacySubtype, prev.catalogDefinitions, classificationDefinitions)
          : "(unspecified)";
        const cl = b.privacySubtype
          ? privacyBoundaryTypeLabel(b.privacySubtype, curr.catalogDefinitions, classificationDefinitions)
          : "(unspecified)";
        changes.push({
          id: nextId(),
          category: "boundary",
          description: `Changed privacy subtype on boundary "${boundaryLabel(b, id)}" from "${pl}" to "${cl}"`,
          target: { kind: "boundary", id },
        });
      }
      if ((pb.securitySubtype ?? "") !== (b.securitySubtype ?? "")) {
        const pl = pb.securitySubtype
          ? securityBoundaryTypeLabel(pb.securitySubtype, prev.catalogDefinitions, classificationDefinitions)
          : "(unspecified)";
        const cl = b.securitySubtype
          ? securityBoundaryTypeLabel(b.securitySubtype, curr.catalogDefinitions, classificationDefinitions)
          : "(unspecified)";
        changes.push({
          id: nextId(),
          category: "boundary",
          description: `Changed security subtype on boundary "${boundaryLabel(b, id)}" from "${pl}" to "${cl}"`,
          target: { kind: "boundary", id },
        });
      }
      if ((pb.title ?? "") !== (b.title ?? "")) {
        changes.push({
          id: nextId(),
          category: "boundary",
          description: `Renamed boundary "${boundaryLabel(pb, id)}" → "${boundaryLabel(b, id)}"`,
          target: { kind: "boundary", id },
        });
      }
      for (const { key, label } of BOUNDARY_NETWORK_FIELDS) {
        const previous = formatBoundaryNetworkText(pb[key]);
        const current = formatBoundaryNetworkText(b[key]);
        if (previous === current) continue;
        changes.push({
          id: nextId(),
          category: "boundary",
          description: `Changed ${label} on boundary "${boundaryLabel(b, id)}"${b.type === "privacy" ? " (retained, inactive)" : ""} from "${previous || "Undocumented"}" to "${current || "Undocumented"}"`,
          target: { kind: "boundary", id, scenarioId: curr.scenarios.find(s => s.boundaryIds.includes(id))?.id },
        });
      }
      const previousNodeIds = new Set(pb.nodeIds ?? []);
      const currentNodeIds = new Set(b.nodeIds ?? []);
      for (const nodeId of currentNodeIds) {
        if (previousNodeIds.has(nodeId)) continue;
        changes.push({
          id: nextId(),
          category: "boundary",
          description: `Added node "${nodeLabel(currNodes.get(nodeId), nodeId)}" to boundary "${boundaryLabel(b, id)}"`,
          target: { kind: "boundary", id },
        });
      }
      for (const nodeId of previousNodeIds) {
        if (currentNodeIds.has(nodeId)) continue;
        changes.push({
          id: nextId(),
          category: "boundary",
          description: `Removed node "${nodeLabel(prevNodes.get(nodeId), nodeId)}" from boundary "${boundaryLabel(b, id)}"`,
          target: { kind: "boundary", id },
        });
      }
      // position / size intentionally ignored
    }
  }
  for (const [id, b] of prevBounds) {
    if (!currBounds.has(id)) {
      removedBoundIds.add(id);
      changes.push({
        id: nextId(),
        category: "boundary",
        description: `Removed ${b.type} boundary "${boundaryLabel(b, id)}"`,
      });
    }
  }

  // ----- Data items (global catalog) -----
  for (const [id, d] of currData) {
    if (!prevData.has(id)) {
      changes.push({
        id: nextId(),
        category: "data",
        description: `Created data item "${dataLabel(d, id)}" (${dataClassificationLabel(d.classification, curr.catalogDefinitions, classificationDefinitions)})`,
      });
    } else {
      const pd = prevData.get(id)!;
      if (pd.name !== d.name) {
        changes.push({
          id: nextId(),
          category: "data",
          description: `Renamed data item "${dataLabel(pd, id)}" → "${dataLabel(d, id)}"`,
        });
      }
      if (pd.classification !== d.classification) {
        const pl = dataClassificationLabel(pd.classification, prev.catalogDefinitions, classificationDefinitions);
        const cl = dataClassificationLabel(d.classification, curr.catalogDefinitions, classificationDefinitions);
        changes.push({
          id: nextId(),
          category: "data",
          description: `Changed classification of data "${dataLabel(d, id)}" from "${pl}" to "${cl}"`,
        });
      }
      // sample intentionally ignored (free-form example string)
    }
  }
  for (const [id, d] of prevData) {
    if (!currData.has(id)) {
      changes.push({
        id: nextId(),
        category: "data",
        description: `Removed data item "${dataLabel(d, id)}"`,
      });
    }
  }

  // ----- Deviations (global review state) -----
  const prevDeviations = new Map((prev.deviations ?? []).map((d) => [d.id, d]));
  const currDeviations = new Map((curr.deviations ?? []).map((d) => [d.id, d]));
  const comparableDeviation = (d: PsDeviation) => ({
    key: d.key,
    kind: d.kind,
    title: d.title,
    description: d.description,
    explanation: d.explanation,
    status: d.status,
    evidenceIds: [...d.evidenceIds].sort(),
    sampleCalls: d.sampleCalls ?? [],
    targetKind: d.targetKind,
    targetId: d.targetId,
    scenarioIds: [...d.scenarioIds].sort(),
  });
  for (const [id, d] of currDeviations) {
    const previous = prevDeviations.get(id);
    if (!previous) {
      changes.push({
        id: nextId(),
        category: "deviation",
        description: `Created deviation "${deviationLabel(d, id)}"`,
      });
    } else if (
      JSON.stringify(comparableDeviation(previous)) !==
      JSON.stringify(comparableDeviation(d))
    ) {
      changes.push({
        id: nextId(),
        category: "deviation",
        description: `Changed deviation "${deviationLabel(d, id)}"`,
      });
    }
  }
  for (const [id, d] of prevDeviations) {
    if (!currDeviations.has(id)) {
      changes.push({
        id: nextId(),
        category: "deviation",
        description: `Removed deviation "${deviationLabel(d, id)}"`,
      });
    }
  }

  // ----- Work items (global catalog) -----
  const prevWorkItems = new Map((prev.workItems ?? []).map((w) => [w.id, w]));
  const currWorkItems = new Map((curr.workItems ?? []).map((w) => [w.id, w]));
  for (const [id, w] of currWorkItems) {
    if (!prevWorkItems.has(id)) {
      changes.push({
        id: nextId(),
        category: "workItem",
        description: `Created work item "${workItemLabel(w, id)}"`,
      });
    } else {
      const pw = prevWorkItems.get(id)!;
      if (pw.description !== w.description) {
        changes.push({
          id: nextId(),
          category: "workItem",
          description: `Changed work item description from "${workItemLabel(pw, id)}" to "${workItemLabel(w, id)}"`,
        });
      }
      if (pw.link !== w.link) {
        const pl = pw.link.trim() || "(none)";
        const cl = w.link.trim() || "(none)";
        changes.push({
          id: nextId(),
          category: "workItem",
          description: `Changed link on work item "${workItemLabel(w, id)}" from "${pl}" to "${cl}"`,
        });
      }
    }
  }
  for (const [id, w] of prevWorkItems) {
    if (!currWorkItems.has(id)) {
      changes.push({
        id: nextId(),
        category: "workItem",
        description: `Removed work item "${workItemLabel(w, id)}"`,
      });
    }
  }

  // ----- Per-scenario membership and attachments -----
  // Skip scenarios that were created or removed wholesale; those rollups
  // already cover their child changes.
  for (const [sid, currS] of currScenarios) {
    if (newScenarioIds.has(sid)) continue;
    const prevS = prevScenarios.get(sid);
    if (!prevS) continue; // defensive — shouldn't happen since not in newScenarioIds
    const sName = scenarioLabel(currS, sid);

    // Membership: nodes
    const pNodes = new Set(prevS.nodeIds);
    const cNodes = new Set(currS.nodeIds);
    for (const nid of cNodes) {
      if (newNodeIds.has(nid)) continue;
      if (pNodes.has(nid)) continue;
      const n = currNodes.get(nid);
      changes.push({
        id: nextId(),
        category: "membership",
        description: `[${sName}] Added node "${nodeLabel(n, nid)}" to scenario`,
        target: { kind: "node", id: nid, scenarioId: sid },
      });
    }
    for (const nid of pNodes) {
      if (removedNodeIds.has(nid)) continue;
      if (cNodes.has(nid)) continue;
      const n = currNodes.get(nid) ?? prevNodes.get(nid);
      changes.push({
        id: nextId(),
        category: "membership",
        description: `[${sName}] Removed node "${nodeLabel(n, nid)}" from scenario`,
        target: currNodes.has(nid)
          ? { kind: "node", id: nid, scenarioId: sid }
          : undefined,
      });
    }

    // Membership: edges
    const pEdges = new Set(prevS.edgeIds);
    const cEdges = new Set(currS.edgeIds);
    for (const eid of cEdges) {
      if (newEdgeIds.has(eid)) continue;
      if (pEdges.has(eid)) continue;
      const e = currEdges.get(eid);
      changes.push({
        id: nextId(),
        category: "membership",
        description: `[${sName}] Added edge ${e ? edgePath(e, currNodes, currNodes) : eid} to scenario`,
        target: { kind: "edge", id: eid, scenarioId: sid },
      });
    }
    for (const eid of pEdges) {
      if (removedEdgeIds.has(eid)) continue;
      if (cEdges.has(eid)) continue;
      const e = currEdges.get(eid) ?? prevEdges.get(eid);
      const desc = e
        ? edgePath(
            e,
            currNodes.has(e.source) ? currNodes : prevNodes,
            currNodes.has(e.target) ? currNodes : prevNodes
          )
        : eid;
      changes.push({
        id: nextId(),
        category: "membership",
        description: `[${sName}] Removed edge ${desc} from scenario`,
        target: currEdges.has(eid)
          ? { kind: "edge", id: eid, scenarioId: sid }
          : undefined,
      });
    }

    // Membership: boundaries
    const pBnd = new Set(prevS.boundaryIds);
    const cBnd = new Set(currS.boundaryIds);
    for (const bid of cBnd) {
      if (newBoundIds.has(bid)) continue;
      if (pBnd.has(bid)) continue;
      const b = currBounds.get(bid);
      changes.push({
        id: nextId(),
        category: "membership",
        description: `[${sName}] Added boundary "${boundaryLabel(b, bid)}" to scenario`,
        target: { kind: "boundary", id: bid, scenarioId: sid },
      });
    }
    for (const bid of pBnd) {
      if (removedBoundIds.has(bid)) continue;
      if (cBnd.has(bid)) continue;
      const b = currBounds.get(bid) ?? prevBounds.get(bid);
      changes.push({
        id: nextId(),
        category: "membership",
        description: `[${sName}] Removed boundary "${boundaryLabel(b, bid)}" from scenario`,
        target: currBounds.has(bid)
          ? { kind: "boundary", id: bid, scenarioId: sid }
          : undefined,
      });
    }

    // Edge data attachments (set semantics per edge, per direction)
    const diffEdgeBucket = (
      label: "request" | "response",
      prevMap: Record<string, string[]> | undefined,
      currMap: Record<string, string[]> | undefined,
    ) => {
      const eids = new Set([
        ...Object.keys(prevMap ?? {}),
        ...Object.keys(currMap ?? {}),
      ]);
      for (const eid of eids) {
        if (removedEdgeIds.has(eid)) continue;
        const pIds = new Set(prevMap?.[eid] ?? []);
        const cIds = new Set(currMap?.[eid] ?? []);
        const e = currEdges.get(eid) ?? prevEdges.get(eid);
        const eDesc = e
          ? edgePath(
              e,
              currNodes.has(e.source) ? currNodes : prevNodes,
              currNodes.has(e.target) ? currNodes : prevNodes
            )
          : eid;
        for (const did of cIds) {
          if (pIds.has(did)) continue;
          const d = currData.get(did) ?? prevData.get(did);
          changes.push({
            id: nextId(),
            category: "attachment",
            description: `[${sName}] Added ${label} data "${dataLabel(d, did)}" to edge ${eDesc}`,
            target: currEdges.has(eid)
              ? { kind: "edge", id: eid, scenarioId: sid }
              : undefined,
          });
        }
        for (const did of pIds) {
          if (cIds.has(did)) continue;
          const d = currData.get(did) ?? prevData.get(did);
          changes.push({
            id: nextId(),
            category: "attachment",
            description: `[${sName}] Removed ${label} data "${dataLabel(d, did)}" from edge ${eDesc}`,
            target: currEdges.has(eid)
              ? { kind: "edge", id: eid, scenarioId: sid }
              : undefined,
          });
        }
      }
    };
    diffEdgeBucket("request", prevS.edgeRequestData, currS.edgeRequestData);
    diffEdgeBucket("response", prevS.edgeResponseData, currS.edgeResponseData);

    // Node data attachments (with retention)
    const nodeAttachIds = new Set([
      ...Object.keys(prevS.nodeData ?? {}),
      ...Object.keys(currS.nodeData ?? {}),
    ]);
    for (const nid of nodeAttachIds) {
      if (removedNodeIds.has(nid)) continue;
      const pMap = prevS.nodeData?.[nid] ?? {};
      const cMap = currS.nodeData?.[nid] ?? {};
      const allDids = new Set([...Object.keys(pMap), ...Object.keys(cMap)]);
      const n = currNodes.get(nid) ?? prevNodes.get(nid);
      const nDesc = nodeLabel(n, nid);
      for (const did of allDids) {
        const pHas = did in pMap;
        const cHas = did in cMap;
        const d = currData.get(did) ?? prevData.get(did);
        if (!pHas && cHas) {
          changes.push({
            id: nextId(),
            category: "attachment",
            description: `[${sName}] Added data "${dataLabel(d, did)}" to node "${nDesc}"`,
            target: currNodes.has(nid)
              ? { kind: "node", id: nid, scenarioId: sid }
              : undefined,
          });
        } else if (pHas && !cHas) {
          changes.push({
            id: nextId(),
            category: "attachment",
            description: `[${sName}] Removed data "${dataLabel(d, did)}" from node "${nDesc}"`,
            target: currNodes.has(nid)
              ? { kind: "node", id: nid, scenarioId: sid }
              : undefined,
          });
        } else if (pHas && cHas && pMap[did] !== cMap[did]) {
          const pr = RETENTION_LABELS[pMap[did]] || pMap[did] || "(unset)";
          const cr = RETENTION_LABELS[cMap[did]] || cMap[did] || "(unset)";
          changes.push({
            id: nextId(),
            category: "attachment",
            description: `[${sName}] Changed retention of "${dataLabel(d, did)}" on node "${nDesc}" from "${pr}" to "${cr}"`,
            target: currNodes.has(nid)
              ? { kind: "node", id: nid, scenarioId: sid }
              : undefined,
          });
        }
      }
    }
  }

  // Stable sort: by category in canonical order, then by description for
  // determinism. We don't sort by scenario name because scenario-scoped
  // changes carry "[scenario]" prefixes that naturally cluster lexically.
  const order: ChangeCategory[] = [
    "catalogDefinition",
    "scenario",
    "node",
    "edge",
    "boundary",
    "data",
    "deviation",
    "workItem",
    "membership",
    "attachment",
  ];
  changes.sort((a, b) => {
    const c = order.indexOf(a.category) - order.indexOf(b.category);
    if (c !== 0) return c;
    // Within "edge" category, group by scenario then by edge sequence
    // number so the panel mirrors the canvas reading order. Items with
    // no scenario context sort after numbered ones, alphabetical fallback.
    if (a.category === "edge" && b.category === "edge") {
      const sa = a.scenarioName ?? "\uFFFF";
      const sb = b.scenarioName ?? "\uFFFF";
      const sc2 = sa.localeCompare(sb);
      if (sc2 !== 0) return sc2;
      const ea = a.edgeNumber ?? Number.POSITIVE_INFINITY;
      const eb = b.edgeNumber ?? Number.POSITIVE_INFINITY;
      if (ea !== eb) return ea - eb;
    }
    return a.description.localeCompare(b.description);
  });
  return changes;
}

// Helper used by UI code to decide whether a change row should be clickable.
// We re-check at render time rather than relying solely on the target snapshot
// taken when the diff was computed — the user may have edited the document
// since (e.g. fixing flagged issues), and stale-but-currently-valid targets
// should remain navigable while ones that became stale should not.
export function isChangeNavigable(
  change: ChangeItem,
  doc: PsDocument
): boolean {
  if (!change.target) return false;
  const t = change.target;
  if (t.scenarioId && !doc.scenarios.some((s) => s.id === t.scenarioId))
    return false;
  switch (t.kind) {
    case "node":
      return doc.nodes.some((n) => n.id === t.id);
    case "edge":
      return doc.edges.some((e) => e.id === t.id);
    case "boundary":
      return doc.boundaries.some((b) => b.id === t.id);
    case "scenario":
      return doc.scenarios.some((s) => s.id === t.id);
  }
}
