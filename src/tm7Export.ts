// Microsoft Threat Modeling Tool (.tm7) export.
//
// Emits a single XML file whose schema matches what the desktop TMT app
// reads on Open. Each SecureDesignStudio scenario becomes a separate
// `<DrawingSurfaceModel>` (tab in TMT). If the document has no scenarios,
// a single "Diagram" tab is generated holding everything.
//
// What's mapped:
//   - PsNode  -> StencilEllipse (TypeId="GE.P") with the node title + an
//                optional second line "ST: <serviceTreeId>".
//   - PsEdge  -> Connector (TypeId="GE.DF") with the sequence number, edge
//                title, and any selected auth types appended as "Auth: …".
//   - PsBoundary (type === "security") -> BorderBoundary (TypeId="GE.TB.B")
//                with the boundary title.
//
// What's intentionally omitted:
//   - Privacy boundaries and data items (per export spec).
//   - Per-edge `description`, `audience`, `constraints`,
//     `productionIdentity` (no clean TM7 surface; keep the file small).
//   - Per-node `description`, `endpointRegex` (no clean TM7 surface).
//   - All threats / threat instances. We emit an empty ThreatInstances /
//     ThreatTypes section; TMT regenerates threats on Analyze.
//
// The bundled KnowledgeBase is the minimum needed for TMT to render the
// generic stencils we reference (GE.P, GE.DF, GE.TB.B). Icons are omitted
// so the bundle stays tiny; TMT falls back to its default ellipse/line
// rendering when ImageSource is empty.

import type {
  AuthenticationType,
  PsBoundary,
  PsDocument,
  PsEdge,
  PsNode,
  Scenario,
} from "./types";
import { authenticationCatalogFor, authTypeLabel, securityBoundaryTypeLabel, type AuthTypeDef } from "./types";

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
  });
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
  // Per-surface offset applied to every coordinate so TMT's validator
  // doesn't see negative Left/Top/SourceX/etc. The app's canvas allows
  // arbitrary panning (negative positions are common); TMT requires
  // non-negative integer coordinates and flags anything else as
  // "Border/Line element coordinates are corrupted".
  offsetX: number;
  offsetY: number;
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
  const zid = ctx.ids.next();
  // PsNode has no width/height; render as a centered 100x100 ellipse.
  const left = Math.max(0, Math.round(node.position.x - NODE_W / 2 + ctx.offsetX));
  const top = Math.max(0, Math.round(node.position.y - NODE_H / 2 + ctx.offsetY));
  return (
    `      <a:KeyValueOfguidanyType>\n` +
    `        <a:Key>${node.id ? safeGuid(node.id) : newGuid()}</a:Key>\n` +
    `        <a:Value z:Id="${zid}" i:type="StencilEllipse">\n` +
    `          <GenericTypeId xmlns="${NS_ABSTRACTS}">GE.P</GenericTypeId>\n` +
    `          <Guid xmlns="${NS_ABSTRACTS}">${safeGuid(node.id)}</Guid>\n` +
    `          <Properties xmlns="${NS_ABSTRACTS}">\n` +
    renderHeader("Generic Process") +
    renderStringAttr("Name", nodeLabel(node, ctx.inventoryLabel)) +
    renderBoolAttr("Out Of Scope", false, PROP_OUT_OF_SCOPE_NAME) +
    renderStringAttr(
      "Reason For Out Of Scope",
      "",
      PROP_REASON_OUT_OF_SCOPE_NAME
    ) +
    `          </Properties>\n` +
    `          <TypeId xmlns="${NS_ABSTRACTS}">GE.P</TypeId>\n` +
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
  const zid = ctx.ids.next();
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

function renderEdge(
  edge: PsEdge,
  seq: number | undefined,
  nodeById: Map<string, PsNode>,
  ctx: BuildCtx
): string {
  const zid = ctx.ids.next();
  const src = nodeById.get(edge.source);
  const tgt = nodeById.get(edge.target);
  // Defensive: if either endpoint is missing from the scenario's node set,
  // we still emit the connector with zero coordinates so TMT shows it as
  // an unconnected line rather than dropping it silently.
  const sx = src ? Math.max(0, Math.round(src.position.x + ctx.offsetX)) : 0;
  const sy = src ? Math.max(0, Math.round(src.position.y + ctx.offsetY)) : 0;
  const tx = tgt ? Math.max(0, Math.round(tgt.position.x + ctx.offsetX)) : 0;
  const ty = tgt ? Math.max(0, Math.round(tgt.position.y + ctx.offsetY)) : 0;
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
  name: string;
  nodes: PsNode[];
  edges: PsEdge[];
  // Sequence number per edge id (1-based). Missing -> blank in the label.
  edgeNumbers: Record<string, number>;
  // Security boundaries only.
  boundaries: PsBoundary[];
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
  for (const b of tab.boundaries) {
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
  const surfaceCtx: BuildCtx = { ...ctx, offsetX, offsetY };
  const bordersXml =
    tab.boundaries.map((b) => renderSecurityBoundary(b, surfaceCtx)).join("") +
    tab.nodes.map((n) => renderNode(n, surfaceCtx)).join("");
  const linesXml = tab.edges
    .map((e) => renderEdge(e, tab.edgeNumbers[e.id], nodeById, surfaceCtx))
    .join("");

  return (
    `    <DrawingSurfaceModel z:Id="${surfaceZid}" xmlns:z="${NS_SERIALIZATION}">\n` +
    `      <GenericTypeId xmlns="${NS_ABSTRACTS}">DRAWINGSURFACE</GenericTypeId>\n` +
    `      <Guid xmlns="${NS_ABSTRACTS}">${newGuid()}</Guid>\n` +
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
    genericElement(
      "GE.P",
      "Generic Process",
      "A representation of a process",
      "ROOT",
      "Ellipse"
    ) +
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
// the three we use (GE.P, GE.DF, GE.TB.B) plus GE.A so future
// annotation-style notes work without another schema change. Icons are
// left empty so the bundle stays small — TMT shows its default shape.

// ---------- Public entry point ----------

// Build the per-scenario tab content list. If a scenario references node /
// edge / boundary ids that no longer exist (e.g. they've been deleted),
// they're silently dropped. Edges whose endpoints aren't in the scenario's
// node set are also dropped — TMT would render them as dangling lines
// otherwise, which confuses readers and triggers validation warnings.
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
      name: s.name?.trim() || "(unnamed scenario)",
      nodes,
      edges,
      edgeNumbers: { ...s.edgeNumbers },
      boundaries,
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
    name: "Diagram",
    nodes: [...doc.nodes],
    edges,
    edgeNumbers,
    boundaries: doc.boundaries.filter((b) => b.type === "security"),
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
  const ctx: BuildCtx = { ids: makeIdGen(), offsetX: 0, offsetY: 0, inventoryLabel: options.inventoryLabel ?? "Inventory ID", authenticationCatalog: authenticationCatalogFor(doc), catalogDefinitions: doc.catalogDefinitions };

  const tabs: TabContent[] =
    doc.scenarios.length > 0
      ? buildTabsFromScenarios(doc)
      : [buildSingleTabFromDocument(doc)];

  // Always render at least one tab; an empty DrawingSurfaceList would
  // crash TMT on Open.
  const surfacesXml =
    tabs.length > 0
      ? tabs.map((t) => renderDrawingSurface(t, ctx)).join("")
      : renderDrawingSurface(
          {
            name: "Diagram",
            nodes: [],
            edges: [],
            edgeNumbers: {},
            boundaries: [],
          },
          ctx
        );

  const modelName = xmlEscape(
    options.modelName ?? "SecureDesignStudio model",
  );

  // Suppress the unused-warning the linter would otherwise raise for the
  // fallback sizing constants. (Kept defined for future use when we add
  // synthetic placeholder content to empty tabs.)
  void FALLBACK_TAB_W;
  void FALLBACK_TAB_H;

  return (
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
    `  <ThreatInstances xmlns:a="${NS_ARRAYS}" />\n` +
    `  <ThreatGenerationEnabled>true</ThreatGenerationEnabled>\n` +
    `  <Validations xmlns:a="${NS_KB}" />\n` +
    renderKnowledgeBase(ctx) +
    `  <Profile>\n` +
    `    <PromptedKb xmlns="" />\n` +
    `  </Profile>\n` +
    `</ThreatModel>\n`
  );
}
