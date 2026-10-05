import type { PsDocument, PsTextAnnotation, Scenario } from "./types";

// Textarea values normalize CR/CRLF to LF. Keep a no-op edit byte-exact and
// retain a consistent source newline convention when the author changes text.
export function annotationTextFromEditor(value: string, original: string): string {
  if (value === original.replace(/\r\n?/g, "\n")) return original;
  const breaks = original.match(/\r\n|\r|\n/g);
  return breaks?.length && breaks.every(separator => separator === breaks[0])
    ? value.replace(/\r\n?|\n/g, breaks[0]) : value;
}

export function normalizeTextAnnotations(doc: Partial<PsDocument>): PsTextAnnotation[] | undefined {
  if (doc.textAnnotations === undefined) return undefined;
  if (!Array.isArray(doc.textAnnotations)) throw new Error("Text annotations must be an array.");
  const ids = new Set<string>([
    ...(doc.nodes ?? []), ...(doc.edges ?? []), ...(doc.boundaries ?? []),
    ...(doc.scenarios ?? []), ...(doc.data ?? []), ...(doc.comments ?? []),
    ...(doc.issues ?? []), ...(doc.deviations ?? []), ...(doc.workItems ?? []),
  ].map(item => item.id));
  return doc.textAnnotations.map(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" ||
        !item.id.trim() || ids.has(item.id)) {
      throw new Error("Text annotations require unique, nonempty IDs distinct from other entities.");
    }
    ids.add(item.id);
    if (typeof item.text !== "string") throw new Error("Annotation text must be a string.");
    if (!item.position || !Number.isFinite(item.position.x) || !Number.isFinite(item.position.y) ||
        !item.size || !Number.isFinite(item.size.width) || !Number.isFinite(item.size.height) ||
        item.size.width <= 0 || item.size.height <= 0) {
      throw new Error("Annotation position and positive size must be finite numbers.");
    }
    return { id: item.id, text: item.text, position: { ...item.position }, size: { ...item.size } };
  });
}

export function normalizeTextAnnotationIds(scenario: Partial<Scenario>, annotations: readonly PsTextAnnotation[]) {
  if (scenario.textAnnotationIds === undefined) return {};
  if (!Array.isArray(scenario.textAnnotationIds) || scenario.textAnnotationIds.some(id => typeof id !== "string")) {
    throw new Error("Scenario text annotation membership must be an array of IDs.");
  }
  const existing = new Set(annotations.map(item => item.id));
  return { textAnnotationIds: [...new Set(scenario.textAnnotationIds)].filter(id => existing.has(id)) };
}
