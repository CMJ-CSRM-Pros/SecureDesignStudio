import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { resolveLibraries } = await import("../../src/libraries/registry.ts");
const { endpointImportHelp } = await import("../../src/libraries/endpointHelp.ts");
const pkg = (overrides = {}) => ({
  format: "secure-design-studio-library", apiVersion: 1,
  id: "synthetic", name: "Synthetic guidance", version: "1.0.0",
  help: [
    { id: "endpoint-import.instructions", title: "Preparation", text: "Prepare a text file." },
    { id: "endpoint-import.example", title: "Sample", text: "https://example.invalid/first\nhttps://example.invalid/second" },
  ],
  ...overrides,
});
const resolve = value => resolveLibraries([{ source: "Synthetic selection", value }]);

test("endpoint help: unselected, missing and rejected packages supply no hidden default", () => {
  const empty = { instructions: undefined, example: undefined };
  assert.deepEqual(endpointImportHelp(resolveLibraries()), empty);
  assert.deepEqual(endpointImportHelp(resolveLibraries([{ source: "Absent", error: "Missing." }])), empty);
  assert.deepEqual(endpointImportHelp(resolve(pkg({ apiVersion: 9 }))), empty);
  assert.deepEqual(endpointImportHelp(resolve(pkg({ help: [{ id: "endpoint-import.example", title: "Bad", text: "Rejected.", url: "javascript:alert(1)" }] }))), empty);
});

test("endpoint help: exact text and loaded-package provenance are retained", () => {
  const input = pkg();
  const help = endpointImportHelp(resolve(input));
  assert.equal(help.example.text, input.help[1].text);
  assert.equal(help.instructions.text, input.help[0].text);
  assert.equal(help.example.source, "Synthetic guidance (synthetic @ 1.0.0)");
});

test("endpoint help: contributions are independently optional and arbitrary help IDs do not replace the importer", () => {
  const onlyExample = endpointImportHelp(resolve(pkg({ help: [pkg().help[1]] })));
  assert.equal(onlyExample.instructions, undefined);
  assert.ok(onlyExample.example);
  const unrelated = endpointImportHelp(resolve(pkg({ help: [{ id: "unrelated", title: "Other", text: "Not importer help." }] })));
  assert.equal(unrelated.example, undefined);
});

test("endpoint help: explicit overlays show the effective contributor, not the original owner", () => {
  const replacement = pkg({
    id: "replacement", name: "Replacement guidance",
    dependencies: [{ id: "synthetic", version: "1.0.0" }],
    overrides: [{ key: "help/endpoint-import.example", from: "synthetic" }],
    help: [{ id: "endpoint-import.example", title: "New example", text: "https://replacement.example.invalid" }],
  });
  const registry = resolveLibraries([{ source: "A", value: replacement }, { source: "B", value: pkg() }]);
  const help = endpointImportHelp(registry);
  assert.equal(help.example.source, "Replacement guidance (replacement @ 1.0.0)");
  assert.equal(help.instructions.source, "Synthetic guidance (synthetic @ 1.0.0)");
});
