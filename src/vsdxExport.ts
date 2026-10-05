// VSDX (Microsoft Visio) export.
//
// Emits a single .vsdx file (a ZIP package of OPC parts) that opens in
// Microsoft Visio and is suitable for upload to Microsoft Privacy
// Manager. One Visio page is produced per scenario, mirroring the TM7
// export's tab-per-scenario layout.
//
// What's mapped:
// Canvas text annotations are not mapped. Interactive callers must disclose
// this loss before download; .tma remains the complete native backup.
//   - PsNode  -> rounded rectangle whose multi-line text shows:
//                  <title>
//                  Type: <nodeType label>
//                  ST: <serviceTreeId>
//                (lines without a value are omitted)
//   - PsEdge  -> dynamic connector labelled with the comma-separated
//                set of data classifications carried along the edge in
//                this scenario (e.g. "EUPI, Customer Content"). The
//                set is the dedup'd union of the classifications of
//                every PsData attached in either direction. Falls back
//                to the edge title when no data is attached.
//                Connectors glue to the source/target shapes via
//                <Connect> elements so the line follows the shapes when
//                they are moved in Visio.
//   - PsBoundary (type === "privacy") -> a coloured outlined rectangle
//                rendered BEHIND the nodes, labelled with the boundary
//                title and (if specified) its privacy-subtype label.
//                Security boundaries are intentionally skipped — the
//                Privacy Manager use case only cares about privacy
//                boundaries.
//
// Coordinate system: Visio uses INCHES with the origin at the page's
// bottom-left and the Y axis pointing UP. SecureDesignStudio canvas coordinates
// are CSS pixels with the origin at the top-left and Y pointing DOWN.
// We convert pixels -> inches with a fixed scale, flip Y, and shift
// everything so the page's bottom-left sits at the diagram's
// bounding-box minimum. PinX / PinY in Visio refer to the shape's
// LocPin (= the shape's centre by default).

import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";

import type {
  DataClassification,
  CatalogDefinitionSnapshot,
  NodeTypeRef,
  PsBoundary,
  PsData,
  PsDocument,
  PsEdge,
  PsNode,
  Scenario,
} from "./types";
import {
  DATA_CLASSIFICATIONS,
  dataClassificationLabel,
  nodeTypeLabel,
  privacyBoundaryTypeLabel,
} from "./types";
import { VSDX_TEMPLATE_BASE64 } from "./vsdxTemplate";
import templateNotice from "./data/vsdxTemplateNotice.json";

// ----------------------------- Geometry ----------------------------------

// Pixels per inch. Matches the CSS pixel = 1/96 in convention so a
// SecureDesignStudio node whose CSS width is ~130 px lands at ~1.35 in in Visio —
// a comfortably-sized Visio shape that prints legibly.
const PX_PER_INCH = 96;

// Default rendered footprint of a SecureDesignStudio node on the canvas.
// auto-sizes nodes 130-220 px wide based on the title, but the model
// itself only carries a position — there's no measured size to copy
// out. We approximate a 160x80 px rectangle which lines up with the
// typical rendered ProcessNode and keeps the Visio output readable.
const NODE_W_PX = 160;
const NODE_H_PX = 80;

// Padding (inches) added around the diagram's bounding box so shapes
// aren't flush against the page edge.
const PAGE_MARGIN_IN = 0.75;

// Extra padding (inches) added inside a privacy-boundary rectangle so
// nodes don't touch the boundary outline.
const BOUNDARY_INSET_IN = 0.25;

function pxToIn(px: number): number {
  return px / PX_PER_INCH;
}

// XML escape for text content and attribute values. Visio's parser is
// strict about &, <, >, " in attribute values; ' is escaped defensively.
function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return c;
    }
  });
}

// Format an inches value with enough precision for Visio's spline
// router but without trailing-zero noise.
function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, "") || "0" : "0";
}

// -------------------------- Per-scenario layout --------------------------

interface PageContent {
  catalogDefinitions: PsDocument["catalogDefinitions"];
  name: string;
  nodes: PsNode[];
  edges: PsEdge[];
  edgeNumbers: Record<string, number>;
  // Per-edge ordered list of data-classification labels (e.g.
  // ["EUPI", "Customer Content"]) — the union of the classifications
  // of every data item attached to the edge in either direction within
  // this scenario. Empty when no data is attached.
  edgeClassifications: Record<string, string[]>;
  // Privacy boundaries only (security boundaries are intentionally
  // skipped per the export spec).
  boundaries: PsBoundary[];
  // Document-level node-type registry, threaded onto each page so
  // shape text rendering can resolve labels for user-added node types
  // (those that aren't in the static NODE_TYPE_DEF_MAP catalog).
  nodeTypeRefs: readonly NodeTypeRef[];
}

// Build the list of data-classification labels for a single edge in a
// scenario by unioning the classifications of every PsData attached in
// either direction (request + response) and ordering them by the
// canonical order in DATA_CLASSIFICATIONS so the label is stable across
// exports.
function classificationsForEdge(
  edgeId: string,
  requestData: Record<string, string[]>,
  responseData: Record<string, string[]>,
  dataById: Map<string, PsData>,
  saved: PsDocument["catalogDefinitions"],
  available?: readonly CatalogDefinitionSnapshot[],
): string[] {
  const ids = new Set<string>([
    ...(requestData[edgeId] ?? []),
    ...(responseData[edgeId] ?? []),
  ]);
  const present = new Set<string>();
  for (const id of ids) {
    const d = dataById.get(id);
    if (d) present.add(d.classification);
  }
  const order: readonly string[] = available?.map(def => def.id) ?? DATA_CLASSIFICATIONS;
  const known = order.filter((id) => present.has(id));
  const unavailable = [...present].filter((id) => !order.includes(id)).sort();
  return [...known, ...unavailable].map((id) => dataClassificationLabel(id, saved, available));
}

function buildPagesFromScenarios(doc: PsDocument, available?: readonly CatalogDefinitionSnapshot[]): PageContent[] {
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(doc.edges.map((e) => [e.id, e]));
  const boundaryById = new Map(doc.boundaries.map((b) => [b.id, b]));
  const dataById = new Map(doc.data.map((d) => [d.id, d]));

  return doc.scenarios.map((s: Scenario): PageContent => {
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
      .filter((b) => b.type === "privacy");
    const edgeClassifications: Record<string, string[]> = {};
    for (const e of edges) {
      edgeClassifications[e.id] = classificationsForEdge(
        e.id,
        s.edgeRequestData,
        s.edgeResponseData,
        dataById,
        doc.catalogDefinitions,
        available,
      );
    }
    return {
      name: s.name?.trim() || "(unnamed scenario)",
      nodes,
      edges,
      edgeNumbers: { ...s.edgeNumbers },
      edgeClassifications,
      boundaries,
      nodeTypeRefs: doc.nodeTypes,
      catalogDefinitions: doc.catalogDefinitions,
    };
  });
}

// Fallback page when the document has no scenarios at all — render
// everything in one page so the file always opens to something useful.
function buildSinglePageFromDocument(doc: PsDocument): PageContent {
  const nodeIdSet = new Set(doc.nodes.map((n) => n.id));
  const edges = doc.edges.filter(
    (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target),
  );
  const edgeNumbers: Record<string, number> = {};
  edges.forEach((e, i) => { edgeNumbers[e.id] = i + 1; });
  // No scenarios means no data attachments to surface; emit empty
  // classification lists so renderEdgeShape falls back to the title.
  const edgeClassifications: Record<string, string[]> = {};
  for (const e of edges) edgeClassifications[e.id] = [];
  return {
    name: "Diagram",
    nodes: [...doc.nodes],
    edges,
    edgeNumbers,
    edgeClassifications,
    boundaries: doc.boundaries.filter((b) => b.type === "privacy"),
    nodeTypeRefs: doc.nodeTypes,
    catalogDefinitions: doc.catalogDefinitions,
  };
}

// ---------------------- Shape / text helpers -----------------------------

function nodeText(
  node: PsNode,
  docNodeTypes?: readonly NodeTypeRef[],
  inventoryLabel = "Inventory ID",
): string {
  const lines: string[] = [];
  const title = (node.title ?? "").trim();
  lines.push(title || "(unnamed)");
  const typeId = (node.type ?? "").trim();
  if (typeId) {
    lines.push(`Type: ${nodeTypeLabel(typeId, docNodeTypes)}`);
  }
  const st = (node.serviceTreeId ?? "").trim();
  if (st) lines.push(`${inventoryLabel}: ${st}`);
  return lines.join("\n");
}

function boundaryText(b: PsBoundary, saved: PsDocument["catalogDefinitions"]): string {
  const title = (b.title ?? "").trim() || "(unnamed boundary)";
  const sub = b.privacySubtype?.trim();
  if (!sub) return title;
  return `${title} (${privacyBoundaryTypeLabel(sub, saved)})`;
}

// Visio Shape <Text> element. The format supports embedded runs and
// pp markers; we just emit plain XML-escaped text with newlines so the
// shape renders as a multi-line label.
function textElement(text: string): string {
  return `<Text>${xmlEscape(text)}</Text>`;
}

// --------------------------- Page geometry -------------------------------

// Computed page metrics: every value is in INCHES, in Visio's
// page-local coordinate system (origin = bottom-left, Y axis up).
interface PageMetrics {
  pageW: number;
  pageH: number;
  // Converters from SecureDesignStudio canvas px coordinates to Visio inches.
  // `cx` returns the X-centre of a node whose canvas X is `px`;
  // `cy` returns the Y-centre of a node whose canvas Y is `px`,
  // already flipped onto Visio's bottom-up axis.
  cx: (px: number) => number;
  cy: (px: number) => number;
}

function computePageMetrics(page: PageContent): PageMetrics {
  // Collect every "extent box" on the canvas (boundary rectangles use
  // their stored size; nodes use the approximated NODE_W_PX/H_PX).
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    xs.push(x1, x2); ys.push(y1, y2);
  };
  for (const n of page.nodes) {
    push(
      n.position.x - NODE_W_PX / 2,
      n.position.y - NODE_H_PX / 2,
      n.position.x + NODE_W_PX / 2,
      n.position.y + NODE_H_PX / 2,
    );
  }
  for (const b of page.boundaries) {
    push(
      b.position.x,
      b.position.y,
      b.position.x + b.size.width,
      b.position.y + b.size.height,
    );
  }
  // Default to an empty A4-portrait page if there's nothing to lay out.
  if (xs.length === 0) {
    return {
      pageW: 8.5,
      pageH: 11,
      cx: (px) => pxToIn(px),
      cy: (px) => 11 - pxToIn(px),
    };
  }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const widthIn = pxToIn(maxX - minX) + 2 * PAGE_MARGIN_IN;
  const heightIn = pxToIn(maxY - minY) + 2 * PAGE_MARGIN_IN;
  // Visio is happy with arbitrary page sizes; round up to 0.25 in so
  // the page looks tidy in Print Preview.
  const pageW = Math.ceil(widthIn * 4) / 4;
  const pageH = Math.ceil(heightIn * 4) / 4;
  return {
    pageW,
    pageH,
    cx: (px) => pxToIn(px - minX) + PAGE_MARGIN_IN,
    cy: (px) => pageH - (pxToIn(px - minY) + PAGE_MARGIN_IN),
  };
}

// ---------------------------- Shape XML ----------------------------------

// Boundary rectangle. Behind the nodes (Visio Z-order = document
// order), light-blue fill at low opacity, dashed dark-blue outline,
// label pinned to the top-left of the box.
function renderBoundaryShape(
  b: PsBoundary,
  m: PageMetrics,
  id: number,
  saved: PsDocument["catalogDefinitions"],
): string {
  const widthIn = pxToIn(b.size.width) + 2 * BOUNDARY_INSET_IN;
  const heightIn = pxToIn(b.size.height) + 2 * BOUNDARY_INSET_IN;
  // SecureDesignStudio stores top-left; Visio pins by centre.
  const centreX = b.position.x + b.size.width / 2;
  const centreY = b.position.y + b.size.height / 2;
  return (
    `      <Shape ID="${id}" NameU="PrivacyBoundary" Name="PrivacyBoundary" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    `<Cell N="PinX" V="${fmt(m.cx(centreX))}"/>` +
    `<Cell N="PinY" V="${fmt(m.cy(centreY))}"/>` +
    `<Cell N="Width" V="${fmt(widthIn)}"/>` +
    `<Cell N="Height" V="${fmt(heightIn)}"/>` +
    `<Cell N="LocPinX" V="${fmt(widthIn / 2)}" F="Width*0.5"/>` +
    `<Cell N="LocPinY" V="${fmt(heightIn / 2)}" F="Height*0.5"/>` +
    `<Cell N="Angle" V="0"/>` +
    `<Cell N="FillForegnd" V="#dbeafe"/>` +
    `<Cell N="FillBkgnd" V="#dbeafe"/>` +
    `<Cell N="FillPattern" V="1"/>` +
    `<Cell N="LineColor" V="#1d4ed8"/>` +
    `<Cell N="LinePattern" V="2"/>` +
    `<Cell N="LineWeight" V="0.02"/>` +
    `<Cell N="VerticalAlign" V="0"/>` +
    `<Cell N="TextPos" V="0"/>` +
    `<Cell N="TxtPinX" V="${fmt(widthIn / 2)}" F="Width*0.5"/>` +
    `<Cell N="TxtPinY" V="${fmt(heightIn - 0.15)}" F="Height-0.15 in"/>` +
    `<Cell N="TxtWidth" V="${fmt(Math.max(0.5, widthIn - 0.3))}" F="Width-0.3 in"/>` +
    `<Cell N="TxtHeight" V="0.3"/>` +
    `<Section N="Geometry" IX="0">` +
    `<Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/>` +
    `<Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>` +
    `<Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>` +
    `<Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>` +
    `<Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>` +
    `<Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>` +
    `</Section>` +
    textElement(boundaryText(b, saved)) +
    `</Shape>\n`
  );
}

// Node shape. Rounded rectangle, multi-line text label centred in the
// box. Fill color comes from `node.color` (set via the right-click
// "Color" menu); falls back to the slate-grey default used by uncolored
// nodes in the canvas.
function renderNodeShape(
  node: PsNode,
  m: PageMetrics,
  id: number,
  docNodeTypes?: readonly NodeTypeRef[],
  inventoryLabel = "Inventory ID",
): string {
  const widthIn = pxToIn(NODE_W_PX);
  const heightIn = pxToIn(NODE_H_PX);
  const fill = sanitizeHexColor(node.color) ?? "#f1f5f9";
  return (
    `      <Shape ID="${id}" NameU="ProcessNode" Name="ProcessNode" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    `<Cell N="PinX" V="${fmt(m.cx(node.position.x))}"/>` +
    `<Cell N="PinY" V="${fmt(m.cy(node.position.y))}"/>` +
    `<Cell N="Width" V="${fmt(widthIn)}"/>` +
    `<Cell N="Height" V="${fmt(heightIn)}"/>` +
    `<Cell N="LocPinX" V="${fmt(widthIn / 2)}" F="Width*0.5"/>` +
    `<Cell N="LocPinY" V="${fmt(heightIn / 2)}" F="Height*0.5"/>` +
    `<Cell N="Angle" V="0"/>` +
    `<Cell N="FillForegnd" V="${fill}"/>` +
    `<Cell N="FillPattern" V="1"/>` +
    `<Cell N="LineColor" V="#0f172a"/>` +
    `<Cell N="LineWeight" V="0.012"/>` +
    `<Cell N="Rounding" V="0.1"/>` +
    `<Cell N="VerticalAlign" V="1"/>` +
    `<Cell N="Char.Size" V="0.11"/>` +
    `<Section N="Geometry" IX="0">` +
    `<Cell N="NoFill" V="0"/><Cell N="NoLine" V="0"/>` +
    `<Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>` +
    `<Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>` +
    `<Row T="RelLineTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>` +
    `<Row T="RelLineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="1"/></Row>` +
    `<Row T="RelLineTo" IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>` +
    `</Section>` +
    textElement(nodeText(node, docNodeTypes, inventoryLabel)) +
    `</Shape>\n`
  );
}

// Visio's FillForegnd cell accepts a `#RRGGBB` hex literal. We accept
// both `#rgb` and `#rrggbb` and expand the short form; anything else
// (CSS color name, rgb(), undefined) falls through so the caller's
// default is used. Conservative on purpose — passing an arbitrary
// string straight into the XML risks Visio refusing the file.
function sanitizeHexColor(c?: string): string | undefined {
  if (!c) return undefined;
  const v = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toUpperCase().replace(/^#/, "#");
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1], g = v[2], b = v[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase().replace(/^#/, "#");
  }
  return undefined;
}

// Connector. Uses the embedded template's "Dynamic connector" master
// (Master ID 2 in the template's masters.xml) so Visio treats it as a
// real routable connector — the line follows the source/target shapes
// when they are moved, displays the standard arrowhead, and sits on
// the Connector layer.
//
// The critical bits that make this an actually-glued connector (vs a
// floating line that just happens to start/end near the nodes):
//
//   - BeginX/BeginY use `F='_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)'`
//   - EndX/EndY   use `F='_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)'`
//   - BegTrigger  uses `F='_XFTRIGGER(Sheet.<source>!EventXFMod)'`
//   - EndTrigger  uses `F='_XFTRIGGER(Sheet.<target>!EventXFMod)'`
//   - A `<Connect>` row at page level pins BeginX (FromPart=9) to the
//     source shape's PinX (ToPart=3), and similarly for EndX (12).
//
// Without the _WALKGLUE / _XFTRIGGER formulas Visio loads the shape
// as an un-glued line that happens to start/end near the nodes; the
// arrowheads don't reconnect when the nodes are dragged.
function renderEdgeShape(
  edge: PsEdge,
  m: PageMetrics,
  id: number,
  shapeIdByNode: Map<string, number>,
  nodeById: Map<string, PsNode>,
  seq: number | undefined,
  classifications: string[],
): { shapeXml: string; connectsXml: string } {
  const sourceShape = shapeIdByNode.get(edge.source);
  const targetShape = shapeIdByNode.get(edge.target);
  const sourceNode = nodeById.get(edge.source);
  const targetNode = nodeById.get(edge.target);
  if (
    sourceShape == null ||
    targetShape == null ||
    !sourceNode ||
    !targetNode
  ) {
    return { shapeXml: "", connectsXml: "" };
  }
  // Initial Begin/End coordinates. Visio's _WALKGLUE will recompute
  // these on load to land on the appropriate face of the source/target
  // shape, but we still need plausible starting values so an
  // un-recalculated viewer (or the first paint) shows the connector
  // roughly in the right place.
  const bx = m.cx(sourceNode.position.x);
  const by = m.cy(sourceNode.position.y);
  const ex = m.cx(targetNode.position.x);
  const ey = m.cy(targetNode.position.y);
  const midX = (bx + ex) / 2;
  const midY = (by + ey) / 2;
  const seqPart = seq != null ? `${seq}. ` : "";
  // Label = the comma-separated list of data classifications carried
  // along this edge (e.g. "EUPI, Customer Content"). Falls back to the
  // edge title if no data is attached, so untyped edges still show
  // something useful instead of an empty label.
  const labelBody = classifications.length > 0
    ? classifications.join(", ")
    : ((edge.title ?? "").trim() || "(untitled)");
  const label = `${seqPart}${labelBody}`;
  const shapeXml =
    `<Shape ID='${id}' NameU='Dynamic connector' Name='Dynamic connector' ` +
    `Type='Shape' Master='2'>` +
    // PinX/PinY/LocPinX/LocPinY all inherit their formula from the
    // master (GUARD((BeginX+EndX)/2) etc.) — we just supply the
    // computed numeric values so a freshly-opened file shows the
    // right initial position before Visio recomputes.
    `<Cell N='PinX' V='${fmt(midX)}' F='Inh'/>` +
    `<Cell N='PinY' V='${fmt(midY)}' F='Inh'/>` +
    `<Cell N='Width' V='${fmt(Math.abs(ex - bx))}' F='GUARD(EndX-BeginX)'/>` +
    `<Cell N='Height' V='${fmt(Math.abs(ey - by))}' F='GUARD(EndY-BeginY)'/>` +
    `<Cell N='LocPinX' V='${fmt(Math.abs(ex - bx) / 2)}' F='Inh'/>` +
    `<Cell N='LocPinY' V='${fmt(Math.abs(ey - by) / 2)}' F='Inh'/>` +
    `<Cell N='BeginX' V='${fmt(bx)}' F='_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)'/>` +
    `<Cell N='BeginY' V='${fmt(by)}' F='_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)'/>` +
    `<Cell N='EndX' V='${fmt(ex)}' F='_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)'/>` +
    `<Cell N='EndY' V='${fmt(ey)}' F='_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)'/>` +
    `<Cell N='LayerMember' V='0'/>` +
    `<Cell N='BegTrigger' V='2' F='_XFTRIGGER(Sheet.${sourceShape}!EventXFMod)'/>` +
    `<Cell N='EndTrigger' V='2' F='_XFTRIGGER(Sheet.${targetShape}!EventXFMod)'/>` +
    `<Cell N='ConFixedCode' V='6'/>` +
    // EndArrow=13 is Visio's default filled-triangle arrowhead. Without
    // this, the connector renders as a plain line and visually doesn't
    // appear "connected" to the target.
    `<Cell N='EndArrow' V='13'/>` +
    `<Cell N='LineColor' V='${edge.problem ? "#DC2626" : "#334155"}'/>` +
    // Center the text label on the midpoint of the connector. The
    // Dynamic connector master defines TxtPinX/TxtPinY as
    // GUARD(Width*0.5) / GUARD(Height*0.5+Controls.TextPosition.Y -...) ;
    // inheriting via F='Inh' lets Visio recompute the right anchor.
    // Without these cells, Visio falls back to (0,0) and the text
    // floats off to the bottom-left of the connector instead of
    // sitting on the line.
    `<Cell N='TxtPinX' V='${fmt(Math.abs(ex - bx) / 2)}' F='Inh'/>` +
    `<Cell N='TxtPinY' V='0.125' F='Inh'/>` +
    `<Section N='Control'>` +
    `<Row N='TextPosition'>` +
    `<Cell N='X' V='${fmt(Math.abs(ex - bx) / 2)}'/>` +
    `<Cell N='Y' V='0.125'/>` +
    `<Cell N='XDyn' V='${fmt(Math.abs(ex - bx) / 2)}' F='Inh'/>` +
    `<Cell N='YDyn' V='0.125' F='Inh'/>` +
    `</Row>` +
    `</Section>` +
    // Override the master's L-shaped routing geometry with a single
    // straight line from (0,0) to (Width,Height). Visio will recompute
    // the actual routed path on open, but the override prevents the
    // master's hard-coded L from showing through in viewers that don't
    // recalculate (Privacy Manager's renderer in particular).
    `<Section N='Geometry' IX='0'>` +
    `<Row T='MoveTo' IX='1'><Cell N='X' V='0'/><Cell N='Y' V='0'/></Row>` +
    `<Row T='LineTo' IX='2'><Cell N='X' V='${fmt(Math.abs(ex - bx))}'/><Cell N='Y' V='${fmt(Math.abs(ey - by))}'/></Row>` +
    `<Row T='LineTo' IX='3' Del='1'/>` +
    `</Section>` +
    textElement(label) +
    `</Shape>`;
  const connectsXml =
    `<Connect FromSheet='${id}' FromCell='EndX' FromPart='12' ` +
    `ToSheet='${targetShape}' ToCell='PinX' ToPart='3'/>` +
    `<Connect FromSheet='${id}' FromCell='BeginX' FromPart='9' ` +
    `ToSheet='${sourceShape}' ToCell='PinX' ToPart='3'/>`;
  return { shapeXml, connectsXml };
}

// ----------------------------- Page XML ----------------------------------

function renderPageXml(page: PageContent, inventoryLabel: string): string {
  const m = computePageMetrics(page);

  // IDs are document-unique strings, but Visio wants integers > 0
  // per-page. Allocate sequentially.
  let nextId = 1;
  const allocate = () => nextId++;

  // Boundaries first so they end up behind nodes in Z-order.
  const boundaryShapes = page.boundaries
    .map((b) => renderBoundaryShape(b, m, allocate(), page.catalogDefinitions))
    .join("");

  const shapeIdByNode = new Map<string, number>();
  const nodeById = new Map(page.nodes.map((n) => [n.id, n]));
  const nodeShapes = page.nodes
    .map((n) => {
      const sid = allocate();
      shapeIdByNode.set(n.id, sid);
      return renderNodeShape(n, m, sid, page.nodeTypeRefs, inventoryLabel);
    })
    .join("");

  let edgeShapes = "";
  let connects = "";
  for (const e of page.edges) {
    const sid = allocate();
    const seq = page.edgeNumbers[e.id];
    const { shapeXml, connectsXml } = renderEdgeShape(
      e,
      m,
      sid,
      shapeIdByNode,
      nodeById,
      seq,
      page.edgeClassifications[e.id] ?? [],
    );
    edgeShapes += shapeXml;
    connects += connectsXml;
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<PageContents xml:space="preserve" xmlns="http://schemas.microsoft.com/office/visio/2012/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n` +
    `  <Shapes>\n` +
    boundaryShapes +
    nodeShapes +
    edgeShapes +
    `  </Shapes>\n` +
    (connects
      ? `  <Connects>\n${connects}  </Connects>\n`
      : ``) +
    `</PageContents>\n`
  );
}

// ----------------------- Package-level XML parts -------------------------

// We base every export on a known-working Visio template (embedded as
// base64 in vsdxTemplate.ts). The template provides a complete
// document.xml with valid DocumentSettings / Colors / FaceNames /
// StyleSheets / DocumentSheet, plus a master sheet and theme that
// Visio expects to find. We only need to author:
//   - visio/pages/pages.xml        (one <Page> per scenario)
//   - visio/pages/page{N}.xml      (one per scenario)
//   - visio/pages/_rels/pages.xml.rels  (rId1 -> page1.xml, etc.)
//   - [Content_Types].xml          (add Override per extra page)
//
// Style/master parts remain unchanged. Export properties are generated anew;
// inherited author/company/custom metadata and the stale thumbnail are omitted.

function renderPagesXml(pages: PageContent[]): string {
  const entries = pages.map((p, i) => {
    const m = computePageMetrics(p);
    const id = i;
    const relId = `rId${i + 1}`;
    return (
      `<Page ID='${id}' NameU='${xmlEscape(p.name)}' Name='${xmlEscape(p.name)}' ` +
      `ViewScale='1' ViewCenterX='${fmt(m.pageW / 2)}' ViewCenterY='${fmt(m.pageH / 2)}'>` +
      `<PageSheet LineStyle='0' FillStyle='0' TextStyle='0'>` +
      `<Cell N='PageWidth' V='${fmt(m.pageW)}'/>` +
      `<Cell N='PageHeight' V='${fmt(m.pageH)}'/>` +
      `<Cell N='ShdwOffsetX' V='0.1181102362204724'/>` +
      `<Cell N='ShdwOffsetY' V='-0.1181102362204724'/>` +
      `<Cell N='PageScale' V='1' U='IN'/>` +
      `<Cell N='DrawingScale' V='1' U='IN_F'/>` +
      `<Cell N='DrawingSizeType' V='3'/>` +
      `<Cell N='DrawingScaleType' V='0'/>` +
      `<Cell N='InhibitSnap' V='0'/>` +
      `<Cell N='PageLockReplace' V='0' U='BOOL'/>` +
      `<Cell N='PageLockDuplicate' V='0' U='BOOL'/>` +
      `<Cell N='UIVisibility' V='0'/>` +
      `<Cell N='ShdwType' V='0'/>` +
      `<Cell N='ShdwObliqueAngle' V='0'/>` +
      `<Cell N='ShdwScaleFactor' V='1'/>` +
      `<Cell N='DrawingResizeType' V='1'/>` +
      `<Cell N='PageShapeSplit' V='1'/>` +
      `</PageSheet>` +
      `<Rel r:id='${relId}'/>` +
      `</Page>`
    );
  }).join("");
  return (
    `<?xml version='1.0' encoding='utf-8' ?>\n` +
    `<Pages xmlns='http://schemas.microsoft.com/office/visio/2012/main' ` +
    `xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships' xml:space='preserve'>` +
    entries +
    `</Pages>`
  );
}

function renderPagesRels(pageCount: number): string {
  const rels = Array.from({ length: pageCount }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${i + 1}.xml"/>`
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels +
    `</Relationships>`
  );
}

// Each page references the embedded "Dynamic connector" master via
// `Master='2'` on its connector shapes. Visio expects every page that
// uses a master to declare a rel to the master file. The template
// ships with this exact rel for page1; we recreate the same rel for
// every page we author so multi-scenario exports stay consistent.
function renderPageRels(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/master" Target="../masters/master1.xml"/>` +
    `</Relationships>`
  );
}

// Add <Override> entries for page2, page3, ... in the template's
// [Content_Types].xml. The template already declares /visio/pages/page1.xml
// and the visio/pages.xml/document.xml/etc parts.
function patchContentTypes(template: string, pageCount: number): string {
  if (pageCount <= 1) return template;
  const extras = [];
  for (let i = 2; i <= pageCount; i++) {
    extras.push(
      `<Override PartName="/visio/pages/page${i}.xml" ` +
      `ContentType="application/vnd.ms-visio.page+xml"/>`,
    );
  }
  // Splice before the closing </Types>.
  return template.replace(/<\/Types>/, extras.join("") + "</Types>");
}

// Base64 -> Uint8Array. Used to decode the embedded VSDX template at
// export time. Works in both browser and Node contexts.
function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  // Node fallback.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Buf = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (Buf) return Buf.from(b64, "base64");
  throw new Error("No base64 decoder available");
}

// ----------------------------- Public API --------------------------------

export interface ExportVsdxOptions {
  inventoryLabel?: string;
  classificationDefinitions?: readonly CatalogDefinitionSnapshot[];
  // Title written to docProps/core.xml. Defaults to the product name.
  modelName?: string;
}

// Build a single .vsdx file as a Uint8Array. The caller is responsible
// for wrapping it in a Blob and triggering the download.
export function exportVsdx(
  doc: PsDocument,
  options: ExportVsdxOptions = {},
): Uint8Array {
  const pages: PageContent[] =
    doc.scenarios.length > 0
      ? buildPagesFromScenarios(doc, options.classificationDefinitions)
      : [buildSinglePageFromDocument(doc)];

  const safePages: PageContent[] = pages.length > 0
    ? pages
    : [{
        name: "Diagram",
        nodes: [],
        edges: [],
        edgeNumbers: {},
        edgeClassifications: {},
        boundaries: [],
        nodeTypeRefs: doc.nodeTypes,
        catalogDefinitions: doc.catalogDefinitions,
      }];

  // Start from the embedded template (a known-working Visio file) and
  // mutate only the parts that vary per export. Everything else
  // (document.xml, masters/, theme/, windows.xml, the
  // existing page1.xml.rels which references master1) is inherited
  // unchanged so Visio finds the package well-formed.
  const templateBytes = base64ToBytes(VSDX_TEMPLATE_BASE64);
  const files: Record<string, Uint8Array> = unzipSync(templateBytes);

  // Replace pages.xml with our authored multi-page index.
  files["visio/pages/pages.xml"] = strToU8(renderPagesXml(safePages));

  // Replace pages.xml.rels so it lists rId1..rIdN for each page file.
  files["visio/pages/_rels/pages.xml.rels"] = strToU8(
    renderPagesRels(safePages.length),
  );

  // Drop any stale per-page xml files left over from the template.
  // We're about to write fresh page{N}.xml + page{N}.xml.rels per
  // scenario; clearing them first guarantees a clean slate.
  Object.keys(files).forEach((path) => {
    if (/^visio\/pages\/page\d+\.xml$/.test(path)) {
      delete files[path];
    }
    if (/^visio\/pages\/_rels\/page\d+\.xml\.rels$/.test(path)) {
      delete files[path];
    }
  });

  // Write one page file per scenario, plus a matching rels file so
  // the connector shapes (which use Master='2', the Dynamic Connector
  // master from the template) resolve to master1.xml.
  safePages.forEach((p, i) => {
    files[`visio/pages/page${i + 1}.xml`] = strToU8(renderPageXml(p, options.inventoryLabel ?? "Inventory ID"));
    files[`visio/pages/_rels/page${i + 1}.xml.rels`] = strToU8(renderPageRels());
  });

  // Update [Content_Types].xml to add Override entries for page2..pageN
  // (page1 is already declared in the template).
  const ct = strFromU8(files["[Content_Types].xml"]);
  files["[Content_Types].xml"] = strToU8(
    patchContentTypes(ct, safePages.length),
  );

  const modelName = options.modelName ?? "SecureDesignStudio diagram";
  const attribution = `${templateNotice.component}\nSource: ${templateNotice.sourceUrl}\n\n${templateNotice.notice}`;
  files["docProps/core.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title>${xmlEscape(modelName)}</dc:title><dc:creator>SecureDesignStudio</dc:creator>` +
    `<dc:description>${xmlEscape(attribution)}</dc:description></cp:coreProperties>`,
  );
  files["docProps/app.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
    `<Application>SecureDesignStudio</Application></Properties>`,
  );
  const removedMetadata = new Set(["docProps/custom.xml", "docProps/thumbnail.emf"]);
  for (const part of removedMetadata) delete files[part];
  const stripRemovedReferences = (xml: string, element: string, attribute: string) =>
    xml.replace(new RegExp(`<${element}\\b[^>]*\\/>`, "g"), match => {
      const target = match.match(new RegExp(`\\b${attribute}=(["'])(.*?)\\1`))?.[2]?.replace(/^\//, "");
      return target && removedMetadata.has(target) ? "" : match;
    });
  files["_rels/.rels"] = strToU8(stripRemovedReferences(strFromU8(files["_rels/.rels"]), "Relationship", "Target"));
  files["[Content_Types].xml"] = strToU8(stripRemovedReferences(strFromU8(files["[Content_Types].xml"]), "Override", "PartName"));

  return zipSync(files);
}
