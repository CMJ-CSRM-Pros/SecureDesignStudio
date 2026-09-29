// Wraps removeNodeFromScenario / removeEdgeFromScenario with a "is this the
// last scenario the entity belongs to?" check. When yes, we confirm with the
// user and outright delete the node/edge from the document instead of
// silently leaving an orphaned entity behind that's no longer reachable from
// any scenario.
//
// Used by every UI surface that exposes a "remove from scenario" affordance
// (NodeDetails, EdgeDetails, EdgeTable, DiagramCanvas context menu) so all
// of them get the safety net.

import { useCallback } from "react";
import { useStore } from "../store";

export function useRemoveFromScenarioWithConfirm() {
  const {
    doc,
    removeNodeFromScenario,
    removeEdgeFromScenario,
    deleteNode,
    deleteEdge,
  } = useStore();

  const removeNodeOrDelete = useCallback(
    (scenarioId: string, nodeId: string) => {
      const scenario = doc.scenarios.find((s) => s.id === scenarioId);
      if (!scenario || !scenario.nodeIds.includes(nodeId)) return;
      const otherScenarios = doc.scenarios.filter(
        (s) => s.id !== scenarioId && s.nodeIds.includes(nodeId)
      );
      if (otherScenarios.length === 0) {
        const node = doc.nodes.find((n) => n.id === nodeId);
        const title = node?.title?.trim() || "(unnamed node)";
        const touchingEdges = doc.edges.filter(
          (e) => e.source === nodeId || e.target === nodeId
        );
        const edgeSuffix =
          touchingEdges.length > 0
            ? ` This will also delete ${touchingEdges.length} connected edge${
                touchingEdges.length === 1 ? "" : "s"
              }.`
            : "";
        if (
          !window.confirm(
            `"${title}" is only used in this scenario. Removing it here will delete the node from the diagram entirely.${edgeSuffix}\n\nContinue?`
          )
        ) {
          return;
        }
        deleteNode(nodeId);
      } else {
        removeNodeFromScenario(scenarioId, nodeId);
      }
    },
    [doc, removeNodeFromScenario, deleteNode]
  );

  const removeEdgeOrDelete = useCallback(
    (scenarioId: string, edgeId: string) => {
      const scenario = doc.scenarios.find((s) => s.id === scenarioId);
      if (!scenario || !scenario.edgeIds.includes(edgeId)) return;
      const otherScenarios = doc.scenarios.filter(
        (s) => s.id !== scenarioId && s.edgeIds.includes(edgeId)
      );
      if (otherScenarios.length === 0) {
        const edge = doc.edges.find((e) => e.id === edgeId);
        const title = edge?.title?.trim() || "(unnamed edge)";
        if (
          !window.confirm(
            `"${title}" is only used in this scenario. Removing it here will delete the edge from the diagram entirely.\n\nContinue?`
          )
        ) {
          return;
        }
        deleteEdge(edgeId);
      } else {
        removeEdgeFromScenario(scenarioId, edgeId);
      }
    },
    [doc, removeEdgeFromScenario, deleteEdge]
  );

  return { removeNodeOrDelete, removeEdgeOrDelete };
}
