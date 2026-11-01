// Bridges the shared Y.Doc and the local PsDocument.
//
// The store remains the source of truth for *local* edits — every
// mutating action calls setDoc/snapshot exactly as before. After the
// local doc settles, `reconcileLocalToY` diffs it against the Y.Doc and
// applies minimal mutations inside a transaction tagged with
// LOCAL_ORIGIN so the provider knows to broadcast and the React hook
// knows not to roundtrip.
//
// In the other direction, when the Y.Doc changes from a remote update,
// `buildDocFromY` materialises a fresh PsDocument and the hook calls
// `setDocFromCollab` (a snapshot-free setDoc).

import * as Y from "yjs";
import { validateNodeTypeGuidanceEntries } from "../../shared/aiDesignGuidance";
import {
  type PsBoundary,
  type PsTextAnnotation,
  type PsComment,
  type PsData,
  type PsDeviation,
  type PsDocument,
  type PsEdge,
  type PsIssue,
  type PsNode,
  type PsWorkItem,
  type Scenario,
  type NodeTypeRef,
  type AuthTypeDef,
  type CatalogDefinitionSnapshot,
} from "../types";
import { normalizeDoc } from "../store";
import { catalogDefinitionKey, validateCatalogDefinitions, withCatalogDefinitions } from "../catalogDefinitions";
import type { ProtocolTypeDef } from "../protocols";
import { validatePortableAuthenticationDefinitions } from "../authentication";
import { AUTHENTICATION_DEFINITIONS_VERSION, CATALOG_DEFINITIONS_VERSION, LOCAL_ORIGIN, type YShape } from "./yDoc";

// Deep-equality good enough for our shapes: all leaves are primitives,
// arrays, or plain objects. JSON serialisation is fine and avoids
// pulling in a deep-equal dep.
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Sync one id-keyed collection. Creates / removes / updates Y.Map
// entries to match the local list. Per-field comparison keeps Y
// operations minimal so concurrent peers see the smallest possible
// CRDT update.
function syncCollection<T extends { id: string }>(
  yMap: Y.Map<Y.Map<unknown>>,
  items: readonly T[]
) {
  const seenIds = new Set<string>();
  for (const item of items) {
    seenIds.add(item.id);
    let yItem = yMap.get(item.id);
    if (!yItem) {
      yItem = new Y.Map();
      // Populate before inserting so observers see a complete record.
      for (const [k, v] of Object.entries(item)) {
        yItem.set(k, v);
      }
      yMap.set(item.id, yItem);
      continue;
    }
    // Update mutated fields.
    for (const [k, v] of Object.entries(item)) {
      if (!jsonEqual(yItem.get(k), v)) {
        yItem.set(k, v);
      }
    }
    // Drop fields the local item no longer carries.
    for (const k of Array.from(yItem.keys())) {
      if (!(k in item)) yItem.delete(k);
    }
  }
  // Drop items removed locally.
  for (const id of Array.from(yMap.keys())) {
    if (!seenIds.has(id)) yMap.delete(id);
  }
}

function syncNodeTypeCollection(
  yMap: Y.Map<Y.Map<unknown>>,
  items: readonly NodeTypeRef[],
) {
  const seenIds = new Set<string>();
  for (const item of items) {
    seenIds.add(item.id);
    let yItem = yMap.get(item.id);
    if (!yItem) {
      yItem = new Y.Map();
      yMap.set(item.id, yItem);
    }
    if (yItem.get("id") !== item.id) yItem.set("id", item.id);
    if (yItem.get("label") !== item.label) yItem.set("label", item.label);

    if (item.definition) {
      const existingDefinition = yItem.get("definition");
      let yDefinition: Y.Map<unknown>;
      if (existingDefinition instanceof Y.Map) {
        yDefinition = existingDefinition;
      } else {
        yDefinition = new Y.Map<unknown>();
        yItem.set("definition", yDefinition);
      }
      for (const [key, value] of Object.entries(item.definition)) {
        if (!jsonEqual(yDefinition.get(key), value)) {
          yDefinition.set(key, value);
        }
      }
      for (const key of Array.from(yDefinition.keys())) {
        if (!(key in item.definition)) yDefinition.delete(key);
      }
    } else {
      yItem.delete("definition");
    }

    for (const key of Array.from(yItem.keys())) {
      if (key !== "id" && key !== "label" && key !== "definition") {
        yItem.delete(key);
      }
    }
  }
  for (const id of Array.from(yMap.keys())) {
    if (!seenIds.has(id)) yMap.delete(id);
  }
}

function assertAuthenticationVersion(y: YShape): void {
  const version = y.meta.get("authenticationDefinitionsVersion");
  if (version !== undefined && version !== AUTHENTICATION_DEFINITIONS_VERSION) {
    throw new Error("This room uses an unsupported authentication definitions version. Upgrade before editing; older readers are not guaranteed to preserve authentication metadata.");
  }
  const catalogVersion = y.meta.get("catalogDefinitionsVersion");
  if (catalogVersion !== undefined && catalogVersion !== CATALOG_DEFINITIONS_VERSION) {
    throw new Error("This room uses an unsupported catalog definitions version. Upgrade before editing.");
  }
}

function readCatalogDefinitions(y: YShape) {
  const catalogMap = y.ydoc.getMap<unknown>("catalogDefinitions");
  const saved = validateCatalogDefinitions([...catalogMap.values()]);
  for (const definition of saved) {
    if (!catalogMap.has(catalogDefinitionKey(definition))) {
      throw new Error("Room catalog definition key does not match its kind/ID.");
    }
  }
  return saved;
}

export function reconcileLocalToY(
  y: YShape, doc: PsDocument, availableClassifications?: readonly CatalogDefinitionSnapshot[],
): void {
  assertAuthenticationVersion(y);
  validateNodeTypeGuidanceEntries(doc.nodeTypes);
  if (doc.authenticationDefinitions !== undefined) validatePortableAuthenticationDefinitions(doc.authenticationDefinitions);
  readCatalogDefinitions(y);
  // An absent optional field is not a deletion by a reader without catalog support.
  const definitions = doc.catalogDefinitions === undefined ? undefined
    : validateCatalogDefinitions(withCatalogDefinitions(doc, availableClassifications).catalogDefinitions);
  const catalogMap = y.ydoc.getMap<unknown>("catalogDefinitions");
  y.ydoc.transact(() => {
    syncCollection(y.nodes, doc.nodes);
    syncCollection(y.edges, doc.edges);
    syncCollection(y.boundaries, doc.boundaries);
    if (doc.textAnnotations !== undefined) {
      syncCollection(y.textAnnotations, doc.textAnnotations);
      if (y.meta.get("textAnnotationsPresent") !== true) y.meta.set("textAnnotationsPresent", true);
    }
    syncCollection(y.scenarios, doc.textAnnotations === undefined
      ? doc.scenarios.map(scenario => {
          const retained = y.scenarios.get(scenario.id)?.get("textAnnotationIds");
          return scenario.textAnnotationIds === undefined && Array.isArray(retained)
            ? { ...scenario, textAnnotationIds: retained as string[] } : scenario;
        })
      : doc.scenarios);
    syncCollection(y.data, doc.data);
    syncCollection(y.comments, doc.comments);
    syncCollection(y.issues, doc.issues);
    syncCollection(y.deviations, doc.deviations);
    syncCollection(y.workItems, doc.workItems);
    syncNodeTypeCollection(y.nodeTypes, doc.nodeTypes);
    // An absent optional field is not an explicit deletion by an older caller.
    // Only saved diagram definitions travel here, never the profile library.
    if (doc.authenticationDefinitions !== undefined) {
      syncCollection(y.authenticationDefinitions, doc.authenticationDefinitions);
      if (y.meta.get("authenticationDefinitionsVersion") !== AUTHENTICATION_DEFINITIONS_VERSION) {
        y.meta.set("authenticationDefinitionsVersion", AUTHENTICATION_DEFINITIONS_VERSION);
      }
    }
    // This is portable per-document data, not a profile library or a client
    // version gate. Older peers may omit it; absence is not deletion.
    if (doc.protocolDefinitions !== undefined) {
      syncCollection(y.protocolDefinitions, doc.protocolDefinitions);
    }
    if (definitions !== undefined) {
      // Whole snapshot values prevent concurrent kind/ID/library fields from
      // being combined into a definition that neither peer authored.
      const keys = new Set(definitions.map(catalogDefinitionKey));
      for (const definition of definitions) {
        const key = catalogDefinitionKey(definition);
        if (!jsonEqual(catalogMap.get(key), definition)) catalogMap.set(key, definition);
      }
      for (const key of catalogMap.keys()) if (!keys.has(key)) catalogMap.delete(key);
      if (y.meta.get("catalogDefinitionsVersion") !== CATALOG_DEFINITIONS_VERSION) {
        y.meta.set("catalogDefinitionsVersion", CATALOG_DEFINITIONS_VERSION);
      }
    }
    if (y.meta.get("version") !== doc.version) {
      y.meta.set("version", doc.version);
    }
  }, LOCAL_ORIGIN);
}

// The current application owns complete document replacement (New/Open/history).
// Unlike a legacy caller's partial representation, absence here means no notes.
export function reconcileCurrentDocumentToY(
  y: YShape, doc: PsDocument, availableClassifications?: readonly CatalogDefinitionSnapshot[],
): void {
  reconcileLocalToY(y, doc.textAnnotations === undefined
    ? { ...doc, textAnnotations: [] } : doc, availableClassifications);
}

// Pull an item back out of Y.Map. Y.Map.toJSON() walks nested Y types,
// but our values are plain JS objects/arrays/primitives so a simple
// key-by-key extraction suffices and gives us typed casts.
function yMapToObject<T>(yMap: Y.Map<unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of yMap.entries()) {
    out[k] = v instanceof Y.Map ? yMapToObject(v) : v;
  }
  return out as T;
}

// Build a PsDocument from the current Y state. We always run the result
// through `normalizeDoc` so any drift (missing fields after a schema
// bump, partially-populated records mid-sync) gets back-filled exactly
// the same way an imported file would. Sorting by id is for stability
// only — the diagram doesn't depend on array order, but a stable order
// avoids spurious diffs when comparing against the local doc.
export function buildDocFromY(y: YShape): PsDocument {
  assertAuthenticationVersion(y);
  const catalogDefinitions = readCatalogDefinitions(y);
  const collect = <T>(m: Y.Map<Y.Map<unknown>>): T[] =>
    Array.from(m.values()).map((entry) => yMapToObject<T>(entry));

  const partial: Partial<PsDocument> = {
    version: (y.meta.get("version") as 1 | undefined) ?? 1,
    ...(y.textAnnotations.size || y.meta.get("textAnnotationsPresent") === true ? {
      textAnnotations: collect<PsTextAnnotation>(y.textAnnotations).sort((a, b) => a.id.localeCompare(b.id)),
    } : {}),
    nodes: collect<PsNode>(y.nodes).sort((a, b) => a.id.localeCompare(b.id)),
    edges: collect<PsEdge>(y.edges).sort((a, b) => a.id.localeCompare(b.id)),
    boundaries: collect<PsBoundary>(y.boundaries).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    scenarios: collect<Scenario>(y.scenarios).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    data: collect<PsData>(y.data).sort((a, b) => a.id.localeCompare(b.id)),
    comments: collect<PsComment>(y.comments).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    issues: collect<PsIssue>(y.issues).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    deviations: collect<PsDeviation>(y.deviations).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    workItems: collect<PsWorkItem>(y.workItems).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    nodeTypes: collect<NodeTypeRef>(y.nodeTypes).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    authenticationDefinitions: collect<AuthTypeDef>(y.authenticationDefinitions).sort((a, b) =>
      a.id.localeCompare(b.id)
    ),
    ...(y.protocolDefinitions.size ? {
      protocolDefinitions: collect<ProtocolTypeDef>(y.protocolDefinitions).sort((a, b) => a.id.localeCompare(b.id)),
    } : {}),
    ...(catalogDefinitions.length || y.meta.has("catalogDefinitionsVersion")
      ? { catalogDefinitions: catalogDefinitions.sort((a, b) => catalogDefinitionKey(a).localeCompare(catalogDefinitionKey(b))) }
      : {}),
  };

  return normalizeDoc(partial);
}
