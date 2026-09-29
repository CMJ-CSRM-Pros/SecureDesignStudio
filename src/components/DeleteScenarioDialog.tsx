import { useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";
import { calculateScenarioDeletionImpact } from "../scenarioDeletion";

export function DeleteScenarioDialog({
  scenarioId,
  onCancel,
  onConfirm,
}: {
  scenarioId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { doc } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const scenario = doc.scenarios.find((candidate) => candidate.id === scenarioId);

  const impact = useMemo(() => {
    const { orphanNodeIds, orphanEdgeIds } =
      calculateScenarioDeletionImpact(doc, scenarioId);
    const commentsRemoved = doc.comments.filter(
      (comment) =>
        comment.scenarioId === scenarioId ||
        (comment.targetKind === "node" &&
          orphanNodeIds.has(comment.targetId)) ||
        (comment.targetKind === "edge" &&
          orphanEdgeIds.has(comment.targetId)),
    ).length;
    const issuesRemoved = doc.issues.filter(
      (issue) =>
        (issue.targetKind === "node" && orphanNodeIds.has(issue.targetId)) ||
        (issue.targetKind === "edge" && orphanEdgeIds.has(issue.targetId)),
    ).length;
    const requestAttachments = Object.values(
      scenario?.edgeRequestData ?? {},
    ).reduce((count, ids) => count + ids.length, 0);
    const responseAttachments = Object.values(
      scenario?.edgeResponseData ?? {},
    ).reduce((count, ids) => count + ids.length, 0);
    const retentionEntries = Object.values(scenario?.nodeData ?? {}).reduce(
      (count, values) => count + Object.keys(values).length,
      0,
    );
    return {
      orphanNodes: orphanNodeIds.size,
      orphanEdges: orphanEdgeIds.size,
      commentsRemoved,
      issuesRemoved,
      requestAttachments,
      responseAttachments,
      retentionEntries,
    };
  }, [doc, scenario, scenarioId]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!scenario) return null;

  return (
    <div className="ps-modal-overlay ps-fluent-dialog-overlay">
      <div
        ref={dialogRef}
        className="ps-modal ps-modal-sm ps-fluent-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ps-delete-scenario-title"
        aria-describedby="ps-delete-scenario-description"
        onKeyDown={onDialogKeyDown}
      >
        <header className="ps-modal-header">
          <h2 id="ps-delete-scenario-title">
            Delete “{scenario.name}”?
          </h2>
        </header>
        <div className="ps-modal-body" id="ps-delete-scenario-description">
          <p>
            This removes the scenario and its scenario-specific membership,
            numbering, data attachments, retention entries, and comments.
          </p>
          <ul className="ps-dialog-impact-list">
            <li>{scenario.nodeIds.length} node memberships</li>
            <li>{scenario.edgeIds.length} edge memberships and sequence numbers</li>
            <li>
              {scenario.boundaryIds.length} boundary memberships (boundary
              records are not deleted by this action)
            </li>
            <li>
              {impact.requestAttachments + impact.responseAttachments} edge
              data attachments and {impact.retentionEntries} retention entries
            </li>
            <li>
              {impact.commentsRemoved} comments and {impact.issuesRemoved} issues
              removed with deleted targets
            </li>
          </ul>
          {(impact.orphanNodes > 0 || impact.orphanEdges > 0) && (
            <p className="ps-dialog-warning">
              <strong>Cascade:</strong> {impact.orphanNodes} node
              {impact.orphanNodes === 1 ? "" : "s"} no longer used by another
              scenario and {impact.orphanEdges} connected edge
              {impact.orphanEdges === 1 ? "" : "s"} will be deleted from the
              document.
            </p>
          )}
          <p>Nodes and edges still used by another scenario remain.</p>
        </div>
        <footer className="ps-modal-footer ps-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="ps-dialog-danger-primary"
            onClick={onConfirm}
          >
            Delete scenario
          </button>
        </footer>
      </div>
    </div>
  );
}
