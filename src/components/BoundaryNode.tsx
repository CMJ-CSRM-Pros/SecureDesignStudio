import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  privacyBoundaryTypeLabel,
  securityBoundaryTypeLabel,
} from "../types";

export interface BoundaryNodeData {
  title: string;
  boundaryType: "security" | "privacy";
  privacySubtype?: string;
  securitySubtype?: string;
  onResizeStart?: (id: string) => void;
  onResizeEnd?: (id: string) => void;
  [key: string]: unknown;
}

export function BoundaryNode({ id, data, selected, dragging }: NodeProps) {
  const { doc, availableCatalogDefinitions, setSelection, toggleAdditionalSelection, updateBoundary } = useStore();
  const d = data as BoundaryNodeData;
  const cls = `ps-boundary ps-boundary-${d.boundaryType} ${
    selected ? "selected" : ""
  }`;

  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select-all when entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      toggleAdditionalSelection("boundary", id);
    } else {
      setSelection({ kind: "boundary", id });
    }
  };

  const commitTitle = (value: string) => {
    updateBoundary(id, { title: value });
    setEditing(false);
  };

  return (
    <div className={cls} onClick={onClick}>
      {/* Hide NodeResizer's handles during drag — re-painting 8 handle DOM
          nodes on every drag frame is the main source of boundary drag lag. */}
      <NodeResizer
        isVisible={Boolean(selected) && !dragging}
        minWidth={120}
        minHeight={80}
        lineClassName="ps-boundary-resize-line"
        handleClassName="ps-boundary-resize-handle"
        onResizeStart={() => d.onResizeStart?.(id)}
        onResizeEnd={() => d.onResizeEnd?.(id)}
      />
      {(["top", "right", "bottom", "left"] as const).map(side => (
        <span key={side} className={`ps-boundary-drag ps-boundary-drag-${side}`}
          aria-hidden="true" title="Drag the border to move this boundary and its nodes" />
      ))}
      {editing ? (
        <input
          ref={inputRef}
          className="ps-boundary-title-input nodrag nopan"
          defaultValue={d.title}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => commitTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
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
          className="ps-boundary-title nodrag nopan"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          title="Double-click to rename"
        >
          <span className="ps-boundary-kind">
            {(() => {
              const base =
                d.boundaryType === "security" ? "Security" : "Privacy";
              const sub =
                d.boundaryType === "security"
                  ? d.securitySubtype
                    ? securityBoundaryTypeLabel(d.securitySubtype, doc.catalogDefinitions, availableCatalogDefinitions)
                    : ""
                  : d.privacySubtype
                    ? privacyBoundaryTypeLabel(d.privacySubtype, doc.catalogDefinitions, availableCatalogDefinitions)
                    : "";
              return sub ? `${base} - ${sub}` : base;
            })()}
          </span>
          {d.title && (
            <span className="ps-boundary-title-text">{d.title}</span>
          )}
        </div>
      )}
    </div>
  );
}
