import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as Y from "yjs";
import { documentFixture, IDS } from "./catalog-fixtures.mjs";

const { resolveLibraries, CORE_LIBRARIES } = await import("../../src/libraries/registry.ts");
const { validateLibraryPackage, normalizeEntityMetadata } = await import("../../src/libraries/validation.ts");
const { withLibraryDefinitions, libraryNodeTypes } = await import("../../src/libraries/document.ts");
const { bootstrapLibraries } = await import("../../src/libraries/bootstrap.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { diffDocuments } = await import("../../src/diff.ts");
const { loadClassificationLibrary, persistClassificationLibrary } = await import("../../src/classificationLibrary.ts");
const { readLibraryCandidates, libraryBuildBridge } = await import("../../scripts/custom-libraries.mjs");
const example = JSON.parse(await readFile(new URL("../../examples/custom-libraries/example/library.json", import.meta.url), "utf8"));
const candidate = (value = example, source = "Synthetic package") => ({ source, value: structuredClone(value) });

test("libraries: empty configuration preserves public catalogs and fourteen core finding kinds", () => {
  assert.deepEqual(resolveLibraries(), CORE_LIBRARIES);
  assert.equal(CORE_LIBRARIES.coreRuleIds.length, 14);
  assert.ok(CORE_LIBRARIES.coreRuleIds.includes("Edge_missing_application_id"));
  assert.ok(CORE_LIBRARIES.coreRuleIds.includes("Edge_protocol_guidance_missing"));
  assert.equal(CORE_LIBRARIES.coreRuleIds.includes("Node_must_have_servicetree"), false);
  assert.equal(CORE_LIBRARIES.authentication.length, 14);
  assert.equal(CORE_LIBRARIES.classifications.defaultId, "EUII");
  assert.equal(CORE_LIBRARIES.statuses.length, 0);
  assert.ok(Object.isFrozen(CORE_LIBRARIES.fields));
});

test("libraries: all contribution categories activate atomically with immutable provenance", () => {
  const registry = resolveLibraries([candidate()]);
  assert.equal(registry.statuses[0].state, "loaded");
  assert.equal(registry.classifications.defaultId, "ExamplePublic");
  assert.ok(registry.authentication.some(def => def.id === "ExampleProof"));
  assert.ok(registry.nodes.some(def => def.id === "ExampleService"));
  assert.equal(registry.fields.length, 4);
  assert.equal(registry.rules.length, 2);
  assert.equal(registry.help.length, 3);
  assert.equal(registry.provenance["classifications/default"], "example");
  assert.ok(Object.isFrozen(registry.nodes.find(def => def.id === "ExampleService").definition));
});

test("libraries: invalid category, executable payload, reserved identity and incompatible API reject the entire package", () => {
  for (const change of [
    pkg => { pkg.apiVersion = 2; },
    pkg => { pkg.id = "CORE"; },
    pkg => { pkg.script = "alert(1)"; },
    pkg => { pkg.rules[0].check = "eval"; },
    pkg => { pkg.fields[0].storage = "title"; },
    pkg => { pkg.catalogs.authentication[0].aliases = ["Hijack"]; },
    pkg => { pkg.catalogs.nodes[0].definition.allowedDataTypes = []; },
    pkg => { pkg.catalogs.nodes[0].definition.documentationUrl = "javascript:alert(1)"; },
    pkg => { pkg.help[0].url = "https://user:secret@example.invalid"; },
  ]) {
    const input = candidate();
    change(input.value);
    const registry = resolveLibraries([input]);
    assert.equal(registry.statuses[0].state, "rejected");
    assert.deepEqual(registry.authentication, CORE_LIBRARIES.authentication);
    assert.equal(registry.fields.length, CORE_LIBRARIES.fields.length);
  }
});

test("libraries: missing files are visible and size limits fail closed", () => {
  assert.equal(resolveLibraries([{ source: "Missing", error: "Not installed." }]).statuses[0].state, "unavailable");
  const large = candidate();
  large.value.help[0].text = "x".repeat(1_048_577);
  assert.equal(resolveLibraries([large]).statuses[0].state, "rejected");
  assert.equal(resolveLibraries(Array.from({ length: 17 }, () => candidate())).statuses[0].state, "rejected");
});

test("libraries: duplicate identities and unordered collisions reject every contender independent of order", () => {
  const a = candidate();
  const b = candidate();
  assert.ok(resolveLibraries([a, b]).statuses.every(status => status.state === "rejected"));
  b.value.id = "another";
  for (const order of [[a, b], [b, a]]) {
    assert.ok(resolveLibraries(order).statuses.every(status => status.state === "rejected"));
  }
});

test("libraries: exact dependencies and explicit overlays resolve deterministically", () => {
  const a = { ...structuredClone(example), catalogs: {}, fields: [], rules: [], overrides: [] };
  const b = {
    ...structuredClone(a), id: "extension", name: "Extension",
    dependencies: [{ id: "example", version: "1.0.0" }],
    overrides: [
      { key: "help/endpoint-import.instructions", from: "example" },
      { key: "help/endpoint-import.example", from: "example" },
      { key: "help/analysis.deprecated-auth-guidance", from: "example" },
    ],
  };
  b.help[0].text = "Overlay guidance.";
  for (const order of [[a, b], [b, a]]) {
    const result = resolveLibraries(order.map(value => candidate(value)));
    assert.ok(result.statuses.every(status => status.state === "loaded"));
    assert.equal(result.help[0].text, "Overlay guidance.");
  }
  const c = { ...structuredClone(b), id: "final",
    dependencies: [{ id: b.id, version: b.version }],
    overrides: [
      { key: "help/endpoint-import.instructions", from: b.id },
      { key: "help/endpoint-import.example", from: b.id },
      { key: "help/analysis.deprecated-auth-guidance", from: b.id },
    ] };
  c.help[0].text = "Final overlay.";
  const chained = resolveLibraries([candidate(c), candidate(a), candidate(b)]);
  assert.ok(chained.statuses.every(status => status.state === "loaded"));
  assert.equal(chained.help[0].text, "Final overlay.");
  b.dependencies[0].version = "2.0.0";
  assert.equal(resolveLibraries([candidate(b)]).statuses[0].state, "rejected");
  a.dependencies = [{ id: "extension", version: "1.0.0" }];
  b.dependencies[0].version = "1.0.0";
  assert.ok(resolveLibraries([candidate(a), candidate(b)]).statuses.every(status => status.state === "rejected"));
});

test("libraries: undeclared core overrides, unavailable rule fields and changed built-in authentication behavior are rejected", () => {
  for (const change of [
    pkg => { pkg.overrides = []; },
    pkg => { pkg.rules[0].fieldId = "missing"; },
    pkg => {
      pkg.catalogs.authentication = [{
        ...CORE_LIBRARIES.authentication[0],
        behavior: { ...CORE_LIBRARIES.authentication[0].behavior, audience: false },
      }];
    },
  ]) {
    const input = candidate(); change(input.value);
    assert.equal(resolveLibraries([input]).statuses[0].state, "rejected");
  }
});

test("libraries: selected directory reads do not auto-discover optional content or expose filesystem paths", async () => {
  assert.deepEqual(await readLibraryCandidates(undefined, process.cwd()), []);
  const missing = await readLibraryCandidates(JSON.stringify(["missing-example-library"]), process.cwd());
  assert.equal(missing[0].source, "Configured library 1");
  assert.ok(missing[0].error);
  const loaded = await readLibraryCandidates(JSON.stringify(["examples\\custom-libraries\\example"]), process.cwd());
  assert.equal(loaded[0].value.id, "example");
  const hosted = libraryBuildBridge(loaded, false);
  assert.equal(hosted.delivery.mode, "same-origin");
  assert.match(hosted.delivery.manifest, /^\.\/assets\/custom-libraries\.[a-f0-9]{16}\.json$/);
  assert.equal(libraryBuildBridge(loaded, true).delivery.mode, "embedded");
  assert.equal(libraryBuildBridge([], false).delivery.mode, "embedded");
});

test("libraries: startup rejects HTML fallback, cross-origin, timeout and corrupt manifests without blocking core", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response("not json", { headers: { "content-type": "text/html" } }); };
  const delivery = { mode: "same-origin", manifest: "./assets/libraries.json" };
  for (const [local, base] of [[true, "http://localhost:5173/"], [false, "file:///C:/test.html"]]) {
    assert.equal((await bootstrapLibraries(delivery, local, base, fetcher)).statuses[0].state, "unavailable");
  }
  assert.equal(calls, 0);
  assert.equal((await bootstrapLibraries({ ...delivery, manifest: "https://elsewhere.invalid/a.json" }, false, "https://example.invalid/", fetcher)).statuses[0].state, "unavailable");
  assert.equal(calls, 0);
  assert.equal((await bootstrapLibraries(delivery, false, "https://example.invalid/", fetcher)).statuses[0].state, "unavailable");
  const timeout = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.match((await bootstrapLibraries(delivery, false, "https://example.invalid/", timeout, 5)).statuses[0].message, /timed out/);
  const loaded = await bootstrapLibraries(delivery, false, "https://example.invalid/", async () =>
    new Response(JSON.stringify([candidate()]), { headers: { "content-type": "application/json" } }));
  assert.equal(loaded.statuses[0].state, "loaded");
});

test("libraries: referenced snapshots persist, unused packages are not copied, and saved definitions win", () => {
  const registry = resolveLibraries([candidate()]);
  const empty = documentFixture();
  assert.equal(withLibraryDefinitions(empty, registry).nodeTypes.some(type => type.id === "ExampleService"), false);
  assert.ok(libraryNodeTypes(empty, registry).some(type => type.id === "ExampleService"));
  empty.nodes[0].type = "ExampleService";
  empty.nodes[0].metadata = { "example.owner": "not-a-guid" };
  empty.edges[0].authenticationTypes = ["ExampleProof"];
  const captured = withLibraryDefinitions(empty, registry);
  assert.ok(captured.nodeTypes.find(type => type.id === "ExampleService").definition);
  assert.equal(captured.nodes[0].metadataFields[0].label, "Example owner ID");
  assert.equal(captured.authenticationDefinitions[0].id, "ExampleProof");
  const reopened = normalizeDoc(JSON.parse(JSON.stringify(captured)));
  assert.deepEqual(reopened.nodes[0].metadata, captured.nodes[0].metadata);
  assert.deepEqual(reopened.nodes[0].metadataFields, captured.nodes[0].metadataFields);
  const saved = structuredClone(reopened);
  saved.nodeTypes.find(type => type.id === "ExampleService").definition.description = "Saved contract wins.";
  assert.equal(withLibraryDefinitions(saved, registry).nodeTypes.find(type => type.id === "ExampleService").definition.description, "Saved contract wins.");
});

test("libraries: declarative rules preserve history/status across package removal and restoration", () => {
  const registry = resolveLibraries([candidate()]);
  const doc = documentFixture();
  const run = doc => new IssueManager(undefined, undefined, registry.rules, registry.fields).analyze(doc);
  const first = run(doc);
  const issue = first.issues.find(issue => issue.kind === "Example_owner_required" && issue.targetId === IDS.source);
  assert.ok(issue);
  issue.status = "Resolved";
  issue.replies.push({ id: "ir_test", text: "Review decision", createdAt: 1 });
  const absent = new IssueManager().analyze(structuredClone(first));
  assert.equal(absent.issues.find(item => item.id === issue.id).notEvaluatedReason, "rule-unavailable");
  absent.nodes[0].metadata = { "example.owner": "11111111-1111-4111-8111-111111111111" };
  assert.equal(run(absent).issues.some(item => item.id === issue.id), false);
  const retained = run(first).issues.find(item => item.id === issue.id);
  assert.equal(retained.status, "Resolved");
  assert.deepEqual(retained.replies, issue.replies);
});

test("libraries: metadata is bounded and portable through peer edits without shipping executable rules", () => {
  assert.throws(() => normalizeEntityMetadata({ metadata: { x: 1 } }, "node"));
  assert.throws(() => normalizeEntityMetadata({ metadata: JSON.parse('{"__proto__":"bad"}') }, "node"));
  const registry = resolveLibraries([candidate()]);
  const doc = documentFixture();
  doc.nodes[0].metadata = { "example.owner": "old" };
  const captured = withLibraryDefinitions(doc, registry);
  const left = createYShape(); const right = createYShape();
  try {
    reconcileLocalToY(left, captured);
    Y.applyUpdate(right.ydoc, Y.encodeStateAsUpdate(left.ydoc));
    const remote = buildDocFromY(right);
    assert.deepEqual(remote.nodes[0].metadataFields, captured.nodes[0].metadataFields);
    assert.equal("rules" in remote, false);
    remote.nodes[0].metadata["example.owner"] = "new";
    assert.ok(diffDocuments(captured, remote).some(change => /custom metadata/.test(change.description)));
  } finally { left.ydoc.destroy(); right.ydoc.destroy(); }
});

test("libraries: profile classification preferences win over package defaults with stale-write protection", () => {
  const registry = resolveLibraries([candidate()]);
  let raw = null;
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value; } };
  assert.equal(loadClassificationLibrary(storage, registry.classifications).library.defaultId, "ExamplePublic");
  persistClassificationLibrary(CORE_LIBRARIES.classifications, registry.classifications, storage, registry.classifications);
  assert.equal(loadClassificationLibrary(storage, registry.classifications).library.defaultId, "EUII");
  assert.throws(() => persistClassificationLibrary(registry.classifications, registry.classifications, storage, registry.classifications), /changed in another tab/);
});
