import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";

const { resolveLibraries } = await import("../../src/libraries/registry.ts");
const { validateAiDesignGuidance } = await import("../../shared/aiDesignGuidance.ts");
const raw = JSON.parse(readFileSync(new URL("../../src/data/genericNodeTypes.json", import.meta.url), "utf8"));
const core = resolveLibraries([]);
const byId = new Map(core.nodes.map(type => [type.id, type]));

const roles = {
  "Generic / Process": "Process",
  "Generic / Client and device": "ExternalInteractor",
  "Generic / Networking": "Process",
  "Generic / Storage": "DataStore",
};

test("generic catalog: 29 vendor-neutral process, networking and storage types ship in core", () => {
  assert.equal(raw.length, 29);
  assert.equal(new Set(raw.map(entry => entry.id)).size, 29);
  const counts = {};
  for (const entry of raw) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  assert.deepEqual(counts, { "Generic / Process": 6, "Generic / Client and device": 3, "Generic / Networking": 10, "Generic / Storage": 10 });
  for (const entry of raw) {
    assert.match(entry.id, /^generic\.(compute|client|device|network|storage)\.[a-z0-9-]+$/);
    assert.equal(entry.catalogSource, "Generic");
    const type = byId.get(entry.id);
    assert.ok(type, `${entry.id} is offered by core`);
    assert.equal(type.label, entry.label);
    assert.equal(type.definition.defaultDfdRole, roles[entry.category], entry.id);
    assert.equal(type.definition.policyStatus, "Unspecified");
    assert.equal(type.definition.serviceTreeId, "");
    assert.equal(type.definition.endpointRegex, "^$");
    assert.deepEqual(type.definition.allowedAuthMethods, []);
    assert.deepEqual(type.definition.allowedDataTypes, []);
    assert.match(entry.icon, /^neutral\/[a-z0-9-]+\.svg$/);
    assert.ok(existsSync(new URL(`../../src/assets/node-icons/${entry.icon}`, import.meta.url)), entry.icon);
  }
});

test("generic catalog: every type carries validated, sourced and structured AI design guidance", () => {
  for (const entry of raw) {
    const guidance = byId.get(entry.id).definition.aiDesignGuidance;
    assert.deepEqual(validateAiDesignGuidance(guidance), guidance, entry.id);
    assert.ok(guidance.content.length <= 2400, entry.id);
    for (const heading of ["Context", "Modeling", "Dependencies", "Risks", "Controls to verify", "Uncertainty"]) {
      assert.ok(guidance.content.includes(`${heading}\n`), `${entry.id} has ${heading}`);
    }
    assert.ok(guidance.sources.length >= 2, `${entry.id} cites at least two sources`);
    for (const source of guidance.sources) assert.equal(new URL(source).protocol, "https:", `${entry.id}: ${source}`);
    assert.doesNotMatch(guidance.content, /\b(Azure|AWS|Amazon|Google Cloud|GCP)\b/, `${entry.id} stays vendor-neutral`);
  }
});
