import { useEffect } from "react";
import { useStore } from "../store";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function DeleteKeyHandler() {
  const {
    selection,
    setSelection,
    multiSelectedIds,
    doc,
    deleteNode,
    deleteEdge,
    deleteBoundary,
    deleteTextAnnotation,
    removeEdgeWaypoint,
    undo,
    redo,
  } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      const mod = e.ctrlKey || e.metaKey;

      // Undo: Ctrl/Cmd+Z (without shift)
      if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (typing) return; // let inputs handle their own undo
        e.preventDefault();
        undo();
        return;
      }
      // Redo: Ctrl/Cmd+Y, or Ctrl/Cmd+Shift+Z
      if (
        mod &&
        ((e.key === "y" || e.key === "Y") ||
          (e.shiftKey && (e.key === "z" || e.key === "Z")))
      ) {
        if (typing) return;
        e.preventDefault();
        redo();
        return;
      }

      // Delete current selection.
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (typing) return;
      if (!selection && multiSelectedIds.length === 0) return;
      e.preventDefault();
      // Delete any additionally multi-selected nodes/boundaries first.
      if (multiSelectedIds.length > 0) {
        const nodeIds = new Set(doc.nodes.map((n) => n.id));
        for (const id of multiSelectedIds) {
          if (nodeIds.has(id)) deleteNode(id);
          else if (doc.textAnnotations?.some(annotation => annotation.id === id)) deleteTextAnnotation(id);
          else deleteBoundary(id);
        }
      }
      if (!selection) {
        setSelection(null);
        return;
      }
      if (selection.kind === "node") {
        deleteNode(selection.id);
        setSelection(null);
      } else if (selection.kind === "edge") {
        deleteEdge(selection.id);
        setSelection(null);
      } else if (selection.kind === "boundary") {
        deleteBoundary(selection.id);
        setSelection(null);
      } else if (selection.kind === "annotation") {
        deleteTextAnnotation(selection.id);
        setSelection(null);
      } else if (selection.kind === "waypoint") {
        removeEdgeWaypoint(selection.edgeId, selection.waypointId);
        setSelection({ kind: "edge", id: selection.edgeId });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selection,
    setSelection,
    multiSelectedIds,
    doc,
    deleteNode,
    deleteEdge,
    deleteBoundary,
    deleteTextAnnotation,
    removeEdgeWaypoint,
    undo,
    redo,
  ]);

  return null;
}
