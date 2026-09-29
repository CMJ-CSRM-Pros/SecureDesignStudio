// Importer for Microsoft Threat Modeling Tool (.tm7) files.
//
// Mirrors `tm7Export.ts` on the reverse path: each `<DrawingSurfaceModel>`
// becomes a SecureDesignStudio Scenario, each stencil becomes a PsNode, each
// BorderBoundary becomes a security PsBoundary, and each Connector
// becomes a PsEdge. Nodes / edges / boundaries are deduped by their TM7
// Guid so an element that appears on multiple tabs only materializes
// once; per-scenario membership is recorded via Scenario.nodeIds /
// edgeIds / boundaryIds.
//
// What's mapped:
//   - StencilEllipse (GE.P)            -> PsNode
//   - StencilRectangle (GE.EI)         -> PsNode  (type left blank — TM7's
//                                         stencil classes don't line up
//                                         with SecureDesignStudio's policy-bearing
//                                         NodeTypes)
//   - StencilParallelLines (GE.DS)     -> PsNode
//   - BorderBoundary (GE.TB.B)         -> PsBoundary  (security, blank
//                                         subtype — set later in UI)
//   - Connector (GE.DF)                -> PsEdge
//
// What's intentionally dropped (with counters in the summary):
//   - StencilRectangle (GE.A) free-text annotations — no PsNode analog.
//   - LineBoundary (GE.TB.L) — PsBoundary is rectangle-only, no surface
//     for representing a free-floating line. Future improvement.
//   - Connectors whose Source or Target Guid is the all-zero sentinel,
//     or refers to a Guid that didn't survive node dedup (e.g. pointed
//     to a dropped freetext / line boundary).
//
// Round-trip decorations from `tm7Export.ts` are reversed when present:
//   - Node "Name" of the form "Title\nST: <guid>" splits into
//     PsNode.title + PsNode.serviceTreeId.
//   - Edge "Name" of the form "N. Title\nAuth: A, B" splits into
//     edgeNumber, PsEdge.title, and PsEdge.authenticationTypes. Names
//     that don't match the export shape are kept verbatim as the edge
//     title (and seq is assigned by source order on the surface).
//
// Caller contract: pass the raw XML string. Returns a PsDocument plus
// metadata for an import-summary alert. Throws Tm7ImportError on
// structural failure (bad XML, missing root element).

import {
  AUTH_TYPE_DEFS,
  legacyAuthenticationIdentity,
  isAuthenticationType,
  type AuthenticationType,
  DEFAULT_NODE_TYPES,
  type PsBoundary,
  type PsDocument,
  type PsEdge,
  type PsNode,
  type Scenario,
  uid,
} from "./types";
import { chooseHandles } from "./tmcImport";

export class Tm7ImportError extends Error {}

export interface Tm7ImportSummary {
  scenarioCount: number;
  nodeCount: number;
  edgeCount: number;
  boundaryCount: number;
  // Surfaces seen in the file (= scenarios that will exist).
  surfaceCount: number;
  // Connectors dropped because Source or Target couldn't be resolved to
  // a node we kept (zero-GUID, points at a freetext, points at a line
  // boundary, or the GUID simply wasn't present in any Borders block).
  skippedDanglingEdgeCount: number;
  // Free-text annotations (GE.A) dropped on import.
  skippedAnnotationCount: number;
  // Line boundaries (GE.TB.L) dropped on import.
  skippedLineBoundaryCount: number;
}

export interface Tm7ImportResult {
  doc: PsDocument;
  activeScenarioId: string | null;
  summary: Tm7ImportSummary;
}

// Lowercased TM7 GenericTypeId constants. Centralized so a future
// rename in the export doesn't drift silently.
const GTI_PROCESS = "GE.P";
const GTI_EXTERNAL = "GE.EI";
const GTI_DATASTORE = "GE.DS";
const GTI_ANNOTATION = "GE.A";
const GTI_DATAFLOW = "GE.DF";
const GTI_BORDER_BOUNDARY = "GE.TB.B";
const GTI_LINE_BOUNDARY = "GE.TB.L";

const NODE_GTIS = new Set([GTI_PROCESS, GTI_EXTERNAL, GTI_DATASTORE]);

const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

// Maps the lowercased AuthenticationType label (as emitted by
// tm7Export.ts via `authTypeLabel`) back to its enum id. Built lazily so
// the bundle doesn't pay for it on cold start.
let _authLabelToId: Map<string, AuthenticationType> | null = null;
function authLabelToId(): Map<string, AuthenticationType> {
  if (_authLabelToId) return _authLabelToId;
  const m = new Map<string, AuthenticationType>();
  for (const def of AUTH_TYPE_DEFS) {
    for (const alias of def.aliases) m.set(alias.toLowerCase(), def.id);
    m.set(def.label.trim().toLowerCase(), def.id as AuthenticationType);
    // Also accept the id verbatim — handles round-trips of an edge
    // whose label was hand-edited to use the enum value directly.
    m.set(def.id.toLowerCase(), def.id as AuthenticationType);
  }
  _authLabelToId = m;
  return m;
}

// ---- DOM helpers --------------------------------------------------------

// Return direct-child Elements with the given local name. Works the same
// in browser DOM and @xmldom/xmldom; we never rely on namespace URI
// lookup so any prefix mapping in the file is fine.
function childElements(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === localName) {
      out.push(n as Element);
    }
  }
  return out;
}

function firstChild(parent: Element, localName: string): Element | null {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === localName) {
      return n as Element;
    }
  }
  return null;
}

function textOf(el: Element | null): string {
  if (!el) return "";
  return (el.textContent ?? "").trim();
}

// Find a child by local name regardless of nesting depth (BFS). Returns
// the first match. Used for digging into Properties / Value subtrees
// where exact namespace prefixes differ across emitters.
function descendant(root: Element, localName: string): Element | null {
  const queue: Element[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (let n = cur.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      if (el.localName === localName) return el;
      queue.push(el);
    }
  }
  return null;
}

// Find the StringDisplayAttribute / BooleanDisplayAttribute / etc. in a
// <Properties> block whose `<b:DisplayName>` equals `displayName`. The
// `<b:Value>` element is returned (caller reads text). Returns null when
// the property is absent or has no value child.
function findPropertyValue(
  properties: Element | null,
  displayName: string,
): Element | null {
  if (!properties) return null;
  for (const child of childElements(properties, "anyType")) {
    const dn = textOf(firstChild(child, "DisplayName"));
    if (dn !== displayName) continue;
    return firstChild(child, "Value");
  }
  return null;
}

// Read the stencil's "headline" — first HeaderDisplayAttribute in the
// Properties block (e.g. "Web API", "Azure Cosmos DB"). Used as the
// stencil's TMT class identity; preserved in the imported node's
// description for context.
function readStencilHeader(properties: Element | null): string {
  if (!properties) return "";
  for (const child of childElements(properties, "anyType")) {
    const xsiType = child.getAttribute("i:type") ?? child.getAttribute("type");
    if (!xsiType) continue;
    if (!/HeaderDisplayAttribute$/.test(xsiType)) continue;
    return textOf(firstChild(child, "DisplayName"));
  }
  return "";
}

// ---- Parsers per element -----------------------------------------------

interface ParsedNode {
  id: string;
  title: string;
  serviceTreeId: string;
  description: string;
  position: { x: number; y: number };
}

interface ParsedBoundary {
  id: string;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface ParsedEdge {
  id: string;
  source: string;
  target: string;
  title: string;
  authenticationTypes: AuthenticationType[];
  dataflowOrder: number | null;
  // True when SourceGuid / TargetGuid were zero-sentinel rather than a
  // real node id — used by caller to decide whether to skip.
  endpointMissing: boolean;
}

// Split a TM7 "Name" cell. Lines come in with `\r\n` (TMT writes
// Windows-style line breaks); normalize to `\n` before splitting.
function splitLines(s: string): string[] {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function parseNodeLabel(raw: string): {
  title: string;
  serviceTreeId: string;
} {
  const lines = splitLines(raw);
  let serviceTreeId = "";
  const titleLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(?:ST|Inventory ID|ServiceTreeId|ServiceTree ID):\s*(.+?)\s*$/i);
    if (m) {
      // Only treat as a service tree id when it parses like one. The
      // export emits it verbatim from PsNode.serviceTreeId so this is
      // typically a GUID, but we don't require that — any non-blank id
      // is preserved.
      serviceTreeId = m[1].trim();
      continue;
    }
    titleLines.push(line);
  }
  return { title: titleLines.join("\n").trim(), serviceTreeId };
}

function parseEdgeLabel(raw: string): {
  title: string;
  seq: number | null;
  authenticationTypes: AuthenticationType[];
} {
  const lines = splitLines(raw);
  const authIds: AuthenticationType[] = [];
  const bodyLines: string[] = [];
  const labelToId = authLabelToId();
  let explicitIds: AuthenticationType[] | undefined;
  for (const line of lines) {
    const idsLine = line.match(/^\s*Auth IDs:\s*(.+)\s*$/);
    if (idsLine) {
      let ids: unknown;
      try { ids = JSON.parse(idsLine[1]); }
      catch { throw new Tm7ImportError("Invalid Auth IDs JSON in flow label; authentication data was not removed."); }
      if (!Array.isArray(ids) || !ids.every(isAuthenticationType)) {
        throw new Tm7ImportError("Invalid authentication ID in flow label.");
      }
      explicitIds = [...new Set(ids)];
      continue;
    }
    const m = line.match(/^\s*Auth:\s*(.+)\s*$/);
    if (m) {
      // Comma-separated list of auth labels.
      for (const piece of m[1].split(",")) {
        const key = piece.trim().toLowerCase();
        const id = labelToId.get(key) ?? legacyAuthenticationIdentity(piece.trim());
        if (id && !authIds.includes(id)) authIds.push(id);
      }
      continue;
    }
    bodyLines.push(line);
  }
  let body = bodyLines.join("\n").trim();
  let seq: number | null = null;
  // Leading "N. " is a sequence number from the export; pull it off the
  // body so PsEdge.title doesn't carry display noise.
  const seqMatch = body.match(/^\s*(\d+)\.\s+/);
  if (seqMatch) {
    seq = parseInt(seqMatch[1], 10);
    body = body.slice(seqMatch[0].length);
  }
  return { title: body.trim(), seq, authenticationTypes: explicitIds ?? authIds };
}

function parseInt0(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

// Parse a KeyValueOfguidanyType representing a Borders entry (node or
// border boundary). Returns either a node, a boundary, or null when
// the kind is unsupported (LineBoundary appears under Lines, not here,
// but we tolerate it for safety; free-text annotations are surfaced
// via the discriminator).
function parseBorderEntry(entry: Element): {
  kind: "node" | "boundary" | "annotation" | "other";
  node?: ParsedNode;
  boundary?: ParsedBoundary;
} {
  const value = firstChild(entry, "Value");
  if (!value) return { kind: "other" };
  const xsiType =
    value.getAttribute("i:type") ?? value.getAttribute("type") ?? "";
  const genericTypeId = textOf(firstChild(value, "GenericTypeId"));
  const guid = textOf(firstChild(value, "Guid"));
  if (!guid || guid === ZERO_GUID) return { kind: "other" };

  const properties = firstChild(value, "Properties");
  const nameValue = findPropertyValue(properties, "Name");
  const rawName = textOf(nameValue);
  const left = parseInt0(textOf(firstChild(value, "Left")));
  const top = parseInt0(textOf(firstChild(value, "Top")));
  const width = parseInt0(textOf(firstChild(value, "Width")));
  const height = parseInt0(textOf(firstChild(value, "Height")));

  if (genericTypeId === GTI_ANNOTATION) {
    return { kind: "annotation" };
  }

  if (NODE_GTIS.has(genericTypeId) || xsiType === "StencilEllipse" ||
      xsiType === "StencilRectangle" || xsiType === "StencilParallelLines") {
    // Free-text annotations are StencilRectangle/GE.A — already handled
    // above. Anything else maps to a node.
    if (genericTypeId === GTI_ANNOTATION) return { kind: "annotation" };
    const { title, serviceTreeId } = parseNodeLabel(rawName);
    const header = readStencilHeader(properties);
    // Position: TM7 stores top-left of the stencil bounding box. The
    // export side back-computes from `position.x - NODE_W/2`. Restore
    // the centerpoint so re-export round-trips cleanly.
    const w = width > 0 ? width : 100;
    const h = height > 0 ? height : 100;
    return {
      kind: "node",
      node: {
        id: guid.toLowerCase(),
        title: title || "(unnamed)",
        serviceTreeId,
        description: header ? `TMT stencil: ${header}` : "",
        position: { x: left + w / 2, y: top + h / 2 },
      },
    };
  }

  if (genericTypeId === GTI_BORDER_BOUNDARY || xsiType === "BorderBoundary") {
    return {
      kind: "boundary",
      boundary: {
        id: guid.toLowerCase(),
        title: rawName || "(unnamed boundary)",
        position: { x: left, y: top },
        size: { width: Math.max(40, width), height: Math.max(40, height) },
      },
    };
  }

  return { kind: "other" };
}

interface ParseLineResult {
  kind: "edge" | "lineBoundary" | "other";
  edge?: ParsedEdge;
}

function parseLineEntry(entry: Element): ParseLineResult {
  const value = firstChild(entry, "Value");
  if (!value) return { kind: "other" };
  const xsiType =
    value.getAttribute("i:type") ?? value.getAttribute("type") ?? "";
  const genericTypeId = textOf(firstChild(value, "GenericTypeId"));
  const guid = textOf(firstChild(value, "Guid"));

  if (genericTypeId === GTI_LINE_BOUNDARY || xsiType === "LineBoundary") {
    return { kind: "lineBoundary" };
  }
  if (genericTypeId !== GTI_DATAFLOW && xsiType !== "Connector") {
    return { kind: "other" };
  }
  if (!guid || guid === ZERO_GUID) return { kind: "other" };

  const properties = firstChild(value, "Properties");
  const rawName = textOf(findPropertyValue(properties, "Name"));
  const rawOrder = textOf(findPropertyValue(properties, "Dataflow Order"));
  const sourceGuidRaw = textOf(firstChild(value, "SourceGuid"));
  const targetGuidRaw = textOf(firstChild(value, "TargetGuid"));
  const sourceGuid = sourceGuidRaw.toLowerCase();
  const targetGuid = targetGuidRaw.toLowerCase();
  const endpointMissing =
    !sourceGuid ||
    !targetGuid ||
    sourceGuid === ZERO_GUID ||
    targetGuid === ZERO_GUID;

  const { title, seq, authenticationTypes } = parseEdgeLabel(rawName);
  // Dataflow Order, when present, beats the seq we sniffed from the
  // label — TMT keeps it as the canonical sort key. Fall back to the
  // label sniff so files that omit Dataflow Order (e.g. older exports)
  // still get sensible numbering.
  const orderFromProp = parseInt(rawOrder, 10);
  const dataflowOrder = Number.isFinite(orderFromProp) && orderFromProp > 0
    ? orderFromProp
    : seq;

  return {
    kind: "edge",
    edge: {
      id: guid.toLowerCase(),
      source: sourceGuid,
      target: targetGuid,
      title: title || "(untitled)",
      authenticationTypes,
      dataflowOrder,
      endpointMissing,
    },
  };
}

// ---- Surface walk -------------------------------------------------------

interface ParsedSurface {
  name: string;
  nodes: ParsedNode[];
  boundaries: ParsedBoundary[];
  // Edges as they appear on this surface, in source order. dataflowOrder
  // is honored when present; otherwise we use the source order for
  // numbering.
  edges: ParsedEdge[];
  annotations: number;
  lineBoundaries: number;
}

function parseSurface(surface: Element): ParsedSurface {
  const out: ParsedSurface = {
    name: "Diagram",
    nodes: [],
    boundaries: [],
    edges: [],
    annotations: 0,
    lineBoundaries: 0,
  };

  // Tab name lives in Properties as a StringDisplayAttribute "Name".
  const properties = firstChild(surface, "Properties");
  const tabName = textOf(findPropertyValue(properties, "Name"));
  if (tabName) out.name = tabName;

  const borders = firstChild(surface, "Borders");
  if (borders) {
    for (const entry of childElements(borders, "KeyValueOfguidanyType")) {
      const parsed = parseBorderEntry(entry);
      if (parsed.kind === "node" && parsed.node) {
        out.nodes.push(parsed.node);
      } else if (parsed.kind === "boundary" && parsed.boundary) {
        out.boundaries.push(parsed.boundary);
      } else if (parsed.kind === "annotation") {
        out.annotations++;
      }
    }
  }

  const lines = firstChild(surface, "Lines");
  if (lines) {
    for (const entry of childElements(lines, "KeyValueOfguidanyType")) {
      const parsed = parseLineEntry(entry);
      if (parsed.kind === "edge" && parsed.edge) {
        out.edges.push(parsed.edge);
      } else if (parsed.kind === "lineBoundary") {
        out.lineBoundaries++;
      }
    }
  }

  return out;
}

// ---- Entry point --------------------------------------------------------

export function parseTm7(xmlText: string): Tm7ImportResult {
  // Use the browser's built-in DOMParser. The Node-side test harness
  // polyfills `globalThis.DOMParser` from @xmldom/xmldom before calling
  // this function.
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) {
    throw new Tm7ImportError(
      "DOMParser is not available in this environment.",
    );
  }
  let doc: Document;
  try {
    doc = new Parser().parseFromString(xmlText, "text/xml");
  } catch (e) {
    throw new Tm7ImportError(
      `Failed to parse XML: ${(e as Error).message ?? "(no message)"}`,
    );
  }
  // Browser DOMParser surfaces XML errors as a <parsererror> element in
  // the document instead of throwing; xmldom may emit a non-Element root.
  // Both cases hit here.
  if (!doc || !doc.documentElement) {
    throw new Tm7ImportError("Empty or unparseable TM7 document.");
  }
  if (doc.documentElement.localName !== "ThreatModel") {
    throw new Tm7ImportError(
      `Unexpected root element <${doc.documentElement.nodeName}>; expected <ThreatModel>.`,
    );
  }

  const surfaceList = descendant(doc.documentElement, "DrawingSurfaceList");
  const surfaces = surfaceList
    ? childElements(surfaceList, "DrawingSurfaceModel")
    : [];
  if (surfaces.length === 0) {
    throw new Tm7ImportError(
      "No <DrawingSurfaceModel> tabs were found in this TM7 file.",
    );
  }

  const parsedSurfaces = surfaces.map(parseSurface);

  // ---- Cross-tab dedup ----
  //
  // Build the unified PsNode / PsEdge / PsBoundary sets keyed by TM7
  // Guid. First-seen properties win; later occurrences only register
  // membership in their scenario's nodeIds / etc.
  const nodesByGuid = new Map<string, PsNode>();
  const boundariesByGuid = new Map<string, PsBoundary>();
  const edgesByGuid = new Map<string, PsEdge>();
  const skipped = {
    annotation: 0,
    lineBoundary: 0,
    danglingEdge: 0,
  };

  for (const surf of parsedSurfaces) {
    for (const n of surf.nodes) {
      if (nodesByGuid.has(n.id)) continue;
      nodesByGuid.set(n.id, {
        id: n.id,
        title: n.title,
        description: n.description,
        // Type intentionally blank — TM7's stencil identity doesn't map
        // cleanly to SecureDesignStudio's policy-bearing NodeType list.
        type: "",
        serviceTreeId: n.serviceTreeId,
        endpointRegex: "",
        position: n.position,
      });
    }
    for (const b of surf.boundaries) {
      if (boundariesByGuid.has(b.id)) continue;
      boundariesByGuid.set(b.id, {
        id: b.id,
        type: "security",
        title: b.title,
        position: b.position,
        size: b.size,
        nodeIds: [],
      });
    }
    skipped.annotation += surf.annotations;
    skipped.lineBoundary += surf.lineBoundaries;
  }

  // Edge pass: only register edges whose endpoints survived node dedup.
  // Doing this AFTER all surfaces are walked means an edge whose
  // endpoint sits on a different tab (rare but legal in TMT) still
  // resolves cleanly.
  for (const surf of parsedSurfaces) {
    for (const e of surf.edges) {
      if (
        e.endpointMissing ||
        !nodesByGuid.has(e.source) ||
        !nodesByGuid.has(e.target)
      ) {
        // Only count each unique edge guid once towards the dropped
        // count to avoid double-counting cross-tab repeats.
        if (!edgesByGuid.has(e.id)) skipped.danglingEdge++;
        continue;
      }
      if (edgesByGuid.has(e.id)) continue;
      const srcNode = nodesByGuid.get(e.source);
      const tgtNode = nodesByGuid.get(e.target);
      // Pick connector sides based on relative node positions so the edge
      // exits the source on the side facing the target (e.g. a left-to-right
      // pair gets right→left). TM7 doesn't persist handle positions, so
      // without this every imported edge would default to top→top and the
      // diagram would be a tangle.
      const { sourceHandle, targetHandle } = chooseHandles(
        srcNode?.position,
        tgtNode?.position,
      );
      edgesByGuid.set(e.id, {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        title: e.title,
        description: "",
        authenticationTypes: e.authenticationTypes,
        waypoints: [],
      });
    }
  }

  // ---- Materialize scenarios ----
  const scenarios: Scenario[] = parsedSurfaces.map((surf) => {
    const sid = uid("s");
    const surfaceNodeIds = new Set<string>();
    for (const n of surf.nodes) {
      if (nodesByGuid.has(n.id)) surfaceNodeIds.add(n.id);
    }
    const surfaceBoundaryIds = new Set<string>();
    for (const b of surf.boundaries) {
      if (boundariesByGuid.has(b.id)) surfaceBoundaryIds.add(b.id);
    }
    // Edges on this surface, in display order. Dataflow Order (when
    // present) wins over source order; ties fall back to source order
    // for stability.
    const surfaceEdges = surf.edges
      .filter((e) => edgesByGuid.has(e.id))
      .map((e, idx) => ({ e, idx }))
      .sort((a, b) => {
        const ao = a.e.dataflowOrder;
        const bo = b.e.dataflowOrder;
        if (ao != null && bo != null && ao !== bo) return ao - bo;
        if (ao != null && bo == null) return -1;
        if (ao == null && bo != null) return 1;
        return a.idx - b.idx;
      })
      .map(({ e }) => e);
    // Dedup edge ids inside the scenario — a connector can appear twice
    // in the source XML if TMT was unhappy at save time; keep the first.
    const seenEdge = new Set<string>();
    const edgeIds: string[] = [];
    for (const e of surfaceEdges) {
      if (seenEdge.has(e.id)) continue;
      seenEdge.add(e.id);
      edgeIds.push(e.id);
    }
    const edgeNumbers: Record<string, number> = {};
    edgeIds.forEach((id, i) => (edgeNumbers[id] = i + 1));

    return {
      id: sid,
      name: surf.name || "Diagram",
      description: "",
      nodeIds: [...surfaceNodeIds],
      edgeIds,
      edgeNumbers,
      boundaryIds: [...surfaceBoundaryIds],
      nodeData: {},
      edgeRequestData: {},
      edgeResponseData: {},
    };
  });

  const psDoc: PsDocument = {
    version: 1,
    nodeTypes: [...DEFAULT_NODE_TYPES],
    nodes: [...nodesByGuid.values()],
    edges: [...edgesByGuid.values()],
    boundaries: [...boundariesByGuid.values()],
    scenarios,
    data: [],
    comments: [],
    issues: [],
    deviations: [],
    workItems: [],
  };

  return {
    doc: psDoc,
    activeScenarioId: scenarios.length > 0 ? scenarios[0].id : null,
    summary: {
      scenarioCount: scenarios.length,
      nodeCount: nodesByGuid.size,
      edgeCount: edgesByGuid.size,
      boundaryCount: boundariesByGuid.size,
      surfaceCount: parsedSurfaces.length,
      skippedDanglingEdgeCount: skipped.danglingEdge,
      skippedAnnotationCount: skipped.annotation,
      skippedLineBoundaryCount: skipped.lineBoundary,
    },
  };
}
