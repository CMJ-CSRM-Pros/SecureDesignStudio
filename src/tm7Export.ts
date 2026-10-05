// Microsoft Threat Modeling Tool (.tm7) export.
//
// Emits a single XML file whose schema matches what the desktop TMT app
// reads on Open. Each SecureDesignStudio scenario becomes a separate
// `<DrawingSurfaceModel>` (tab in TMT). If the document has no scenarios,
// a single "Diagram" tab is generated holding everything.
//
// What's mapped:
//   - PsNode  -> standard Process/Data Store/External Interactor with title + an
//                optional second line "ST: <serviceTreeId>".
//   - PsEdge  -> Connector (TypeId="GE.DF") with the sequence number, edge
//                title, and any selected auth types appended as "Auth: …".
//   - PsBoundary (type === "security") -> BorderBoundary (TypeId="GE.TB.B")
//                with the boundary title.
//
// What's intentionally omitted:
//   - Privacy boundaries and data items (per export spec).
//   - Per-edge `description`, `audience`, `constraints`,
//     `productionIdentity`, `requiredAccessRights` (no native mapping).
//   - Per-node `description`, `endpointRegex` (no clean TM7 surface).
//   - Ordinary issues/comments and automated findings. Explicit authored threat
//     notes use native User-defined records, aggregated per native interaction.
//
// The bundled KnowledgeBase is the minimum needed for TMT to render the
// generic stencils we reference (GE.P, GE.DS, GE.EI, GE.DF, GE.TB.B). Icons are omitted
// so the bundle stays tiny; TMT falls back to its default ellipse/line
// rendering when ImageSource is empty. Native compatibility needs separate
// open/save/reopen observations; XML checks alone are not that evidence.

import type {
  AuthenticationType,
  DfdRole,
  PsBoundary,
  PsDocument,
  PsEdge,
  PsNode,
  PsTextAnnotation,
  PsIssue,
  Scenario,
} from "./types";
import { authenticationCatalogFor, authTypeLabel, BOUNDARY_NETWORK_FIELDS, formatBoundaryNetworkText, formatRequiredAccessRights, securityBoundaryTypeLabel, type AuthTypeDef } from "./types";
import { resolveNodeReviewScope } from "./dfdSemantics";
import { isAuthoredThreatNote, validateThreatNotes } from "./threatNotes";

export class Tm7ExportError extends Error {}

export interface Tm7OccurrenceReference {
  kind: "node" | "edge" | "boundary" | "annotation";
  entityId: string;
  scenarioId: string | null;
  tabGuid: string;
  objectGuid: string;
  serializationId: string;
}

export interface Tm7ExportResult {
  xml: string;
  diagnostics: string[];
  references: Tm7OccurrenceReference[];
}

const NATIVE_ROLES: Record<DfdRole, { id: string; name: string; shape: string; representation: string }> = {
  Process: { id: "GE.P", name: "Generic Process", shape: "StencilEllipse", representation: "Ellipse" },
  DataStore: { id: "GE.DS", name: "Generic Data Store", shape: "StencilParallelLines", representation: "ParallelLines" },
  ExternalInteractor: { id: "GE.EI", name: "Generic External Interactor", shape: "StencilRectangle", representation: "Rectangle" },
};

// XML namespace URIs used throughout TM7 — pulled out to keep the
// templates legible.
const NS_MODEL = "http://schemas.datacontract.org/2004/07/ThreatModeling.Model";
const NS_ABSTRACTS =
  "http://schemas.datacontract.org/2004/07/ThreatModeling.Model.Abstracts";
const NS_KB =
  "http://schemas.datacontract.org/2004/07/ThreatModeling.KnowledgeBase";
const NS_ARRAYS = "http://schemas.microsoft.com/2003/10/Serialization/Arrays";
const NS_SERIALIZATION = "http://schemas.microsoft.com/2003/10/Serialization/";
const NS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
const NS_XSD = "http://www.w3.org/2001/XMLSchema";

// Property GUIDs that TMT bakes into stencil attribute identifiers. Stable
// across all .tm7 files I've seen; surfacing them by name so reviewers can
// spot what they are without diving into the spec.
const PROP_OUT_OF_SCOPE_NAME = "71f3d9aa-b8ef-4e54-8126-607a1d903103";
const PROP_REASON_OUT_OF_SCOPE_NAME = "752473b6-52d4-4776-9a24-202153f7d579";
const PROP_DATAFLOW_ORDER_NAME = "15ccd509-98eb-49ad-b9c2-b4a2926d1780";

// Default geometry for nodes without an explicit size. PsNode has only a
// position; we center a 100x100 ellipse on that point so TMT's auto-layout
// roughly matches what the user sees in SecureDesignStudio.
const NODE_W = 100;
const NODE_H = 100;

// Fallback for a scenario tab with zero positioned content — render a
// dummy 1600x1200 surface so TMT has something to draw the empty tab on.
const FALLBACK_TAB_W = 1600;
const FALLBACK_TAB_H = 1200;

function xmlEscape(s: string): string {
  if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(s)) {
    throw new Tm7ExportError("Text contains characters that XML 1.0 cannot represent. Correct the text before exporting.");
  }
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return c;
    }
  }).replace(/\r/g, "&#13;");
}

// RFC 4122 v4 GUID. Prefer crypto.randomUUID() when present (every modern
// browser + Node 19+); fall back to a Math.random-seeded variant so the
// export still works in older environments.
function newGuid(): string {
  const g = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto;
  if (g?.randomUUID) {
    return g.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

// Monotonically-increasing `z:Id` counter. TM7 uses these as serialization
// references; they must be unique across the whole file (not just per tab),
// hence the closure-scoped counter we hand around as a small mutable state.
interface IdGen {
  next(): string;
}
function makeIdGen(): IdGen {
  let n = 0;
  return {
    next() {
      n += 1;
      return `i${n}`;
    },
  };
}

interface BuildCtx {
  inventoryLabel: string;
  ids: IdGen;
  authenticationCatalog: readonly AuthTypeDef[];
  catalogDefinitions: PsDocument["catalogDefinitions"];
  nodeTypes: PsDocument["nodeTypes"];
  scenario?: Scenario;
  tabGuid: string;
  references: Tm7OccurrenceReference[];
  diagnostics: string[];
  // Per-surface offset applied to every coordinate so TMT's validator
  // doesn't see negative Left/Top/SourceX/etc. The app's canvas allows
  // arbitrary panning (negative positions are common); TMT requires
  // non-negative integer coordinates and flags anything else as
  // "Border/Line element coordinates are corrupted".
  offsetX: number;
  offsetY: number;
}

function occurrenceId(kind: Tm7OccurrenceReference["kind"], entityId: string, ctx: BuildCtx): string {
  const serializationId = ctx.ids.next();
  ctx.references.push({ kind, entityId, scenarioId: ctx.scenario?.id ?? null,
    tabGuid: ctx.tabGuid, objectGuid: safeGuid(entityId), serializationId });
  return serializationId;
}

// Leave some breathing room from the top-left of the TMT canvas so
// stencils aren't clipped against the toolbar.
const SURFACE_MARGIN = 50;

// ---------- Per-stencil renderers ----------

function renderHeader(displayName: string): string {
  return (
    `        <a:anyType i:type="b:HeaderDisplayAttribute" xmlns:b="${NS_KB}">` +
    `<b:DisplayName>${xmlEscape(displayName)}</b:DisplayName>` +
    `<b:Name /><b:Value i:nil="true" /></a:anyType>\n`
  );
}

function renderStringAttr(
  displayName: string,
  value: string,
  nameGuid?: string
): string {
  // `b:Name` is either empty (built-in "Name" property) or a stable GUID
  // identifying the attribute. Empty values still emit an empty xsi:string
  // element so TMT can round-trip the field.
  const nameElt = nameGuid ? `<b:Name>${nameGuid}</b:Name>` : `<b:Name />`;
  const valueElt =
    value === ""
      ? `<b:Value i:type="c:string" xmlns:c="${NS_XSD}" />`
      : `<b:Value i:type="c:string" xmlns:c="${NS_XSD}">${xmlEscape(value)}</b:Value>`;
  return (
    `        <a:anyType i:type="b:StringDisplayAttribute" xmlns:b="${NS_KB}">` +
    `<b:DisplayName>${xmlEscape(displayName)}</b:DisplayName>` +
    `${nameElt}${valueElt}</a:anyType>\n`
  );
}

function renderBoolAttr(
  displayName: string,
  value: boolean,
  nameGuid: string
): string {
  return (
    `        <a:anyType i:type="b:BooleanDisplayAttribute" xmlns:b="${NS_KB}">` +
    `<b:DisplayName>${xmlEscape(displayName)}</b:DisplayName>` +
    `<b:Name>${nameGuid}</b:Name>` +
    `<b:Value i:type="c:boolean" xmlns:c="${NS_XSD}">${value}</b:Value>` +
    `</a:anyType>\n`
  );
}

function nodeLabel(node: PsNode, inventoryLabel: string): string {
  const stId = node.serviceTreeId?.trim();
  const title = (node.title ?? "").trim() || "(unnamed)";
  return stId ? `${title}\n${inventoryLabel}: ${stId}` : title;
}

function edgeLabel(
  edge: PsEdge,
  seq: number | undefined,
  catalog: readonly AuthTypeDef[],
): string {
  const seqPart = seq != null ? `${seq}. ` : "";
  const title = (edge.title ?? "").trim();
  const auths = (edge.authenticationTypes ?? []).filter((a) => !!a);
  const head = `${seqPart}${title || "(untitled)"}`;
  if (auths.length === 0) return head;
  const authText = auths
    .map((a) => authTypeLabel(a, catalog))
    .join(", ");
  return `${head}\nAuth: ${authText}\nAuth IDs: ${JSON.stringify(auths)}`;
}

function renderNode(node: PsNode, ctx: BuildCtx): string {
  const scope = resolveNodeReviewScope(node, ctx.scenario, ctx.nodeTypes);
  if (scope.role.confidence === "unresolved") {
    throw new Tm7ExportError(`Node "${node.title}" (${node.id}) has an unresolved DFD role. Correct it before exporting.`);
  }
  for (const diagnostic of scope.diagnostics) {
    ctx.diagnostics.push(`Node "${node.title}" (${node.id}), tab "${ctx.scenario?.name ?? "Diagram"}": ${diagnostic}`);
  }
  const native = NATIVE_ROLES[scope.role.role];
  const zid = occurrenceId("node", node.id, ctx);
  // PsNode has no width/height; render as a centered 100x100 ellipse.
  const left = Math.max(0, Math.round(node.position.x - NODE_W / 2 + ctx.offsetX));
  const top = Math.max(0, Math.round(node.position.y - NODE_H / 2 + ctx.offsetY));
  return (
    `      <a:KeyValueOfguidanyType>\n` +
    `        <a:Key>${safeGuid(node.id)}</a:Key>\n` +
    `        <a:Value z:Id="${zid}" i:type="${native.shape}">\n` +
    `          <GenericTypeId xmlns="${NS_ABSTRACTS}">${native.id}</GenericTypeId>\n` +
    `          <Guid xmlns="${NS_ABSTRACTS}">${safeGuid(node.id)}</Guid>\n` +
    `          <Properties xmlns="${NS_ABSTRACTS}">\n` +
    renderHeader(native.name) +
    renderStringAttr("Name", nodeLabel(node, ctx.inventoryLabel)) +
    renderBoolAttr("Out Of Scope", scope.disposition === "outOfScope", PROP_OUT_OF_SCOPE_NAME) +
    renderStringAttr(
      "Reason For Out Of Scope",
      scope.effectiveReason,
      PROP_REASON_OUT_OF_SCOPE_NAME
    ) +
    `          </Properties>\n` +
    `          <TypeId xmlns="${NS_ABSTRACTS}">${native.id}</TypeId>\n` +
    `          <Height xmlns="${NS_ABSTRACTS}">${NODE_H}</Height>\n` +
    `          <Left xmlns="${NS_ABSTRACTS}">${left}</Left>\n` +
    `          <StrokeDashArray i:nil="true" xmlns="${NS_ABSTRACTS}" />\n` +
    `          <StrokeThickness xmlns="${NS_ABSTRACTS}">1</StrokeThickness>\n` +
    `          <Top xmlns="${NS_ABSTRACTS}">${top}</Top>\n` +
    `          <Width xmlns="${NS_ABSTRACTS}">${NODE_W}</Width>\n` +
    `        </a:Value>\n` +
    `      </a:KeyValueOfguidanyType>\n`
  );
}

function securityBoundaryLabel(b: PsBoundary, saved: PsDocument["catalogDefinitions"]): string {
  const title = (b.title ?? "").trim() || "(unnamed boundary)";
  const subtypeId = b.securitySubtype?.trim();
  if (!subtypeId) return title;
  const subtypeLabel = securityBoundaryTypeLabel(subtypeId, saved);
  return `${title} (${subtypeLabel})`;
}

function renderSecurityBoundary(b: PsBoundary, ctx: BuildCtx): string {
  const zid = occurrenceId("boundary", b.id, ctx);
  const left = Math.max(0, Math.round(b.position.x + ctx.offsetX));
  const top = Math.max(0, Math.round(b.position.y + ctx.offsetY));
  const w = Math.max(40, Math.round(b.size.width));
  const h = Math.max(40, Math.round(b.size.height));
  return (
    `      <a:KeyValueOfguidanyType>\n` +
    `        <a:Key>${safeGuid(b.id)}</a:Key>\n` +
    `        <a:Value z:Id="${zid}" i:type="BorderBoundary">\n` +
    `          <GenericTypeId xmlns="${NS_ABSTRACTS}">GE.TB.B</GenericTypeId>\n` +
    `          <Guid xmlns="${NS_ABSTRACTS}">${safeGuid(b.id)}</Guid>\n` +
    `          <Properties xmlns="${NS_ABSTRACTS}">\n` +
    renderHeader("Generic Trust Border Boundary") +
    renderStringAttr("Name", securityBoundaryLabel(b, ctx.catalogDefinitions)) +
    renderStringAttr("Dataflow Order", "0", PROP_DATAFLOW_ORDER_NAME) +
    `          </Properties>\n` +
    `          <TypeId xmlns="${NS_ABSTRACTS}">GE.TB.B</TypeId>\n` +
    `          <Height xmlns="${NS_ABSTRACTS}">${h}</Height>\n` +
    `          <Left xmlns="${NS_ABSTRACTS}">${left}</Left>\n` +
    `          <StrokeDashArray i:nil="true" xmlns="${NS_ABSTRACTS}" />\n` +
    `          <StrokeThickness xmlns="${NS_ABSTRACTS}">1</StrokeThickness>\n` +
    `          <Top xmlns="${NS_ABSTRACTS}">${top}</Top>\n` +
    `          <Width xmlns="${NS_ABSTRACTS}">${w}</Width>\n` +
    `        </a:Value>\n` +
    `      </a:KeyValueOfguidanyType>\n`
  );
}

function renderAnnotation(annotation: PsTextAnnotation, ctx: BuildCtx): string {
  const zid = occurrenceId("annotation", annotation.id, ctx);
  return `      <a:KeyValueOfguidanyType>
        <a:Key>${safeGuid(annotation.id)}</a:Key>
        <a:Value z:Id="${zid}" i:type="StencilRectangle">
          <GenericTypeId xmlns="${NS_ABSTRACTS}">GE.A</GenericTypeId>
          <Guid xmlns="${NS_ABSTRACTS}">${safeGuid(annotation.id)}</Guid>
          <Properties xmlns="${NS_ABSTRACTS}">
${renderHeader("Generic Annotation")}${renderStringAttr("Name", annotation.text)}
          </Properties>
          <TypeId xmlns="${NS_ABSTRACTS}">GE.A</TypeId>
          <Height xmlns="${NS_ABSTRACTS}">${Math.max(1, Math.round(annotation.size.height))}</Height>
          <Left xmlns="${NS_ABSTRACTS}">${Math.max(0, Math.round(annotation.position.x + ctx.offsetX))}</Left>
          <Top xmlns="${NS_ABSTRACTS}">${Math.max(0, Math.round(annotation.position.y + ctx.offsetY))}</Top>
          <Width xmlns="${NS_ABSTRACTS}">${Math.max(1, Math.round(annotation.size.width))}</Width>
        </a:Value>
      </a:KeyValueOfguidanyType>
`;
}

function renderEdge(
  edge: PsEdge,
  seq: number | undefined,
  nodeById: Map<string, PsNode>,
  ctx: BuildCtx
): string {
  const zid = occurrenceId("edge", edge.id, ctx);
  const src = nodeById.get(edge.source);
  const tgt = nodeById.get(edge.target);
  if (!src || !tgt) throw new Tm7ExportError(`Flow ${edge.id} has an endpoint absent from its tab.`);
  const sx = Math.max(0, Math.round(src.position.x + ctx.offsetX));
  const sy = Math.max(0, Math.round(src.position.y + ctx.offsetY));
  const tx = Math.max(0, Math.round(tgt.position.x + ctx.offsetX));
  const ty = Math.max(0, Math.round(tgt.position.y + ctx.offsetY));
  const hx = Math.round((sx + tx) / 2);
  const hy = Math.round((sy + ty) / 2);
  return (
    `      <a:KeyValueOfguidanyType>\n` +
    `        <a:Key>${safeGuid(edge.id)}</a:Key>\n` +
    `        <a:Value z:Id="${zid}" i:type="Connector">\n` +
    `          <GenericTypeId xmlns="${NS_ABSTRACTS}">GE.DF</GenericTypeId>\n` +
    `          <Guid xmlns="${NS_ABSTRACTS}">${safeGuid(edge.id)}</Guid>\n` +
    `          <Properties xmlns="${NS_ABSTRACTS}">\n` +
    renderHeader("Generic Data Flow") +
    renderStringAttr("Name", edgeLabel(edge, seq, ctx.authenticationCatalog)) +
    renderStringAttr("Dataflow Order", String(seq ?? 0), PROP_DATAFLOW_ORDER_NAME) +
    renderBoolAttr("Out Of Scope", false, PROP_OUT_OF_SCOPE_NAME) +
    renderStringAttr(
      "Reason For Out Of Scope",
      "",
      PROP_REASON_OUT_OF_SCOPE_NAME
    ) +
    `          </Properties>\n` +
    `          <TypeId xmlns="${NS_ABSTRACTS}">GE.DF</TypeId>\n` +
    `          <HandleX xmlns="${NS_ABSTRACTS}">${hx}</HandleX>\n` +
    `          <HandleY xmlns="${NS_ABSTRACTS}">${hy}</HandleY>\n` +
    `          <PortSource xmlns="${NS_ABSTRACTS}">East</PortSource>\n` +
    `          <PortTarget xmlns="${NS_ABSTRACTS}">West</PortTarget>\n` +
    `          <SourceGuid xmlns="${NS_ABSTRACTS}">${safeGuid(edge.source)}</SourceGuid>\n` +
    `          <SourceX xmlns="${NS_ABSTRACTS}">${sx}</SourceX>\n` +
    `          <SourceY xmlns="${NS_ABSTRACTS}">${sy}</SourceY>\n` +
    `          <TargetGuid xmlns="${NS_ABSTRACTS}">${safeGuid(edge.target)}</TargetGuid>\n` +
    `          <TargetX xmlns="${NS_ABSTRACTS}">${tx}</TargetX>\n` +
    `          <TargetY xmlns="${NS_ABSTRACTS}">${ty}</TargetY>\n` +
    `        </a:Value>\n` +
    `      </a:KeyValueOfguidanyType>\n`
  );
}

// ---------- Tab (DrawingSurfaceModel) ----------

interface TabContent {
  guid: string;
  scenario?: Scenario;
  name: string;
  nodes: PsNode[];
  edges: PsEdge[];
  // Sequence number per edge id (1-based). Missing -> blank in the label.
  edgeNumbers: Record<string, number>;
  // Security boundaries only.
  boundaries: PsBoundary[];
  textAnnotations: PsTextAnnotation[];
}

function computeSurfaceOffset(tab: TabContent): { offsetX: number; offsetY: number } {
  // Find the min x/y across all positioned elements on this surface so we
  // can translate everything into the positive quadrant with a margin.
  // TMT's validator rejects negative coordinates ("element coordinates are
  // corrupted") and tries to "correct" the file on load.
  let minX = Infinity;
  let minY = Infinity;
  for (const n of tab.nodes) {
    minX = Math.min(minX, n.position.x - NODE_W / 2);
    minY = Math.min(minY, n.position.y - NODE_H / 2);
  }
  for (const b of [...tab.boundaries, ...tab.textAnnotations]) {
    minX = Math.min(minX, b.position.x);
    minY = Math.min(minY, b.position.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { offsetX: 0, offsetY: 0 };
  }
  return {
    offsetX: SURFACE_MARGIN - minX,
    offsetY: SURFACE_MARGIN - minY,
  };
}

function renderDrawingSurface(tab: TabContent, ctx: BuildCtx): string {
  const surfaceZid = ctx.ids.next();
  const nodeById = new Map(tab.nodes.map((n) => [n.id, n]));
  const { offsetX, offsetY } = computeSurfaceOffset(tab);
  const surfaceCtx: BuildCtx = { ...ctx, offsetX, offsetY, scenario: tab.scenario, tabGuid: tab.guid };
  const bordersXml =
    tab.boundaries.map((b) => renderSecurityBoundary(b, surfaceCtx)).join("") +
    tab.textAnnotations.map(annotation => renderAnnotation(annotation, surfaceCtx)).join("") +
    tab.nodes.map((n) => renderNode(n, surfaceCtx)).join("");
  const linesXml = tab.edges
    .map((e) => renderEdge(e, tab.edgeNumbers[e.id], nodeById, surfaceCtx))
    .join("");

  return (
    `    <DrawingSurfaceModel z:Id="${surfaceZid}" xmlns:z="${NS_SERIALIZATION}">\n` +
    `      <GenericTypeId xmlns="${NS_ABSTRACTS}">DRAWINGSURFACE</GenericTypeId>\n` +
    `      <Guid xmlns="${NS_ABSTRACTS}">${tab.guid}</Guid>\n` +
    `      <Properties xmlns="${NS_ABSTRACTS}" xmlns:a="${NS_ARRAYS}">\n` +
    renderHeader("Diagram") +
    renderStringAttr("Name", tab.name || "Diagram") +
    `      </Properties>\n` +
    `      <TypeId xmlns="${NS_ABSTRACTS}">DRAWINGSURFACE</TypeId>\n` +
    `      <Borders xmlns:a="${NS_ARRAYS}">\n` +
    bordersXml +
    `      </Borders>\n` +
    `      <Lines xmlns:a="${NS_ARRAYS}">\n` +
    linesXml +
    `      </Lines>\n` +
    `      <Zoom>1</Zoom>\n` +
    `    </DrawingSurfaceModel>\n`
  );
}

// Convert a PsNode/Edge/Boundary id (an opaque app-internal string) into a
// stable GUID — TM7 keys/Guids are strictly GUID-formatted. We do a v5-ish
// SHA-style hash so the same id always maps to the same GUID across exports
// from the same document; this lets ThreatInstances / Connectors reference
// the same node even when the source id isn't already a GUID.
function safeGuid(id: string): string {
  if (isGuid(id)) return id.toLowerCase();
  // FNV-1a 32-bit hash, run twice with different seeds to produce 128 bits.
  // Not cryptographic; just deterministic and well-distributed enough that
  // collisions inside a single diagram are astronomically unlikely.
  const hash = (seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const a = hash(0x811c9dc5).toString(16).padStart(8, "0");
  const b = hash(0x1234abcd).toString(16).padStart(8, "0");
  const c = hash(0xfeedface).toString(16).padStart(8, "0");
  const d = hash(0xdeadbeef).toString(16).padStart(8, "0");
  return `${a}-${b.slice(0, 4)}-${b.slice(4, 8)}-${c.slice(0, 4)}-${c.slice(4, 8)}${d}`;
}

function isGuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

// ---------- Knowledge base ----------

// The standard PropertiesMetaData block. TMT's KnowledgeBase
// deserializer (`ThreatMetaData..ctor(SerializableThreatMetaData s)`)
// throws a NullReferenceException when this section is missing or
// empty — it iterates the standard entries by name and dereferences
// them unconditionally. Copying the 9 entries Microsoft ships with the
// Azure Threat Model Template is the simplest way to keep the file
// loadable; we use the placeholder GUID `222...` for every Id since
// these are deserialization-internal identifiers TMT regenerates on
// Analyze. Values are intentionally blank / nil for free-form
// metadata; only Priority and SDLPhase need pre-populated enum values.
function renderThreatMetaData(): string {
  const datum = (
    name: string,
    label: string,
    hide: boolean,
    values: string | null,
    attrType: 0 | 1 | 2
  ): string => {
    const valuesElt =
      values == null
        ? `          <Values i:nil="true" xmlns:b="${NS_ARRAYS}" />\n`
        : values === ""
          ? `          <Values xmlns:b="${NS_ARRAYS}">\n            <b:string />\n          </Values>\n`
          : `          <Values xmlns:b="${NS_ARRAYS}">\n${values}          </Values>\n`;
    return (
      `        <ThreatMetaDatum>\n` +
      `          <Name>${name}</Name>\n` +
      `          <Label>${xmlEscape(label)}</Label>\n` +
      `          <HideFromUI>${hide}</HideFromUI>\n` +
      valuesElt +
      `          <Id>22222222-2222-2222-2222-222222222222</Id>\n` +
      `          <AttributeType>${attrType}</AttributeType>\n` +
      `        </ThreatMetaDatum>\n`
    );
  };
  const priorityValues =
    `            <b:string>High</b:string>\n` +
    `            <b:string>Medium</b:string>\n` +
    `            <b:string>Low</b:string>\n`;
  const sdlValues =
    `            <b:string>Design</b:string>\n` +
    `            <b:string>Implementation</b:string>\n`;
  return (
    `    <a:ThreatMetaData>\n` +
    `      <IsPriorityUsed>true</IsPriorityUsed>\n` +
    `      <IsStatusUsed>true</IsStatusUsed>\n` +
    `      <PropertiesMetaData>\n` +
    datum("Title", "Title", false, "", 0) +
    datum("UserThreatCategory", "STRIDE Category", false, null, 0) +
    datum("UserThreatShortDescription", "Short Description", true, "", 0) +
    datum("UserThreatDescription", "Description", false, "", 0) +
    datum("StateInformation", "Justification", false, "", 0) +
    datum("InteractionString", "Interaction", false, null, 0) +
    datum("PossibleMitigations", "Possible Mitigation(s)", false, "", 2) +
    datum("Priority", "Severity", false, priorityValues, 1) +
    datum("SDLPhase", "SDL Phase", false, sdlValues, 1) +
    `      </PropertiesMetaData>\n` +
    `    </a:ThreatMetaData>\n`
  );
}
function renderKnowledgeBase(ctx: BuildCtx): string {
  const kbZid = ctx.ids.next();

  const genericElement = (
    id: string,
    name: string,
    description: string,
    parentId: string,
    representation: string
  ): string =>
    `      <a:ElementType>\n` +
    `        <a:IsExtension>false</a:IsExtension>\n` +
    `        <a:Attributes />\n` +
    `        <a:AvailableToBaseModels xmlns:b="http://schemas.datacontract.org/2004/07/ThreatModeling.ExternalStorage.OM" />\n` +
    `        <a:Behavior i:nil="true" />\n` +
    `        <a:Description>${xmlEscape(description)}</a:Description>\n` +
    `        <a:Hidden>false</a:Hidden>\n` +
    `        <a:Id>${id}</a:Id>\n` +
    `        <a:ImageLocation>Centered on stencil</a:ImageLocation>\n` +
    `        <a:ImageSource />\n` +
    `        <a:ImageStream i:nil="true" />\n` +
    `        <a:Name>${xmlEscape(name)}</a:Name>\n` +
    `        <a:ParentId>${parentId}</a:ParentId>\n` +
    `        <a:Representation>${representation}</a:Representation>\n` +
    `        <a:Shape i:nil="true" />\n` +
    `        <a:StencilConstraints>\n` +
    `          <a:StencilConstraint>\n` +
    `            <a:IsExtension>false</a:IsExtension>\n` +
    `            <a:SelectedStencilConnection>Any</a:SelectedStencilConnection>\n` +
    `            <a:SelectedStencilType>Any</a:SelectedStencilType>\n` +
    `          </a:StencilConstraint>\n` +
    `        </a:StencilConstraints>\n` +
    `      </a:ElementType>\n`;

  return (
    `  <KnowledgeBase z:Id="${kbZid}" xmlns:a="${NS_KB}" xmlns:z="${NS_SERIALIZATION}">\n` +
    `    <a:GenericElements>\n` +
    genericElement(
      "GE.DF",
      "Generic Data Flow",
      "A unidirectional representation of the flow of data between elements",
      "ROOT",
      "Line"
    ) +
    Object.values(NATIVE_ROLES).map(role =>
      genericElement(role.id, role.name, role.name, "ROOT", role.representation)).join("") +
    genericElement(
      "GE.TB.B",
      "Generic Trust Border Boundary",
      "A border representation of a trust boundary",
      "ROOT",
      "BorderBoundary"
    ) +
    genericElement(
      "GE.A",
      "Free Text Annotation",
      "A representation of an annotation",
      "ROOT",
      "Annotation"
    ) +
    `    </a:GenericElements>\n` +
    `    <a:Manifest>\n` +
    `      <a:Author>SecureDesignStudio</a:Author>\n` +
    `      <a:Id>${newGuid()}</a:Id>\n` +
    `      <a:Name>SecureDesignStudio Export</a:Name>\n` +
    `      <a:Version>1.0.0.0</a:Version>\n` +
    `    </a:Manifest>\n` +
    `    <a:StandardElements />\n` +
    `    <a:ThreatCategories />\n` +
    renderThreatMetaData() +
    `    <a:ThreatTypes />\n` +
    `  </KnowledgeBase>\n`
  );
}

// Minimal KnowledgeBase. TMT requires the GenericElements section to
// register every TypeId referenced by stencils on the canvas; we register
// GE.P, GE.DS, GE.EI, GE.DF, GE.TB.B plus GE.A so future
// annotation-style notes work without another schema change. Icons are
// left empty so the bundle stays small — TMT shows its default shape.

// ---------- Public entry point ----------

// Membership/reference integrity is checked before selecting supported content.
function buildTabsFromScenarios(doc: PsDocument): TabContent[] {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(doc.edges.map((e) => [e.id, e]));
  const boundaryById = new Map(doc.boundaries.map((b) => [b.id, b]));

  return doc.scenarios.map((s: Scenario): TabContent => {
    const nodes = s.nodeIds
      .map((id) => nodeById.get(id))
      .filter((n): n is PsNode => !!n);
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const edges = s.edgeIds
      .map((id) => edgeById.get(id))
      .filter((e): e is PsEdge => !!e)
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));
    const boundaries = s.boundaryIds
      .map((id) => boundaryById.get(id))
      .filter((b): b is PsBoundary => !!b)
      .filter((b) => b.type === "security");
    return {
      guid: safeGuid(s.id),
      scenario: s,
      name: s.name?.trim() || "(unnamed scenario)",
      nodes,
      edges,
      edgeNumbers: { ...s.edgeNumbers },
      boundaries,
      textAnnotations: (doc.textAnnotations ?? []).filter(annotation => s.textAnnotationIds?.includes(annotation.id)),
    };
  });
}

// Fallback tab — used when the document has no scenarios so the export
// still contains something openable. Includes every node, every edge whose
// endpoints exist, and every security boundary. Auto-numbers edges in
// document order so the labels carry a stable "1.", "2.", … prefix.
function buildSingleTabFromDocument(doc: PsDocument): TabContent {
  const nodeIdSet = new Set(doc.nodes.map((n) => n.id));
  const edges = doc.edges.filter(
    (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
  );
  const edgeNumbers: Record<string, number> = {};
  edges.forEach((e, i) => {
    edgeNumbers[e.id] = i + 1;
  });
  return {
    guid: safeGuid("secure-design-studio:tm7:diagram"),
    name: "Diagram",
    nodes: [...doc.nodes],
    edges,
    edgeNumbers,
    boundaries: doc.boundaries.filter((b) => b.type === "security"),
    textAnnotations: [...(doc.textAnnotations ?? [])],
  };
}

export interface ExportTm7Options {
  inventoryLabel?: string;
  // Threat-model name written to MetaInformation; shown in TMT's window
  // title. Defaults to "SecureDesignStudio model".
  modelName?: string;
}

export function exportTm7(
  doc: PsDocument,
  options: ExportTm7Options = {}
): string {
  return prepareTm7Export(doc, options).xml;
}

export function prepareTm7Export(doc: PsDocument, options: ExportTm7Options = {}): Tm7ExportResult {
  validateReferences(doc);
  try {
    validateThreatNotes(doc);
  } catch (error) {
    throw new Tm7ExportError(error instanceof Error ? error.message : "Invalid authored threat note.");
  }
  const tabs: TabContent[] =
    doc.scenarios.length > 0
      ? buildTabsFromScenarios(doc)
      : [buildSingleTabFromDocument(doc)];
  const diagnostics = exportLosses(doc, tabs);
  const references: Tm7OccurrenceReference[] = [];
  const ctx: BuildCtx = { ids: makeIdGen(), offsetX: 0, offsetY: 0,
    inventoryLabel: options.inventoryLabel ?? "Inventory ID", authenticationCatalog: authenticationCatalogFor(doc),
    catalogDefinitions: doc.catalogDefinitions, nodeTypes: doc.nodeTypes, tabGuid: "", diagnostics, references };

  // Always render at least one tab; an empty DrawingSurfaceList would
  // crash TMT on Open.
  const surfacesXml =
    tabs.length > 0
      ? tabs.map((t) => renderDrawingSurface(t, ctx)).join("")
      : renderDrawingSurface(
          {
            guid: safeGuid("secure-design-studio:tm7:diagram"),
            name: "Diagram",
            nodes: [],
            edges: [],
            edgeNumbers: {},
            boundaries: [],
            textAnnotations: [],
          },
          ctx
        );

  const modelName = xmlEscape(
    options.modelName ?? "SecureDesignStudio model",
  );
  const threatsXml = renderThreatNotes(doc, tabs, ctx);

  // Suppress the unused-warning the linter would otherwise raise for the
  // fallback sizing constants. (Kept defined for future use when we add
  // synthetic placeholder content to empty tabs.)
  void FALLBACK_TAB_W;
  void FALLBACK_TAB_H;

  const xml = (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<ThreatModel xmlns="${NS_MODEL}" xmlns:i="${NS_XSI}">\n` +
    `  <DrawingSurfaceList>\n` +
    surfacesXml +
    `  </DrawingSurfaceList>\n` +
    `  <MetaInformation>\n` +
    `    <Assumptions />\n` +
    `    <Contributors />\n` +
    `    <ExternalDependencies />\n` +
    `    <HighLevelSystemDescription />\n` +
    `    <Owner />\n` +
    `    <Reviewer />\n` +
    `    <ThreatModelName>${modelName}</ThreatModelName>\n` +
    `  </MetaInformation>\n` +
    `  <Notes />\n` +
    threatsXml +
    `  <ThreatGenerationEnabled>true</ThreatGenerationEnabled>\n` +
    `  <Validations xmlns:a="${NS_KB}" />\n` +
    renderKnowledgeBase(ctx) +
    `  <Profile>\n` +
    `    <PromptedKb xmlns="" />\n` +
    `  </Profile>\n` +
    `</ThreatModel>\n`
  );
  return { xml, diagnostics: [...new Set(diagnostics)], references };
}

function renderThreatNotes(doc: PsDocument, tabs: readonly TabContent[], ctx: BuildCtx): string {
  const notes = (doc.issues ?? []).filter(isAuthoredThreatNote);
  if (!notes.length) return `  <ThreatInstances xmlns:a="${NS_ARRAYS}" />\n`;
  const emptyGuid = "00000000-0000-0000-0000-000000000000";
  const groups = new Map<string, { source: string; flow: string; target: string;
    occurrences: Tm7OccurrenceReference[]; notes: PsIssue[] }>();
  for (const note of notes) {
    const occurrences = ctx.references.filter(ref => ref.kind === note.targetKind && ref.entityId === note.targetId &&
      (!note.scenarioIds.length || (ref.scenarioId !== null && note.scenarioIds.includes(ref.scenarioId))));
    if (!occurrences.length) {
      throw new Tm7ExportError(`Threat note "${note.title}" has no exported target occurrence. Restore its scenario membership before exporting.`);
    }
    const occurrence = occurrences[0];
    const edge = note.targetKind === "edge" ? doc.edges.find(e => e.id === note.targetId) : undefined;
    const endpoint = (id: string) => {
      const ref = ctx.references.find(r => r.kind === "node" && r.entityId === id && r.tabGuid === occurrence.tabGuid);
      if (!ref) throw new Tm7ExportError(`Threat note "${note.title}" has no exported endpoint.`);
      return ref.objectGuid;
    };
    const source = edge ? endpoint(edge.source) : occurrence.objectGuid;
    const flow = edge ? occurrence.objectGuid : emptyGuid;
    const target = edge ? endpoint(edge.target) : emptyGuid;
    const key = source + flow + target;
    const group = groups.get(key) ?? { source, flow, target, occurrences: [], notes: [] };
    group.notes.push(note);
    group.occurrences.push(...occurrences);
    groups.set(key, group);
  }
  ctx.diagnostics.push(
    "Authored threat notes use native User-defined records. Native workflow is AutoGenerated (Not Started), not SDS Active/Resolved or a mitigation/risk decision; each SDS human status is preserved in the description.",
    "SDS severity is Unspecified. Priority is exported blank, but TMT can assign High to both current and legacy Priority and display High, and can assign an SDL phase. These are native format defaults, not authored severity, CVSS or lifecycle decisions. Each note retains an explicit Unspecified label; keep the .tma model.",
    "TM7 re-import does not restore threat notes, justification, replies or human status. Keep the .tma model as the full-detail original.",
  );
  const entries = [...groups.values()].map((group, index) => {
    // The native dashboard keys empty-TypeId threats by interaction, not by the
    // dictionary key or Id. Emit one record globally, never one per note/tab.
    const occurrence = ctx.references.find(ref => group.occurrences.includes(ref))!;
    const tab = tabs.find(t => t.guid === occurrence.tabGuid)!;
    const tabIds = new Set(group.occurrences.map(ref => ref.tabGuid));
    if (group.notes.length > 1) {
      ctx.diagnostics.push(`${group.notes.length} authored threat notes on ${occurrence.kind} "${occurrence.entityId}" are aggregated into one native record; each note's exact text, ID, human status and scenario applicability are labeled separately.`);
    }
    if (tabIds.size > 1) {
      ctx.diagnostics.push(`Threat notes on "${occurrence.entityId}" span ${tabIds.size} tabs but are projected onto "${tab.name}" only. Native interaction identity cannot safely duplicate records across tabs; each note's original scenario applicability remains in its text.`);
    }
    const scenarioText = (note: PsIssue) => note.scenarioIds.length
      ? note.scenarioIds.map(id => `${doc.scenarios.find(s => s.id === id)!.name} [${id}]`).join(", ")
      : "All scenarios containing this target";
    const label = (note: PsIssue) => `SDS threat note [${note.id}]\nTitle: ${note.title}\nSDS human status: ${note.status}\nSDS severity: Unspecified (native defaults are not authored severity or CVSS)\nApplies to: ${scenarioText(note)}`;
    const description = group.notes.map(note => `${label(note)}\nThreat / mitigation notes:\n${note.description}`).join("\n\n---\n\n");
    const justification = group.notes.filter(note => note.justification)
      .map(note => `${label(note)}\nJustification:\n${note.justification}`).join("\n\n---\n\n");
    const edge = occurrence.kind === "edge" ? doc.edges.find(e => e.id === occurrence.entityId) : undefined;
    const interactionLabel = edge ? edgeLabel(edge, tab.edgeNumbers[edge.id], ctx.authenticationCatalog)
      : nodeLabel(doc.nodes.find(n => n.id === occurrence.entityId)!, ctx.inventoryLabel);
    const properties: Record<string, string> = {
      Title: group.notes.map(note => note.title).join(" / "),
      UserThreatCategory: "User-defined", UserThreatShortDescription: "",
      UserThreatDescription: description, StateInformation: justification,
      InteractionString: interactionLabel, PossibleMitigations: "", Priority: "", SDLPhase: "",
    };
    // XML normalizes literal CR/CRLF; character references retain authored text.
    const dictionary = Object.entries(properties).map(([key, value]) =>
      `<a:KeyValueOfstringstring><a:Key>${key}</a:Key><a:Value>${xmlEscape(value).replace(/\r/g, "&#13;")}</a:Value></a:KeyValueOfstringstring>`).join("");
    const createdAt = Math.max(...group.notes.map(note => note.createdAt));
    if (!Number.isFinite(createdAt) || Number.isNaN(new Date(createdAt).getTime())) {
      throw new Tm7ExportError("Threat note has an invalid authored timestamp.");
    }
    return `    <a:KeyValueOfstringThreatpc_P0_PhOB><a:Key>${group.source}${group.flow}${group.target}</a:Key><a:Value xmlns:b="${NS_KB}">` +
      `<b:ChangedBy /><b:DrawingSurfaceGuid>${occurrence.tabGuid}</b:DrawingSurfaceGuid><b:FlowGuid>${group.flow}</b:FlowGuid>` +
      `<b:Id>${index + 1}</b:Id><b:InteractionKey>${group.source}:${group.flow}:${group.target}</b:InteractionKey>` +
      `<b:InteractionString i:nil="true" /><b:ModifiedAt>${new Date(createdAt).toISOString()}</b:ModifiedAt><b:Priority />` +
      `<b:Properties>${dictionary}</b:Properties><b:SourceGuid>${group.source}</b:SourceGuid><b:State>AutoGenerated</b:State>` +
      `<b:StateInformation i:nil="true" /><b:TargetGuid>${group.target}</b:TargetGuid><b:Title i:nil="true" /><b:TypeId />` +
      `<b:Upgraded>false</b:Upgraded><b:UserThreatCategory i:nil="true" /><b:UserThreatDescription i:nil="true" />` +
      `<b:UserThreatShortDescription i:nil="true" /><b:Wide>false</b:Wide></a:Value></a:KeyValueOfstringThreatpc_P0_PhOB>\n`;
  }).join("");
  return `  <ThreatInstances xmlns:a="${NS_ARRAYS}">\n${entries}  </ThreatInstances>\n`;
}

function validateReferences(doc: PsDocument): void {
  const guids = new Map<string, string>();
  for (const item of [...doc.nodes, ...doc.edges, ...doc.boundaries, ...doc.scenarios, ...(doc.textAnnotations ?? [])]) {
    if (!item.id?.trim()) throw new Tm7ExportError("An object has no ID. Correct the model before exporting.");
    const guid = safeGuid(item.id);
    if (guid === "00000000-0000-0000-0000-000000000000" || guids.has(guid)) {
      throw new Tm7ExportError(`Duplicate or colliding TM7 ID: ${item.id}${guids.has(guid) ? ` and ${guids.get(guid)}` : ""}.`);
    }
    guids.set(guid, item.id);
  }
  if (!doc.scenarios.length && guids.has(safeGuid("secure-design-studio:tm7:diagram"))) {
    throw new Tm7ExportError("An object ID collides with the fallback Diagram tab.");
  }
  for (const item of [...doc.nodes, ...doc.boundaries, ...(doc.textAnnotations ?? [])]) {
    if (![item.position.x, item.position.y, ...("size" in item && item.size ? [item.size.width, item.size.height] : [])]
      .every(value => Number.isFinite(value) && Math.abs(value) < 100_000_000)) {
      throw new Tm7ExportError(`Object ${item.id} has invalid or unsupported coordinates.`);
    }
  }
  const nodes = new Set(doc.nodes.map(node => node.id));
  const edges = new Set(doc.edges.map(edge => edge.id));
  const boundaries = new Set(doc.boundaries.map(boundary => boundary.id));
  const annotations = new Set(doc.textAnnotations?.map(annotation => annotation.id));
  for (const edge of doc.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      throw new Tm7ExportError(`Flow ${edge.id} has a missing endpoint.`);
    }
  }
  for (const scenario of doc.scenarios) {
    for (const [ids, known] of [[scenario.nodeIds, nodes], [scenario.edgeIds, edges], [scenario.boundaryIds, boundaries], [scenario.textAnnotationIds ?? [], annotations]] as const) {
      if (new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) {
        throw new Tm7ExportError(`Tab "${scenario.name}" (${scenario.id}) has duplicate or missing membership references.`);
      }
    }
    for (const edge of doc.edges.filter(edge => scenario.edgeIds.includes(edge.id))) {
      if (!scenario.nodeIds.includes(edge.source) || !scenario.nodeIds.includes(edge.target)) {
        throw new Tm7ExportError(`Flow ${edge.id} has an endpoint absent from tab "${scenario.name}" (${scenario.id}).`);
      }
      const number = scenario.edgeNumbers[edge.id];
      if (number !== undefined && (!Number.isSafeInteger(number) || number < 1)) {
        throw new Tm7ExportError(`Flow ${edge.id} has an unsupported sequence number in tab "${scenario.name}".`);
      }
    }
  }
}

function exportLosses(doc: PsDocument, tabs: readonly TabContent[]): string[] {
  const losses: string[] = [];
  const note = (condition: unknown, message: string) => { if (condition) losses.push(message); };
  note(doc.textAnnotations?.length,
    "Canvas text annotations use standard GE.A rectangles with full plain text. Coordinates are translated per tab to a positive origin and rounded to integers; fonts and decoration are not exported. Keep .tma for exact native geometry.");
  note(doc.nodes.some(node => node.type || node.dfdRoleOverride !== undefined || node.dfdRoleLegacy !== undefined),
    "Service types, catalog defaults and role-override provenance are not retained; only the effective native DFD role is exported.");
  note(doc.nodes.some(node => node.description || node.endpointRegex || node.metadata || node.geoBoundary || node.postSubscriptionRetention),
    "Node descriptions, endpoint patterns and additional node metadata are omitted.");
  note(doc.edges.some(edge => edge.description || edge.audience || edge.constraints || edge.productionIdentity || edge.waypoints?.length),
    "Flow descriptions, audience, constraints, production identity and waypoint geometry are omitted.");
  const rightsFlows = new Set(tabs.flatMap(tab => tab.edges
    .filter(edge => formatRequiredAccessRights(edge.requiredAccessRights))
    .map(edge => edge.id))).size;
  note(rightsFlows,
    `Required access-rights text on ${rightsFlows} exported flow${rightsFlows === 1 ? "" : "s"} is not included in TM7. Keep the .tma model to retain it.`);
  const networkBoundaries = new Set(tabs.flatMap(tab => tab.boundaries
    .filter(boundary => BOUNDARY_NETWORK_FIELDS.some(({ key }) => formatBoundaryNetworkText(boundary[key])))
    .map(boundary => boundary.id))).size;
  note(networkBoundaries,
    `Boundary network text on ${networkBoundaries} exported security ${networkBoundaries === 1 ? "boundary" : "boundaries"} is not included in TM7. Keep the .tma model to retain it.`);
  note(doc.authenticationDefinitions?.length, "Authentication IDs/labels are retained, but saved method definitions and behavior are omitted.");
  note(doc.boundaries.some(boundary => boundary.type === "privacy"), "Privacy boundaries are omitted.");
  note(doc.boundaries.some(boundary => boundary.type === "security"),
    "Security boundary subtypes are flattened into labels; containment membership is not retained.");
  note(doc.data.length || doc.scenarios.some(s => Object.keys(s.nodeData).length || Object.keys(s.edgeRequestData).length || Object.keys(s.edgeResponseData).length),
    "Data items, directional data attachments and retention are omitted.");
  note(doc.comments.length || doc.issues?.some(issue => !isAuthoredThreatNote(issue)) || doc.deviations?.length || doc.workItems?.length,
    "Comments, ordinary issues, analyzer/accepted AI findings, deviations and work items are omitted. Only explicitly authored threat notes become native threat records.");
  note(doc.issues?.some(issue => isAuthoredThreatNote(issue) && issue.replies.length),
    "Threat-note discussion replies are omitted; the authored title, body and optional justification are exported.");
  note(doc.scenarios.some(s => s.description), "Scenario descriptions are omitted.");
  note(doc.scenarios.some(s => s.nodeScopeReasonsRecovery),
    "Unrecognized scenario scope input is not exported; repair it in the .tma model.");
  note(doc.scenarios.some(s => Object.keys(s.nodeScopeReasons ?? {}).some(id => !s.nodeIds.includes(id))),
    "Scope reasons for nodes absent from their scenario are not exported.");
  note(doc.scenarios.some(s => s.edgeIds.some((id, i) => s.edgeNumbers[id] !== i + 1)),
    "Flow numbers are exported, but TM7 re-import currently compacts them to sequential values.");
  if (doc.scenarios.length) {
    const assigned = new Set(doc.scenarios.flatMap(s => [...s.nodeIds, ...s.edgeIds, ...s.boundaryIds, ...(s.textAnnotationIds ?? [])]));
    note([...doc.nodes, ...doc.edges, ...doc.boundaries, ...(doc.textAnnotations ?? [])].some(item => !assigned.has(item.id)),
      "Objects outside every scenario are omitted.");
  }
  return losses;
}
