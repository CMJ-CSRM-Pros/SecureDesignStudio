// A crafted file or collaboration peer can put any JSON value in a field the
// UI renders as text. normalizeDoc must hand React only strings and finite
// coordinates, or one model can crash the whole app (audit S4).
import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { documentFixture } from "./catalog-fixtures.mjs";

const { normalizeDoc } = await import("../../src/store.tsx");

const hostile = [{ x: 1 }, ["array"], 42, true];

test("regression: normalizeDoc coerces non-string text fields and non-finite positions", () => {
  for (const value of hostile) {
    const doc = documentFixture();
    for (const node of doc.nodes) Object.assign(node, {
      title: value, description: value, type: value, serviceTreeId: value, endpointRegex: value,
      position: { x: value, y: Number.NaN },
    });
    Object.assign(doc.edges[0], { title: value, description: value, audience: value, constraints: value,
      sourceHandle: value, targetHandle: value, waypoints: [{ id: "w1", x: value, y: Number.NaN }] });
    doc.boundaries = [{ id: "b1", type: "security", title: value, position: { x: "1", y: Infinity },
      size: { width: value, height: Number.NaN } }];
    Object.assign(doc.scenarios[0], { name: value, description: value, edgeNumbers: { [doc.edges[0].id]: value } });
    doc.data = [{ id: "d1", name: value, classification: "EUII", sample: "" }];
    doc.comments = [{ id: "c1", scenarioId: doc.scenarios[0].id, targetKind: "node", targetId: doc.nodes[0].id,
      text: "", createdAt: Infinity, replies: [{ id: "r1", text: "", createdAt: Number.NaN }] }];
    doc.issues = [{ id: "i1", targetKind: "node", targetId: doc.nodes[0].id, scenarioIds: [], title: "",
      description: "", createdAt: -Infinity, replies: [] }];
    doc.deviations = [{ id: "v1", title: "t", explanation: "e", createdAt: Infinity, updatedAt: Number.NaN }];
    const normalized = normalizeDoc(doc);
    for (const node of normalized.nodes) {
      for (const key of ["title", "description", "type", "serviceTreeId", "endpointRegex"]) {
        assert.equal(typeof node[key], "string", `node.${key} from ${JSON.stringify(value)}`);
      }
      assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y), "node position");
    }
    const finite = (n) => typeof n === "number" && Number.isFinite(n);
    for (const edge of normalized.edges) {
      assert.equal(typeof edge.title, "string"); assert.equal(typeof edge.description, "string");
      for (const key of ["audience", "constraints", "sourceHandle", "targetHandle"]) {
        assert.ok(edge[key] === undefined || typeof edge[key] === "string", `edge.${key} from ${JSON.stringify(value)}`);
      }
      for (const w of edge.waypoints) assert.ok(finite(w.x) && finite(w.y), "edge waypoint");
    }
    for (const boundary of normalized.boundaries) {
      assert.equal(typeof boundary.title, "string");
      assert.ok(Number.isFinite(boundary.position.x) && Number.isFinite(boundary.position.y), "boundary position");
      assert.ok(finite(boundary.size.width) && finite(boundary.size.height), "boundary size");
    }
    const scenario = normalized.scenarios[0];
    assert.equal(typeof scenario.name, "string", `scenario.name from ${JSON.stringify(value)}`);
    assert.equal(typeof scenario.description, "string");
    for (const n of Object.values(scenario.edgeNumbers)) assert.ok(finite(n), `edgeNumbers from ${JSON.stringify(value)}`);
    assert.equal(typeof normalized.data[0].name, "string", `data.name from ${JSON.stringify(value)}`);
    const comment = normalized.comments[0];
    assert.ok(finite(comment.createdAt) && finite(comment.replies[0].createdAt), "comment timestamps");
    assert.ok(finite(normalized.issues[0].createdAt), "issue timestamp");
    assert.ok(finite(normalized.deviations[0].createdAt) && finite(normalized.deviations[0].updatedAt), "deviation timestamps");
  }
  // Valid values survive unchanged.
  const ok = documentFixture();
  ok.nodes[0].title = "Checkout"; ok.nodes[0].position = { x: 12.5, y: -4 };
  Object.assign(ok.edges[0], { audience: "api://x", constraints: "c", sourceHandle: "right", targetHandle: "left",
    waypoints: [{ id: "w1", x: 3.5, y: -2 }] });
  ok.boundaries = [{ id: "b1", type: "security", title: "Zone", position: { x: 0, y: 0 }, size: { width: 900, height: 700 }, nodeIds: [] }];
  ok.data = [{ id: "d1", name: "Telemetry", classification: "EUII", sample: "" }];
  ok.comments = [{ id: "c1", scenarioId: ok.scenarios[0].id, targetKind: "node", targetId: ok.nodes[0].id,
    text: "hi", createdAt: 1700000000000, replies: [{ id: "r1", text: "re", createdAt: 1700000000001 }] }];
  ok.deviations = [{ id: "v1", title: "t", explanation: "e", createdAt: 1700000000002, updatedAt: 1700000000003 }];
  const keptDoc = normalizeDoc(ok);
  const kept = keptDoc.nodes[0];
  assert.equal(kept.title, "Checkout"); assert.deepEqual(kept.position, { x: 12.5, y: -4 });
  const keptEdge = keptDoc.edges[0];
  assert.deepEqual([keptEdge.audience, keptEdge.constraints, keptEdge.sourceHandle, keptEdge.targetHandle],
    ["api://x", "c", "right", "left"]);
  assert.deepEqual(keptEdge.waypoints, [{ id: "w1", x: 3.5, y: -2 }]);
  assert.deepEqual(keptDoc.boundaries[0].size, { width: 900, height: 700 });
  assert.equal(keptDoc.scenarios[0].name, "Authentication review");
  assert.deepEqual(keptDoc.scenarios[0].edgeNumbers, { [ok.edges[0].id]: 7 });
  assert.equal(keptDoc.data[0].name, "Telemetry");
  assert.equal(keptDoc.comments[0].createdAt, 1700000000000);
  assert.equal(keptDoc.comments[0].replies[0].createdAt, 1700000000001);
  assert.equal(keptDoc.deviations[0].createdAt, 1700000000002);
  assert.equal(keptDoc.deviations[0].updatedAt, 1700000000003);
});
