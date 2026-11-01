import { useEffect, useState } from "react";
import { useStore } from "../store";
import { ISSUE_NOT_EVALUATED_LABELS, type PsIssue } from "../types";
import { safeNavigationHref } from "../urlSafety";
import { nodeDfdSummary, flowDfdSummary } from "../dfdSemantics";
import { isAuthoredThreatNote } from "../threatNotes";

export function IssueRow({
  issue,
  onNavigate,
  hideTarget = false,
  selected = false,
}: {
  issue: PsIssue;
  onNavigate?: () => void;
  // When true, omit the "Node: …" / "Edge: …" header. Useful when the row
  // is already rendered in the context of its target (e.g. inside the
  // selected node's side panel).
  hideTarget?: boolean;
  // Highlights the row to indicate it's the currently focused issue in the
  // All Issues pane.
  selected?: boolean;
}) {
  const {
    doc,
    activeScenario,
    setIssueStatus,
    deleteIssue,
    updateIssue,
    addIssueReply,
    updateIssueReply,
    deleteIssueReply,
  } = useStore();

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(issue.title);
  const [descDraft, setDescDraft] = useState(issue.description);
  const [justificationDraft, setJustificationDraft] = useState(issue.justification ?? "");
  useEffect(() => setJustificationDraft(issue.justification ?? ""), [issue.justification]);
  useEffect(() => setTitleDraft(issue.title), [issue.title]);
  useEffect(() => setDescDraft(issue.description), [issue.description]);
  const [replyDraft, setReplyDraft] = useState("");
  const [editError, setEditError] = useState("");

  let targetLabel = "";
  let edgeNumberLabel = "";
  if (issue.targetKind === "node") {
    const n = doc.nodes.find((x) => x.id === issue.targetId);
    targetLabel = n?.title || "(untitled node)";
  } else {
    const e = doc.edges.find((x) => x.id === issue.targetId);
    targetLabel = e?.title || "(untitled edge)";
    // Display the edge's sequence number so the All Issues sort order
    // (nodes → edges in #-order) is visible at a glance. Pick the
    // smallest number across the issue's scenarios.
    let num: number | null = null;
    for (const sid of issue.scenarioIds) {
      const sc = doc.scenarios.find((s) => s.id === sid);
      const n = sc?.edgeNumbers?.[issue.targetId];
      if (typeof n === "number" && (num == null || n < num)) num = n;
    }
    if (num != null) edgeNumberLabel = `#${num} `;
  }
  const scenarioNames =
    issue.scenarioIds.length === 0
      ? "All scenarios containing this target"
      : issue.scenarioIds
          .map(
            (sid) =>
              doc.scenarios.find((s) => s.id === sid)?.name ?? "(deleted)"
          )
          .join(", ");

  const onResolveToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIssueStatus(
      issue.id,
      issue.status === "Active" ? "Resolved" : "Active"
    );
  };

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(e.currentTarget.ownerDocument.defaultView ?? window).confirm("Delete this issue and its replies?")) return;
    deleteIssue(issue.id);
  };

  const submitReply = () => {
    const txt = replyDraft.trim();
    if (!txt) return;
    addIssueReply(issue.id, txt);
    setReplyDraft("");
  };

  const saveEdits = () => {
    // Auto-generated issues have an immutable title/description so the
    // analyzer can keep them in sync; the user can still edit replies and
    // toggle status. Only allow text edits on user-authored issues.
    if (issue.kind) return;
    try {
      updateIssue(issue.id, {
        title: isAuthoredThreatNote(issue) ? titleDraft : titleDraft.trim() || "(untitled)",
        description: descDraft,
        ...(isAuthoredThreatNote(issue) ? { justification: justificationDraft } : {}),
      });
      setEditing(false);
      setEditError("");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Unable to save issue.");
    }
  };

  const canEdit = !issue.kind;
  const node = issue.targetKind === "node" ? doc.nodes.find(item => item.id === issue.targetId) : undefined;
  const edge = issue.targetKind === "edge" ? doc.edges.find(item => item.id === issue.targetId) : undefined;
  const scopeContext = node ? nodeDfdSummary(node, doc, activeScenario)
    : edge ? flowDfdSummary(edge, doc, activeScenario) : "";

  return (
    <div
      className={`ps-allcomments-row ps-allissues-row ps-allcomments-${issue.status.toLowerCase()}${
        selected ? " ps-allissues-selected" : ""
      }`}
    >
      <button
        type="button"
        className="ps-allissues-rowhead"
        onClick={onNavigate}
        title={onNavigate ? "Click to navigate to this item" : undefined}
        disabled={!onNavigate}
      >
        <div className="ps-allcomments-row-head">
          <span
            className={`ps-comment-status ps-comment-status-${issue.status.toLowerCase()}`}
          >
            {issue.status}
          </span>
          <span className="ps-allcomments-scenario">{scenarioNames}</span>
          <span className="ps-comment-date">{formatDate(issue.createdAt)}</span>
        </div>
        {!hideTarget && (
          <div className="ps-allcomments-target">
            <strong>{issue.targetKind === "node" ? "Node" : "Edge"}:</strong>{" "}
            {edgeNumberLabel && (
              <span className="ps-allissues-edgenum">{edgeNumberLabel}</span>
            )}
            {targetLabel}
          </div>
        )}
        <p className="ps-allissues-title">{issue.title || "(untitled)"}</p>
        {isAuthoredThreatNote(issue) && <p className="ps-description-below">Authored threat note</p>}
        {scopeContext && <p className="ps-description-below">Scope context: {scopeContext}{issue.kind ? " Fixed checks unchanged." : ""}</p>}
        {issue.kind && issue.notEvaluatedReason && (
          <p className="ps-issue-evaluation">{ISSUE_NOT_EVALUATED_LABELS[issue.notEvaluatedReason]}</p>
        )}
        {!expanded && issue.description && (
          <p className="ps-allcomments-text">
            {truncate(issue.description, 200)}
          </p>
        )}
        {!expanded && issue.replies.length > 0 && (
          <div className="ps-allcomments-row-meta">
            💬 {issue.replies.length}{" "}
            {issue.replies.length === 1 ? "reply" : "replies"}
          </div>
        )}
      </button>

      {issue.resolutionLink && (() => {
        // Defensive scheme check. Today resolutionLink is only set from
        // hardcoded rule strings in IssueManager.ts, but the field type is
        // just `string?` — if a future rule sources content from the doc
        // we don't want a javascript:/data: URL to slip through.
        const safe = safeNavigationHref(issue.resolutionLink);
        if (!safe) return null;
        return (
          <a
            className="ps-issue-resolution-link"
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open remediation guidance in a new tab"
          >
            🔗 Resolution guidance
          </a>
        );
      })()}

      <div
        className="ps-allissues-actions"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : "Details"}
        </button>
        <button onClick={onResolveToggle}>
          {issue.status === "Active" ? "Resolve" : "Reopen"}
        </button>
        <button className="ps-danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      {expanded && (
        <div
          className="ps-allissues-detail"
          onClick={(e) => e.stopPropagation()}
        >
          {editing && canEdit ? (
            <>
              <label className="ps-allissues-field">
                Title
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="ps-allissues-field">
                {isAuthoredThreatNote(issue) ? "Threat / mitigation notes" : "Description"}
                <textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={4}
                />
              </label>
              {isAuthoredThreatNote(issue) && <label className="ps-allissues-field">
                Justification (optional)
                <textarea value={justificationDraft} onChange={event => setJustificationDraft(event.target.value)} rows={3} />
              </label>}
              {editError && <p role="alert">{editError}</p>}
              <div className="ps-comment-edit-actions">
                <button
                  className="ps-modal-primary"
                  onClick={saveEdits}
                  disabled={!isAuthoredThreatNote(issue) && !titleDraft.trim()}
                >
                  Save
                </button>
                <button onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="ps-allcomments-text">
                {issue.description || "(no description)"}
              </p>
              {isAuthoredThreatNote(issue) && <p className="ps-allcomments-text">
                Justification: {issue.justification || "(not supplied)"}
              </p>}
              {canEdit && (
                <div className="ps-allissues-edit-row">
                  <button onClick={() => setEditing(true)}>Edit</button>
                </div>
              )}
              {!canEdit && (
                <p className="ps-empty" style={{ padding: 0, fontSize: 11 }}>
                  Auto-generated by Analyze ({issue.kind}).{" "}
                  {issue.notEvaluatedReason
                    ? "Coverage is incomplete. Saved evidence and status are retained; new findings may cover only evaluable portions. Restore the rule and required definitions, then re-run Analyze."
                    : "Re-run Analyze to refresh or clear this issue when its rule and required definitions are available."}
                </p>
              )}
            </>
          )}

          {issue.replies.length > 0 && (
            <ol className="ps-comment-replies">
              {issue.replies.map((r) => (
                <ReplyItem
                  key={r.id}
                  replyText={r.text}
                  createdAt={r.createdAt}
                  onUpdate={(text) => updateIssueReply(issue.id, r.id, text)}
                  onDelete={() => deleteIssueReply(issue.id, r.id)}
                />
              ))}
            </ol>
          )}

          <div className="ps-comment-reply-row">
            <input
              type="text"
              placeholder="Reply…"
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitReply();
                }
              }}
            />
            <button onClick={submitReply} disabled={!replyDraft.trim()}>
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyItem({
  replyText,
  createdAt,
  onUpdate,
  onDelete,
}: {
  replyText: string;
  createdAt: number;
  onUpdate: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(replyText);
  useEffect(() => setDraft(replyText), [replyText]);

  return (
    <li className="ps-reply">
      <div className="ps-reply-head">
        <span className="ps-comment-date">{formatDate(createdAt)}</span>
        <div className="ps-reply-actions">
          <button onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </button>
          <button className="ps-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
          />
          <div className="ps-comment-edit-actions">
            <button
              className="ps-modal-primary"
              onClick={() => {
                onUpdate(draft);
                setEditing(false);
              }}
              disabled={!draft.trim()}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <p>{replyText || "(empty)"}</p>
      )}
    </li>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}
