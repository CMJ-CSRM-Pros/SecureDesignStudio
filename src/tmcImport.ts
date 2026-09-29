// Importer for the supported scenario/DFD JSON interchange format.
//
// Converts {scenarios, dfds} JSON into a PsDocument without service access.
// See docs/user-guide.md for the source-format provenance and a synthetic example.
//
// Important shape notes for callers / future maintainers:
//   - TMC entity GUIDs persist when an iteration is cloned. Imported ids are
//     derived from those GUIDs so independently imported iterations can be
//     compared by SecureDesignStudio's id-based diff engine. Node instances
//     remain distinct: labels and TMC shape types are editable and therefore
//     cannot safely identify an entity across iterations.
//   - Inside a TMC boundary, child `nodes[].position` is RELATIVE to the
//     parent boundary's position. We carry an ancestor offset down the
//     recursion so SecureDesignStudio sees absolute coordinates.
//   - `freetext` TMC nodes are explanatory labels with no SecureDesignStudio analog;
//     we drop them and report the count. Any edge that references a
//     freetext or a boundary is reported as unresolved (PsEdge endpoints
//     must be PsNode ids).
//   - The diagram → scenario join is by GUID match between
//     `dfds.items[].diagram.id` and `scenarios.threatModel.scenarios[].id`,
//     not array order — the export format makes no order guarantee.

import {
  DEFAULT_NODE_TYPES,
  type PsBoundary,
  type PsDocument,
  type PsEdge,
  type PsNode,
  type Scenario,
  type Waypoint,
} from "./types";

// ---- Source-side (TMC) shapes -------------------------------------------
//
// Kept narrow and defensive: every property is optional because real-world
// exports may add or drop fields between TMC backend versions.

type TmcNodeType =
  | "process"
  | "datastore"
  | "externalinteractor"
  | "freetext"
  | "boundary";

interface TmcPosition {
  x: number;
  y: number;
}

interface TmcSize {
  width: number;
  height: number;
}

interface TmcNode {
  id: string;
  type: TmcNodeType;
  label?: string;
  position?: TmcPosition;
  size?: TmcSize;
  nodes?: TmcNode[];
}

interface TmcEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface TmcDiagram {
  id: string;
  nodes: TmcNode[];
  edges: TmcEdge[];
}

interface TmcScenarioMeta {
  id: string;
  name?: string;
  description?: string;
}

export interface TmcImportSummary {
  scenarioCount: number;
  uniqueNodeCount: number;
  rawNodeInstanceCount: number;
  boundaryCount: number;
  edgeCount: number;
  // Number of TMC edges whose label encoded multiple numbered actions and
  // were split into separate SecureDesignStudio edges. (Counts source edges, not the
  // resulting pieces.)
  splitEdgeCount: number;
  skippedFreetextCount: number;
  skippedUnresolvedEdgeCount: number;
  diagramsWithoutScenarioCount: number;
  scenariosWithoutDiagramCount: number;
}

export interface TmcImportResult {
  doc: PsDocument;
  activeScenarioId: string | null;
  summary: TmcImportSummary;
}

export class TmcImportError extends Error {}

// ---- Entry point --------------------------------------------------------

export function importTmcExport(raw: unknown): TmcImportResult {
  const { scenarioMetas, diagrams } = parseAndValidate(raw);

  // Pass 1: walk every diagram once to collect node instances. TMC ids are
  // globally unique in normal exports; first-wins handling keeps malformed
  // exports with duplicate ids recoverable.
  const nodeEntries = new Map<
    string,
    { psId: string; label: string; type: TmcNodeType; position: TmcPosition }
  >();
  // TMC guid → SecureDesignStudio node id, used to resolve edges in pass 2.
  const tmcIdToPsId = new Map<string, string>();
  let rawNodeInstanceCount = 0;
  let skippedFreetextCount = 0;

  const collectFromTree = (
    n: TmcNode,
    offset: TmcPosition,
  ): void => {
    const abs = addPos(offset, n.position);
    if (n.type === "boundary") {
      // Boundaries themselves are handled in pass 2 (per-scenario). Recurse
      // into children with this boundary's absolute position as the new
      // offset.
      for (const child of n.nodes ?? []) {
        collectFromTree(child, abs);
      }
      return;
    }
    if (n.type === "freetext") {
      skippedFreetextCount++;
      return;
    }
    // process / datastore / externalinteractor
    rawNodeInstanceCount++;
    let entry = nodeEntries.get(n.id);
    if (!entry) {
      entry = {
        psId: stableTmcId("n", n.id),
        label: (n.label ?? "").trim() || "(unnamed)",
        type: n.type,
        position: abs,
      };
      nodeEntries.set(n.id, entry);
    }
    tmcIdToPsId.set(n.id, entry.psId);
  };

  for (const diagram of diagrams.values()) {
    for (const n of diagram.nodes) {
      collectFromTree(n, { x: 0, y: 0 });
    }
  }

  // Materialize PsNodes from the instance map (insertion order = first-seen
  // order across diagrams, which roughly tracks the scenario order in
  // the source).
  const psNodes: PsNode[] = [];
  for (const entry of nodeEntries.values()) {
    psNodes.push({
      id: entry.psId,
      title: entry.label,
      description: "",
      // Leaving type blank deliberately: TMC's `process`/`datastore`/
      // `externalinteractor` are shape categories, not the policy-bearing
      // SecureDesignStudio types (Dataverse / CAPI / BAP / …). Forcing a mapping would
      // give wrong policy hits; users assign types after import.
      type: "",
      serviceTreeId: "",
      endpointRegex: "",
      position: { x: entry.position.x, y: entry.position.y },
    });
  }
  const psNodeById = new Map(psNodes.map((n) => [n.id, n]));

  // Pass 2: build scenarios, boundaries, edges. Each scenario walks its
  // own diagram once.
  const psScenarios: Scenario[] = [];
  const psBoundaries: PsBoundary[] = [];
  const psEdges: PsEdge[] = [];
  let splitEdgeCount = 0;
  let skippedUnresolvedEdgeCount = 0;
  const descendantNodeIds = (root: TmcNode): string[] => {
    const ids = new Set<string>();
    const visit = (node: TmcNode) => {
      if (node.type === "boundary") {
        for (const child of node.nodes ?? []) visit(child);
        return;
      }
      if (node.type === "freetext") return;
      const id = tmcIdToPsId.get(node.id);
      if (id) ids.add(id);
    };
    for (const child of root.nodes ?? []) visit(child);
    return [...ids];
  };

  // Iterate in source-order of scenario metas so the output ordering is
  // stable and matches what the user saw in TMC.
  for (const meta of scenarioMetas) {
    const diagram = diagrams.get(meta.id);
    const scenario: Scenario = {
      id: stableTmcId("s", meta.id),
      name: (meta.name ?? "").trim() || "(unnamed scenario)",
      description: meta.description ?? "",
      nodeIds: [],
      edgeIds: [],
      edgeNumbers: {},
      boundaryIds: [],
      nodeData: {},
      edgeRequestData: {},
      edgeResponseData: {},
    };
    psScenarios.push(scenario);

    if (!diagram) continue;

    // Track per-scenario node membership; a node may appear in multiple
    // diagrams but should only be listed once per scenario.
    const scenarioNodeIds = new Set<string>();

    const walkForScenario = (n: TmcNode, offset: TmcPosition): void => {
      const abs = addPos(offset, n.position);
      if (n.type === "boundary") {
        const boundary: PsBoundary = {
          id: stableTmcId("b", n.id),
          type: "security",
          title: (n.label ?? "").trim(),
          position: { x: abs.x, y: abs.y },
          size: {
            width: Math.max(1, n.size?.width ?? 200),
            height: Math.max(1, n.size?.height ?? 120),
          },
          nodeIds: descendantNodeIds(n),
        };
        psBoundaries.push(boundary);
        scenario.boundaryIds.push(boundary.id);
        for (const child of n.nodes ?? []) {
          walkForScenario(child, abs);
        }
        return;
      }
      if (n.type === "freetext") return;

      const psId = tmcIdToPsId.get(n.id);
      if (psId && !scenarioNodeIds.has(psId)) {
        scenarioNodeIds.add(psId);
        scenario.nodeIds.push(psId);
      }
    };

    for (const n of diagram.nodes) {
      walkForScenario(n, { x: 0, y: 0 });
    }

    // Edges. Two preprocessing steps before we create PsEdges:
    //
    //   (a) SPLIT a label that encodes multiple numbered actions on the
    //       same source→target arrow into separate logical edges. TMC
    //       can only attach one edge per direction between two shapes,
    //       so authors stack actions into one label like:
    //         "8. GET /foo\r\nToken: User\r\n23. POST /bar\r\nToken: User"
    //       Each "N." (or "Na.") prefix at line start marks a new action;
    //       continuation lines (without that prefix) belong to the
    //       preceding action.
    //
    //   (b) ORDER the resulting edges by their parsed sequence — number
    //       first, then letter suffix (so 1, 1a, 1b, 2, 10 sort
    //       correctly). Edges with no number prefix slot in based on
    //       their original document position relative to the surrounding
    //       numbered edges.
    //
    // The final order drives SecureDesignStudio's per-scenario edgeNumbers (1..N),
    // so getting it right here is what the user actually sees on screen.

    interface LogicalEdge {
      id: string;
      source: string;
      target: string;
      label: string;
      // Used as a tie-breaker in the sort below; combines TMC edge index
      // (i) and split sub-index (j) so order within a multi-numbered
      // label is preserved when sort values tie.
      originalIndex: number;
    }

    const logical: LogicalEdge[] = [];
    diagram.edges.forEach((e, i) => {
      const splits = splitMultiNumberedLabel(e.label ?? "");
      if (splits.length > 1) splitEdgeCount++;
      splits.forEach((subLabel, j) => {
        const sequenceToken = subLabel.match(SEQUENCE_PREFIX_RE)?.[0]
          .replace(/\.\s*$/, "")
          .toLowerCase();
        logical.push({
          id: stableTmcId(
            "e",
            e.id,
            splits.length > 1 ? sequenceToken || `part-${j + 1}` : undefined,
          ),
          source: e.source,
          target: e.target,
          label: subLabel,
          originalIndex: i * 10000 + j,
        });
      });
    });

    // Compute a numeric sort value per edge in DOCUMENT order. Unnumbered
    // edges get anchored to the last seen numbered edge with a tiny
    // increment so they slot just after it, before the next numbered
    // group. See edgeSortValueFor for details.
    const keyed = computeEdgeSortValues(logical);
    keyed.sort(
      (a, b) =>
        a.sortValue - b.sortValue || a.edge.originalIndex - b.edge.originalIndex,
    );

    for (const { edge: le } of keyed) {
      const sourcePsId = tmcIdToPsId.get(le.source);
      const targetPsId = tmcIdToPsId.get(le.target);
      if (!sourcePsId || !targetPsId || sourcePsId === targetPsId) {
        // sourcePsId === targetPsId is the self-loop case we get if two
        // distinct TMC instances of the same label were collapsed into
        // one PsNode and an edge connected those two instances. Dropping
        // it matches createEdge's own guard.
        skippedUnresolvedEdgeCount++;
        continue;
      }

      // Strip the "N.", "Na.", "12b." sequence prefix (SecureDesignStudio auto-numbers
      // via scenario.edgeNumbers from the sorted order computed above).
      // Then split off the first remaining line as the title; remaining
      // lines (typical TMC pattern: "Token: User", method/path detail, etc.)
      // go into the description.
      const rawLabel = le.label.trim();
      const prefixMatch = rawLabel.match(SEQUENCE_PREFIX_RE);
      const withoutPrefix = prefixMatch
        ? rawLabel.slice(prefixMatch[0].length)
        : rawLabel;
      const newlineIdx = withoutPrefix.search(/\r?\n/);
      const title =
        (newlineIdx >= 0
          ? withoutPrefix.slice(0, newlineIdx)
          : withoutPrefix
        ).trim() || "(unnamed edge)";
      const description =
        newlineIdx >= 0
          ? withoutPrefix.slice(newlineIdx).replace(/^\r?\n+/, "").trimEnd()
          : "";

      const sourceNode = psNodeById.get(sourcePsId);
      const targetNode = psNodeById.get(targetPsId);
      // Pick which side of each node the edge attaches to based on the
      // relative positions of the two endpoints. Without this, every
      // imported edge would default to the top handle, producing a tangled
      // hairball at the top of every node.
      const { sourceHandle, targetHandle } = chooseHandles(
        sourceNode?.position,
        targetNode?.position,
      );
      // Pre-seed a midpoint waypoint so FlowEdge doesn't auto-snapshot on
      // first render (which would clobber the undo stack with one entry
      // per imported edge).
      const midWaypoint: Waypoint = {
        id: stableTmcId("w", le.id),
        x: ((sourceNode?.position.x ?? 0) + (targetNode?.position.x ?? 0)) / 2,
        y: ((sourceNode?.position.y ?? 0) + (targetNode?.position.y ?? 0)) / 2,
      };

      const psEdge: PsEdge = {
        id: le.id,
        source: sourcePsId,
        target: targetPsId,
        sourceHandle,
        targetHandle,
        title,
        description,
        waypoints: [midWaypoint],
      };
      psEdges.push(psEdge);

      scenario.edgeIds.push(psEdge.id);
      // Ensure both endpoints are in this scenario's nodeIds even if the
      // diagram walk above didn't see them (defensive — a malformed diagram
      // could reference nodes only via edges).
      for (const nid of [sourcePsId, targetPsId]) {
        if (!scenarioNodeIds.has(nid)) {
          scenarioNodeIds.add(nid);
          scenario.nodeIds.push(nid);
        }
      }
    }
    scenario.edgeIds.forEach((eid, i) => {
      scenario.edgeNumbers[eid] = i + 1;
    });
  }

  // Diagnostics: diagrams whose id doesn't match any declared scenario
  // (data bug in the export); scenarios with no diagram (legitimate —
  // empty placeholders).
  const scenarioIdSet = new Set(scenarioMetas.map((m) => m.id));
  let diagramsWithoutScenarioCount = 0;
  for (const id of diagrams.keys()) {
    if (!scenarioIdSet.has(id)) diagramsWithoutScenarioCount++;
  }
  const scenariosWithoutDiagramCount = scenarioMetas.filter(
    (m) => !diagrams.has(m.id),
  ).length;

  const doc: PsDocument = {
    version: 1,
    nodeTypes: [...DEFAULT_NODE_TYPES],
    nodes: psNodes,
    edges: psEdges,
    boundaries: psBoundaries,
    scenarios: psScenarios,
    data: [],
    comments: [],
    issues: [],
    deviations: [],
    workItems: [],
  };

  return {
    doc,
    activeScenarioId: psScenarios[0]?.id ?? null,
    summary: {
      scenarioCount: psScenarios.length,
      uniqueNodeCount: psNodes.length,
      rawNodeInstanceCount,
      boundaryCount: psBoundaries.length,
      edgeCount: psEdges.length,
      splitEdgeCount,
      skippedFreetextCount,
      skippedUnresolvedEdgeCount,
      diagramsWithoutScenarioCount,
      scenariosWithoutDiagramCount,
    },
  };
}

// ---- Internals ----------------------------------------------------------

function parseAndValidate(raw: unknown): {
  scenarioMetas: TmcScenarioMeta[];
  diagrams: Map<string, TmcDiagram>;
} {
  if (raw == null || typeof raw !== "object") {
    throw new TmcImportError(
      "Scenario/DFD JSON must be an object with the supported scenarios and dfds structure.",
    );
  }
  const obj = raw as Record<string, unknown>;

  const scenariosRoot = obj["scenarios"];
  if (!scenariosRoot || typeof scenariosRoot !== "object") {
    throw new TmcImportError(
      'Scenario/DFD JSON is missing the top-level "scenarios" object. Use File > Open for native model JSON.',
    );
  }
  const threatModel =
    (scenariosRoot as Record<string, unknown>)["threatModel"];
  if (!threatModel || typeof threatModel !== "object") {
    throw new TmcImportError(
      'Scenario/DFD JSON is missing "scenarios.threatModel".',
    );
  }
  const tmScenarios = (threatModel as Record<string, unknown>)["scenarios"];
  if (!Array.isArray(tmScenarios)) {
    throw new TmcImportError(
      'Scenario/DFD JSON "scenarios.threatModel.scenarios" must be an array.',
    );
  }

  const scenarioMetas: TmcScenarioMeta[] = [];
  for (const s of tmScenarios) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    scenarioMetas.push({
      id: r.id,
      name: typeof r.name === "string" ? r.name : undefined,
      description: typeof r.description === "string" ? r.description : undefined,
    });
  }

  const dfdsRoot = obj["dfds"];
  if (!dfdsRoot || typeof dfdsRoot !== "object") {
    throw new TmcImportError('Scenario/DFD JSON is missing the top-level "dfds" object.');
  }
  const items = (dfdsRoot as Record<string, unknown>)["items"];
  if (!Array.isArray(items)) {
    throw new TmcImportError('Scenario/DFD JSON "dfds.items" must be an array.');
  }

  const diagrams = new Map<string, TmcDiagram>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const diagram = (item as Record<string, unknown>)["diagram"];
    if (!diagram || typeof diagram !== "object") continue;
    const d = diagram as Record<string, unknown>;
    if (typeof d.id !== "string") continue;
    const nodes = Array.isArray(d.nodes) ? (d.nodes as TmcNode[]) : [];
    const edges = Array.isArray(d.edges) ? (d.edges as TmcEdge[]) : [];
    // Key by diagram id; duplicates keep the last-wins, but the source
    // shouldn't produce duplicates and we surface a count if it does
    // (see diagramsWithoutScenarioCount in caller).
    diagrams.set(d.id, { id: d.id, nodes, edges });
  }

  if (scenarioMetas.length === 0 && diagrams.size === 0) {
    throw new TmcImportError(
      "Scenario/DFD JSON contains no scenarios and no diagrams.",
    );
  }
  return { scenarioMetas, diagrams };
}

function addPos(a: TmcPosition, b: TmcPosition | undefined): TmcPosition {
  return {
    x: a.x + (b?.x ?? 0),
    y: a.y + (b?.y ?? 0),
  };
}

function stableTmcId(
  prefix: "n" | "s" | "b" | "e" | "w",
  sourceId: string,
  part?: string,
): string {
  const identity = `${sourceId.trim().toLowerCase()}|${part ?? ""}`;
  const hash = (seed: number): number => {
    let value = seed >>> 0;
    for (let i = 0; i < identity.length; i++) {
      value ^= identity.charCodeAt(i);
      value = Math.imul(value, 0x01000193);
    }
    return value >>> 0;
  };
  const a = hash(0x811c9dc5).toString(16).padStart(8, "0");
  const b = hash(0x1234abcd).toString(16).padStart(8, "0");
  const c = hash(0xfeedface).toString(16).padStart(8, "0");
  const d = hash(0xdeadbeef).toString(16).padStart(8, "0");
  return `${prefix}_tmc_${a}${b}${c}${d}`;
}

// Matches "N.", "Na.", "12bc." at the start of a string. Capture group 1
// is the numeric part; group 2 (optional) is the lowercase letter suffix.
// Single regex used for both the front-of-label strip and the start-of-line
// detector inside splitMultiNumberedLabel.
const SEQUENCE_PREFIX_RE = /^(\d+)([a-z]*)\.\s*/i;
const SEQUENCE_LINE_RE = /^\s*\d+[a-z]*\.\s+/i;

// TMC can only render one edge per direction between any two shapes, so
// when an author needs to depict multiple calls in the same direction
// they stack them in a single label, separated by newlines. Each numbered
// line (matching SEQUENCE_LINE_RE) starts a new logical action; subsequent
// unprefixed lines are continuation/detail for that action.
//
// If the label has 0 or 1 numbered lines, no splitting is performed and
// the original label is returned unchanged (including its newlines).
export function splitMultiNumberedLabel(label: string): string[] {
  if (!label) return [label];
  const lines = label.split(/\r?\n/);
  const groups: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (SEQUENCE_LINE_RE.test(line) && current.length > 0) {
      groups.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) groups.push(current.join("\n"));
  if (groups.length <= 1) return [label];
  return groups.map((g) => g.trim()).filter((g) => g.length > 0);
}

// Convert a lowercase letter suffix to a numeric offset.
//   ""  → 0
//   "a" → 1, "b" → 2, ..., "z" → 26
//   "aa" → 27, "ab" → 28, ..., "zz" → 702
// Standard base-26 (1-indexed) so the ordering matches what a human reader
// would expect for the rare "aa+" case.
function letterSuffixOffset(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 96 /* 'a' - 1 */);
  }
  return n;
}

// Pick which side of each endpoint an edge should attach to based on the
// relative position of the two nodes. The 4 handle ids on a PsNode are
// "top" | "right" | "bottom" | "left" (see ProcessNode.tsx).
//
// We choose the dominant axis from the delta vector (target - source):
//   |dx| > |dy|  → horizontal: source = right/left, target = left/right
//   |dy| >= |dx| → vertical:   source = bottom/top, target = top/bottom
//
// Identical positions (or missing positions) fall back to right/left so the
// edge still has explicit handles instead of defaulting to top/top.
export function chooseHandles(
  sourcePos?: { x: number; y: number },
  targetPos?: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  if (!sourcePos || !targetPos) {
    return { sourceHandle: "right", targetHandle: "left" };
  }
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "right", targetHandle: "left" }
      : { sourceHandle: "left", targetHandle: "right" };
  }
  return dy >= 0
    ? { sourceHandle: "bottom", targetHandle: "top" }
    : { sourceHandle: "top", targetHandle: "bottom" };
}

interface KeyedEdge<T> {
  edge: T;
  sortValue: number;
}

// Assign sort values to edges in DOCUMENT order so unnumbered edges can
// anchor to the most recently seen numbered edge.
//
// Numbered edges get sortValue = num * 1000 + letterOffset, which keeps
// the numeric component dominant (so 2 > 1z) while preserving the
// expected ordering within a number (1 < 1a < 1b < 1z).
//
// Unnumbered edges get sortValue = lastNumberedValue + 0.001 * k where k
// is how many unnumbered we've seen since the last numbered, so they
// slot between the previous numbered group and the next one. Initial
// unnumbered (before any numbered edge) anchor at 0 so they sort before
// any positive-numbered edge.
function computeEdgeSortValues<
  T extends { label: string; originalIndex: number },
>(edges: T[]): KeyedEdge<T>[] {
  let lastValue = 0;
  let unnumberedRun = 0;
  const result: KeyedEdge<T>[] = [];
  for (const e of edges) {
    const m = e.label.match(SEQUENCE_PREFIX_RE);
    if (m) {
      const num = parseInt(m[1], 10);
      const letterOffset = letterSuffixOffset((m[2] || "").toLowerCase());
      const sortValue = num * 1000 + letterOffset;
      lastValue = sortValue;
      unnumberedRun = 0;
      result.push({ edge: e, sortValue });
    } else {
      unnumberedRun++;
      result.push({ edge: e, sortValue: lastValue + 0.001 * unnumberedRun });
    }
  }
  return result;
}
