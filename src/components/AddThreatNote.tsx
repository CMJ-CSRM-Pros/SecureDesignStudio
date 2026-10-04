import { useRef, useState } from "react";
import { useStore } from "../store";

export function AddThreatNote({ targetKind, targetId }: {
  targetKind: "node" | "edge";
  targetId: string;
}) {
  const { doc, activeScenario, addIssue } = useStore();
  const trigger = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<{
    targetKind: "node" | "edge"; targetId: string; scenarioIds: string[];
    title: string; description: string; justification: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const close = () => {
    setDraft(null); setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const target = (draft?.targetKind ?? targetKind) === "node"
    ? doc.nodes.find(n => n.id === (draft?.targetId ?? targetId))
    : doc.edges.find(e => e.id === (draft?.targetId ?? targetId));

  return <div className="ps-threat-note-editor" onKeyDown={event => {
    if (draft && event.key === "Escape") {
      event.stopPropagation(); event.preventDefault(); close();
    }
  }}>
    <button type="button" ref={trigger} disabled={draft !== null} onClick={() => {
      setDraft({ targetKind, targetId, scenarioIds: activeScenario ? [activeScenario.id] : [],
        title: "", description: "", justification: "" });
      setMessage(""); setError("");
    }}>Add threat note</button>
    {message && <p role="status">{message}</p>}
    {draft && <fieldset>
      <legend>Authored threat note</legend>
      <p>{draft.targetKind === "node" ? "Node" : "Flow"}: {target?.title || draft.targetId}</p>
      <p>Applies to: {draft.scenarioIds.length
        ? draft.scenarioIds.map(id => doc.scenarios.find(s => s.id === id)?.name || "(deleted scenario)").join(", ")
        : "All scenarios containing this target"}</p>
      <label className="ps-allissues-field">Title
        <input autoFocus value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label className="ps-allissues-field">Threat / mitigation notes
        <textarea rows={5} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} />
      </label>
      <label className="ps-allissues-field">Justification (optional)
        <textarea rows={3} value={draft.justification} onChange={event => setDraft({ ...draft, justification: event.target.value })} />
      </label>
      <p className="ps-description-below">Free-form authored text, not an analysis or mitigation-completion claim. Explanations may be blank. Severity is unspecified.</p>
      {error && <p role="alert">{error}</p>}
      <div className="ps-comment-edit-actions">
        <button type="button" onClick={() => {
          try {
            addIssue(draft.targetKind, draft.targetId, draft.scenarioIds, draft.title, draft.description,
              { origin: "authored-threat", justification: draft.justification });
            close(); setMessage("Threat note added.");
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to add threat note.");
          }
        }}>Save threat note</button>
        <button type="button" onClick={close}>Cancel</button>
      </div>
    </fieldset>}
  </div>;
}
