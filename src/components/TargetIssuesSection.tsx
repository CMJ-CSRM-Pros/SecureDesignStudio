import { useMemo } from "react";
import { useStore } from "../store";
import { IssueRow } from "./IssueRow";
import { AddThreatNote } from "./AddThreatNote";

// Inline "Issues" list shown inside a NodeDetails / EdgeDetails side panel.
// Lists every issue whose target matches the selected node or edge.
// Reuses the same IssueRow used by AllIssuesPanel for a consistent look
// (collapsible details, resolve/reopen, reply, delete).
export function TargetIssuesSection({
  targetKind,
  targetId,
}: {
  targetKind: "node" | "edge";
  targetId: string;
}) {
  const { doc } = useStore();

  const matching = useMemo(() => {
    return doc.issues
      .filter((i) => i.targetKind === targetKind && i.targetId === targetId)
      .sort((a, b) => {
        // Active issues first, then by recency.
        if (a.status !== b.status) return a.status === "Active" ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }, [doc.issues, targetKind, targetId]);

  const activeCount = matching.filter((i) => i.status === "Active").length;

  return (
    <fieldset className="ps-edge-data ps-target-issues">
      <legend>
        Issues {matching.length > 0 ? `(${activeCount} active)` : ""}
      </legend>
      <AddThreatNote targetKind={targetKind} targetId={targetId} />
      {matching.length === 0 ? (
        <p className="ps-empty" style={{ padding: 0, fontSize: 12 }}>
          No issues on this {targetKind}.
        </p>
      ) : (
        <div className="ps-target-issues-list">
          {matching.map((i) => (
            <IssueRow key={i.id} issue={i} hideTarget />
          ))}
        </div>
      )}
    </fieldset>
  );
}
