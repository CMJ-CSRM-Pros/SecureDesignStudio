import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { scenarioDfdJsonFixture } from "../browser/fixture.mjs";

const { importTmcExport, TmcImportError, chooseHandles, splitMultiNumberedLabel } = await import("../../src/tmcImport.ts");

test("scenario/DFD JSON: preserves GUID joins, nested positions, identities, directions and split numbering", () => {
  const input = scenarioDfdJsonFixture(), before = structuredClone(input);
  const { doc, activeScenarioId, summary } = importTmcExport(input);
  assert.deepEqual(input, before);
  assert.deepEqual(summary, {
    scenarioCount: 3, uniqueNodeCount: 4, rawNodeInstanceCount: 5,
    boundaryCount: 2, edgeCount: 4, splitEdgeCount: 1, skippedFreetextCount: 1,
    skippedUnresolvedEdgeCount: 2, diagramsWithoutScenarioCount: 1, scenariosWithoutDiagramCount: 1,
  });
  assert.deepEqual(doc.scenarios.map(s => s.name), ["JSON primary", "JSON archive", "JSON empty"]);
  assert.equal(activeScenarioId, doc.scenarios[0].id);
  const client = doc.nodes.find(n => n.title === "Client");
  const api = doc.nodes.find(n => n.title === "API" && n.position.x === 320);
  const archive = doc.nodes.find(n => n.title === "Archive");
  assert.deepEqual(client.position, { x: 130, y: 120 });
  assert.deepEqual(api.position, { x: 320, y: 150 });
  assert.equal(new Set(doc.nodes.filter(n => n.title === "API").map(n => n.id)).size, 2);
  assert.deepEqual(doc.boundaries.find(b => b.title === "Inner").position, { x: 300, y: 120 });
  assert.deepEqual(new Set(doc.boundaries.find(b => b.title === "Outer").nodeIds), new Set([client.id, api.id]));
  assert.deepEqual(doc.boundaries.find(b => b.title === "Inner").nodeIds, [api.id]);
  assert.ok(doc.boundaries.every(b => b.type === "security"));
  const primary = doc.scenarios[0], secondary = doc.scenarios[1], empty = doc.scenarios[2];
  const primaryEdges = primary.edgeIds.map(id => doc.edges.find(edge => edge.id === id));
  assert.deepEqual(primaryEdges.map(e => e.title), ["Reply", "Send", "Follow-up"]);
  assert.deepEqual(primaryEdges.map(e => [e.source, e.target]), [
    [api.id, client.id], [client.id, api.id], [client.id, api.id],
  ]);
  assert.equal(primaryEdges[1].description, "Opaque detail");
  assert.deepEqual(Object.values(primary.edgeNumbers), [1, 2, 3]);
  assert.deepEqual(new Set(secondary.nodeIds), new Set([api.id, archive.id]));
  assert.deepEqual([empty.nodeIds, empty.edgeIds, empty.boundaryIds], [[], [], []]);
  assert.ok(doc.nodes.every(n => n.type === "" && n.serviceTreeId === ""));
  assert.ok(doc.edges.every(e => e.authenticationTypes === undefined && e.waypoints.length === 1));
  assert.deepEqual(doc.data, []);
  assert.deepEqual(importTmcExport(input), { doc, activeScenarioId, summary });
  const relabeled = structuredClone(input);
  for (const entry of relabeled.dfds.items) {
    for (const edge of entry.diagram.edges) edge.label = edge.label.replace("Opaque detail", "Edited detail");
  }
  assert.deepEqual(importTmcExport(relabeled).doc.edges.map(e => e.id), doc.edges.map(e => e.id));
});

test("scenario/DFD JSON: rejected envelopes report precise schema errors without accepting native or inventory JSON", () => {
  const empty = { scenarios: { threatModel: { scenarios: [] } }, dfds: { items: [] } };
  for (const [value, message] of [
    [null, /must be an object/],
    [42, /must be an object/],
    [[], /top-level "scenarios"/],
    [{ format: "secure-design-studio-diagram", version: 2, doc: {} }, /Use File > Open/],
    [{ data: [] }, /top-level "scenarios"/],
    [{ scenarios: {} }, /scenarios\.threatModel/],
    [{ scenarios: { threatModel: { scenarios: {} } } }, /scenarios\.threatModel\.scenarios.*array/],
    [{ scenarios: empty.scenarios }, /top-level "dfds"/],
    [{ scenarios: empty.scenarios, dfds: { items: {} } }, /dfds\.items.*array/],
    [empty, /no scenarios and no diagrams/],
  ]) {
    assert.throws(() => importTmcExport(value), error => error instanceof TmcImportError
      && message.test(error.message) && !/TMC export/.test(error.message));
  }
});

test("scenario/DFD JSON: shared TM7 handle selection and split helpers retain their contracts", () => {
  assert.deepEqual(splitMultiNumberedLabel("2. Send\r\nDetail\r\n4a. Follow-up"), ["2. Send\nDetail", "4a. Follow-up"]);
  assert.deepEqual(splitMultiNumberedLabel("Plain\nContinuation"), ["Plain\nContinuation"]);
  for (const [target, expected] of [
    [{ x: 100, y: 0 }, ["right", "left"]],
    [{ x: -100, y: 0 }, ["left", "right"]],
    [{ x: 0, y: 100 }, ["bottom", "top"]],
    [{ x: 0, y: -100 }, ["top", "bottom"]],
  ]) {
    assert.deepEqual(Object.values(chooseHandles({ x: 0, y: 0 }, target)), expected);
  }
});
