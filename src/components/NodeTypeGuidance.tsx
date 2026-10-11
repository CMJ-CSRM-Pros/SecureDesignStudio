import { useRef, useState } from "react";
import { useStore } from "../store";
import { resolveNodeTypeDef } from "../types";
import { resolveAiDesignGuidance } from "../aiDesignGuidance";
import { validateAiDesignGuidance, type AiDesignGuidance } from "../../shared/aiDesignGuidance";
import { safeNavigationHref } from "../urlSafety";
import { AiDesignGuidanceEditor } from "./AiDesignGuidanceEditor";

export function NodeTypeGuidance({ typeId }: { typeId: string }) {
  const { doc, nodeTypeCatalog, saveNodeTypeGuidance } = useStore();
  const definition = resolveNodeTypeDef(typeId, nodeTypeCatalog);
  const guidance = resolveAiDesignGuidance(typeId, doc.nodeTypes, nodeTypeCatalog);
  const [draft, setDraft] = useState<AiDesignGuidance>();
  const [baseline, setBaseline] = useState<string | null>(null);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setBaseline(null); setError(""); requestAnimationFrame(() => trigger.current?.focus()); };
  const save = () => {
    try {
      if (JSON.stringify(definition) !== baseline) throw new Error("This type changed while you were editing. Cancel and reopen the editor to use the current definition; no changes were applied.");
      validateAiDesignGuidance(draft);
      saveNodeTypeGuidance(typeId, draft);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Guidance could not be saved."); }
  };
  return <details className="ps-node-guidance" onKeyDown={event => {
    if (event.key === "Escape" && baseline !== null) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <summary>AI design guidance{guidance ? ` · revision ${guidance.revision}` : " · not supplied"}</summary>
    <p className="ps-field-help">Type-wide in this diagram, across all scenarios and every node of this type.
      Saving creates or updates a document-local definition, not the installed library. Undo/Redo applies normally.</p>
    {guidance && <>
      <p className="ps-field-help">{guidance.typeId} · {guidance.definitionSource === "saved" ? "Saved diagram definition" : "Available catalog definition"} · edited {guidance.updatedOn}.
        Unverified reference guidance, not deployment evidence.</p>
      <div className="ps-guidance-content">{guidance.content}</div>
      {guidance.sources.length ? <ul aria-label="Guidance sources">{guidance.sources.map((url, index) =>
        <li key={`${index}:${url}`}><a href={safeNavigationHref(url) ?? undefined} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
        : <p className="ps-field-help">No sources supplied.</p>}
    </>}
    {baseline === null ? <button ref={trigger} type="button" disabled={!definition} onClick={() => {
      setDraft(definition?.aiDesignGuidance ? structuredClone(definition.aiDesignGuidance) : undefined);
      setBaseline(JSON.stringify(definition)); setError("");
    }}>Edit guidance for this type in this diagram</button> : <div>
      <AiDesignGuidanceEditor value={draft} onChange={setDraft} autoFocus />
      {error && <p className="ps-catalog-error" role="alert">{error}</p>}
      <div className="ps-guidance-actions">
        <button type="button" onClick={save}>Save guidance</button>
        <button type="button" onClick={close}>Cancel guidance edit</button>
      </div>
    </div>}
    {!definition && <p className="ps-field-help">Define this unavailable type in Node Type Catalog first. Existing node values are preserved.</p>}
  </details>;
}
