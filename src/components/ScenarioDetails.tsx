import { useStore } from "../store";
import type { Scenario } from "../types";

export function ScenarioDetails({ scenario }: { scenario: Scenario }) {
  const { updateScenario, doc } = useStore();
  const nodeCount = scenario.nodeIds.length;
  const edgeCount = scenario.edgeIds.length;
  const knownNodes = doc.nodes.filter((n) => scenario.nodeIds.includes(n.id));
  const knownEdges = doc.edges.filter((e) => scenario.edgeIds.includes(e.id));

  return (
    <div className="ps-details">
      <h3>Scenario</h3>
      <label>
        Name
        <input
          type="text"
          value={scenario.name}
          onChange={(e) => updateScenario(scenario.id, { name: e.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          value={scenario.description}
          onChange={(e) =>
            updateScenario(scenario.id, { description: e.target.value })
          }
          placeholder="What does this scenario cover?"
          rows={5}
        />
      </label>
      <div className="ps-scenario-summary">
        <div>
          <strong>{knownNodes.length}</strong> / {nodeCount} nodes
        </div>
        <div>
          <strong>{knownEdges.length}</strong> / {edgeCount} edges
        </div>
      </div>
    </div>
  );
}
