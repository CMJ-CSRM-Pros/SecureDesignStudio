import {
  BaseEdge,
  EdgeLabelRenderer,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { CommentBadges } from "./CommentBadges";
import { IssueBadges } from "./IssueBadges";
import type { Position, Waypoint } from "../types";

// Module-level state for click detection — survives FlowEdge remounts.
const lastEdgePointerDownTimes = new Map<string, number>();

export interface FlowEdgeData {
  title: string;
  number: number | null;
  waypoints: Waypoint[];
  problem?: boolean;
  commentActive?: number;
  commentResolved?: number;
  issueActive?: number;
  issueResolved?: number;
  authenticationLabels?: string[];
  authenticationShortLabel?: string;
  authenticationAnonymous?: boolean;
  authenticationMultiple?: boolean;
  authenticationReviewRequired?: boolean;
  protocolLabel?: string;
  protocolShortLabel?: string;
  protocolDescription?: string;
  protocolSemanticsDescription?: string;
  protocolReviewRequired?: boolean;
  applicationId?: string;
  classificationLabels?: string[];
  classificationColor?: string;
  classificationForeground?: string;
  simulationActive?: boolean;
  simulationCurrent?: boolean;
  [key: string]: unknown;
}

// Catmull-Rom-to-cubic-Bezier spline through all points.
function splinePath(pts: Position[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
  }
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function distToSegmentSq(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return ex * ex + ey * ey;
}

function closestSegmentIndex(pts: Position[], p: Position): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegmentSq(p, pts[i], pts[i + 1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const {
    setSelection,
    selection,
    addEdgeWaypoint,
    updateEdgeWaypoint,
    updateEdge,
    editingEdgeTitleId,
    setEditingEdgeTitleId,
    editingEdgeTitleValue,
    setEditingEdgeTitleValue,
  } = useStore();
  const { getZoom, screenToFlowPosition } = useReactFlow();

  // Edit state lives in the store so it survives FlowEdge remounts. Entering
  // edit mode seeds the live value from the current edge title; the input
  // itself is controlled by editingEdgeTitleValue so the user's in-progress
  // typing isn't lost if FlowEdge remounts mid-edit.
  const editingTitle = editingEdgeTitleId === id;
  // Read title directly from the data prop here (not from `d`, which is
  // declared further below — referencing it before declaration is a TDZ
  // error). `data` is the same object `d` will alias.
  const currentTitle =
    (data && typeof (data as { title?: unknown }).title === "string"
      ? (data as { title: string }).title
      : "");
  const setEditingTitle = useCallback(
    (next: boolean) => {
      if (next) {
        setEditingEdgeTitleValue(currentTitle);
        setEditingEdgeTitleId(id);
      } else {
        setEditingEdgeTitleId(null);
      }
    },
    [id, currentTitle, setEditingEdgeTitleId, setEditingEdgeTitleValue]
  );
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  // Use a state-backed callback ref so the dblclick listener attaches as
  // soon as the label DOM element actually exists (the EdgeLabelRenderer
  // portal target may not be ready on the first FlowEdge mount).
  const [labelEl, setLabelEl] = useState<HTMLDivElement | null>(null);
  // Reset to auto first so shrinking works, then expand to fit the content.
  const autoSizeTitle = useCallback(() => {
    const el = titleInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
      autoSizeTitle();
    }
  }, [editingTitle, autoSizeTitle]);
  // Keep textarea height in sync with the controlled value (typing, paste,
  // remount-rehydration, etc.).
  useLayoutEffect(() => {
    if (editingTitle) autoSizeTitle();
  }, [editingTitle, editingEdgeTitleValue, autoSizeTitle]);
  // Commit edit on click outside the input. Attached at document level so
  // StrictMode's transient blur on the focused input doesn't trigger it.
  // Deferred slightly so the dblclick that opened the editor doesn't close
  // it immediately.
  useEffect(() => {
    if (!editingTitle) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(`[data-editing-edge-id="${id}"]`)
      ) {
        return;
      }
      // Value is read from the store at click time, not from a stale closure.
      commitEdgeTitle();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDocClick, true);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDocClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTitle, id]);
  useEffect(() => {
    if (!labelEl) return;
    const onDbl = (e: Event) => {
      e.stopPropagation();
      setEditingTitle(true);
    };
    const onCustomEdit = () => setEditingTitle(true);
    labelEl.addEventListener("dblclick", onDbl);
    // Fired by DiagramCanvas's document-level capture-phase dblclick
    // listener as a fallback if the native dblclick somehow doesn't bubble
    // to this element (e.g., portal/edge-wrapper event routing quirks).
    labelEl.addEventListener("ps-edit-edge-title", onCustomEdit);
    return () => {
      labelEl.removeEventListener("dblclick", onDbl);
      labelEl.removeEventListener("ps-edit-edge-title", onCustomEdit);
    };
  }, [labelEl]);
  // Ref mirror of the live editor value so the click-outside listener (which
  // is attached once when edit mode starts) always sees the LATEST typed
  // value rather than the closure value from the render that attached it.
  const editingValueRef = useRef(editingEdgeTitleValue);
  editingValueRef.current = editingEdgeTitleValue;

  const commitEdgeTitle = () => {
    updateEdge(id, { title: editingValueRef.current });
    setEditingEdgeTitleId(null);
  };

  const d = (data ?? {
    title: "",
    number: null,
    waypoints: [] as Waypoint[],
  }) as FlowEdgeData;
  const authenticationSummary = (d.authenticationLabels?.length ?? 0) > 0
    ? `Authentication: ${d.authenticationLabels!.join(", ")}${d.authenticationReviewRequired ? " (unverified or unresolved; review required)" : ""}`
    : "Authentication is not specified; this is not proof of anonymous access";
  const protocolSummary = d.protocolLabel
    ? `Communication profile: ${d.protocolLabel}${d.protocolReviewRequired ? " (review required)" : ""}. ${d.protocolDescription ?? ""} ${d.protocolSemanticsDescription ?? ""} Declared design intent only; not evidence of negotiated protection.`
    : "Communication profile is not specified; this is not proof of plaintext or encryption";
  const communicationSummary = `${protocolSummary}. ${authenticationSummary}. Caller Application ID: ${d.applicationId || "Not specified"}.`;

  const source: Position = { x: sourceX, y: sourceY };
  const target: Position = { x: targetX, y: targetY };
  const polyline: Position[] = [source, ...d.waypoints, target];
  const path = splinePath(polyline);
  const strokeColor = d.problem
    ? "#dc2626"
    : d.simulationActive
      ? "#d13438"
      : d.classificationColor ?? (selected ? "#1d4ed8" : "#48a");

  // The "middle" waypoint that the title moves.
  const middleIdx =
    d.waypoints.length > 0 ? Math.floor((d.waypoints.length - 1) / 2) : -1;
  const labelPos: Position =
    middleIdx >= 0
      ? { x: d.waypoints[middleIdx].x, y: d.waypoints[middleIdx].y }
      : { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };

  // Shared drag bootstrap. Uses document-level pointer listeners so the drag
  // keeps working across React re-renders (which can invalidate pointer
  // capture on portal-rendered nodes).
  const startWaypointDrag = useCallback(
    (
      e: React.PointerEvent,
      waypointId: string,
      startX: number,
      startY: number,
      onClick?: () => void
    ) => {
      e.stopPropagation();
      // NOTE: deliberately NOT preventing default on pointerdown — that was
      // suppressing the subsequent dblclick event on the edge label and
      // breaking inline title editing. The label has `user-select: none`
      // and no focusable children, so omitting preventDefault is safe.
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const zoom = getZoom() || 1;
      let moved = false;

      const onMove = (ev: PointerEvent) => {
        const dxPx = ev.clientX - startClientX;
        const dyPx = ev.clientY - startClientY;
        if (!moved && Math.abs(dxPx) + Math.abs(dyPx) > 2) moved = true;
        if (moved) {
          updateEdgeWaypoint(id, waypointId, {
            x: startX + dxPx / zoom,
            y: startY + dyPx / zoom,
          });
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        if (!moved && onClick) onClick();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [getZoom, id, updateEdgeWaypoint]
  );

  // Browser-level dblclick never fires on the edge label in this React Flow
  // setup (something inside the pane handlers swallows the mouseup compat
  // event, breaking the click chain). We detect double-clicks from
  // pointerdown timestamps stored at module scope so they survive the
  // FlowEdge remounts that StrictMode + selection-driven re-renders cause.
  const onTitlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only react to the primary (left) button. Right-click must flow
      // through to the browser so contextmenu fires on the label.
      if (e.button !== 0) return;

      const now = Date.now();
      const prev = lastEdgePointerDownTimes.get(id) ?? 0;
      const since = now - prev;
      if (prev > 0 && since < 700) {
        e.stopPropagation();
        lastEdgePointerDownTimes.delete(id);
        setEditingTitle(true);
        return;
      }
      lastEdgePointerDownTimes.set(id, now);

      let waypointId: string;
      let startX: number;
      let startY: number;

      if (middleIdx >= 0) {
        const w = d.waypoints[middleIdx];
        waypointId = w.id;
        startX = w.x;
        startY = w.y;
      } else {
        const created = addEdgeWaypoint(id, 0, {
          x: (sourceX + targetX) / 2,
          y: (sourceY + targetY) / 2,
        });
        if (!created) return;
        waypointId = created.id;
        startX = created.x;
        startY = created.y;
      }

      startWaypointDrag(e, waypointId, startX, startY, () =>
        setSelection({ kind: "edge", id })
      );
    },
    [
      addEdgeWaypoint,
      d.waypoints,
      id,
      middleIdx,
      setSelection,
      sourceX,
      sourceY,
      targetX,
      targetY,
      startWaypointDrag,
    ]
  );

  const onWaypointPointerDown = useCallback(
    (e: React.PointerEvent, waypointId: string) => {
      if (e.button !== 0) return;
      const w = d.waypoints.find((x) => x.id === waypointId);
      if (!w) return;
      startWaypointDrag(e, waypointId, w.x, w.y, () =>
        setSelection({ kind: "waypoint", edgeId: id, waypointId })
      );
    },
    [d.waypoints, id, setSelection, startWaypointDrag]
  );

  const onPathDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const insertIdx = closestSegmentIndex(polyline, flow);
      const created = addEdgeWaypoint(id, insertIdx, flow);
      if (created) {
        setSelection({ kind: "waypoint", edgeId: id, waypointId: created.id });
      }
    },
    [addEdgeWaypoint, id, polyline, screenToFlowPosition, setSelection]
  );

  // Pointerdown on the line: if the edge isn't selected, just select it.
  // If it IS selected, a drag creates a new waypoint at the press location
  // and immediately starts dragging that waypoint.
  const onPathPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      if (!selected) {
        setSelection({ kind: "edge", id });
        return;
      }

      e.preventDefault();
      const flowStart = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const zoom = getZoom() || 1;
      let moved = false;
      let waypointId: string | null = null;
      let waypointStartX = flowStart.x;
      let waypointStartY = flowStart.y;

      const onMove = (ev: PointerEvent) => {
        const dxPx = ev.clientX - startClientX;
        const dyPx = ev.clientY - startClientY;
        if (!moved && Math.abs(dxPx) + Math.abs(dyPx) > 3) {
          moved = true;
          const insertIdx = closestSegmentIndex(polyline, flowStart);
          const created = addEdgeWaypoint(id, insertIdx, flowStart);
          if (created) {
            waypointId = created.id;
            waypointStartX = created.x;
            waypointStartY = created.y;
            setSelection({
              kind: "waypoint",
              edgeId: id,
              waypointId: created.id,
            });
          }
        }
        if (moved && waypointId) {
          updateEdgeWaypoint(id, waypointId, {
            x: waypointStartX + dxPx / zoom,
            y: waypointStartY + dyPx / zoom,
          });
        }
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [
      addEdgeWaypoint,
      getZoom,
      id,
      polyline,
      screenToFlowPosition,
      selected,
      setSelection,
      updateEdgeWaypoint,
    ]
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={d.simulationActive ? "ps-simulation-edge" : undefined}
        style={{
          stroke: strokeColor,
          strokeWidth: d.simulationActive || selected ? 4 : 2,
          strokeDasharray: d.simulationActive ? "10 7" : undefined,
          filter: d.simulationCurrent
            ? "drop-shadow(0 0 6px #d13438)"
            : selected
            ? `drop-shadow(0 0 4px ${strokeColor})`
            : undefined,
        }}
      />
      {/* Invisible thick hit area for press + double-click on the line.
          When the edge is selected, a press-and-drag here makes a new
          waypoint that follows the cursor. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="nodrag nopan"
        style={{
          cursor: selected ? "move" : "pointer",
          pointerEvents: "stroke",
        }}
        onPointerDown={onPathPointerDown}
        onDoubleClick={onPathDoubleClick}
      />

      {/* Visible indicator at the source endpoint so the user knows where
          to grab to reroute it. React Flow's invisible reconnect anchor
          (much larger hit radius) sits on top and handles the actual drag,
          so this circle is non-interactive. */}
      {selected && (
        <circle
          cx={sourceX}
          cy={sourceY}
          r={6}
          className="ps-edge-endpoint"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Waypoint handles — only shown when the edge is selected (or one
          of its waypoints is selected, which keeps `selected` true here). */}
      {selected &&
        d.waypoints.map((w) => {
          const isSelected =
            selection?.kind === "waypoint" &&
            selection.edgeId === id &&
            selection.waypointId === w.id;
          return (
            <circle
              key={w.id}
              cx={w.x}
              cy={w.y}
              r={6}
              className={`ps-waypoint nodrag nopan ${
                isSelected ? "selected" : ""
              }`}
              style={{ cursor: "move" }}
              onPointerDown={(e) => onWaypointPointerDown(e, w.id)}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          );
        })}

      <EdgeLabelRenderer>
        <div
          ref={setLabelEl}
          className={`ps-edge-label nodrag nopan ${selected ? "selected" : ""} ${
            d.simulationActive ? "ps-simulation-active" : ""
          } ${d.simulationCurrent ? "ps-simulation-current" : ""}`}
          data-edge-id={id}
          title={communicationSummary}
          style={{
            transform: `translate(-50%, -50%) translate(${labelPos.x}px, ${labelPos.y}px)`,
            cursor: editingTitle ? "text" : "move",
          }}
          onPointerDown={editingTitle ? undefined : onTitlePointerDown}
        >
          <span className="ps-edge-num">
            {d.number != null ? `#${d.number}` : "—"}
          </span>
          {(d.protocolLabel || d.protocolReviewRequired) && (
            <span
              className={`ps-edge-protocol-badge ${d.protocolReviewRequired ? "ps-edge-protocol-review" : ""}`}
              title={communicationSummary}
              aria-label={communicationSummary}
            >
              {d.protocolShortLabel ?? "Protocol"}
            </span>
          )}
          <span
            className={`ps-edge-auth-badge ${
              d.authenticationMultiple
                ? "ps-edge-auth-multiple"
                : (d.authenticationLabels?.length ?? 0) === 0
                ? "ps-edge-auth-missing"
                : d.authenticationAnonymous
                  ? "ps-edge-auth-anonymous"
                  : d.authenticationReviewRequired
                    ? "ps-edge-auth-review"
                    : "ps-edge-auth-defined"
            }`}
            title={authenticationSummary}
            aria-label={authenticationSummary}
          >
            {d.authenticationMultiple
              ? "Multiple auth"
              : (d.authenticationLabels?.length ?? 0) === 0
              ? "Auth —"
              : d.authenticationAnonymous
                ? "Anonymous"
                : d.authenticationShortLabel ?? "Auth"}
          </span>
          {(d.classificationLabels?.length ?? 0) > 0 && (
            <span
              className="ps-edge-classification-badge"
              style={{
                backgroundColor: d.classificationColor,
                color: d.classificationForeground,
              }}
              title={`Data classifications: ${d.classificationLabels!.join(", ")}`}
              aria-label={`Data classifications: ${d.classificationLabels!.join(", ")}`}
            >
              {d.classificationLabels![0]}
              {d.classificationLabels!.length > 1
                ? ` +${d.classificationLabels!.length - 1}`
                : ""}
            </span>
          )}
          {editingTitle ? (
            <textarea
              ref={titleInputRef}
              className="ps-edge-title-input nodrag nopan"
              data-editing-edge-id={id}
              rows={1}
              // CONTROLLED via the store so transient FlowEdge remounts
              // (StrictMode in dev) don't reset the input back to d.title
              // and wipe the user's in-progress typing.
              value={editingEdgeTitleValue}
              onChange={(e) => setEditingEdgeTitleValue(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              // Intentionally no onBlur — React's StrictMode mount/unmount
              // cycle in dev fires a phantom blur on the focused input as it
              // tears down and rebuilds FlowEdge, which kept committing and
              // exiting edit mode immediately. The document-level click
              // listener above handles real "click outside" commits.
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter commits; plain Enter inserts a newline so
                // titles can span multiple lines. Esc cancels (no save).
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  commitEdgeTitle();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingEdgeTitleId(null);
                }
              }}
            />
          ) : (
            <span
              className="ps-edge-title"
              title="Double-click to rename · Ctrl/Cmd+Enter to save · Esc to cancel"
            >
              {d.title || "(untitled)"}
            </span>
          )}
          <CommentBadges
            active={d.commentActive ?? 0}
            resolved={d.commentResolved ?? 0}
          />
          <IssueBadges
            active={d.issueActive ?? 0}
            resolved={d.issueResolved ?? 0}
          />
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
