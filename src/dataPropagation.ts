import type { PsEdge, Retention, Scenario } from "./types";

// Receiving data does not establish storage or a retention period.
export function propagateScenarioEdgeData(scenario: Scenario, edges: readonly PsEdge[]): Scenario {
  const members = new Set(scenario.edgeIds);
  const incoming = new Map(scenario.nodeIds.map(id => [id, new Set<string>()]));
  for (const edge of edges) {
    if (!members.has(edge.id)) continue;
    for (const id of scenario.edgeRequestData[edge.id] ?? []) incoming.get(edge.target)?.add(id);
    for (const id of scenario.edgeResponseData[edge.id] ?? []) incoming.get(edge.source)?.add(id);
  }
  const nodeData = { ...scenario.nodeData };
  let changed = false;
  for (const [nodeId, dataIds] of incoming) {
    const existing = nodeData[nodeId] ?? {};
    const updated: Record<string, Retention> = { ...existing };
    let nodeChanged = false;
    for (const id of dataIds) {
      if (Object.prototype.hasOwnProperty.call(existing, id)) continue;
      updated[id] = "";
      nodeChanged = true;
    }
    if (nodeChanged) {
      nodeData[nodeId] = updated;
      changed = true;
    }
  }
  return changed ? { ...scenario, nodeData } : scenario;
}
