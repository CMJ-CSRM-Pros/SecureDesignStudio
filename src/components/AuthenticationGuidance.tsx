import { useRef, useState } from "react";
import { useStore } from "../store";
import type { AuthTypeDef } from "../authentication";
import { validateAiDesignGuidance, type AiDesignGuidance } from "../../shared/aiDesignGuidance";
import { AiDesignGuidanceDetails, AiDesignGuidanceEditor } from "./AiDesignGuidanceEditor";

export function AuthenticationGuidance({ methodId }: { methodId: string }) {
  const { doc, authenticationCatalog, saveAuthenticationGuidance } = useStore();
  const definition = authenticationCatalog.find(method => method.id === methodId);
  const [draft, setDraft] = useState<AiDesignGuidance>();
  const [baseline, setBaseline] = useState<AuthTypeDef | null>(null);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setBaseline(null);
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = () => {
    try {
      validateAiDesignGuidance(draft);
      saveAuthenticationGuidance(methodId, draft, baseline ?? undefined);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication guidance could not be saved.");
    }
  };
  return <details className="ps-node-guidance" onKeyDown={event => {
    if (event.key === "Escape" && baseline) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}>
    <summary>Authentication AI design guidance{definition?.aiDesignGuidance ? ` / revision ${definition.aiDesignGuidance.revision}` : " / not supplied"}</summary>
    <p className="ps-field-help">Method-wide in this diagram, across all scenarios and every flow using this method.
      Saving changes the diagram definition, not your profile library or any flow settings. Undo/Redo applies normally.</p>
    <p className="ps-field-help">{definition?.label ?? methodId} ({methodId}) / {
      doc.authenticationDefinitions?.some(method => method.id === methodId) ? "Saved diagram definition" : "Available catalog definition"
    }. Guidance cannot make an unavailable method selectable or prove authentication is secure.</p>
    <AiDesignGuidanceDetails value={definition?.aiDesignGuidance} />
    {baseline === null ? <button ref={trigger} type="button" disabled={!definition || definition.unresolved} onClick={() => {
      if (!definition || definition.unresolved) return;
      setDraft(definition.aiDesignGuidance ? structuredClone(definition.aiDesignGuidance) : undefined);
      setBaseline(structuredClone(definition));
      setError("");
    }}>Edit guidance for this method in this diagram</button> : <div>
      <AiDesignGuidanceEditor value={draft} onChange={setDraft} autoFocus
        removeConfirmation="Remove AI design guidance from this draft? Save guidance to remove it for this method throughout this diagram. Your profile library is unchanged." />
      {error && <p className="ps-catalog-error" role="alert">{error}</p>}
      <div className="ps-guidance-actions">
        <button type="button" onClick={save}>Save guidance</button>
        <button type="button" onClick={close}>Cancel guidance edit</button>
      </div>
    </div>}
    {(!definition || definition.unresolved) && <p className="ps-field-help">
      Resolve this method in Authentication Library before editing guidance. Existing flow values are preserved.
    </p>}
  </details>;
}
