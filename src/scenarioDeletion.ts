import type { PsDocument } from "./types";

export interface ScenarioDeletionImpact {
  orphanNodeIds: Set<string>;
  orphanEdgeIds: Set<string>;
}

export function calculateScenarioDeletionImpact(
  doc: PsDocument,
  scenarioId: string,
): ScenarioDeletionImpact {
  const remainingScenarios = doc.scenarios.filter(
    (scenario) => scenario.id !== scenarioId,
  );
  const deletedScenario = doc.scenarios.find(
    (scenario) => scenario.id === scenarioId,
  );
  if (!deletedScenario) {
    return { orphanNodeIds: new Set(), orphanEdgeIds: new Set() };
  }
  const retainedNodeIds = new Set(
    remainingScenarios.flatMap((scenario) => scenario.nodeIds),
  );
  const retainedEdgeIds = new Set(
    remainingScenarios.flatMap((scenario) => scenario.edgeIds),
  );
  const orphanNodeIds = new Set(
    deletedScenario.nodeIds.filter((nodeId) => !retainedNodeIds.has(nodeId)),
  );
  const orphanEdgeIds = new Set<string>(
    deletedScenario.edgeIds.filter((edgeId) => !retainedEdgeIds.has(edgeId)),
  );
  for (const edge of doc.edges) {
    if (
      orphanNodeIds.has(edge.source) ||
      orphanNodeIds.has(edge.target)
    ) {
      orphanEdgeIds.add(edge.id);
    }
  }
  return { orphanNodeIds, orphanEdgeIds };
}
