import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { strFromU8, unzipSync } from "fflate";
import { catalogReferenceSnapshot, unavailableCatalogFixture } from "../browser/fixture.mjs";

const types = await import("../../src/types.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { diffDocuments } = await import("../../src/diff.ts");
const { createYShape, REMOTE_ORIGIN } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");
const { exportVsdx } = await import("../../src/vsdxExport.ts");
const { buildReviewReportHtml } = await import("../../src/reportExport.ts");

function assertReferences(actual, expected = unavailableCatalogFixture().doc) {
  assert.deepEqual(catalogReferenceSnapshot(actual), catalogReferenceSnapshot(expected));
}

test("catalog references: native normalization retains unavailable IDs and policy references", () => {
  const input = unavailableCatalogFixture();
  const before = structuredClone(input);
  const normalized = normalizeDoc(input.doc);
  assertReferences(normalized);
  const reopened = normalizeDoc(JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(reopened, normalized);
  assert.deepEqual(input, before, "Normalization does not modify caller input");
});

test("catalog references: malformed values retain conservative legacy fallbacks", () => {
  for (const value of [null, 4, {}, "", " padded ", "line\nbreak", "__proto__", "constructor", "*", "<script>", "x".repeat(129)]) {
    const input = unavailableCatalogFixture().doc;
    input.data[0].classification = value;
    input.edges[0].productionIdentity.tenant = value;
    input.boundaries[0].securitySubtype = value;
    input.boundaries[1].privacySubtype = value;
    input.deviations[0].kind = value;
    input.nodeTypes[0].definition.allowedDataTypes[0].id = value;
    input.nodeTypes[0].definition.defaultPrivacyBoundary = value;
    const normalized = normalizeDoc(input);
    assert.equal(normalized.data[0].classification, "EUII");
    assert.equal(normalized.edges[0].productionIdentity.tenant, "Other");
    assert.equal(normalized.boundaries[0].securitySubtype, undefined);
    assert.equal(normalized.boundaries[1].privacySubtype, undefined);
    assert.equal(normalized.deviations[0].kind, "other");
    assert.equal(normalized.nodeTypes[0].definition.defaultPrivacyBoundary, undefined);
    if (value !== "*") assert.equal(normalized.nodeTypes[0].definition.allowedDataTypes.length, 1);
  }
});

test("catalog references: unfamiliar identifiers are bounded opaque text, not executable metadata", () => {
  for (const value of ["ExampleRestricted", "example:classification/secret", "Donn\u00e9es priv\u00e9es", "new-evidence"]) {
    assert.equal(types.isCatalogReferenceId(value), true);
  }
  for (const value of ["toString", "__proto__", "prototype", "control\u007f", "field\u0000", "*"]) {
    assert.equal(types.isCatalogReferenceId(value), false);
  }
  assert.equal(types.dataClassificationLabel("ExampleRestricted"), "ExampleRestricted (unresolved)");
  assert.equal(types.productionIdentityTenantLabel("ExampleTenant"), "ExampleTenant (unresolved)");
  assert.equal(types.securityBoundaryTypeLabel("ExampleSecurity"), "ExampleSecurity (unresolved)");
  assert.equal(types.privacyBoundaryTypeLabel("ExamplePrivacy"), "ExamplePrivacy (unresolved)");
  assert.equal(types.deviationKindLabel("example-evidence"), "example-evidence (unresolved)");
  assert.equal(types.dataClassificationLabel("EUII"), "EUII");
  assert.equal(types.productionIdentityTenantLabel("ME"), "ME (unresolved)");
  assert.equal(types.productionIdentityTenantLabel("ME", [{ kind: "tenant", id: "ME", label: "*ME" }]), "*ME");
});

test("catalog references: peers without definitions preserve IDs on edits and reconnect", t => {
  const source = createYShape();
  const peer = createYShape();
  const reconnect = createYShape();
  t.after(() => [source, peer, reconnect].forEach(shape => shape.ydoc.destroy()));
  reconcileLocalToY(source, normalizeDoc(unavailableCatalogFixture().doc));
  Y.applyUpdate(peer.ydoc, Y.encodeStateAsUpdate(source.ydoc), REMOTE_ORIGIN);
  const received = buildDocFromY(peer);
  assertReferences(received);
  received.nodes[0].title = "Peer edit without definitions";
  reconcileLocalToY(peer, received);
  Y.applyUpdate(source.ydoc, Y.encodeStateAsUpdate(peer.ydoc, Y.encodeStateVector(source.ydoc)), REMOTE_ORIGIN);
  Y.applyUpdate(reconnect.ydoc, Y.encodeStateAsUpdate(source.ydoc), REMOTE_ORIGIN);
  assertReferences(buildDocFromY(reconnect));
  assert.equal(buildDocFromY(reconnect).nodes[0].title, "Peer edit without definitions");
});

test("catalog references: comparison and review exports retain unavailable classifications", () => {
  const previous = normalizeDoc(unavailableCatalogFixture().doc);
  const next = structuredClone(previous);
  next.data[0].classification = "AnotherRestricted";
  const changes = diffDocuments(previous, normalizeDoc(next));
  assert.ok(changes.some(change => /ExampleRestricted/.test(change.description) && /AnotherRestricted/.test(change.description)));
  const report = buildReviewReportHtml({
    doc: previous, scenario: previous.scenarios[0], documentFileName: "synthetic.tma", appVersion: "test",
  });
  assert.match(report, /ExampleRestricted \(unresolved\)/);
  const archive = unzipSync(exportVsdx(previous));
  const pageText = Object.entries(archive)
    .filter(([name]) => /^visio\/pages\/page\d+\.xml$/.test(name))
    .map(([, bytes]) => strFromU8(bytes)).join("\n");
  assert.match(pageText, /ExampleRestricted \(unresolved\)/);
});
