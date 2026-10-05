import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useStore } from "../store";
import { useUiShell } from "../uiShell";

export function TextAnnotationNode({ id, data, selected, dragging }: NodeProps) {
  const { doc, setSelection, toggleAdditionalSelection, snapshot, updateTextAnnotation, deleteTextAnnotation } = useStore();
  const { openInspector } = useUiShell();
  return (
    <div className={`ps-text-annotation${selected ? " selected" : ""}`} tabIndex={0}
      role="button" aria-label={`Canvas text: ${data.text as string || "Empty annotation"}`}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation();
          setSelection({ kind: "annotation", id }); openInspector("properties");
        } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const annotation = doc.textAnnotations?.find(item => item.id === id);
          if (!annotation) return;
          const step = event.shiftKey ? 10 : 1;
          setSelection({ kind: "annotation", id });
          updateTextAnnotation(id, { position: {
            x: annotation.position.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
            y: annotation.position.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
          } });
        } else if (!selected && (event.key === "Delete" || event.key === "Backspace")) {
          event.preventDefault(); event.stopPropagation();
          deleteTextAnnotation(id); setSelection(null);
        }
      }}
      onClick={event => {
        event.stopPropagation();
        if (event.ctrlKey || event.metaKey) toggleAdditionalSelection("annotation", id);
        else setSelection({ kind: "annotation", id });
      }}
      onDoubleClick={() => { setSelection({ kind: "annotation", id }); openInspector("properties"); }}>
      <NodeResizer isVisible={Boolean(selected) && !dragging} minWidth={40} minHeight={30}
        onResizeStart={() => snapshot()}
        onResize={(_, params) => updateTextAnnotation(id, {
          position: { x: params.x, y: params.y }, size: { width: params.width, height: params.height },
        }, false)}
      />
      <div className="ps-text-annotation-content">{data.text as string || <span className="ps-text-annotation-empty">Free text — edit in Properties</span>}</div>
    </div>
  );
}
