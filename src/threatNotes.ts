import type { PsDocument, PsIssue } from "./types";

export function isAuthoredThreatNote(issue: Partial<PsIssue>): boolean {
  return issue.origin === "authored-threat" && !issue.kind;
}

export function threatNoteFields(issue: Partial<PsIssue>): Pick<PsIssue, "origin" | "justification"> {
  if (issue.origin === undefined && issue.justification === undefined) return {};
  if (issue.origin !== "authored-threat" || issue.kind) {
    throw new Error("Threat note provenance must be explicit and cannot belong to an analyzer finding.");
  }
  if (typeof issue.title !== "string" || typeof issue.description !== "string" ||
      (issue.justification != null && typeof issue.justification !== "string")) {
    throw new Error("Threat note title, body and optional justification must be text.");
  }
  return { origin: "authored-threat",
    ...(issue.justification ? { justification: issue.justification } : {}) };
}

export function validateThreatNotes(doc: Partial<PsDocument>): void {
  const seen = new Set<string>();
  for (const issue of doc.issues ?? []) {
    threatNoteFields(issue);
    if (!isAuthoredThreatNote(issue)) continue;
    const targets = issue.targetKind === "node" ? doc.nodes : issue.targetKind === "edge" ? doc.edges : [];
    if (!issue.id || seen.has(issue.id) || (doc.issues ?? []).filter(i => i.id === issue.id).length !== 1 ||
        !targets?.some(target => target.id === issue.targetId)) {
      throw new Error("Threat note has a duplicate/missing ID or a missing node/flow target.");
    }
    seen.add(issue.id);
    if (!Array.isArray(issue.scenarioIds) || issue.scenarioIds.some(id => {
      const scenario = doc.scenarios?.find(s => s.id === id);
      return !scenario || !(issue.targetKind === "node" ? scenario.nodeIds : scenario.edgeIds)?.includes(issue.targetId);
    })) {
      throw new Error(`Threat note "${issue.title}" has a missing scenario or target outside its selected scenario.`);
    }
    if (issue.status !== "Active" && issue.status !== "Resolved") {
      throw new Error("Threat note status must be the human Active or Resolved state.");
    }
  }
}

// Losing the final selected scenario must not widen a note to all scenarios.
export function removeThreatNoteScenario(issue: PsIssue, scenarioId: string): PsIssue[] {
  if (!issue.scenarioIds.includes(scenarioId)) return [issue];
  const scenarioIds = issue.scenarioIds.filter(id => id !== scenarioId);
  if (isAuthoredThreatNote(issue) && !scenarioIds.length) return [];
  return [{ ...issue, scenarioIds }];
}
