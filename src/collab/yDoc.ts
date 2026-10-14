// Shape of the shared Yjs document.
//
// We keep one Y.Map per id-keyed collection in PsDocument. Each entry's
// id is the outer key, and the inner Y.Map holds the item's fields. This
// means concurrent edits to different items always merge cleanly, and
// concurrent edits to different *fields* of the same item merge as LWW
// per field. Concurrent edits to the *same* field of the *same* item are
// last-writer-wins, which is acceptable for v1 — promoting selected
// free-form fields (e.g. node title, comment body) to Y.Text is the
// natural v2 follow-up.
//
// Top-level scalars and collection compatibility markers live in `meta`.

import * as Y from "yjs";
import { NODE_TYPE_DEF_MAP } from "../types";

export const AUTHENTICATION_DEFINITIONS_VERSION = 1;
export const CATALOG_DEFINITIONS_VERSION = 1;

export interface YShape {
  ydoc: Y.Doc;
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Map<Y.Map<unknown>>;
  boundaries: Y.Map<Y.Map<unknown>>;
  textAnnotations: Y.Map<Y.Map<unknown>>;
  scenarios: Y.Map<Y.Map<unknown>>;
  data: Y.Map<Y.Map<unknown>>;
  comments: Y.Map<Y.Map<unknown>>;
  issues: Y.Map<Y.Map<unknown>>;
  deviations: Y.Map<Y.Map<unknown>>;
  workItems: Y.Map<Y.Map<unknown>>;
  nodeTypes: Y.Map<Y.Map<unknown>>;
  authenticationDefinitions: Y.Map<Y.Map<unknown>>;
  protocolDefinitions: Y.Map<Y.Map<unknown>>;
  catalogDefinitions: Y.Map<unknown>;
  meta: Y.Map<unknown>;
}

export function createYShape(ydoc?: Y.Doc): YShape {
  const doc = ydoc ?? new Y.Doc();
  return {
    ydoc: doc,
    nodes: doc.getMap<Y.Map<unknown>>("nodes"),
    edges: doc.getMap<Y.Map<unknown>>("edges"),
    boundaries: doc.getMap<Y.Map<unknown>>("boundaries"),
    textAnnotations: doc.getMap<Y.Map<unknown>>("textAnnotations"),
    scenarios: doc.getMap<Y.Map<unknown>>("scenarios"),
    data: doc.getMap<Y.Map<unknown>>("data"),
    comments: doc.getMap<Y.Map<unknown>>("comments"),
    issues: doc.getMap<Y.Map<unknown>>("issues"),
    deviations: doc.getMap<Y.Map<unknown>>("deviations"),
    workItems: doc.getMap<Y.Map<unknown>>("workItems"),
    nodeTypes: doc.getMap<Y.Map<unknown>>("nodeTypes"),
    authenticationDefinitions: doc.getMap<Y.Map<unknown>>("authenticationDefinitions"),
    protocolDefinitions: doc.getMap<Y.Map<unknown>>("protocolDefinitions"),
    catalogDefinitions: doc.getMap<unknown>("catalogDefinitions"),
    meta: doc.getMap<unknown>("meta"),
  };
}

export function isYShapeEmpty(shape: YShape): boolean {
  return (
    shape.nodes.size === 0 &&
    shape.edges.size === 0 &&
    shape.boundaries.size === 0 &&
    shape.textAnnotations.size === 0 &&
    shape.scenarios.size === 0 &&
    shape.data.size === 0 &&
    shape.comments.size === 0 &&
    shape.issues.size === 0 &&
    shape.deviations.size === 0 &&
    shape.workItems.size === 0 &&
    shape.authenticationDefinitions.size === 0 &&
    shape.protocolDefinitions.size === 0 &&
    shape.ydoc.getMap("catalogDefinitions").size === 0 &&
    !Array.from(shape.nodeTypes.entries()).some(
      ([id, entry]) => NODE_TYPE_DEF_MAP[id] == null || entry.has("definition"),
    )
  );
}

// Origin sentinels used with Y.Doc.transact() so the React-side and
// provider-side update listeners can distinguish their own writes from
// remote ones and avoid feedback loops.
export const LOCAL_ORIGIN = Symbol("ps-collab-local");
export const REMOTE_ORIGIN = Symbol("ps-collab-remote");
