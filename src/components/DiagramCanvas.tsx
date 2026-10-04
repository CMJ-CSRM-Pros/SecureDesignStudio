import {
  Background,
  ConnectionMode,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { useBreachSimulation } from "../breachSimulation";
import { nodeTypeIconUrl } from "../nodeTypeIcons";
import { DFD_ROLE_LABELS, DFD_SCOPE_LABELS, nodeDfdSummary, resolveNodeReviewScope } from "../dfdSemantics";
import {
  NODE_COLORS,
  authTypeLabel,
  authBehavior,
  isKnownInstalledAuthentication,
  authTypeShortLabel,
  dataClassificationLabel,
  nodeTypeLabel,
  type DataClassification,
} from "../types";
import { useUiShell } from "../uiShell";
import { useLibraries } from "../libraries/LibraryProvider";
import { BoundaryNode } from "./BoundaryNode";
import { CommentsModal, type CommentTarget } from "./CommentsModal";
import { FlowEdge } from "./FlowEdge";
import { ProcessNode } from "./ProcessNode";
import { useRemoveFromScenarioWithConfirm } from "./useRemoveFromScenarioWithConfirm";

const nodeTypes = {
  process: ProcessNode,
  boundary: BoundaryNode,
};

const edgeTypes = {
  flow: FlowEdge,
};

const UNRANKED_CLASSIFICATION_STYLE = { color: "#475569", foreground: "#ffffff" };

function CanvasZoomControls() {
  const { zoomIn, zoomOut, setViewport, fitView } = useReactFlow();
  const { x, y, zoom } = useViewport();
  const percentage = Math.round(zoom * 100);

  return (
    <div
      className="ps-canvas-zoom-controls"
      role="group"
      aria-label="Canvas zoom controls"
    >
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={zoom <= 0.5}
        onClick={() => void zoomOut({ duration: 150 })}
      >
        −
      </button>
      <button
        type="button"
        className="ps-canvas-zoom-level"
        aria-label={`Reset canvas zoom to 100%. Current zoom ${percentage}%`}
        title="Reset canvas zoom to 100%"
        onClick={() => void setViewport({ x, y, zoom: 1 }, { duration: 180 })}
      >
        {percentage}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={zoom >= 2}
        onClick={() => void zoomIn({ duration: 150 })}
      >
        +
      </button>
      <span className="ps-canvas-zoom-separator" aria-hidden="true" />
      <button
        type="button"
        aria-label="Fit model to view"
        title="Fit model to view"
        onClick={() => void fitView({ duration: 300, padding: 0.18 })}
      >
        ⊡
      </button>
    </div>
  );
}

function InnerDiagram() {
  const installed = useLibraries().authentication;
  const {
    activeReferenceKeys,
    currentStepIndex: simulationStepIndex,
    currentReferenceKey,
    plan: simulationPlan,
    status: simulationStatus,
  } = useBreachSimulation();
  const {
    doc,
    authenticationCatalog,
    classificationLibrary,
    classificationDefinitions,
    visibleNodes,
    visibleEdges,
    setNodeSize,
    moveDiagramItems,
    resizeBoundary,
    finishBoundaryResize,
    createNode,
    createEdge,
    createBoundary,
    updateEdge,
    addNodeToScenario,
    addEdgeToScenario,
    addBoundaryToScenario,
    removeBoundaryFromScenario,
    removeNodeFromBoundary,
    visibleBoundaries,
    activeScenarioId,
    activeScenario,
    edgeNumberFor,
    selection,
    setSelection,
    multiSelectedIds,
    snapshot,
    focusTarget,
    setFocusTarget,
    updateNode,
  } = useStore();
  const { removeNodeOrDelete, removeEdgeOrDelete } =
    useRemoveFromScenarioWithConfirm();
  const {
    screenToFlowPosition,
    fitView,
    zoomIn,
    zoomOut,
    getViewport,
    setViewport,
  } = useReactFlow();
  const { fitViewRequest } = useUiShell();

  // ---- Right-click context menu state ---- (hoisted above rfEdges so the
  // edge-title callback can be embedded in edge data.)
  type MenuTarget =
    | { kind: "pane" }
    | { kind: "boundary"; id: string }
    | { kind: "node"; id: string }
    | { kind: "edge"; id: string };
  type Menu = {
    screenX: number;
    screenY: number;
    flowX: number;
    flowY: number;
    target: MenuTarget;
  };
  const [contextMenu, setContextMenu] = useState<Menu | null>(null);
  const resizingBoundaryIdsRef = useRef(new Set<string>());
  const onBoundaryResizeStart = useCallback(
    (id: string) => {
      resizingBoundaryIdsRef.current.add(id);
      snapshot();
    },
    [snapshot],
  );
  const onBoundaryResizeEnd = useCallback(
    (id: string) => {
      requestAnimationFrame(() => {
        resizingBoundaryIdsRef.current.delete(id);
        finishBoundaryResize(id);
      });
    },
    [finishBoundaryResize],
  );
  const [commentsTarget, setCommentsTarget] = useState<CommentTarget | null>(
    null
  );
  const [commentsMode, setCommentsMode] = useState<"view" | "add">("view");
  const openMenuAt = useCallback(
    (clientX: number, clientY: number, target: MenuTarget) => {
      const flow = screenToFlowPosition({ x: clientX, y: clientY });
      setContextMenu({
        screenX: clientX,
        screenY: clientY,
        flowX: flow.x,
        flowY: flow.y,
        target,
      });
    },
    [screenToFlowPosition]
  );
  // Pan/zoom the React Flow viewport to a target requested by the
  // review panels. Runs after the visible diagram elements have been
  // recomputed for the (possibly newly active) scenario.
  useEffect(() => {
    if (!focusTarget) return;
    let nodeIds: string[] = [];
    if (focusTarget.kind === "node") {
      if (visibleNodes.some((n) => n.id === focusTarget.id)) {
        nodeIds = [focusTarget.id];
      }
    } else if (focusTarget.kind === "boundary") {
      if (visibleBoundaries.some((boundary) => boundary.id === focusTarget.id)) {
        nodeIds = [focusTarget.id];
      }
    } else {
      const edge = doc.edges.find((e) => e.id === focusTarget.id);
      if (edge) {
        const visible = new Set(visibleNodes.map((n) => n.id));
        nodeIds = [edge.source, edge.target].filter((id) => visible.has(id));
      }
    }
    if (nodeIds.length > 0) {
      // Defer to next frame so React Flow has applied the new scenario's
      // node set before we call fitView.
      const raf = requestAnimationFrame(() => {
        fitView({
          nodes: nodeIds.map((id) => ({ id })),
          duration: 400,
          padding: 0.4,
          maxZoom: 1.5,
        });
        setFocusTarget(null);
      });
      return () => cancelAnimationFrame(raf);
    }
    // Target isn't visible in the current scenario — clear so we don't loop.
    setFocusTarget(null);
  }, [focusTarget, visibleNodes, visibleBoundaries, doc.edges, fitView, setFocusTarget]);

  useEffect(() => {
    if (fitViewRequest === 0) return;
    const raf = requestAnimationFrame(() => {
      void fitView({ duration: 300, padding: 0.18 });
    });
    return () => cancelAnimationFrame(raf);
  }, [fitViewRequest, fitView]);

  useEffect(() => {
    if (
      !simulationPlan ||
      simulationStatus !== "playing" ||
      simulationStepIndex !== -1
    ) {
      return;
    }
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const pathNodeIds = new Set<string>();
    for (const step of simulationPlan.steps) {
      if (step.kind === "node" && visibleNodeIds.has(step.id)) {
        pathNodeIds.add(step.id);
      } else if (step.kind === "edge") {
        const edge = visibleEdges.find((candidate) => candidate.id === step.id);
        if (edge) {
          if (visibleNodeIds.has(edge.source)) pathNodeIds.add(edge.source);
          if (visibleNodeIds.has(edge.target)) pathNodeIds.add(edge.target);
        }
      }
    }
    if (pathNodeIds.size === 0) return;
    const raf = requestAnimationFrame(() => {
      void fitView({
        nodes: [...pathNodeIds].map((id) => ({ id })),
        duration: 500,
        padding: 0.22,
        maxZoom: 1.15,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [
    fitView,
    simulationPlan,
    simulationStatus,
    simulationStepIndex,
    visibleEdges,
    visibleNodes,
  ]);

  // Capture-phase document listener that maps a right-click anywhere inside
  // a .ps-edge-label up to the edge id and opens the "Add to scenario" menu.
  useEffect(() => {
    const onDocContextMenu = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      let cur: Element | null = e.target;
      while (cur) {
        if (cur.classList?.contains("ps-edge-label")) {
          const edgeId = cur.getAttribute("data-edge-id");
          if (edgeId) {
            e.preventDefault();
            e.stopPropagation();
            openMenuAt(e.clientX, e.clientY, { kind: "edge", id: edgeId });
            return;
          }
          break;
        }
        cur = cur.parentElement;
      }
    };
    document.addEventListener("contextmenu", onDocContextMenu, true);
    return () =>
      document.removeEventListener("contextmenu", onDocContextMenu, true);
  }, [openMenuAt]);

  // Document-level capture-phase dblclick listener — same fallback pattern
  // we use for the right-click on the edge label. Dispatches a custom event
  // on the matched label so the FlowEdge enters title-edit mode.
  useEffect(() => {
    const onDocDblClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      let cur: Element | null = e.target;
      while (cur) {
        if (cur.classList?.contains("ps-edge-label")) {
          const edgeId = cur.getAttribute("data-edge-id");
          if (edgeId) {
            e.stopPropagation();
            cur.dispatchEvent(
              new CustomEvent("ps-edit-edge-title", { bubbles: false })
            );
            return;
          }
          break;
        }
        cur = cur.parentElement;
      }
    };
    document.addEventListener("dblclick", onDocDblClick, true);
    return () => document.removeEventListener("dblclick", onDocDblClick, true);
  }, []);

  // Precompute per-target comment counts so node/edge components can render
  // their badges without each one re-walking doc.comments. Comments are
  // scenario-scoped: when a scenario is active, count only its comments;
  // in show-all mode, sum across every scenario.
  const commentCounts = useMemo(() => {
    const counts = new Map<string, { active: number; resolved: number }>();
    for (const c of doc.comments) {
      if (activeScenario && c.scenarioId !== activeScenario.id) continue;
      const key = `${c.targetKind}:${c.targetId}`;
      const cur = counts.get(key) ?? { active: 0, resolved: 0 };
      if (c.status === "Active") cur.active += 1;
      else cur.resolved += 1;
      counts.set(key, cur);
    }
    return counts;
  }, [doc.comments, activeScenario]);

  // Per-target issue counts. An issue is "visible" on a target in a given
  // scenario if (a) the scenario is in its scenarioIds list, OR (b) the
  // issue has no scenarioIds (target-only / structural). In show-all mode
  // we count every issue once per distinct target regardless of scenario.
  const issueCounts = useMemo(() => {
    const counts = new Map<string, { active: number; resolved: number }>();
    for (const i of doc.issues) {
      if (activeScenario) {
        const applies =
          i.scenarioIds.length === 0 ||
          i.scenarioIds.includes(activeScenario.id);
        if (!applies) continue;
      }
      const key = `${i.targetKind}:${i.targetId}`;
      const cur = counts.get(key) ?? { active: 0, resolved: 0 };
      if (i.status === "Active") cur.active += 1;
      else cur.resolved += 1;
      counts.set(key, cur);
    }
    return counts;
  }, [doc.issues, activeScenario]);

  const edgeClassificationVisuals = useMemo(() => {
    const presentations = new Map(classificationLibrary.classifications.flatMap(
      item => item.presentation ? [[item.id, item.presentation] as const] : [],
    ));
    const dataById = new Map(doc.data.map((item) => [item.id, item]));
    const scenarios = activeScenario ? [activeScenario] : doc.scenarios;
    const visuals = new Map<
      string,
      {
        labels: string[];
        color: string;
        foreground: string;
      }
    >();

    for (const edge of visibleEdges) {
      const classifications = new Set<DataClassification>();
      for (const scenario of scenarios) {
        if (!scenario.edgeIds.includes(edge.id)) continue;
        const dataIds = [
          ...(scenario.edgeRequestData[edge.id] ?? []),
          ...(scenario.edgeResponseData[edge.id] ?? []),
        ];
        for (const dataId of dataIds) {
          const item = dataById.get(dataId);
          if (item) classifications.add(item.classification);
        }
      }
      const unranked = [...classifications].filter((id) => !presentations.has(id)).sort();
      const known = [...classifications].filter((id) => presentations.has(id)).sort(
        (a, b) =>
          presentations.get(b)!.priority - presentations.get(a)!.priority,
      );
      const ordered = [...unranked, ...known];
      const primary = ordered[0];
      if (!primary) continue;
      const style = unranked.length > 0
        ? UNRANKED_CLASSIFICATION_STYLE
        : presentations.get(primary)!;
      visuals.set(edge.id, {
        labels: ordered.map((id) => dataClassificationLabel(id, doc.catalogDefinitions, classificationDefinitions)),
        color: style.color,
        foreground: style.foreground,
      });
    }
    return visuals;
  }, [activeScenario, doc.data, doc.scenarios, doc.catalogDefinitions, visibleEdges, classificationLibrary, classificationDefinitions]);

  const rfNodes = useMemo<RfNode[]>(() => {
    const multiSet = new Set(multiSelectedIds);
    const boundaryNodes: RfNode[] = visibleBoundaries.map((b) => ({
      id: b.id,
      type: "boundary",
      position: b.position,
      width: b.size.width,
      height: b.size.height,
      measured: { width: b.size.width, height: b.size.height },
      data: {
        title: b.title,
        boundaryType: b.type,
        privacySubtype: b.privacySubtype,
        securitySubtype: b.securitySubtype,
        onResizeStart: onBoundaryResizeStart,
        onResizeEnd: onBoundaryResizeEnd,
      },
      selected:
        (selection?.kind === "boundary" && selection.id === b.id) ||
        multiSet.has(b.id),
      draggable: true,
      selectable: true,
      zIndex: -1,
    }));
    const processNodes: RfNode[] = visibleNodes.map((n) => {
      const scope = resolveNodeReviewScope(n, activeScenario, doc.nodeTypes);
      const semanticSummary = nodeDfdSummary(n, doc, activeScenario);
      const cc = commentCounts.get(`node:${n.id}`) ?? { active: 0, resolved: 0 };
      const ic = issueCounts.get(`node:${n.id}`) ?? { active: 0, resolved: 0 };
      return {
        id: n.id,
        type: "process",
        ariaLabel: `${n.title || "Untitled node"}. ${semanticSummary}`,
        position: n.position,
        data: {
          title: n.title,
          type: n.type,
          typeLabel: nodeTypeLabel(n.type, doc.nodeTypes),
          iconUrl: nodeTypeIconUrl(n.type, doc.nodeTypes),
          color: n.color,
          dfdRole: scope.role.role,
          dfdLabel: DFD_ROLE_LABELS[scope.role.role],
          scopeDisposition: scope.disposition,
          scopeLabel: activeScenario ? DFD_SCOPE_LABELS[scope.disposition] : "Scope varies by scenario",
          semanticSummary,
          commentActive: cc.active,
          commentResolved: cc.resolved,
          issueActive: ic.active,
          issueResolved: ic.resolved,
          simulationActive: activeReferenceKeys.has(`node:${n.id}`),
          simulationCurrent: currentReferenceKey === `node:${n.id}`,
          simulationTarget:
            simulationPlan?.steps.at(-1)?.kind === "node" &&
            simulationPlan.steps.at(-1)?.id === n.id,
        },
        selected:
          (selection?.kind === "node" && selection.id === n.id) ||
          multiSet.has(n.id),
        draggable: true,
        selectable: true,
        zIndex: 1,
      };
    });
    return [...boundaryNodes, ...processNodes];
  }, [
    visibleBoundaries,
    visibleNodes,
    selection,
    multiSelectedIds,
    commentCounts,
    issueCounts,
    onBoundaryResizeStart,
    onBoundaryResizeEnd,
    doc,
    activeScenario,
    activeReferenceKeys,
    currentReferenceKey,
    simulationPlan,
  ]);

  const rfEdges = useMemo<RfEdge[]>(() => {
    return visibleEdges.map((e) => {
      const edgeSelected =
        (selection?.kind === "edge" && selection.id === e.id) ||
        (selection?.kind === "waypoint" && selection.edgeId === e.id);
      const classificationVisual = edgeClassificationVisuals.get(e.id);
      const edgeColor = e.problem
        ? "#dc2626"
        : activeReferenceKeys.has(`edge:${e.id}`)
        ? "#d13438"
        : classificationVisual?.color ?? "#48a";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: "flow",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
        },
        selected: edgeSelected,
        // Endpoints can only be dragged to a new node/handle when the edge
        // is currently selected.
        reconnectable: edgeSelected,
        data: {
          title: e.title,
          number: edgeNumberFor(e.id),
          waypoints: e.waypoints,
          problem: e.problem === true,
          authenticationLabels: (e.authenticationTypes ?? []).map(id => authTypeLabel(id, authenticationCatalog)),
          authenticationShortLabel:
            e.authenticationTypes?.length === 1
              ? authTypeShortLabel(e.authenticationTypes[0], authenticationCatalog)
              : undefined,
          authenticationAnonymous:
            e.authenticationTypes?.some(id => authBehavior(id, authenticationCatalog).anonymous) ?? false,
          authenticationMultiple: (e.authenticationTypes?.length ?? 0) > 1,
          authenticationReviewRequired: (e.authenticationTypes ?? []).some(id => {
            const def = authenticationCatalog.find(entry => entry.id === id);
            return !def || def.unresolved || def.unavailableReason || def.legacy || !isKnownInstalledAuthentication(id, installed)
              || def.behavior.productionIdentity === "unknown";
          }),
          classificationLabels: classificationVisual?.labels ?? [],
          classificationColor: classificationVisual?.color,
          classificationForeground: classificationVisual?.foreground,
          commentActive:
            commentCounts.get(`edge:${e.id}`)?.active ?? 0,
          commentResolved:
            commentCounts.get(`edge:${e.id}`)?.resolved ?? 0,
          issueActive:
            issueCounts.get(`edge:${e.id}`)?.active ?? 0,
          issueResolved:
            issueCounts.get(`edge:${e.id}`)?.resolved ?? 0,
          simulationActive: activeReferenceKeys.has(`edge:${e.id}`),
          simulationCurrent: currentReferenceKey === `edge:${e.id}`,
        },
      } as RfEdge;
    });
  }, [
    visibleEdges,
    selection,
    edgeNumberFor,
    commentCounts,
    issueCounts,
    edgeClassificationVisuals,
    authenticationCatalog,
    activeReferenceKeys,
    currentReferenceKey,
  ]);

  // Drag position updates are coalesced once per animation frame so we don't
  // do a full doc copy + re-render on every pointermove (which was the source
  // of boundary drag lag).
  const pendingMovesRef = useRef<
    Map<
      string,
      {
        kind: "node" | "boundary";
        position: { x: number; y: number };
        size?: { width: number; height: number };
      }
    >
  >(new Map());
  const rafIdRef = useRef<number | null>(null);

  const flushPendingMoves = useCallback(() => {
    rafIdRef.current = null;
    const moves = Array.from(
      pendingMovesRef.current,
      ([id, move]) => ({ id, ...move }),
    );
    if (moves.length > 0) moveDiagramItems(moves, false);
    pendingMovesRef.current.clear();
  }, [moveDiagramItems]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, rfNodes);
      const finishedMoves = new Map<
        string,
        {
          kind: "node" | "boundary";
          position: { x: number; y: number };
          size?: { width: number; height: number };
        }
      >();
      if (
        changes.some(
          (change) =>
            change.type === "position" && change.dragging !== true,
        )
      ) {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        for (const [id, move] of pendingMovesRef.current) {
          finishedMoves.set(id, move);
        }
        pendingMovesRef.current.clear();
      }

      for (const change of changes) {
        if (change.type === "position" && change.position) {
          const node = updated.find((n) => n.id === change.id);
          if (!node) continue;
          if (
            node.type === "boundary" &&
            resizingBoundaryIdsRef.current.has(node.id)
          ) {
            resizeBoundary(
              node.id,
              {
                width: node.measured?.width ?? node.width ?? 120,
                height: node.measured?.height ?? node.height ?? 80,
              },
              node.position,
            );
            continue;
          }
          if (change.dragging === true) {
            // Coalesce: only the latest position per node-id matters per frame.
            pendingMovesRef.current.set(node.id, {
              kind: node.type === "boundary" ? "boundary" : "node",
              position: node.position,
              size:
                node.type === "boundary"
                ? undefined
                : {
                    width: node.measured?.width ?? node.width ?? 160,
                    height: node.measured?.height ?? node.height ?? 64,
                  },
            });
            if (rafIdRef.current === null) {
              rafIdRef.current = requestAnimationFrame(flushPendingMoves);
            }
          } else {
            finishedMoves.set(node.id, {
              kind: node.type === "boundary" ? "boundary" : "node",
              position: node.position,
              size:
                node.type === "boundary"
                ? undefined
                : {
                  width: node.measured?.width ?? node.width ?? 160,
                  height: node.measured?.height ?? node.height ?? 64,
                },
            });
          }
        } else if (change.type === "dimensions" && change.dimensions) {
          const node = updated.find((n) => n.id === change.id);
          if (!node) continue;
          if (node.type === "boundary") {
            resizeBoundary(
              change.id,
              {
                width: change.dimensions.width,
                height: change.dimensions.height,
              },
              node.position,
            );
          } else {
            setNodeSize(change.id, {
              width: change.dimensions.width,
              height: change.dimensions.height,
            });
          }
        }
      }
      if (finishedMoves.size > 0) {
        moveDiagramItems(
          Array.from(finishedMoves, ([id, move]) => ({ id, ...move })),
          true,
        );
      }
    },
    [
      rfNodes,
      setNodeSize,
      moveDiagramItems,
      resizeBoundary,
      flushPendingMoves,
    ]
  );

  // Snapshot once per drag/resize gesture so undo restores pre-gesture state.
  const onNodeDragStart = useCallback(() => {
    resizingBoundaryIdsRef.current.clear();
    snapshot();
  }, [snapshot]);

  const onEdgesChange = useCallback((_changes: EdgeChange[]) => {
    // Edge selection/deletion are handled elsewhere. No-op here.
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      // Edges must live inside a scenario. Reject the connection silently
      // if no scenario is active.
      if (!activeScenarioId) return;
      const edge = createEdge(
        conn.source,
        conn.target,
        conn.sourceHandle ?? undefined,
        conn.targetHandle ?? undefined
      );
      if (edge) {
        addEdgeToScenario(activeScenarioId, edge.id);
        setSelection({ kind: "edge", id: edge.id });
      }
    },
    [createEdge, addEdgeToScenario, activeScenarioId, setSelection]
  );

  // React Flow calls this when the user finishes dragging an edge endpoint
  // onto a (possibly different) node/handle. Update the edge's source/target
  // and the handle IDs.
  const onReconnect = useCallback(
    (oldEdge: RfEdge, newConn: Connection) => {
      if (!newConn.source || !newConn.target) return;
      updateEdge(oldEdge.id, {
        source: newConn.source,
        target: newConn.target,
        sourceHandle: newConn.sourceHandle ?? undefined,
        targetHandle: newConn.targetHandle ?? undefined,
      });
      setSelection({ kind: "edge", id: oldEdge.id });
    },
    [updateEdge, setSelection]
  );

  // -------- Right-click context menu (handlers; state is hoisted above
  // rfEdges so the edge-title callback can be embedded in edge data.) --------

  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      openMenuAt(e.clientX, e.clientY, { kind: "pane" });
    },
    [openMenuAt]
  );

  // Right-click on a node — boundaries open the create menu (their interior
  // acts like empty space); process nodes open an "Add to scenario" menu.
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: RfNode) => {
      e.preventDefault();
      if (node.type === "boundary") {
        openMenuAt(e.clientX, e.clientY, { kind: "boundary", id: node.id });
      } else {
        openMenuAt(e.clientX, e.clientY, { kind: "node", id: node.id });
      }
    },
    [openMenuAt]
  );

  // Right-click on an edge — open the "Add to scenario" menu.
  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: RfEdge) => {
      e.preventDefault();
      openMenuAt(e.clientX, e.clientY, { kind: "edge", id: edge.id });
    },
    [openMenuAt]
  );

  const onAddTargetToScenario = useCallback(
    (scenarioId: string) => {
      if (!contextMenu) return;
      const t = contextMenu.target;
      if (t.kind === "node") addNodeToScenario(scenarioId, t.id);
      else if (t.kind === "edge") addEdgeToScenario(scenarioId, t.id);
      else if (t.kind === "boundary")
        addBoundaryToScenario(scenarioId, t.id);
      setContextMenu(null);
    },
    [contextMenu, addNodeToScenario, addEdgeToScenario, addBoundaryToScenario]
  );

  const onRemoveTargetFromScenario = useCallback(
    (scenarioId: string) => {
      if (!contextMenu) return;
      const t = contextMenu.target;
      if (t.kind === "node") removeNodeOrDelete(scenarioId, t.id);
      else if (t.kind === "edge") removeEdgeOrDelete(scenarioId, t.id);
      else if (t.kind === "boundary")
        removeBoundaryFromScenario(scenarioId, t.id);
      setContextMenu(null);
    },
    [
      contextMenu,
      removeNodeOrDelete,
      removeEdgeOrDelete,
      removeBoundaryFromScenario,
    ]
  );

  // Close menu when LEFT-clicking anywhere outside it. Right-click is left
  // alone so onPaneContextMenu can reposition the menu instead of fighting
  // with this listener.
  useEffect(() => {
    if (!contextMenu) return;
    const onClickAway = (e: MouseEvent) => {
      if (e.button === 2) return; // right-click handled by onPaneContextMenu
      if (
        e.target instanceof Element &&
        e.target.closest(".ps-context-menu")
      ) {
        return;
      }
      setContextMenu(null);
    };
    document.addEventListener("mousedown", onClickAway);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
    };
  }, [contextMenu]);

  const menuCreateNode = useCallback(() => {
    if (!contextMenu) return;
    if (!activeScenarioId) {
      // Nodes must belong to a scenario. The context menu hides this
      // button when no scenario is active, but guard the action too so
      // any future affordance hitting this path can't create orphans.
      return;
    }
    const node = createNode({ x: contextMenu.flowX, y: contextMenu.flowY });
    addNodeToScenario(activeScenarioId, node.id);
    setSelection({ kind: "node", id: node.id });
    setContextMenu(null);
  }, [contextMenu, createNode, activeScenarioId, addNodeToScenario, setSelection]);

  const menuCreateBoundary = useCallback(
    (type: "security" | "privacy") => {
      if (!contextMenu) return;
      const size = { width: 280, height: 200 };
      const b = createBoundary(
        type,
        { x: contextMenu.flowX - size.width / 2, y: contextMenu.flowY - size.height / 2 },
        size
      );
      if (activeScenarioId) addBoundaryToScenario(activeScenarioId, b.id);
      setSelection({ kind: "boundary", id: b.id });
      setContextMenu(null);
    },
    [
      contextMenu,
      createBoundary,
      activeScenarioId,
      addBoundaryToScenario,
      setSelection,
    ]
  );

  const onPaneClick = useCallback(() => {
    setSelection(null);
    setContextMenu(null);
  }, [setSelection]);

  const onCanvasKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        void zoomOut({ duration: 150 });
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        void zoomIn({ duration: 150 });
      } else if (event.key === "0") {
        event.preventDefault();
        const viewport = getViewport();
        void setViewport(
          { x: viewport.x, y: viewport.y, zoom: 1 },
          { duration: 180 },
        );
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void fitView({ duration: 300, padding: 0.18 });
      }
    },
    [fitView, getViewport, setViewport, zoomIn, zoomOut],
  );

  return (
    <>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onNodeDragStart={onNodeDragStart}
        onPaneClick={onPaneClick}
        onKeyDown={onCanvasKeyDown}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        connectionMode={ConnectionMode.Loose}
        // We drive multi-selection ourselves (Ctrl/Cmd+click on a node or
        // boundary toggles it into the additional-selection set). Disabling
        // RF's built-in multi-selection key stops it from also reacting to
        // Ctrl-click at the container level.
        multiSelectionKeyCode={null}
        // The reconnect anchor is a transparent SVG circle. Its default radius
        // (10px) is the same as the node handle that sits over it, so the
        // handle intercepts every reconnect attempt. A larger radius extends
        // the invisible hit area outside the handle without changing visuals.
        reconnectRadius={30}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        {/* Default minimap is 200×150; halved to take up less room. */}
        <MiniMap pannable zoomable style={{ width: 100, height: 75 }} />
        <CanvasZoomControls />
      </ReactFlow>
      {contextMenu && (
        <div
          className="ps-context-menu"
          style={{
            position: "fixed",
            top: contextMenu.screenY,
            left: contextMenu.screenX,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {(contextMenu.target.kind === "pane" ||
            contextMenu.target.kind === "boundary") &&
            (activeScenarioId ? (
              <>
                <button onClick={menuCreateNode}>＋ New Node</button>
                <button onClick={() => menuCreateBoundary("security")}>
                  ＋ New Security Boundary
                </button>
                <button onClick={() => menuCreateBoundary("privacy")}>
                  ＋ New Privacy Boundary
                </button>
              </>
            ) : (
              <div className="ps-context-menu-empty">
                Select or create a scenario before adding diagram elements.
              </div>
            ))}

          {(() => {
            const t = contextMenu.target;
            if (t.kind !== "node" && t.kind !== "edge" && t.kind !== "boundary")
              return null;
            return (
              <>
                <div className="ps-context-menu-header">Include in scenario</div>
                {doc.scenarios.length === 0 ? (
                  <div className="ps-context-menu-empty">
                    No scenarios yet — create one from the toolbar.
                  </div>
                ) : (
                  doc.scenarios.map((s) => {
                    const already =
                      t.kind === "node"
                        ? s.nodeIds.includes(t.id)
                        : t.kind === "edge"
                          ? s.edgeIds.includes(t.id)
                          : s.boundaryIds.includes(t.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => onAddTargetToScenario(s.id)}
                        disabled={already}
                        title={
                          already ? `Already in ${s.name}` : `Add to ${s.name}`
                        }
                      >
                        {already ? "✓ " : ""}
                        {s.name}
                      </button>
                    );
                  })
                )}
                {activeScenarioId &&
                  (() => {
                    const active = doc.scenarios.find(
                      (s) => s.id === activeScenarioId
                    );
                    if (!active) return null;
                    const inActive =
                      t.kind === "node"
                        ? active.nodeIds.includes(t.id)
                        : t.kind === "edge"
                          ? active.edgeIds.includes(t.id)
                          : active.boundaryIds.includes(t.id);
                    if (!inActive) return null;
                    return (
                      <button
                        className="ps-context-menu-danger"
                        onClick={() =>
                          onRemoveTargetFromScenario(activeScenarioId)
                        }
                        title={`Remove from ${active.name} (does not delete the ${t.kind})`}
                      >
                        Remove from {active.name}
                      </button>
                    );
                  })()}
              </>
            );
          })()}

          {(() => {
            const t = contextMenu.target;
            if (t.kind !== "node") return null;
            const node = doc.nodes.find((n) => n.id === t.id);
            const currentColor = node?.color;
            const setColor = (color: string | undefined) => {
              updateNode(t.id, { color });
              setContextMenu(null);
            };
            return (
              <>
                <div className="ps-context-menu-header">Color</div>
                <div className="ps-context-menu-colors">
                  <button
                    type="button"
                    className={`ps-color-swatch ps-color-swatch-default${
                      !currentColor ? " is-selected" : ""
                    }`}
                    aria-label="Default color"
                    title="Default"
                    onClick={() => setColor(undefined)}
                  />
                  {NODE_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={`ps-color-swatch${
                        currentColor === c.value ? " is-selected" : ""
                      }`}
                      aria-label={c.name}
                      title={c.name}
                      style={{ background: c.value }}
                      onClick={() => setColor(c.value)}
                    />
                  ))}
                </div>
              </>
            );
          })()}

          {(() => {
            const t = contextMenu.target;
            if (t.kind === "node") {
              const memberships = doc.boundaries.filter((boundary) =>
                boundary.nodeIds.includes(t.id),
              );
              if (memberships.length === 0) return null;
              return (
                <>
                  <div className="ps-context-menu-header">
                    Remove from boundary
                  </div>
                  {memberships.map((boundary) => (
                    <button
                      key={boundary.id}
                      onClick={() => {
                        removeNodeFromBoundary(t.id, boundary.id);
                        setContextMenu(null);
                      }}
                    >
                      {boundary.title ||
                        (boundary.type === "security"
                          ? "Security boundary"
                          : "Privacy boundary")}
                    </button>
                  ))}
                </>
              );
            }
            if (t.kind === "boundary") {
              const boundary = doc.boundaries.find(
                (item) => item.id === t.id,
              );
              if (!boundary || boundary.nodeIds.length === 0) return null;
              return (
                <>
                  <div className="ps-context-menu-header">
                    Nodes in boundary
                  </div>
                  {boundary.nodeIds.map((nodeId) => {
                    const node = doc.nodes.find((item) => item.id === nodeId);
                    if (!node) return null;
                    return (
                      <button
                        key={nodeId}
                        onClick={() => {
                          removeNodeFromBoundary(nodeId, boundary.id);
                          setContextMenu(null);
                        }}
                      >
                        Remove {node.title || "(untitled node)"}
                      </button>
                    );
                  })}
                </>
              );
            }
            return null;
          })()}

          {(() => {
            const t = contextMenu.target;
            if (t.kind !== "edge") return null;
            const edge = doc.edges.find((e) => e.id === t.id);
            const isProblem = edge?.problem === true;
            const setEdgeColor = (problem: boolean) => {
              updateEdge(t.id, { problem: problem ? true : undefined });
              setContextMenu(null);
            };
            return (
              <>
                <div className="ps-context-menu-header">Color</div>
                <div className="ps-context-menu-colors">
                  <button
                    type="button"
                    className={`ps-color-swatch${
                      !isProblem ? " is-selected" : ""
                    }`}
                    aria-label="Default color"
                    title="Default"
                    style={{ background: "#48a" }}
                    onClick={() => setEdgeColor(false)}
                  />
                  <button
                    type="button"
                    className={`ps-color-swatch${
                      isProblem ? " is-selected" : ""
                    }`}
                    aria-label="Red (problem flow)"
                    title="Red — problem flow"
                    style={{ background: "#dc2626" }}
                    onClick={() => setEdgeColor(true)}
                  />
                </div>
              </>
            );
          })()}

          {(() => {
            const t = contextMenu.target;
            if (t.kind !== "node" && t.kind !== "edge") return null;
            return (
              <>
                <div className="ps-context-menu-header">Comments</div>
                {activeScenarioId ? (
                  <>
                    <button
                      onClick={() => {
                        setCommentsTarget({ kind: t.kind, id: t.id });
                        setCommentsMode("view");
                        setContextMenu(null);
                      }}
                    >
                      View comments in this scenario
                    </button>
                    <button
                      onClick={() => {
                        setCommentsTarget({ kind: t.kind, id: t.id });
                        setCommentsMode("add");
                        setContextMenu(null);
                      }}
                    >
                      Add new comment
                    </button>
                  </>
                ) : (
                  <div className="ps-context-menu-empty">
                    Select a scenario to add or view its comments.
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
      {commentsTarget && activeScenarioId && (
        <CommentsModal
          scenarioId={activeScenarioId}
          target={commentsTarget}
          initialMode={commentsMode}
          onClose={() => setCommentsTarget(null)}
        />
      )}
    </>
  );
}

export function DiagramCanvas() {
  return (
    <ReactFlowProvider>
      <InnerDiagram />
    </ReactFlowProvider>
  );
}
