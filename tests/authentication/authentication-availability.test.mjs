import "./collaboration-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { IDS, withFlow, historicalAuthenticationDefinitions, PROMOTED_METHOD_IDS } from "./catalog-fixtures.mjs";

const auth = await import("../../src/authentication.ts");
const types = await import("../../src/types.ts");
const { normalizeDoc } = await import("../../src/store.tsx");
const { IssueManager } = await import("../../src/IssueManager.ts");
const { createYShape } = await import("../../src/collab/yDoc.ts");
const { reconcileLocalToY, buildDocFromY } = await import("../../src/collab/reconcile.ts");

const installed = auth.AUTH_TYPE_DEFS;
// Synthetic runtime without the promoted definitions. Every real runtime installs all 18 core
// methods; this keeps the defensive compatibility-identity branch covered for reduced runtimes.
const reducedRuntime = installed.filter(def => !PROMOTED_METHOD_IDS.includes(def.id));
const core = id => structuredClone(installed.find(def => def.id === id));
const historical = id => structuredClone(historicalAuthenticationDefinitions().find(def => def.id === id));
const analyze = (doc, definitions) => new IssueManager(undefined, undefined, [], [], definitions).analyze(doc);

test("availability: the 18-method core includes the promoted compatibility identities while tenant choices stay library-owned", () => {
  assert.equal(installed.length, 18);
  assert.ok(PROMOTED_METHOD_IDS.every(id => installed.some(def => def.id === id)));
  assert.deepEqual(types.PRODUCTION_IDENTITY_TENANT_DEFS.map(def => def.id), ["Customer", "Other"]);
  assert.ok(PROMOTED_METHOD_IDS.every(auth.isPackageAuthenticationId), "Promotion keeps the historical import identities");
  assert.equal(auth.isPackageAuthenticationId("InternalProcessCall"), false);
  assert.ok(PROMOTED_METHOD_IDS.every(id => auth.isKnownInstalledAuthentication(id)));
  assert.ok(PROMOTED_METHOD_IDS.every(id => !auth.isKnownInstalledAuthentication(id, reducedRuntime)));
});

for (const id of PROMOTED_METHOD_IDS) {
  test(`availability: ${id} saved snapshots resolve against core authority without a companion library`, () => {
    const doc = withFlow([id], {
      productionIdentity: { kind: "AppId", appId: IDS.app, tenant: "ME" },
      audience: "saved audience", constraints: "saved constraints",
    });
    const saved = historical(id);
    doc.authenticationDefinitions = [saved];
    const current = normalizeDoc(doc);
    const before = structuredClone(current);
    const resolved = auth.authenticationCatalogFor(current, installed, installed);
    const entry = resolved.find(def => def.id === id);
    assert.equal(entry.label, saved.label, "Saved presentation stays saved-first");
    assert.equal(entry.unavailableReason, undefined, "No companion library is required");
    assert.deepEqual(auth.authBehavior(id, resolved), core(id).behavior);
    assert.deepEqual(auth.withAuthenticationDefinitions(current, resolved).authenticationDefinitions, [saved]);
    assert.match(auth.authenticationWarnings(current, installed, installed).join("\n"), /saved definition differs from your library/,
      "A differently presented historical snapshot stays reviewable instead of being silently adopted");
    assert.deepEqual(current, before);
    assert.equal(JSON.stringify(current).includes("unavailableReason"), false);
    assert.ok(auth.exportAuthenticationCatalog([saved]).includes(saved.id), "Stored definitions remain exportable as data");
    // Defensive: cached profile preferences never grant availability to a reduced runtime.
    const reducedResolved = auth.authenticationCatalogFor(current, installed, reducedRuntime);
    const reduced = reducedResolved.find(def => def.id === id);
    assert.equal(reduced.label, saved.label);
    assert.match(reduced.unavailableReason, /library is unavailable/, "A reduced runtime still refuses portable authority");
    assert.deepEqual(auth.authBehavior(id, reducedResolved), auth.UNKNOWN_AUTH_BEHAVIOR);
    assert.deepEqual(auth.withAuthenticationDefinitions(current, reducedResolved).authenticationDefinitions, [saved]);
    assert.throws(() => auth.exportAuthenticationCatalog(reducedResolved), /runtime availability/);
    assert.deepEqual(current, before);
    assert.deepEqual(auth.authBehavior(id, resolved), saved.behavior);
  });
}

test("availability: portable conflicting behavior is retained but cannot clear identity findings", () => {
  const id = "EntraApplicationOnlyWithCdt";
  const canonical = core(id);
  const changed = { ...canonical, behavior: { ...canonical.behavior, productionIdentity: "optional", audience: false, constraints: false } };
  assert.throws(() => auth.validateAuthenticationDefinitions([changed], installed), /protected/);
  assert.deepEqual(auth.validatePortableAuthenticationDefinitions([changed]), [changed]);
  assert.throws(() => auth.assertInstalledAuthenticationContracts([changed], installed), /protected/);
  const doc = normalizeDoc({ ...withFlow([id]), authenticationDefinitions: [changed] });
  assert.match(auth.authenticationWarnings({ ...doc, edges: [] }, installed, installed).join(" "), /differs from the installed contract/,
    "An unreferenced conflicting snapshot must remain reachable for explicit repair");
  assert.match(auth.authenticationCatalogFor(doc, installed, installed).find(def => def.id === id).unavailableReason,
    /differs from the installed contract/);
  doc.issues = [{
    id: "i_retained", kind: "Edge_missing_production_identity", targetKind: "edge", targetId: IDS.edge,
    scenarioIds: [], title: "Original finding", description: "Original evidence", status: "Resolved",
    createdAt: 10, replies: [{ id: "ir_saved", text: "Human review", createdAt: 20 }],
  }];
  const result = analyze(doc, installed);
  assert.deepEqual(result.issues.find(issue => issue.id === "i_retained"),
    { ...doc.issues[0], notEvaluatedReason: "rule-retired" });
  assert.deepEqual(result.authenticationDefinitions, [changed]);
  const unavailable = analyze({ ...doc, authenticationDefinitions: [canonical] }, reducedRuntime);
  assert.equal(unavailable.issues.find(issue => issue.id === "i_retained").notEvaluatedReason, "rule-retired");
  const restored = analyze({ ...doc, authenticationDefinitions: [canonical] }, installed);
  assert.equal(restored.issues.find(issue => issue.id === "i_retained").notEvaluatedReason, "rule-retired");
  assert.equal(restored.issues.find(issue => issue.id === "i_retained").status, "Resolved");
});

test("availability: identity aliases remain protected and portable data cannot supply authority", () => {
  for (const id of PROMOTED_METHOD_IDS) {
    const entry = core(id);
    for (const name of [entry.label, ...entry.aliases]) {
      assert.equal(auth.normalizeAuthenticationValue(name), id);
      assert.equal(auth.normalizeAuthenticationValue(name, reducedRuntime), id, "Import identity does not depend on installation");
    }
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, id: entry.id.toLowerCase() }]), /protected/);
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, aliases: ["Unrelated takeover"] }]), /protected/);
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, legacy: true }]), /protected/);
    assert.throws(() => auth.validatePortableAuthenticationDefinitions([{ ...entry, unavailableReason: "trusted" }]), /unsupported field/);
  }
  const promoted = auth.authenticationCatalogFor(withFlow(["ProtectedForwardedAccessToken"]))
    .find(def => def.id === "ProtectedForwardedAccessToken");
  assert.equal(promoted.unresolved, undefined, "An unsaved reference resolves from the core");
  assert.deepEqual(promoted, core("ProtectedForwardedAccessToken"));
  const unresolved = auth.authenticationCatalogFor(withFlow(["ProtectedForwardedAccessToken"]), reducedRuntime, reducedRuntime)
    .find(def => def.id === "ProtectedForwardedAccessToken");
  assert.equal(unresolved.unresolved, true);
});

test("availability: profile load is read-only and promoted preferences stay in coherent stale-checked history", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    for (const runtime of [installed, reducedRuntime]) {
      let writes = 0;
      let raw = auth.exportAuthenticationCatalog(installed);
      const storage = { getItem: () => raw, setItem: (_key, value) => { writes++; raw = value; } };
      Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
      const loaded = auth.loadAuthenticationLibrary(runtime);
      assert.equal(loaded.error, null);
      assert.equal(loaded.methods.length, 18, "Stored promoted preferences are kept even by a reduced runtime");
      assert.deepEqual(loaded.methods.map(def => def.id).sort(), installed.map(def => def.id).sort());
      assert.equal(writes, 0);
      const disabled = loaded.methods.map(def => def.id === PROMOTED_METHOD_IDS[0] ? { ...def, disabled: true } : def);
      auth.persistAuthenticationLibrary(disabled, loaded.methods, runtime);
      auth.persistAuthenticationLibrary(loaded.methods, disabled, runtime);
      assert.deepEqual(auth.loadAuthenticationLibrary(runtime).methods, loaded.methods);
      assert.throws(() => auth.persistAuthenticationLibrary(disabled, disabled, runtime), /another tab/);
      assert.equal(writes, 2, "Loading never writes; only the two explicit persists did");
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});

test("availability: tenant authoring choices are installed-only while saved labels and values survive", () => {
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

test("availability: portable promoted snapshots converge through Yjs without serializing installation state", () => {
  const id = PROMOTED_METHOD_IDS[2];
  const doc = withFlow([id]);
  doc.authenticationDefinitions = [historical(id)];
  const a = createYShape(), b = createYShape();
  try {
    reconcileLocalToY(a, normalizeDoc(doc));
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    const remote = buildDocFromY(b);
    assert.deepEqual(remote.authenticationDefinitions, doc.authenticationDefinitions);
    assert.equal(auth.authenticationCatalogFor(remote, installed, installed).find(def => def.id === id).unavailableReason, undefined);
    assert.ok(auth.authenticationCatalogFor(remote, installed, reducedRuntime).find(def => def.id === id).unavailableReason);
    assert.equal(JSON.stringify(remote).includes("unavailableReason"), false);
    let echoes = 0;
    b.ydoc.on("update", () => echoes++);
    reconcileLocalToY(b, remote);
    assert.equal(echoes, 0);
  } finally { a.ydoc.destroy(); b.ydoc.destroy(); }
});