import { useEffect, useState } from "react";
import type { PsTextAnnotation } from "../types";
import { useStore } from "../store";
import { annotationTextFromEditor } from "../textAnnotations";

export function TextAnnotationDetails({ annotation }: { annotation: PsTextAnnotation }) {
  const { doc, updateTextAnnotation, deleteTextAnnotation, setTextAnnotationMembership, setSelection } = useStore();
  const [draft, setDraft] = useState({ text: annotation.text, base: annotation.text });
  const text = draft.text;
  useEffect(() => setDraft(current => current.text === current.base || current.text === annotation.text
    ? { text: annotation.text, base: annotation.text } : current), [annotation.text]);
  const setText = (value: string) => setDraft(current => ({
    ...current, text: annotationTextFromEditor(value, current.base),
  }));
  return (
    <section className="ps-annotation-details">
      <h3>Canvas text annotation</h3>
      <p>Context only, not a process, flow, data item, or policy target. Text is shared across included scenarios.</p>
      <label htmlFor="ps-annotation-text">Annotation text</label>
      <textarea id="ps-annotation-text" className="nodrag nopan nokey" rows={10} value={text}
        onChange={event => setText(event.target.value)} />
      <div className="ps-annotation-actions">
        <button type="button" disabled={text === annotation.text}
          onClick={() => {
            updateTextAnnotation(annotation.id, { text });
            setDraft({ text, base: text });
          }}>Apply text</button>
        <button type="button" disabled={text === annotation.text}
          onClick={() => setDraft({ text: annotation.text, base: annotation.text })}>Discard text edits</button>
      </div>
      <p>Apply saves one undoable edit. Unapplied text is a draft.</p>
      {draft.base !== annotation.text && text !== annotation.text && (
        <p role="status">Saved text changed while you were editing. Your draft is retained. Apply replaces the saved text; Discard uses its current value.</p>
      )}
      <fieldset><legend>Position and size</legend>
        {(["x", "y", "width", "height"] as const).map(key => {
          const size = key === "width" || key === "height";
          const value = size ? annotation.size[key] : annotation.position[key];
          return <label key={key}>{key}
            <input type="number" aria-label={`Annotation ${key}`} value={value} min={size ? 1 : undefined}
              onChange={event => {
                if (!event.target.value) return;
                const next = Number(event.target.value);
                if (!Number.isFinite(next) || (size && next <= 0)) return;
                updateTextAnnotation(annotation.id, size
                  ? { size: { ...annotation.size, [key]: next } }
                  : { position: { ...annotation.position, [key]: next } });
              }} />
          </label>;
        })}
      </fieldset>
      <fieldset><legend>Include in scenarios</legend>
        {doc.scenarios.map(scenario => <label key={scenario.id}>
          <input type="checkbox" checked={scenario.textAnnotationIds?.includes(annotation.id) ?? false}
            onChange={event => setTextAnnotationMembership(scenario.id, annotation.id, event.target.checked)} />
          {scenario.name}
        </label>)}
      </fieldset>
      <button type="button" onClick={() => {
        if (!window.confirm("Delete this text annotation from every scenario? This is undoable.")) return;
        deleteTextAnnotation(annotation.id); setSelection(null);
      }}>Delete text annotation</button>
    </section>
  );
}
