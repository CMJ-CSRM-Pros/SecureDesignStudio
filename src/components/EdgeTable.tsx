import { useEffect, useRef, useState } from "react";
import { dataClassificationLabel } from "../types";
import { useStore } from "../store";
import { resolveProtocolReference } from "../protocols";
import { flowDfdSummary } from "../dfdSemantics";
import {
  authTypeDescription,
  authTypeLabel,
  dataClassificationDescription,
} from "../types";
import { useUiShell } from "../uiShell";
import { LabelWithTooltip } from "./LabelWithTooltip";
import { useRemoveFromScenarioWithConfirm } from "./useRemoveFromScenarioWithConfirm";

export function EdgeTable() {
  const { setInspectorActiveTab } = useUiShell();
  const {
    activeScenario,
    doc,
    authenticationCatalog,
    protocolLibrary,
    classificationDefinitions,
    selection,
    setSelection,
    moveEdgeInScenario,
    setEdgeNumberInScenario,
    edgeNumberFor,
    visibleEdges,
  } = useStore();
  const { removeEdgeOrDelete } = useRemoveFromScenarioWithConfirm();
  // Per-row refs so we can move focus to the row that follows after an
  // arrow-key selection change. Keeping the refs in a Map keyed by
  // edge id (cleared on every render) lets us look the next row up by
  // its target edge id without re-numbering on every reorder.
  const rowRefs = useRef(new Map<string, HTMLTableRowElement | null>());
  rowRefs.current = new Map();

  const selectedEdgeId =
    selection?.kind === "edge" ? selection.id : null;
  const [draggedEdgeId, setDraggedEdgeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    edgeId: string;
    placement: "before" | "after";
  } | null>(null);

  // When the selected edge changes (via keyboard or click elsewhere),
  // pull focus onto its row so subsequent arrow keys keep navigating
  // the list instead of scrolling the panel. We only steal focus if a
  // row in this table is what's currently focused — otherwise we'd
  // yank focus out of an unrelated input on the page.
  // Hook is declared above the activeScenario early-return so the same
  // hooks run on every render of this component.
  useEffect(() => {
    if (!selectedEdgeId) return;
    const active = rowRefs.current.get(selectedEdgeId)?.ownerDocument.activeElement;
    const isOurRow =
      active?.tagName === "TR" &&
      active.getAttribute("data-edge-row") === "1";
    if (!isOurRow) return;
    const row = rowRefs.current.get(selectedEdgeId);
    row?.focus({ preventScroll: false });
  }, [selectedEdgeId]);

  if (!activeScenario) {
    return (
      <div className="ps-table-empty">
        Select a scenario to see ordered edges.
      </div>
    );
  }

  const visibleSet = new Set(visibleEdges.map((e) => e.id));
  const ordered = activeScenario.edgeIds.map((eid, i) => {
    const e = doc.edges.find((x) => x.id === eid);
    return { e, index: i };
  });

  // List of present edge ids in scenario order — drives Up/Down keyboard
  // navigation between rows.
  const orderedIds = ordered
    .map(({ e }) => e?.id)
    .filter((id): id is string => Boolean(id));

  const onRowKeyDown = (e: React.KeyboardEvent, edgeId: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const i = orderedIds.indexOf(edgeId);
    if (i < 0) return;
    const j = e.key === "ArrowDown" ? i + 1 : i - 1;
    if (j < 0 || j >= orderedIds.length) return;
    e.preventDefault();
    const nextId = orderedIds[j];
    setSelection({ kind: "edge", id: nextId });
    // Focus the new row immediately so the next keystroke navigates
    // from there, even before the effect above runs.
    rowRefs.current.get(nextId)?.focus({ preventScroll: false });
  };

  const clearDragState = () => {
    setDraggedEdgeId(null);
    setDropTarget(null);
  };

  const onDragStart = (
    event: React.DragEvent<HTMLElement>,
    edgeId: string,
  ) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", edgeId);
    setDraggedEdgeId(edgeId);
    setDropTarget(null);
  };

  const onDragOver = (
    event: React.DragEvent<HTMLTableRowElement>,
    edgeId: string,
  ) => {
    if (!draggedEdgeId || draggedEdgeId === edgeId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDropTarget((current) =>
      current?.edgeId === edgeId && current.placement === placement
        ? current
        : { edgeId, placement },
    );
  };

  const onDrop = (
    event: React.DragEvent<HTMLTableRowElement>,
    targetEdgeId: string,
  ) => {
    event.preventDefault();
    const sourceEdgeId =
      draggedEdgeId || event.dataTransfer.getData("text/plain");
    const placement =
      dropTarget?.edgeId === targetEdgeId ? dropTarget.placement : "before";
    const sourceIndex = orderedIds.indexOf(sourceEdgeId);
    const targetIndex = orderedIds.indexOf(targetEdgeId);
    if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
      let insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
      if (sourceIndex < insertionIndex) insertionIndex -= 1;
      setEdgeNumberInScenario(
        activeScenario.id,
        sourceEdgeId,
        insertionIndex + 1,
      );
      setSelection({ kind: "edge", id: sourceEdgeId });
    }
    clearDragState();
  };

  return (
    <div className="ps-table-wrap">
      <h3>{activeScenario.name} — edges</h3>
      <table className="ps-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Source → Target</th>
            <th>Protocol</th>
            <th>Auth</th>
            <th>Caller Application ID</th>
            <th>Request data</th>
            <th>Response data</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ordered.map(({ e, index }) => {
            if (!e) return null;
            const src = doc.nodes.find((n) => n.id === e.source);
            const tgt = doc.nodes.find((n) => n.id === e.target);
            const isVisible = visibleSet.has(e.id);
            const num = edgeNumberFor(e.id);
            const protocolResolution = resolveProtocolReference(e.protocolId, doc.protocolDefinitions, protocolLibrary);
            const protocolLabel = protocolResolution.status === "resolved"
              ? `${protocolResolution.definition.label}${protocolResolution.conflict ? " (saved conflict)" : ""}`
              : protocolResolution.status === "unresolved"
                ? `${e.protocolId} (unresolved)`
                : "Not specified";
            const renderDataIds = (ids: string[]) =>
              ids
                .map((id) => doc.data.find((x) => x.id === id))
                .filter((x): x is NonNullable<typeof x> => Boolean(x))
                .map((d, i, arr) => (
                  <span key={d.id}>
                    {d.name} (
                    <LabelWithTooltip
                      label={
                        dataClassificationLabel(d.classification, doc.catalogDefinitions, classificationDefinitions)
                      }
                      description={dataClassificationDescription(
                        d.classification, doc.catalogDefinitions, classificationDefinitions
                      )}
                    />
                    ){i < arr.length - 1 ? ", " : ""}
                  </span>
                ));
            return (
              <tr
                key={e.id}
                ref={(el) => {
                  rowRefs.current.set(e.id, el);
                }}
                data-edge-row="1"
                tabIndex={0}
                draggable
                aria-label={`${e.title || "Untitled edge"}, sequence ${num ?? index + 1}. Drag to reorder.`}
                className={
                  (isVisible ? "" : "ps-row-hidden") +
                  (selectedEdgeId === e.id ? " ps-row-selected" : "") +
                  (draggedEdgeId === e.id ? " ps-row-dragging" : "") +
                  (dropTarget?.edgeId === e.id
                    ? ` ps-row-drop-${dropTarget.placement}`
                    : "")
                }
                onClick={() => setSelection({ kind: "edge", id: e.id })}
                onDoubleClick={() => {
                  setSelection({ kind: "edge", id: e.id });
                  setInspectorActiveTab("properties");
                }}
                onKeyDown={(ev) => onRowKeyDown(ev, e.id)}
                onDragStart={(ev) => onDragStart(ev, e.id)}
                onDragEnd={clearDragState}
                onDragOver={(ev) => onDragOver(ev, e.id)}
                onDrop={(ev) => onDrop(ev, e.id)}
              >
                <td>{num}</td>
                <td>{e.title || "(untitled)"}</td>
                <td>
                  {(src?.title ?? e.source)} → {(tgt?.title ?? e.target)}
                  <div className="ps-description-below">{flowDfdSummary(e, doc, activeScenario)}</div>
                </td>
                <td>
                  <LabelWithTooltip
                    label={protocolLabel}
                    description={protocolResolution.status === "resolved"
                      ? `${protocolResolution.definition.description} ${protocolResolution.definition.semantics.description} Declared design intent only; not evidence of negotiated protection.${protocolResolution.conflict ? " Saved diagram definition takes precedence over the active profile." : ""}`
                      : protocolResolution.status === "unresolved"
                        ? "Imported protocol reference is unresolved; no profile semantics or AI guidance were inferred."
                          : "Not specified is not proof of plaintext or encryption."}
                  />
                </td>
                <td>
                  {(e.authenticationTypes ?? []).length > 0
                    ? (e.authenticationTypes ?? []).map((id, i, arr) => (
                        <span key={id}>
                          <LabelWithTooltip
                            label={authTypeLabel(id, authenticationCatalog)}
                            description={authTypeDescription(id, authenticationCatalog)}
                          />
                          {i < arr.length - 1 ? ", " : ""}
                        </span>
                      ))
                    : "Not specified"}
                </td>
                <td>{e.applicationId || "Not specified"}</td>
                <td>{renderDataIds(activeScenario.edgeRequestData[e.id] ?? [])}</td>
                <td>{renderDataIds(activeScenario.edgeResponseData[e.id] ?? [])}</td>
                <td className="ps-row-actions" onClick={(ev) => ev.stopPropagation()}>
                  <button
                    title="Move up"
                    aria-label={`Move ${e.title || "untitled edge"} up`}
                    disabled={index === 0}
                    onClick={() =>
                      moveEdgeInScenario(activeScenario.id, e.id, -1)
                    }
                  >
                    ↑
                  </button>
                  <button
                    title="Move down"
                    aria-label={`Move ${e.title || "untitled edge"} down`}
                    disabled={index === ordered.length - 1}
                    onClick={() =>
                      moveEdgeInScenario(activeScenario.id, e.id, 1)
                    }
                  >
                    ↓
                  </button>
                  <button
                    title="Remove from scenario"
                    aria-label={`Remove ${e.title || "untitled edge"} from scenario`}
                    onClick={() =>
                      removeEdgeOrDelete(activeScenario.id, e.id)
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
