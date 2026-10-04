import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { CommentBadges } from "./CommentBadges";
import { IssueBadges } from "./IssueBadges";

export interface ProcessNodeData {
  title: string;
  type: string;
  typeLabel?: string;
  iconUrl?: string;
  color?: string;
  dfdRole?: string;
  dfdLabel?: string;
  scopeDisposition?: string;
  scopeLabel?: string;
  semanticSummary?: string;
  selected?: boolean;
  commentActive?: number;
  commentResolved?: number;
  issueActive?: number;
  issueResolved?: number;
  simulationActive?: boolean;
  simulationCurrent?: boolean;
  simulationTarget?: boolean;
  [key: string]: unknown;
}

// Reset to auto first so shrinking works, then expand to fit the content.
function autoSize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function ProcessNode({ id, data, selected }: NodeProps) {
  const { setSelection, toggleAdditionalSelection, updateNode } = useStore();
  const d = data as ProcessNodeData;

  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      autoSize(inputRef.current);
    }
  }, [editing]);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      toggleAdditionalSelection("node", id);
    } else {
      setSelection({ kind: "node", id });
    }
  };

  const commitTitle = (value: string) => {
    updateNode(id, { title: value });
    setEditing(false);
  };

  return (
    <div
      className={`ps-node ps-dfd-${d.dfdRole ?? "Process"} ps-dfd-scope-${d.scopeDisposition ?? "noScenario"} ${selected ? "selected" : ""} ${
        d.simulationActive ? "ps-simulation-active" : ""
      } ${d.simulationCurrent ? "ps-simulation-current" : ""} ${
        d.simulationTarget ? "ps-simulation-target" : ""
      }`}
      onClick={onClick}
      title={d.semanticSummary ?? d.type}
      style={d.color ? { background: d.color } : undefined}
    >
      {/* One handle per side. connectionMode="loose" on the canvas lets each
          act as either source or target — drag direction decides which. */}
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="ps-node-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="ps-node-handle"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="ps-node-handle"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="ps-node-handle"
      />
      <div className="ps-node-content">
        {d.iconUrl && (
          <img
            className="ps-node-icon"
            src={d.iconUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        )}
        <div className="ps-node-text">
          {editing ? (
            <textarea
              ref={inputRef}
              className="ps-node-title-input nodrag nopan"
              defaultValue={d.title}
              rows={1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onInput={(e) => autoSize(e.currentTarget)}
              onBlur={(e) => commitTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter commits; plain Enter inserts a newline so
                // titles can span multiple lines. Esc cancels (no save).
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  commitTitle(e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
            />
          ) : (
            <div
              className="ps-node-title"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              title="Double-click to rename · Ctrl/Cmd+Enter to save · Esc to cancel"
            >
              {d.title || "(untitled)"}
            </div>
          )}
          {d.type && (
            <div className="ps-node-type">{d.typeLabel ?? d.type}</div>
          )}
        </div>
      </div>
      <div className="ps-node-semantics" title={d.semanticSummary}>
        <span>{d.dfdLabel}</span>
        <span>{d.scopeLabel}</span>
      </div>
      {!!(d.commentActive || d.commentResolved || d.issueActive || d.issueResolved) && (
        <div className="ps-node-badges nodrag nopan" role="group" aria-label="Node comments and issues">
          <CommentBadges active={d.commentActive ?? 0} resolved={d.commentResolved ?? 0} />
          <IssueBadges active={d.issueActive ?? 0} resolved={d.issueResolved ?? 0} />
        </div>
      )}
    </div>
  );
}
