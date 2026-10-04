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
// What's intentionally dropped (with counters/diagnostics before replacement):
//   - StencilRectangle (GE.A) free-text annotations — no PsNode analog.
//   - LineBoundary (GE.TB.L) — PsBoundary is rectangle-only, no surface
//     for representing a free-floating line. Future improvement.
// Broken connector references and conflicting identities fail explicitly.
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
  type DfdValue,
  type DfdRole,
  DEFAULT_NODE_TYPES,
  type PsBoundary,
  type PsDocument,
  type PsEdge,
  type PsNode,
  type Scenario,
  uid,
} from "./types";
import { chooseHandles } from "./tmcImport";
import { normalizeDfdValue } from "./dfdSemantics";

export class Tm7ImportError extends Error {}

export interface Tm7ImportSummary {
  scenarioCount: number;
  nodeCount: number;
  edgeCount: number;
  boundaryCount: number;
  // Surfaces seen in the file (= scenarios that will exist).
  surfaceCount: number;
  // Kept for existing consumers. Invalid connector references now fail import.
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
  diagnostics: string[];
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
const NATIVE_PROPERTY_NAMES: Record<string, string> = {
  "71f3d9aa-b8ef-4e54-8126-607a1d903103": "Out Of Scope",
  "752473b6-52d4-4776-9a24-202153f7d579": "Reason For Out Of Scope",
  "15ccd509-98eb-49ad-b9c2-b4a2926d1780": "Dataflow Order",
};

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

function readXsiType(element: Element): string {
  return (element.getAttributeNS("http://www.w3.org/2001/XMLSchema-instance", "type")
    || element.getAttribute("i:type") || element.getAttribute("type") || "").split(":").pop()!;
}

function validGuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || value.toLowerCase() === ZERO_GUID) {
    throw new Tm7ImportError(`Invalid TM7 GUID "${value}".`);
  }
  return value.toLowerCase();
}

function validateEntry(entry: Element, seen: Set<string>): Element {
  const value = firstChild(entry, "Value");
  if (!value) throw new Tm7ImportError("A drawing entry has no Value.");
  const id = validGuid(textOf(firstChild(value, "Guid")));
  const key = textOf(firstChild(entry, "Key"));
  if (key && validGuid(key) !== id) throw new Tm7ImportError(`Drawing key and object GUID disagree for ${id}.`);
  if (seen.has(id)) throw new Tm7ImportError(`Duplicate object GUID ${id} on one tab.`);
  seen.add(id);
  return value;
}

function validateSerialization(root: Element): void {
  const seen = new Set<string>();
  for (const el of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    const ns = "http://schemas.microsoft.com/2003/10/Serialization/";
    const id = el.getAttributeNS(ns, "Id");
    const ref = el.getAttributeNS(ns, "Ref");
    if (ref) throw new Tm7ImportError(`Serialization reference ${ref} is unsupported; save an expanded native TM7 before importing.`);
    if (id && seen.has(id)) throw new Tm7ImportError(`Duplicate XML serialization ID ${id}.`);
    if (id) seen.add(id);
  }
}

function hasElementChildren(element: Element): boolean {
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) return true;
  }
  return false;
}

function readNodeScope(value: Element, node: ParsedNode, tab: string, diagnostics: string[]): DfdValue | undefined {
  const props = firstChild(value, "Properties");
  const flag = textOf(findPropertyValue(props, "Out Of Scope"));
  const reason = textOf(findPropertyValue(props, "Reason For Out Of Scope"));
  const enabled = flag === "true" || flag === "1";
  const prefix = `Node ${node.id} on "${tab}": `;
  const normalizedReason = normalizeDfdValue(reason);
  if (typeof normalizedReason !== "string") {
    diagnostics.push(prefix + "scope reason exceeds the native model's supported text bound; only inactive, truncated recovery evidence is retained. Keep the original TM7.");
    return normalizedReason;
  }
  if (flag && !["true", "false", "1", "0"].includes(flag)) {
    diagnostics.push(prefix + `unrecognized scope flag "${flag}"; scope is not activated and its reason is omitted.`);
    return undefined;
  }
  if (node.role === "ExternalInteractor") {
    if (enabled || reason) diagnostics.push(prefix + "External Interactors cannot be out of scope; any reason is retained only as inactive evidence.");
    return reason || undefined;
  }
  if (enabled && !reason) {
    diagnostics.push(prefix + "Out Of Scope has no reason; it cannot activate reason-based scenario scope. No reason was fabricated.");
    return undefined;
  }
  if (!enabled && reason) {
    diagnostics.push(prefix + "scope flag is false or absent but a reason is present; the contradictory reason is omitted to avoid activating exclusion.");
    return undefined;
  }
  return enabled ? reason : undefined;
}

function reportExtraProperties(value: Element, tab: string, diagnostics: string[]): void {
  const typeId = textOf(firstChild(value, "TypeId"));
  if (typeId && typeId !== textOf(firstChild(value, "GenericTypeId"))) {
    diagnostics.push(`Stencil type "${typeId}" on ${textOf(firstChild(value, "Guid"))}, tab "${tab}", is reduced to its generic drawing type; custom behavior is not imported.`);
  }
  const props = firstChild(value, "Properties");
  if (!props) return;
  for (const attr of childElements(props, "anyType")) {
    if (readXsiType(attr) === "HeaderDisplayAttribute") continue;
    const name = propertyName(attr);
    if (["Name", "Out Of Scope", "Reason For Out Of Scope", "Dataflow Order"].includes(name)) continue;
    if (textOf(firstChild(attr, "Value"))) {
      diagnostics.push(`Property "${name || "(unnamed)"}" on ${textOf(firstChild(value, "Guid"))}, tab "${tab}", is not imported.`);
    }

  }
}

function propertyName(attribute: Element): string {
  const id = textOf(firstChild(attribute, "Name")).toLowerCase();
  return Object.hasOwn(NATIVE_PROPERTY_NAMES, id) ? NATIVE_PROPERTY_NAMES[id]
    : textOf(firstChild(attribute, "DisplayName"));
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
  let result: Element | null = null;
  let found = false;
  for (const child of childElements(properties, "anyType")) {
    const dn = propertyName(child);
    if (dn !== displayName) continue;
    if (found) throw new Tm7ImportError(`Duplicate native property "${displayName}".`);
    found = true;
    result = firstChild(child, "Value");
  }
  return result;
}

// Read the stencil's "headline" — first HeaderDisplayAttribute in the
// Properties block (e.g. "Web API", "Azure Cosmos DB"). Used as the
// stencil's TMT class identity; preserved in the imported node's
// description for context.
function readStencilHeader(properties: Element | null): string {
  if (!properties) return "";
  for (const child of childElements(properties, "anyType")) {
    const xsiType = readXsiType(child);
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
  role: DfdValue;
  scopeReason?: DfdValue;
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
  const xsiType = readXsiType(value);
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
    const roles: Record<string, { role: DfdRole; shape: string }> = {
      [GTI_PROCESS]: { role: "Process", shape: "StencilEllipse" },
      [GTI_EXTERNAL]: { role: "ExternalInteractor", shape: "StencilRectangle" },
      [GTI_DATASTORE]: { role: "DataStore", shape: "StencilParallelLines" },
    };
    const native = NODE_GTIS.has(genericTypeId) ? roles[genericTypeId] : undefined;
    if (native && xsiType && native.shape !== xsiType) {
      throw new Tm7ImportError(`Node ${guid} has conflicting native role ${genericTypeId} and shape ${xsiType}.`);
    }
    const typeId = textOf(firstChild(value, "TypeId"));
    if (native && NODE_GTIS.has(typeId) && typeId !== genericTypeId) {
      throw new Tm7ImportError(`Node ${guid} has conflicting native role IDs ${genericTypeId} and ${typeId}.`);
    }
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
        role: native?.role ?? { invalid: `Unsupported TM7 role ${genericTypeId || xsiType}` },
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
  const xsiType = readXsiType(value);
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
  id: string;
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

function parseSurface(surface: Element, diagnostics: string[]): ParsedSurface {
  const nativeId = textOf(firstChild(surface, "Guid"));
  const out: ParsedSurface = {
    id: nativeId ? validGuid(nativeId) : uid("s"),
    name: "Diagram",
    nodes: [],
    boundaries: [],
    edges: [],
    annotations: 0,
    lineBoundaries: 0,
  };
  if (!nativeId) diagnostics.push("A tab has no native GUID; a new scenario identity was assigned.");

  // Tab name lives in Properties as a StringDisplayAttribute "Name".
  const properties = firstChild(surface, "Properties");
  const tabName = textOf(findPropertyValue(properties, "Name"));
  if (tabName) out.name = tabName;

  const borders = firstChild(surface, "Borders");
  const seen = new Set<string>();
  if (borders) {
    for (const entry of childElements(borders, "KeyValueOfguidanyType")) {
      const value = validateEntry(entry, seen);
      const parsed = parseBorderEntry(entry);
      if (parsed.kind === "node" && parsed.node) {
        parsed.node.scopeReason = readNodeScope(value, parsed.node, out.name, diagnostics);
        if (typeof parsed.node.role !== "string") {
          diagnostics.push(`Node ${parsed.node.id} on "${out.name}": ${parsed.node.role.invalid}. Retained as an unresolved DFD override, not a verified Process.`);
        }
        out.nodes.push(parsed.node);
      } else if (parsed.kind === "boundary" && parsed.boundary) {
        out.boundaries.push(parsed.boundary);
        const props = firstChild(value, "Properties");
        if (["true", "1"].includes(textOf(findPropertyValue(props, "Out Of Scope"))) ||
            textOf(findPropertyValue(props, "Reason For Out Of Scope"))) {
          diagnostics.push(`Boundary scope on "${out.name}" is not mapped; only node scenario scope is supported.`);
        }
      } else if (parsed.kind === "annotation") {
        out.annotations++;
      } else {
        diagnostics.push(`Unsupported border ${textOf(firstChild(value, "Guid"))} on "${out.name}" is omitted.`);
      }
      reportExtraProperties(value, out.name, diagnostics);
    }
  }

  const lines = firstChild(surface, "Lines");
  if (lines) {
    for (const entry of childElements(lines, "KeyValueOfguidanyType")) {
      const value = validateEntry(entry, seen);
      const parsed = parseLineEntry(entry);
      if (parsed.kind === "edge" && parsed.edge) {
        out.edges.push(parsed.edge);
      } else if (parsed.kind === "lineBoundary") {
        out.lineBoundaries++;
      } else {
        diagnostics.push(`Unsupported line ${textOf(firstChild(value, "Guid"))} on "${out.name}" is omitted.`);
      }
      reportExtraProperties(value, out.name, diagnostics);
      const props = firstChild(value, "Properties");
      if (["true", "1"].includes(textOf(findPropertyValue(props, "Out Of Scope"))) ||
          textOf(findPropertyValue(props, "Reason For Out Of Scope"))) {
        diagnostics.push(`Flow/boundary scope on "${out.name}" is not mapped; only node scenario scope is supported.`);
      }
    }
  }

  return out;
}

// ---- Entry point --------------------------------------------------------

export function parseTm7(xmlText: string): Tm7ImportResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) {
    throw new Tm7ImportError("DTD/entity declarations are not supported in TM7 imports.");
  }
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
  if (doc.getElementsByTagNameNS("*", "parsererror").length) {
    throw new Tm7ImportError("Malformed TM7 XML. The current diagram has not been replaced.");
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

  validateSerialization(doc.documentElement);
  const diagnostics: string[] = [];
  const parsedSurfaces = surfaces.map(surface => parseSurface(surface, diagnostics));
  const surfaceIds = new Set<string>();
  const objectKinds = new Map<string, string>();
  for (const surface of parsedSurfaces) {
    if (surfaceIds.has(surface.id)) throw new Tm7ImportError(`Duplicate tab GUID ${surface.id}.`);
    surfaceIds.add(surface.id);
    for (const [kind, objects] of [["node", surface.nodes], ["edge", surface.edges], ["boundary", surface.boundaries]] as const) {
      for (const object of objects) {
        const previous = objectKinds.get(object.id);
        if (previous && previous !== kind) throw new Tm7ImportError(`GUID ${object.id} is shared by incompatible object kinds.`);
        objectKinds.set(object.id, kind);
      }
    }
  }
  for (const id of surfaceIds) {
    if (objectKinds.has(id)) throw new Tm7ImportError(`GUID ${id} is shared by a tab and an object.`);
  }
  const threats = firstChild(doc.documentElement, "ThreatInstances");
  if (threats && hasElementChildren(threats)) {
    diagnostics.push("Native threat instances, authored text, mitigation/justification and status are not imported. Keep the original TM7; this is not a complete threat import.");
  }
  for (const name of ["Notes", "MetaInformation"]) {
    const section = firstChild(doc.documentElement, name);
    if (textOf(section)) diagnostics.push(`${name} content is not imported.`);
  }
  const knowledgeBase = firstChild(doc.documentElement, "KnowledgeBase");
  if (knowledgeBase) diagnostics.push("Template definitions, rules and custom stencil behavior are not imported; only supported native drawing properties are mapped.");

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
      const previous = nodesByGuid.get(n.id);
      if (previous) {
        if (JSON.stringify(previous.dfdRoleOverride) !== JSON.stringify(n.role)) {
          throw new Tm7ImportError(`Node ${n.id} has conflicting DFD roles across tabs. Correct the original TM7 before importing.`);
        }
        if (previous.title !== n.title || previous.serviceTreeId !== n.serviceTreeId ||
            previous.description !== n.description || JSON.stringify(previous.position) !== JSON.stringify(n.position)) {
          diagnostics.push(`Shared node ${n.id} has different labels, metadata or positions across tabs; the first occurrence is retained.`);
        }
        continue;
      }
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
        dfdRoleOverride: n.role,
      });
    }
    for (const b of surf.boundaries) {
      const previous = boundariesByGuid.get(b.id);
      if (previous) {
        if (previous.title !== b.title || JSON.stringify(previous.position) !== JSON.stringify(b.position) ||
            JSON.stringify(previous.size) !== JSON.stringify(b.size)) {
          diagnostics.push(`Shared boundary ${b.id} differs across tabs; the first occurrence is retained.`);
        }
        continue;
      }
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

  // Each connector must resolve to node occurrences on its own tab.
  for (const surf of parsedSurfaces) {
    const localNodes = new Set(surf.nodes.map(node => node.id));
    for (const e of surf.edges) {
      if (
        e.endpointMissing ||
        !localNodes.has(e.source) ||
        !localNodes.has(e.target)
      ) {
        throw new Tm7ImportError(`Flow ${e.id} on "${surf.name}" has an endpoint missing from that tab. Correct its references before importing.`);
      }
      const previous = edgesByGuid.get(e.id);
      if (previous) {
        if (previous.source !== e.source || previous.target !== e.target) {
          throw new Tm7ImportError(`Flow ${e.id} has conflicting endpoints across tabs.`);
        }
        if (previous.title !== e.title || JSON.stringify(previous.authenticationTypes) !== JSON.stringify(e.authenticationTypes)) {
          diagnostics.push(`Shared flow ${e.id} has different labels/authentication across tabs; the first occurrence is retained.`);
        }
        continue;
      }
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
    const sid = surf.id;
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
    if (surfaceEdges.some(e => e.dataflowOrder !== null && e.dataflowOrder !== edgeNumbers[e.id])) {
      diagnostics.push(`Flow numbering on "${surf.name}" is compacted to sequential values on import.`);
    }

    return {
      id: sid,
      name: surf.name || "Diagram",
      description: "",
      nodeIds: [...surfaceNodeIds],
      nodeScopeReasons: Object.fromEntries(surf.nodes.filter(n => n.scopeReason !== undefined).map(n => [n.id, n.scopeReason!])),
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
    diagnostics: [...new Set(diagnostics)],
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
