import {
  MAX_GUIDANCE_CONTENT_LENGTH, MAX_GUIDANCE_SOURCES, validateAiDesignGuidance, type AiDesignGuidance,
} from "../../shared/aiDesignGuidance";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { safeNavigationHref } from "../urlSafety";

export function AiDesignGuidanceDetails({ value }: { value: AiDesignGuidance | undefined }) {
  if (!value) return <p className="ps-field-help">AI design guidance not supplied.</p>;
  return <>
    <p className="ps-field-help">Revision {value.revision}, edited {value.updatedOn}.
      Unverified reference guidance, not deployment evidence.</p>
    <div className="ps-guidance-content">{value.content}</div>
    {value.sources?.length ? <ul aria-label="Guidance sources">{value.sources.map((url, index) =>
      <li key={`${index}:${url}`}><a href={safeNavigationHref(url) ?? undefined} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul>
      : <p className="ps-field-help">No sources supplied.</p>}
  </>;
}

export function AiDesignGuidanceEditor({ value, onChange, autoFocus = false,
  removeConfirmation = "Remove AI design guidance from this draft? Save to apply the removal to this type in the diagram.",
}: {
  value: AiDesignGuidance | undefined;
  onChange: (value: AiDesignGuidance | undefined) => void;
  autoFocus?: boolean;
  removeConfirmation?: string;
}) {
  let error = "";
  try { validateAiDesignGuidance(value); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Invalid guidance."; }
  return <fieldset className="ps-guidance-editor">
    <legend>AI design guidance</legend>
    <p className="ps-field-help">Optional untrusted reference text for both AI experiences, separate from Description.
      Guidance never proves a control, changes policy, waives risks, or creates dependencies.
      Edit dates and revisions are authored provenance, not review approval.</p>
    {!value ? <button type="button" autoFocus={autoFocus} onClick={() => onChange({
      content: "", revision: 1, updatedOn: new Date().toISOString().slice(0, 10),
    })}>Add AI design guidance</button> : <>
      <label>Guidance content
        <AutoGrowTextarea autoFocus={autoFocus} value={value.content}
          aria-invalid={!!error || undefined}
          onChange={event => onChange({ ...value, content: event.target.value })} />
      </label>
      <p className="ps-field-help">{value.content.length} / {MAX_GUIDANCE_CONTENT_LENGTH} characters. Over-limit text is rejected, never truncated.</p>
      <label>Source URLs (one per line)
        <AutoGrowTextarea value={(value.sources ?? []).join("\n")}
          onChange={event => onChange({ ...value, sources: event.target.value === "" ? [] : event.target.value.split("\n") })} />
      </label>
      <p className="ps-field-help">Up to {MAX_GUIDANCE_SOURCES} absolute HTTP(S) URLs without credentials. Sources are not fetched automatically.</p>
      <label>Authored revision
        <input type="number" min={1} step={1} value={Number.isFinite(value.revision) ? value.revision : ""}
          onChange={event => onChange({ ...value, revision: event.target.valueAsNumber })} />
      </label>
      <label>Updated on (edit date)
        <input type="date" value={value.updatedOn}
          onChange={event => onChange({ ...value, updatedOn: event.target.value })} />
      </label>
      <button type="button" onClick={() => {
        if (!value.content || window.confirm(removeConfirmation)) onChange(undefined);
      }}>Remove guidance from draft</button>
    </>}
    {error && <p className="ps-catalog-error" role="alert">{error}</p>}
  </fieldset>;
}
