import { useMemo, useRef, useEffect } from "react";
import { useStore } from "../store";
import { authTypeLabel } from "../authentication";
import { nodeTypeIconUrl } from "../nodeTypeIcons";
import { nodeTypeLabel, type PsNode, type PsEdge } from "../types";
import { DFD_ROLE_LABELS, DFD_SCOPE_LABELS, nodeDfdSummary, resolveNodeReviewScope } from "../dfdSemantics";

// SequenceDiagramView renders the active scenario's edges as a UML-style
// sequence diagram. The underlying data model is unchanged — this is a
// read-only-ish alternate rendering of the same nodes/edges that the
// graph view shows. Clicking a participant or a message updates the
// store's selection so the right-hand SidePanel reacts the same as in
// graph view.

const PARTICIPANT_WIDTH = 180;
const PARTICIPANT_GAP = 60; // gutter between lifelines
const LEFT_MARGIN = 40;
const RIGHT_MARGIN = 40;
const HEADER_HEIGHT = 104;
// One row per event (call or return). Self-loop CALL rows are taller so the
// curled-back arrow has room for its label.
const ROW_HEIGHT = 56;
const TOP_PADDING = 24;
const BOTTOM_PADDING = 40;
const SELF_LOOP_HEIGHT = 36;

export function SequenceDiagramView() {
  const {
    doc,
    authenticationCatalog,
    activeScenario,
    visibleNodes,
    visibleEdges,
    visibleTextAnnotations,
    selection,
    setSelection,
    edgeNumberFor,
  } = useStore();

  // Order the visible edges by scenario sequence number (falling back to
  // visibleEdges order for any unnumbered edges).
  const orderedEdges = useMemo<PsEdge[]>(() => {
    if (!activeScenario) return [];
    const visibleSet = new Set(visibleEdges.map((e) => e.id));
    const result: PsEdge[] = [];
    for (const eid of activeScenario.edgeIds) {
      if (!visibleSet.has(eid)) continue;
      const edge = doc.edges.find((e) => e.id === eid);
      if (edge) result.push(edge);
    }
    return result;
  }, [activeScenario, visibleEdges, doc.edges]);

  // Participants are the visible nodes that take part in at least one
  // ordered edge — listed in first-appearance order across the message
  // timeline so the diagram reads roughly left-to-right.
  const participants = useMemo<PsNode[]>(() => {
    const byId = new Map(visibleNodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const out: PsNode[] = [];
    for (const e of orderedEdges) {
      for (const id of [e.source, e.target]) {
        if (seen.has(id)) continue;
        const node = byId.get(id);
        if (!node) continue;
        seen.add(id);
        out.push(node);
      }
    }
    return out;
  }, [orderedEdges, visibleNodes]);

  const participantIndex = useMemo(() => {
    const m = new Map<string, number>();
    participants.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [participants]);

  const xForParticipant = (idx: number) =>
    LEFT_MARGIN + PARTICIPANT_WIDTH / 2 + idx * (PARTICIPANT_WIDTH + PARTICIPANT_GAP);

  const width =
    LEFT_MARGIN +
    RIGHT_MARGIN +
    Math.max(
      1,
      participants.length * PARTICIPANT_WIDTH +
        Math.max(0, participants.length - 1) * PARTICIPANT_GAP
    );

  // Build the call/return sequence by simulating a call stack as we walk
  // through the ordered edges. Each edge in the graph view is interpreted
  // as a request from source → target with an implicit return.
  //
  // Algorithm:
  //   stack frames are { node, edgeId } (edgeId is null for the root frame).
  //   For each ordered edge A→B:
  //     - If the stack is empty, push {A, null} as the new root.
  //     - Otherwise, the call must originate from a node already on the
  //       stack. Pop frames (emitting RETURN events for each) until the
  //       top of the stack is A. If A is not on the stack at all, pop
  //       everything and start a fresh root.
  //     - Emit CALL A→B and push {B, edgeId}.
  //   After the last edge, pop the remaining non-root frames so the
  //   diagram ends with everything unwound (the original root frame is
  //   left implicit — there's no caller for it to return to).
  //
  // Worked examples (matches the user-stated expected sequences):
  //   1)  A→B then A→C
  //         CALL e1 A→B, RETURN e1 B→A, CALL e2 A→C, RETURN e2 C→A
  //   2)  A→B, B→C, A→D
  //         CALL e1 A→B, CALL e2 B→C, RETURN e2 C→B, RETURN e1 B→A,
  //         CALL e3 A→D, RETURN e3 D→A
  type SeqEvent = {
    kind: "call" | "return";
    edgeId: string;
    from: string;
    to: string;
    // True only for self-loop call rows; their return is implicit in the
    // curled-back arrow geometry so we suppress the explicit return event.
    selfLoopCall?: boolean;
  };

  const events = useMemo<SeqEvent[]>(() => {
    type Frame = { node: string; edgeId: string | null };
    const stack: Frame[] = [];
    const out: SeqEvent[] = [];

    const unwindUntil = (target: string | null) => {
      // Pop frames until top.node === target (or stack is empty when
      // target is null). Each popped non-root frame emits a return.
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (target != null && top.node === target) return;
        stack.pop();
        const newTop = stack[stack.length - 1];
        if (top.edgeId != null && newTop) {
          out.push({
            kind: "return",
            edgeId: top.edgeId,
            from: top.node,
            to: newTop.node,
          });
        }
      }
    };

    for (const e of orderedEdges) {
      const selfLoop = e.source === e.target;
      if (stack.length === 0) {
        stack.push({ node: e.source, edgeId: null });
      } else if (stack[stack.length - 1].node !== e.source) {
        const onStack = stack.some((f) => f.node === e.source);
        if (onStack) {
          unwindUntil(e.source);
        } else {
          // Broken sequence: caller isn't on the stack. Fully unwind
          // and start a fresh root.
          unwindUntil(null);
          stack.push({ node: e.source, edgeId: null });
        }
      }
      out.push({
        kind: "call",
        edgeId: e.id,
        from: e.source,
        to: e.target,
        selfLoopCall: selfLoop,
      });
      if (!selfLoop) {
        stack.push({ node: e.target, edgeId: e.id });
      }
      // For self-loops we never push the call's target frame — the curled
      // arrow renders both call and return geometry, and pushing would
      // strand a phantom A-frame on the stack that future unwinds would
      // pop with no meaningful edge.
    }
    unwindUntil(null);
    return out;
  }, [orderedEdges]);

  // Per-event vertical slots. CALL events for self-loops get the extra
  // height needed for the curled-back arrow.
  const eventRows = useMemo(() => {
    let y = HEADER_HEIGHT + TOP_PADDING;
    return events.map((ev) => {
      const extra = ev.selfLoopCall ? SELF_LOOP_HEIGHT : 0;
      const rowH = ROW_HEIGHT + extra;
      const slot = { ev, top: y, centerY: y + rowH / 2, height: rowH };
      y += rowH;
      return slot;
    });
  }, [events]);

  const totalHeight =
    HEADER_HEIGHT +
    TOP_PADDING +
    BOTTOM_PADDING +
    eventRows.reduce((sum, r) => sum + r.height, 0);

  const lifelineBottom = totalHeight - BOTTOM_PADDING / 2;

  // Auto-scroll a selected edge/node into view when the selection changes
  // from elsewhere (e.g. the side panel or keyboard navigation).
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selection || !containerRef.current) return;
    let targetEl: Element | null = null;
    if (selection.kind === "edge") {
      targetEl = containerRef.current.querySelector(
        `[data-seq-edge="${selection.id}"]`
      );
    } else if (selection.kind === "node") {
      targetEl = containerRef.current.querySelector(
        `[data-seq-node="${selection.id}"]`
      );
    }
    if (targetEl && "scrollIntoView" in targetEl) {
      (targetEl as HTMLElement).scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selection]);

  const notes = visibleTextAnnotations.length > 0 && (
    <section className="ps-seq-notes" aria-label="Scenario text annotations">
      <h3>Canvas notes (not sequence participants)</h3>
      {visibleTextAnnotations.map(annotation => (
        <button type="button" key={annotation.id} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", textAlign: "left" }}
          onClick={() => setSelection({ kind: "annotation", id: annotation.id })}>
          {annotation.text || "Empty text annotation"}
        </button>
      ))}
    </section>
  );
  if (!activeScenario) {
    return (
      <div className="ps-seq-empty">
        <p>Select a scenario to see the sequence diagram.</p>
        {notes}
        <p className="ps-seq-empty-sub">
          The sequence view orders edges by their per-scenario sequence
          number, so a scenario is required.
        </p>
      </div>
    );
  }

  if (orderedEdges.length === 0 || participants.length === 0) {
    return (
      <div className="ps-seq-empty">
        <p>
          No edges are visible in <strong>{activeScenario.name}</strong>.
        </p>
        <p className="ps-seq-empty-sub">
          Add edges in the graph view (or relax the toolbar filters) to
          populate the sequence diagram.
        </p>
        {notes}
      </div>
    );
  }

  return (
    <div className="ps-seq-wrap" ref={containerRef}>
      {notes}
      <svg
        className="ps-seq-svg"
        width={width}
        height={totalHeight}
        viewBox={`0 0 ${width} ${totalHeight}`}
      >
        <defs>
          <marker
            id="ps-seq-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#48a" />
          </marker>
          <marker
            id="ps-seq-arrow-problem"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
          </marker>
          <marker
            id="ps-seq-arrow-selected"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
          </marker>
        </defs>

        {/* Lifelines (vertical dashed lines under each participant) */}
        {participants.map((p, i) => {
          const x = xForParticipant(i);
          return (
            <line
              key={`lifeline-${p.id}`}
              x1={x}
              y1={HEADER_HEIGHT}
              x2={x}
              y2={lifelineBottom}
              stroke="#9ca3af"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          );
        })}

        {/* Participant headers */}
        {participants.map((p, i) => {
          const x = xForParticipant(i);
          const scope = resolveNodeReviewScope(p, activeScenario, doc.nodeTypes);
          const iconUrl = nodeTypeIconUrl(p.type, doc.nodeTypes);
          const headerSelected =
            selection?.kind === "node" && selection.id === p.id;
          return (
            <g
              key={`head-${p.id}`}
              data-seq-node={p.id}
              role="button"
              tabIndex={0}
              aria-label={`${p.title}. ${nodeDfdSummary(p, doc, activeScenario)}`}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelection({ kind: "node", id: p.id });
                }
              }}
              className={
                "ps-seq-participant" +
                (headerSelected ? " ps-seq-participant--selected" : "")
              }
              onClick={(ev) => {
                ev.stopPropagation();
                setSelection({ kind: "node", id: p.id });
              }}
            >
              <title>{nodeDfdSummary(p, doc, activeScenario)}</title>
              <rect
                x={x - PARTICIPANT_WIDTH / 2}
                y={12}
                width={PARTICIPANT_WIDTH}
                height={HEADER_HEIGHT - 24}
                rx={scope.role.role === "Process" ? 18 : scope.role.role === "DataStore" ? 12 : 0}
                ry={6}
                fill={p.color ?? "#ffffff"}
                stroke={headerSelected ? "#2563eb" : "#334155"}
                strokeWidth={headerSelected ? 2 : 1}
                strokeDasharray={scope.disposition === "outOfScope" ? "5 3" : undefined}
              />
              {(scope.disposition === "outOfScope" || scope.disposition === "external") && <rect
                x={x - PARTICIPANT_WIDTH / 2 + 5} y={20} width={4} height={HEADER_HEIGHT - 40}
                fill={scope.disposition === "external" ? "var(--ps-external-color, #7c3aed)" : "var(--ps-oos-color, #b45309)"}
                aria-hidden="true"
              />}
              {iconUrl && (
                <image
                  href={iconUrl}
                  x={x - PARTICIPANT_WIDTH / 2 + 10}
                  y={HEADER_HEIGHT / 2 - 12}
                  width={24}
                  height={24}
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                />
              )}
              <text
                x={x + (iconUrl ? 10 : 0)}
                y={HEADER_HEIGHT / 2 - 14}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={13}
                fontWeight={600}
                fill="#0f172a"
              >
                {truncate(p.title || "(untitled)", 22)}
              </text>
              {p.type && (
                <text
                  x={x + (iconUrl ? 10 : 0)}
                  y={HEADER_HEIGHT / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="#475569"
                >
                  {truncate(nodeTypeLabel(p.type, doc.nodeTypes), 26)}
                </text>
              )}
              <text x={x} y={HEADER_HEIGHT / 2 + 15} textAnchor="middle" fontSize={9} fill="#334155">
                {DFD_ROLE_LABELS[scope.role.role]}
              </text>
              <text x={x} y={HEADER_HEIGHT / 2 + 27} textAnchor="middle" fontSize={9} fill="#334155">
                {DFD_SCOPE_LABELS[scope.disposition]}
              </text>
            </g>
          );
        })}

        {/* Messages — one row per call/return event computed from the
            ordered edges. Calls render as solid arrows with the edge
            title; returns render as dashed arrows. Clicking anywhere
            on a row selects the underlying edge (both call and return
            rows for the same edge share the same edgeId). */}
        {eventRows.map(({ ev, centerY, top, height }, rowIndex) => {
          const edge = doc.edges.find((e) => e.id === ev.edgeId);
          const srcIdx = participantIndex.get(ev.from);
          const tgtIdx = participantIndex.get(ev.to);
          if (srcIdx == null || tgtIdx == null) return null;
          const srcX = xForParticipant(srcIdx);
          const tgtX = xForParticipant(tgtIdx);
          const isSelected =
            selection?.kind === "edge" && selection.id === ev.edgeId;
          const isReturn = ev.kind === "return";
          const isProblem = edge?.problem === true;
          const num = edgeNumberFor(ev.edgeId);
          const auths = ((edge?.authenticationTypes) ?? [])
            .map((id) => authTypeLabel(id, authenticationCatalog))
            .join(", ");
          const callLabel =
            (num != null ? `${num}. ` : "") +
            (edge?.title || "(untitled)") +
            (auths ? `  [${auths}]` : "");
          const returnLabel =
            (num != null ? `${num}. ` : "") + "return";
          const label = isReturn ? returnLabel : callLabel;
          const arrowColor = isSelected
            ? "#2563eb"
            : isProblem
            ? "#dc2626"
            : "#48a";
          const markerId = isSelected
            ? "ps-seq-arrow-selected"
            : isProblem
            ? "ps-seq-arrow-problem"
            : "ps-seq-arrow";
          const dashArray = isReturn ? "5 4" : undefined;
          const onClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            setSelection({ kind: "edge", id: ev.edgeId });
          };
          // data-seq-edge marks only the CALL row as the canonical anchor
          // for the auto-scroll effect (so selecting an edge elsewhere
          // brings the user to the call, not to a downstream return).
          const dataAttr = ev.kind === "call" ? { "data-seq-edge": ev.edgeId } : {};

          if (ev.selfLoopCall) {
            // Self-loop CALL: arrow leaves the lifeline to the right and
            // curls back onto the same lifeline below the label. The
            // implicit return is baked into the curl, so we emit no
            // separate RETURN row for self-loops.
            const loopWidth = 60;
            const startY = centerY - SELF_LOOP_HEIGHT / 2 + 8;
            const endY = centerY + SELF_LOOP_HEIGHT / 2;
            const pathD = `M ${srcX} ${startY} h ${loopWidth} v ${endY - startY} h ${-loopWidth}`;
            return (
              <g
                key={`row-${rowIndex}`}
                {...dataAttr}
                className={
                  "ps-seq-message" +
                  (isSelected ? " ps-seq-message--selected" : "")
                }
                onClick={onClick}
              >
                <rect
                  x={LEFT_MARGIN / 2}
                  y={top}
                  width={width - LEFT_MARGIN}
                  height={height}
                  fill="transparent"
                />
                <text
                  x={srcX + 8}
                  y={startY - 6}
                  fontSize={12}
                  fill="#0f172a"
                >
                  {truncate(callLabel, 80)}
                </text>
                <path
                  d={pathD}
                  fill="none"
                  stroke={arrowColor}
                  strokeWidth={isSelected ? 2 : 1.5}
                  markerEnd={`url(#${markerId})`}
                />
              </g>
            );
          }

          const x1 = Math.min(srcX, tgtX);
          const x2 = Math.max(srcX, tgtX);
          const midX = (srcX + tgtX) / 2;
          return (
            <g
              key={`row-${rowIndex}`}
              {...dataAttr}
              className={
                "ps-seq-message" +
                (isReturn ? " ps-seq-message--return" : "") +
                (isSelected ? " ps-seq-message--selected" : "")
              }
              onClick={onClick}
            >
              {/* Wide hit target so the row is easy to click anywhere */}
              <rect
                x={LEFT_MARGIN / 2}
                y={top}
                width={width - LEFT_MARGIN}
                height={height}
                fill="transparent"
              />
              <text
                x={midX}
                y={centerY - 8}
                textAnchor="middle"
                fontSize={12}
                fill={isReturn ? "#475569" : "#0f172a"}
                fontStyle={isReturn ? "italic" : "normal"}
              >
                {truncate(label, 80)}
              </text>
              <line
                x1={srcX}
                y1={centerY}
                x2={tgtX}
                y2={centerY}
                stroke={arrowColor}
                strokeWidth={isSelected ? 2 : 1.5}
                strokeDasharray={dashArray}
                markerEnd={`url(#${markerId})`}
              />
              {/* Selection highlight band */}
              {isSelected && (
                <rect
                  x={x1 - 6}
                  y={centerY - 22}
                  width={x2 - x1 + 12}
                  height={40}
                  fill="#dbeafe"
                  fillOpacity={0.35}
                  rx={4}
                  ry={4}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
