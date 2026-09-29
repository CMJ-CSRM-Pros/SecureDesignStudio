import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { PsComment } from "../types";

export type CommentTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

export function CommentsModal({
  scenarioId,
  target,
  initialMode = "view",
  onClose,
}: {
  scenarioId: string;
  target: CommentTarget;
  initialMode?: "view" | "add";
  onClose: () => void;
}) {
  const { doc, addComment } = useStore();
  const scenario = doc.scenarios.find((s) => s.id === scenarioId);

  const [newText, setNewText] = useState("");
  const newInputRef = useRef<HTMLTextAreaElement>(null);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (initialMode === "add" && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [initialMode]);

  // Resolve a readable name for the target so the header is meaningful.
  let targetLabel = "";
  if (target.kind === "node") {
    const n = doc.nodes.find((x) => x.id === target.id);
    targetLabel = `Node — ${n?.title || "(untitled)"}`;
  } else {
    const e = doc.edges.find((x) => x.id === target.id);
    const src = e ? doc.nodes.find((n) => n.id === e.source)?.title : undefined;
    const tgt = e ? doc.nodes.find((n) => n.id === e.target)?.title : undefined;
    targetLabel = `Edge — ${e?.title || "(untitled)"}${
      src && tgt ? ` (${src} → ${tgt})` : ""
    }`;
  }
  const scenarioLabel = scenario ? scenario.name : "(unknown scenario)";

  const comments = doc.comments
    .filter(
      (c) =>
        c.scenarioId === scenarioId &&
        c.targetKind === target.kind &&
        c.targetId === target.id
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  const active = comments.filter((c) => c.status === "Active");
  const resolved = comments.filter((c) => c.status === "Resolved");

  const postNew = () => {
    const txt = newText.trim();
    if (!txt) return;
    addComment(scenarioId, target.kind, target.id, txt);
    setNewText("");
  };

  return (
    <div className="ps-modal-overlay" onMouseDown={onClose}>
      <div
        className="ps-modal ps-modal-comments"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Comments"
      >
        <header className="ps-modal-header">
          <h2>
            Comments — {targetLabel}{" "}
            <span className="ps-comment-scenario-tag">in {scenarioLabel}</span>
          </h2>
          <button
            className="ps-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="ps-comments-body">
          {comments.length === 0 ? (
            <p className="ps-empty">No comments yet.</p>
          ) : (
            <>
              {active.length > 0 && (
                <section className="ps-comments-section">
                  <h3 className="ps-comments-section-header">
                    Active ({active.length})
                  </h3>
                  {active.map((c) => (
                    <CommentItem key={c.id} comment={c} />
                  ))}
                </section>
              )}
              {resolved.length > 0 && (
                <section className="ps-comments-section ps-comments-section-resolved">
                  <h3 className="ps-comments-section-header">
                    Resolved ({resolved.length})
                  </h3>
                  {resolved.map((c) => (
                    <CommentItem key={c.id} comment={c} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>

        <footer className="ps-modal-footer ps-comments-footer">
          <textarea
            ref={newInputRef}
            placeholder="Write a new comment…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                postNew();
              }
            }}
          />
          <button
            className="ps-modal-primary"
            onClick={postNew}
            disabled={!newText.trim()}
          >
            Post
          </button>
        </footer>
      </div>
    </div>
  );
}

function CommentItem({ comment }: { comment: PsComment }) {
  const {
    updateCommentText,
    setCommentStatus,
    deleteComment,
    addCommentReply,
    updateCommentReply,
    deleteCommentReply,
  } = useStore();

  const [editingText, setEditingText] = useState(false);
  const [textDraft, setTextDraft] = useState(comment.text);
  useEffect(() => setTextDraft(comment.text), [comment.text]);

  const [replyDraft, setReplyDraft] = useState("");

  const onResolveToggle = () => {
    setCommentStatus(
      comment.id,
      comment.status === "Active" ? "Resolved" : "Active"
    );
  };

  const onDelete = () => {
    if (!window.confirm("Delete this comment and its replies?")) return;
    deleteComment(comment.id);
  };

  const submitReply = () => {
    const txt = replyDraft.trim();
    if (!txt) return;
    addCommentReply(comment.id, txt);
    setReplyDraft("");
  };

  return (
    <article
      className={`ps-comment ps-comment-${comment.status.toLowerCase()}`}
    >
      <header className="ps-comment-head">
        <span className={`ps-comment-status ps-comment-status-${comment.status.toLowerCase()}`}>
          {comment.status}
        </span>
        <span className="ps-comment-date">{formatDate(comment.createdAt)}</span>
        <div className="ps-comment-actions">
          <button onClick={onResolveToggle}>
            {comment.status === "Active" ? "Resolve" : "Reopen"}
          </button>
          <button onClick={() => setEditingText((v) => !v)}>
            {editingText ? "Cancel" : "Edit"}
          </button>
          <button className="ps-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </header>
      <div className="ps-comment-body">
        {editingText ? (
          <>
            <textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="ps-comment-edit-actions">
              <button
                className="ps-modal-primary"
                onClick={() => {
                  updateCommentText(comment.id, textDraft);
                  setEditingText(false);
                }}
                disabled={!textDraft.trim()}
              >
                Save
              </button>
            </div>
          </>
        ) : (
          <p>{comment.text || "(empty)"}</p>
        )}
      </div>
      {comment.replies.length > 0 && (
        <ol className="ps-comment-replies">
          {comment.replies.map((r) => (
            <ReplyItem
              key={r.id}
              replyText={r.text}
              replyId={r.id}
              createdAt={r.createdAt}
              onUpdate={(text) => updateCommentReply(comment.id, r.id, text)}
              onDelete={() => deleteCommentReply(comment.id, r.id)}
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
    </article>
  );
}

function ReplyItem({
  replyText,
  createdAt,
  onUpdate,
  onDelete,
}: {
  replyText: string;
  replyId: string;
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

function formatDate(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}
