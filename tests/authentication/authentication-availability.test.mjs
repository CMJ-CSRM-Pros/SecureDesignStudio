import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { IDS, withFlow, historicalAuthenticationDefinitions } from "./catalog-fixtures.mjs";

const auth = await import("../../src/authentication.ts");
const types = await import("../../src/types.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");

const packageIds = [
  "EntraApplicationOnlyWithForwardedUserContext", "EntraApplicationOnlyWithCdt",
  "ProtectedForwardedAccessToken", "PopWithProtectedForwardedToken",
];
const installed = [...auth.AUTH_TYPE_DEFS, ...historicalAuthenticationDefinitions()];
const withoutPackage = installed.filter(def => !packageIds.includes(def.id));
const method = id => structuredClone(installed.find(def => def.id === id));
const analyze = (doc, definitions) => new IssueManager(undefined, undefined, [], [], definitions).analyze(doc);

test("availability: core defaults exclude package methods and tenant choices", () => {
  assert.equal(auth.AUTH_TYPE_DEFS.length, 14);
  assert.equal(installed.length, 18);
  assert.deepEqual(types.PRODUCTION_IDENTITY_TENANT_DEFS.map(def => def.id), ["Customer", "Other"]);
  assert.ok(packageIds.every(auth.isPackageAuthenticationId));
  assert.equal(auth.isPackageAuthenticationId("InternalProcessCall"), false);
});

for (const id of packageIds) {
  test(`availability foundation: ${id} retains snapshots without becoming available from cached preferences`, () => {
    const doc = withFlow([id], {
      productionIdentity: { kind: "AppId", appId: IDS.app, tenant: "ME" },
      audience: "saved audience", constraints: "saved constraints",
    });
    const saved = method(id);
    doc.authenticationDefinitions = [saved];
    const current = normalizeDoc(doc);
    const before = structuredClone(current);
    const resolved = auth.authenticationCatalogFor(current, installed, withoutPackage);
    const entry = resolved.find(def => def.id === id);
    assert.equal(entry.label, saved.label);
    assert.match(entry.unavailableReason, /library is unavailable/);
    assert.deepEqual(auth.authBehavior(id, resolved), auth.UNKNOWN_AUTH_BEHAVIOR);
    assert.deepEqual(auth.withAuthenticationDefinitions(current, resolved).authenticationDefinitions, [saved]);
    assert.deepEqual(current, before);
    assert.equal(JSON.stringify(current).includes("unavailableReason"), false);
    assert.throws(() => auth.exportAuthenticationCatalog(resolved), /runtime availability/);
    assert.ok(auth.exportAuthenticationCatalog([saved]).includes(saved.id), "Stored definitions remain exportable as data");
    const restored = auth.authenticationCatalogFor(current, installed, installed);
    assert.equal(restored.find(def => def.id === id).unavailableReason, undefined);
    assert.deepEqual(auth.authBehavior(id, restored), saved.behavior);
  });
}

test("availability foundation: portable conflicting behavior is retained but cannot clear identity findings", () => {
  const id = "EntraApplicationOnlyWithCdt";
  const canonical = method(id);
  const changed = { ...canonical, behavior: { ...canonical.behavior, productionIdentity: "optional", audience: false, constraints: false } };
  assert.throws(() => auth.validateAuthenticationDefinitions([changed], installed), /protected/);
  assert.deepEqual(auth.validatePortableAuthenticationDefinitions([changed]), [changed]);
  assert.throws(() => auth.assertInstalledAuthenticationContracts([changed], installed), /protected/);
  const doc = normalizeDoc({ ...withFlow([id]), authenticationDefinitions: [changed] });
  assert.match(auth.authenticationWarnings({ ...doc, edges: [] }, installed, installed).join(" "), /differs from the installed contract/,
    "An unreferenced conflicting snapshot must remain reachable for explicit repair");
  doc.issues = [{
    id: "i_retained", kind: "Edge_missing_production_identity", targetKind: "edge", targetId: IDS.edge,
    scenarioIds: [], title: "Original finding", description: "Original evidence", status: "Resolved",
    createdAt: 10, replies: [{ id: "ir_saved", text: "Human review", createdAt: 20 }],
  }];
  const result = analyze(doc, installed);
  assert.deepEqual(result.issues.find(issue => issue.id === "i_retained"),
    { ...doc.issues[0], notEvaluatedReason: "rule-retired" });
  assert.deepEqual(result.authenticationDefinitions, [changed]);
  const unavailable = analyze({ ...doc, authenticationDefinitions: [canonical] }, withoutPackage);
  assert.equal(unavailable.issues.find(issue => issue.id === "i_retained").notEvaluatedReason, "rule-retired");
  const restored = analyze({ ...doc, authenticationDefinitions: [canonical] }, installed);
  assert.equal(restored.issues.find(issue => issue.id === "i_retained").notEvaluatedReason, "rule-retired");
  assert.equal(restored.issues.find(issue => issue.id === "i_retained").status, "Resolved");
});

test("availability foundation: identity aliases remain protected and portable data cannot supply authority", () => {
  for (const id of packageIds) {
    const entry = method(id);
    for (const name of [entry.label, ...entry.aliases]) {
      assert.equal(auth.normalizeAuthenticationValue(name, withoutPackage), id);
    }
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, id: entry.id.toLowerCase() }]), /protected/);
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, aliases: ["Unrelated takeover"] }]), /protected/);
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, legacy: true }]), /protected/);
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, unavailableReason: "trusted" }]), /unsupported field/);
  }
  const unresolved = auth.authenticationCatalogFor(withFlow(["ProtectedForwardedAccessToken"]), withoutPackage, withoutPackage)
    .find(def => def.id === "ProtectedForwardedAccessToken");
  assert.equal(unresolved.unresolved, true);
});

test("availability foundation: profile load is read-only and unavailable values remain in coherent stale-checked history", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let writes = 0;
  let raw = auth.exportAuthenticationCatalog(installed);
  const storage = { getItem: () => raw, setItem: (_key, value) => { writes++; raw = value; } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  try {
    const loaded = auth.loadAuthenticationLibrary(withoutPackage);
    assert.equal(loaded.error, null);
    assert.equal(loaded.methods.length, 18);
    assert.equal(writes, 0);
    const disabled = loaded.methods.map(def => def.id === packageIds[0] ? { ...def, disabled: true } : def);
    auth.persistAuthenticationLibrary(disabled, loaded.methods, withoutPackage);
    auth.persistAuthenticationLibrary(loaded.methods, disabled, withoutPackage);
    assert.deepEqual(auth.loadAuthenticationLibrary(withoutPackage).methods, loaded.methods);
    assert.throws(() => auth.persistAuthenticationLibrary(disabled, disabled, withoutPackage), /another tab/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});

test("availability foundation: tenant authoring choices are installed-only while saved labels and values survive", () => {
  const saved = [{ kind: "tenant", id: "ME", label: "Saved tenant label" }];
  const available = [
    { kind: "tenant", id: "Customer", label: "Customer" },
    { kind: "tenant", id: "Other", label: "Other" },
  ];
  assert.deepEqual(types.productionIdentityTenantChoices(saved, available).map(def => def.id), ["Customer", "Other"]);
  const pi = { kind: "AppId", appId: IDS.app, tenant: "ME" };
  const doc = normalizeDoc({ ...withFlow(["ApiKey"], { productionIdentity: pi }), catalogDefinitions: saved });
  assert.deepEqual(doc.edges[0].productionIdentity, pi);
  assert.match(types.formatProductionIdentity(pi, saved), /Saved tenant label/);
});

test("availability foundation: portable private snapshots converge through Yjs without serializing installation state", () => {
  const doc = withFlow([packageIds[2]]);
  doc.authenticationDefinitions = [method(packageIds[2])];
  const a = createYShape(), b = createYShape();
  try {
    reconcileLocalToY(a, normalizeDoc(doc));
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const remote = buildDocFromY(b);
    assert.deepEqual(remote.authenticationDefinitions, doc.authenticationDefinitions);
    assert.ok(auth.authenticationCatalogFor(remote, installed, withoutPackage).find(def => def.id === packageIds[2]).unavailableReason);
    assert.equal(JSON.stringify(remote).includes("unavailableReason"), false);
    let echoes = 0;
    b.ydoc.on("update", () => echoes++);
    reconcileLocalToY(b, remote);
    assert.equal(echoes, 0);
  } finally { a.ydoc.destroy(); b.ydoc.destroy(); }
});
