import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture, autosaveKey } from "./fixture.mjs";

async function waitForDfdSavedView(page, expectedView) {
  await page.waitForFunction(({ key, expectedView }) => {
    const scenario = document.querySelector('select[aria-label="Scenario"]');
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    return scenario?.value === (expectedView.activeScenarioId ?? "") &&
      JSON.stringify(saved?.view) === JSON.stringify(expectedView);
  }, { key: autosaveKey, expectedView });
}

async function measureAllFixtureNodes(page, count, restoreScenario) {
  const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
  await scenario.selectOption("");
  await page.waitForFunction(({ count, key }) => {
    const elements = [...document.querySelectorAll(".react-flow__node-process")];
    const doc = JSON.parse(localStorage.getItem(key) || "null")?.doc;
    return elements.length === count && elements.every(element => {
      const node = doc?.nodes.find(node => node.id === element.getAttribute("data-id"));
      return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
    });
  }, { count, key: autosaveKey });
  await scenario.selectOption(restoreScenario);
}

export async function withAtomicStore(page, exercise) {
  const modules = await page.evaluate(() => {
    const urls = performance.getEntriesByType("resource").map(entry => entry.name);
    const find = name => urls.find(url => new URL(url).origin === location.origin && new URL(url).pathname.endsWith(`/${name}`));
    return { react: find("react.js"), client: find("react-dom_client.js") };
  });
  assert.ok(modules.react && modules.client, "Use the actual loaded React modules, not a second module instance");
  const origin = new URL(page.url()).origin;
  await page.route(`${origin}/src/main.tsx*`, route =>
    route.fulfill({ contentType: "text/javascript", body: "// Isolated synthetic StoreProvider fixture.\n" }));
  await page.goto(origin, { timeout: 20000 });
  assert.equal(await page.locator(".ps-shell").count(), 0, "No competing App or DiagramCanvas may mutate the fixture");
  await page.evaluate(async ({ modules, input, key }) => {
    const React = (await import(modules.react)).default;
    const { createRoot } = (await import(modules.client)).default;
    const { StoreProvider, useStore, normalizeDoc } = await import("/src/store.tsx");
    const { UiShellProvider } = await import("/src/uiShell.tsx");
    const { LibraryProvider } = await import("/src/libraries/LibraryProvider.tsx");
    const { CORE_LIBRARIES } = await import("/src/libraries/registry.ts");
    const { withCatalogDefinitions } = await import("/src/catalogDefinitions.ts");
    const doc = withCatalogDefinitions(normalizeDoc(input.doc));
    localStorage.setItem(key, JSON.stringify({ version: 1, doc, view: input.view, past: [], future: [] }));
    window.atomicStoreCommits = 0;
    window.atomicScopeSession = Symbol("atomic-scope-session");
    function Probe() {
      const store = useStore();
      React.useLayoutEffect(() => {
        window.atomicStore = store;
        window.atomicStoreCommits++;
      });
      return null;
    }
    window.mountAtomicStore = () => {
      window.atomicRoot = createRoot(document.getElementById("root"));
      window.atomicRoot.render(React.createElement(React.StrictMode, null,
        React.createElement(LibraryProvider, { registry: CORE_LIBRARIES },
          React.createElement(UiShellProvider, null,
            React.createElement(StoreProvider, null, React.createElement(Probe))))));
    };
    window.mountAtomicStore();
  }, { modules, input: modelFixture(), key: autosaveKey });
  await page.waitForFunction(() => window.atomicStore?.doc.nodes.length === 3 && window.atomicStoreCommits >= 2);
  try {
    await exercise();
  } finally {
    await page.evaluate(() => { window.atomicRoot.unmount(); delete window.atomicStore; });
  }
}

export async function readAtomicStore(page) {
  return page.evaluate(key => ({
    doc: JSON.parse(JSON.stringify(window.atomicStore.doc)),
    selection: window.atomicStore.selection,
    scenario: window.atomicStore.activeScenarioId,
    filter: window.atomicStore.filter,
    canUndo: window.atomicStore.canUndo,
    canRedo: window.atomicStore.canRedo,
    authenticationLibrary: window.atomicStore.authenticationLibrary,
    classificationLibrary: window.atomicStore.classificationLibrary,
    authenticationStorageError: window.atomicStore.authenticationStorageError,
    classificationStorageError: window.atomicStore.classificationStorageError,
    saved: JSON.parse(localStorage.getItem(key)),
  }), autosaveKey);
}

export async function commitAtomicStore(page, action, argument) {
  const before = await page.evaluate(() => window.atomicStoreCommits);
  await page.evaluate(action, argument);
  await page.waitForFunction(previous => window.atomicStoreCommits > previous, before);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  return readAtomicStore(page);
}

export function registerDfdContracts({ getHarness, exportModel }) {
  test("regression: scope grouping survives matching view echoes and ends only on actual target or scenario departure", async () => {
    await getHarness().run("regression: atomic scope navigation guards", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const initial = await readAtomicStore(page);
        const echoed = await commitAtomicStore(page, () => {
          const store = window.atomicStore;
          store.setNodeScopeReason("s_primary", "n_api", "phase-one", window.atomicScopeSession);
          store.setSelection({ kind: "node", id: "n_api" });
          store.setActiveScenarioId("s_primary");
          store.setNodeScopeReason("s_primary", "n_api", "phase-two", window.atomicScopeSession);
        });
        const expected = structuredClone(initial.doc);
        expected.scenarios[0].nodeScopeReasons = { n_api: "phase-two" };
        assert.deepEqual(echoed.doc, expected);
        assert.equal(echoed.saved.past.length, 1, "Same-target/scenario echoes preserve the scope gesture");
        const undone = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undone.doc, initial.doc);
        assert.deepEqual(undone.selection, { kind: "node", id: "n_api" });
        await commitAtomicStore(page, () => window.atomicStore.redo());

        const moved = await commitAtomicStore(page, () => {
          const store = window.atomicStore;
          store.setNodeScopeReason("s_primary", "n_api", "Before navigation", window.atomicScopeSession);
          store.setSelection({ kind: "node", id: "n_client" });
          store.setSelection({ kind: "node", id: "n_api" });
          store.setNodeScopeReason("s_primary", "n_api", "After target return", window.atomicScopeSession);
          store.setActiveScenarioId("s_archive");
          store.setActiveScenarioId("s_primary");
          store.setNodeScopeReason("s_primary", "n_api", "After scenario return", window.atomicScopeSession);
        });
        assert.equal(moved.saved.past.length, 4, "Real departures break continuity even when the target/scenario later returns");
        for (const value of ["After target return", "Before navigation", "phase-two"]) {
          const state = await commitAtomicStore(page, () => window.atomicStore.undo());
          const expectedState = structuredClone(expected);
          expectedState.scenarios[0].nodeScopeReasons.n_api = value;
          assert.deepEqual(state.doc, expectedState);
          assert.deepEqual(state.selection, { kind: "node", id: "n_api" });
          assert.equal(state.scenario, "s_primary");
        }
      });
    });
  });

  test("regression: atomic scope history preserves same-turn queued size and every undo predecessor in StrictMode", async () => {
    await getHarness().run("regression: atomic queued scope writes", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const phaseOne = await commitAtomicStore(page, () => {
          window.atomicStore.setNodeScopeReason("s_primary", "n_api", "phase-prefix", window.atomicScopeSession);
          window.atomicStore.setNodeScopeReason("s_primary", "n_api", "phase-one", window.atomicScopeSession);
        });
        assert.equal(phaseOne.saved.past.length, 1);
        const expected = structuredClone(phaseOne.doc);
        const sized = expected.nodes.find(node => node.id === "n_archive");
        sized.size = { width: sized.size.width + 17, height: sized.size.height + 9 };
        const beforeScope = structuredClone(expected);
        expected.scenarios.find(scenario => scenario.id === "s_primary").nodeScopeReasons.n_api = "phase-two";
        const queued = await commitAtomicStore(page, ({ size, key }) => {
          const store = window.atomicStore;
          store.setNodeSize("n_archive", size);
          store.setNodeScopeReason("s_primary", "n_api", "phase-two", window.atomicScopeSession);
          window.dispatchEvent(new Event("pagehide"));
          window.atomicImmediateSaved = JSON.parse(localStorage.getItem(key));
        }, { size: sized.size, key: autosaveKey });
        assert.deepEqual(queued.doc, expected, "Both queued public mutations survive with no await between calls");
        assert.deepEqual(await page.evaluate(() => window.atomicImmediateSaved.doc), expected,
          "Synchronous autosave reads one complete queued document/history cell before React renders");
        assert.deepEqual(queued.saved.past.at(-1), beforeScope, "The reason snapshot includes the preceding nonundoable size update");
        assert.equal(queued.saved.past.length, 2, "The intervening update breaks the scope gesture exactly once");
        const undone = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undone.doc, beforeScope);
        assert.deepEqual(undone.selection, { kind: "node", id: "n_api" });
        const redone = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.deepEqual(redone.doc, expected);
        assert.deepEqual(redone.selection, { kind: "node", id: "n_api" });

        const expectedMulti = structuredClone(expected);
        expectedMulti.nodes.find(node => node.id === "n_archive").size.width += 11;
        const afterSize = structuredClone(expectedMulti);
        expectedMulti.scenarios[0].nodeScopeReasons.n_api = "phase-three";
        const afterFirstReason = structuredClone(expectedMulti);
        expectedMulti.nodes.find(node => node.id === "n_client").title = "Separate ordinary edit";
        const afterTitle = structuredClone(expectedMulti);
        expectedMulti.scenarios[0].nodeScopeReasons.n_api = "phase-four";
        const multi = await commitAtomicStore(page, size => {
          const store = window.atomicStore;
          store.setNodeSize("n_archive", size);
          store.setNodeScopeReason("s_primary", "n_api", "phase-three", window.atomicScopeSession);
          store.updateNode("n_client", { title: "Separate ordinary edit" });
          store.setNodeScopeReason("s_primary", "n_api", "phase-four", window.atomicScopeSession);
        }, afterSize.nodes.find(node => node.id === "n_archive").size);
        assert.deepEqual(multi.doc, expectedMulti);
        assert.equal(multi.saved.past.length, 5, "Size remains snapshot-free; scope/title/scope form three ordered entries");
        for (const [doc, selection] of [
          [afterTitle, { kind: "node", id: "n_api" }],
          [afterFirstReason, null],
          [afterSize, { kind: "node", id: "n_api" }],
        ]) {
          const state = await commitAtomicStore(page, () => window.atomicStore.undo());
          assert.deepEqual(state.doc, doc);
          assert.deepEqual(state.selection, selection);
        }
        await commitAtomicStore(page, () => {
          window.atomicStore.redo();
          window.atomicStore.redo();
          window.atomicStore.redo();
        });
        assert.deepEqual((await readAtomicStore(page)).doc, expectedMulti, "Consecutive same-turn Redo composes in order");
        const branched = await commitAtomicStore(page, () => {
          window.atomicStore.undo();
          window.atomicStore.setNodeScopeReason("s_primary", "n_api", "Scope branch", window.atomicScopeSession);
        });
        const expectedBranch = structuredClone(afterTitle);
        expectedBranch.scenarios[0].nodeScopeReasons.n_api = "Scope branch";
        assert.deepEqual(branched.doc, expectedBranch);
        assert.equal(branched.canRedo, false);
        assert.deepEqual(branched.saved.future, []);
      });
    });
  });

  test("regression: inverse queued ordering matches real serial store operations without a new nonundoable policy", async () => {
    await getHarness().run("regression: atomic inverse queue control", async ({ page }) => {
      const outcomes = [];
      for (const queued of [false, true]) {
        await withAtomicStore(page, async () => {
          const phaseOne = await commitAtomicStore(page, () =>
            window.atomicStore.setNodeScopeReason("s_primary", "n_api", "phase-one", window.atomicScopeSession));
          const expected = structuredClone(phaseOne.doc);
          expected.scenarios[0].nodeScopeReasons.n_api = "phase-two";
          const node = expected.nodes.find(node => node.id === "n_archive");
          node.size = { width: node.size.width + 17, height: node.size.height + 9 };
          if (queued) {
            await commitAtomicStore(page, size => {
              window.atomicStore.setNodeScopeReason("s_primary", "n_api", "phase-two", window.atomicScopeSession);
              window.atomicStore.setNodeSize("n_archive", size);
            }, node.size);
          } else {
            await commitAtomicStore(page, () =>
              window.atomicStore.setNodeScopeReason("s_primary", "n_api", "phase-two", window.atomicScopeSession));
            await commitAtomicStore(page, size => window.atomicStore.setNodeSize("n_archive", size), node.size);
          }
          const forward = await readAtomicStore(page);
          assert.deepEqual(forward.doc, expected);
          const undo = await commitAtomicStore(page, () => window.atomicStore.undo());
          const redo = await commitAtomicStore(page, () => window.atomicStore.redo());
          const relevant = state => ({
            doc: state.doc, past: state.saved.past, future: state.saved.future,
            selection: state.selection, scenario: state.scenario,
          });
          outcomes.push([forward, undo, redo].map(relevant));
        });
      }
      assert.deepEqual(outcomes[1], outcomes[0], "Queued inverse order equals the same actual-store order with commit barriers");
    });
  });

  test("regression: atomic ordinary creation and membership remain one complete undoable affordance", async () => {
    await getHarness().run("regression: atomic compound creation history", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const initial = await readAtomicStore(page);
        const nodes = await commitAtomicStore(page, () => {
          const store = window.atomicStore;
          window.atomicCreatedNodeIds = [];
          for (let index = 0; index < 2; index++) {
            const node = store.createNode({ x: 700 + index * 200, y: 300 });
            window.atomicCreatedNodeIds.push(node.id);
            store.setSelection({ kind: "node", id: node.id });
            store.setActiveScenarioId("s_archive");
            store.setActiveScenarioId("s_primary");
            store.updateNode(node.id, { title: `Imported endpoint ${index}`, endpointRegex: "^https://example\\.invalid/" });
            store.addNodeToScenario("s_primary", node.id);
          }
        });
        const createdIds = await page.evaluate(() => window.atomicCreatedNodeIds);
        assert.equal(nodes.saved.past.length, 1, "View-only callbacks do not split an ordinary create/metadata/membership gesture");
        assert.equal(nodes.doc.nodes.length, initial.doc.nodes.length + 2);
        for (const id of createdIds) assert.ok(nodes.doc.scenarios[0].nodeIds.includes(id));
        const undoneNodes = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undoneNodes.doc, initial.doc, "One Undo removes all created entities, not only their visible membership");
        const restoredNodes = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.deepEqual(restoredNodes.doc, nodes.doc);
        const edge = await commitAtomicStore(page, target => {
          const store = window.atomicStore;
          const edge = store.createEdge("n_client", target);
          if (!edge) throw new Error("Synthetic edge creation unexpectedly rejected");
          store.setSelection({ kind: "edge", id: edge.id });
          store.setActiveScenarioId("s_primary");
          store.addEdgeToScenario("s_primary", edge.id);
        }, createdIds[0]);
        assert.equal(edge.doc.edges.length, nodes.doc.edges.length + 1);
        assert.equal(edge.saved.past.length, 2);
        const undoneEdge = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undoneEdge.doc, nodes.doc, "Connection Undo removes the global edge as well as membership");
        const restoredEdge = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.deepEqual(restoredEdge.doc, edge.doc);

        const first = await commitAtomicStore(page, () => window.atomicStore.updateNode("n_api", { title: "First user gesture" }));
        const second = await commitAtomicStore(page, () => window.atomicStore.updateNode("n_api", { title: "Second user gesture" }));
        assert.equal(second.saved.past.length, first.saved.past.length + 1,
          "Ordinary gestures separated by an actual React commit do not coalesce");
        const undone = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undone.doc, first.doc);
      });
    });
  });

  test("regression: atomic history retains cap, branches and complete replacement transactions", async () => {
    await getHarness().run("regression: atomic ordinary history and replacements", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const initial = await readAtomicStore(page);
        const edited = await commitAtomicStore(page, () => {
          for (let index = 1; index <= 105; index++) {
            window.atomicStore.setNodeScopeReason("s_primary", "n_api", `Edit ${index}`, Symbol(`gesture-${index}`));
          }
        });
        assert.equal(edited.doc.scenarios[0].nodeScopeReasons.n_api, "Edit 105");
        await commitAtomicStore(page, () => {
          for (let index = 0; index < 99; index++) window.atomicStore.undo();
        });
        let current = await readAtomicStore(page);
        assert.equal(current.doc.scenarios[0].nodeScopeReasons.n_api, "Edit 6");
        assert.equal(current.canUndo, true);
        current = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.equal(current.doc.scenarios[0].nodeScopeReasons.n_api, "Edit 5");
        assert.equal(current.canUndo, false, "Exactly100 history entries, not per-render duplicates or additional truncation");
        current = await commitAtomicStore(page, () => {
          window.atomicStore.redo();
          window.atomicStore.updateNode("n_api", { title: "New branch" });
        });
        assert.equal(current.canRedo, false);
        assert.deepEqual(current.saved.future, []);
        const beforeReplacement = structuredClone(current.doc);
        beforeReplacement.nodes.find(node => node.id === "n_archive").size = { width: 213, height: 91 };
        const imported = structuredClone(initial.doc);
        imported.nodes.find(node => node.id === "n_api").title = "Opened document";
        current = await commitAtomicStore(page, doc => {
          window.atomicStore.setNodeSize("n_archive", { width: 213, height: 91 });
          window.atomicStore.importJson({
            format: "secure-design-studio-diagram", version: 2, doc,
            view: { activeScenarioId: "s_archive", filter: {} },
          });
        }, imported);
        assert.deepEqual(current.doc, imported);
        assert.equal(current.scenario, "s_archive");
        current = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(current.doc, beforeReplacement, "Open snapshots the actual queued predecessor, not the prior render");
        assert.equal(current.selection, null);
        current = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.deepEqual(current.doc, imported);
        await commitAtomicStore(page, () => {
          window.atomicStore.newDocument();
          window.atomicStore.undo();
        });
        assert.deepEqual((await readAtomicStore(page)).doc, imported, "New and Undo compose in one turn");
      });
    });
  });

  test("regression: atomic scope validation and selection use queued scenario and target state", async () => {
    await getHarness().run("regression: queued scope target safety", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const initial = await readAtomicStore(page);
        let state = await commitAtomicStore(page, () => {
          window.atomicStore.setNodeScopeReason("s_primary", "n_api", "Owner", window.atomicScopeSession);
          window.atomicStore.setActiveScenarioId("s_archive");
          window.atomicStore.undo();
        });
        assert.deepEqual(state.doc, initial.doc);
        assert.equal(state.scenario, "s_archive");
        assert.equal(state.selection, null, "A queued scenario change is visible to history context validation");
        await commitAtomicStore(page, () => {
          window.atomicStore.setActiveScenarioId("s_primary");
          window.atomicStore.redo();
        });
        const beforeRemoval = (await readAtomicStore(page)).doc;
        state = await commitAtomicStore(page, () => {
          window.atomicAlerts = [];
          window.atomicOriginalAlert = window.alert;
          window.alert = message => window.atomicAlerts.push(String(message));
          try {
            window.atomicStore.deleteNode("n_api");
            window.atomicStore.setNodeScopeReason("s_primary", "n_api", "Must reject", window.atomicScopeSession);
          } finally {
            window.alert = window.atomicOriginalAlert;
          }
        });
        assert.equal(state.doc.nodes.some(node => node.id === "n_api"), false);
        assert.deepEqual(await page.evaluate(() => window.atomicAlerts),
          ["Select a scenario containing this node before editing its scope."]);
        state = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(state.doc, beforeRemoval, "Rejected post-removal write creates neither a ghost target nor extra history");
        assert.equal(state.selection, null);
        state = await commitAtomicStore(page, () => {
          window.atomicStore.removeNodeFromScenario("s_primary", "n_api");
          window.atomicStore.setActiveScenarioId("s_primary");
          window.atomicStore.undo();
        });
        assert.deepEqual(state.doc, beforeRemoval);
        assert.equal(state.selection, null, "Membership Undo keeps ordinary cleanup, not stale scope context");
        state = await commitAtomicStore(page, () => {
          window.atomicAlerts = [];
          const original = window.alert;
          window.alert = message => window.atomicAlerts.push(String(message));
          try {
            window.atomicStore.updateNode("n_api", { dfdRoleOverride: "ExternalInteractor" });
            window.atomicStore.setNodeScopeReason("s_primary", "n_api", "Must reject", window.atomicScopeSession);
          } finally {
            window.alert = original;
          }
        });
        const externalExpected = structuredClone(beforeRemoval);
        externalExpected.nodes.find(node => node.id === "n_api").dfdRoleOverride = "ExternalInteractor";
        assert.deepEqual(state.doc, externalExpected, "Validation uses the queued role and retains the prior inactive reason");
        assert.deepEqual(await page.evaluate(() => window.atomicAlerts),
          ["External Interactors are black boxes, not out-of-scope infrastructure."]);
        state = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(state.doc, beforeRemoval);
      });
    });
  });

  test("regression: atomic queued history autosaves as one cell and reload never trusts transient editor context", async () => {
    await getHarness().run("regression: atomic history persistence", async ({ page }) => {
      await withAtomicStore(page, async () => {
        await commitAtomicStore(page, () =>
          window.atomicStore.setNodeScopeReason("s_primary", "n_api", "phase-one", window.atomicScopeSession));
        const expectedBefore = (await readAtomicStore(page)).doc;
        expectedBefore.nodes.find(node => node.id === "n_archive").size = { width: 204, height: 87 };
        const expectedAfter = structuredClone(expectedBefore);
        expectedAfter.scenarios[0].nodeScopeReasons.n_api = "phase-two";
        const state = await commitAtomicStore(page, () => {
          window.atomicStore.setNodeSize("n_archive", { width: 204, height: 87 });
          window.atomicStore.setNodeScopeReason("s_primary", "n_api", "phase-two", window.atomicScopeSession);
          window.atomicStore.undo();
          window.dispatchEvent(new Event("pagehide"));
        });
        assert.deepEqual(state.saved.doc, expectedBefore);
        assert.deepEqual(state.saved.future.at(-1), expectedAfter);
        for (const item of [state.saved.doc, ...state.saved.past, ...state.saved.future]) {
          assert.equal(Object.hasOwn(item, "ordinarySnapshot"), false);
          assert.equal(Object.hasOwn(item, "scopeReasonEdit"), false);
          assert.equal(Object.hasOwn(item, "scopeReason"), false);
          assert.equal(Object.hasOwn(item, "session"), false);
        }
        await page.evaluate(() => {
          window.atomicRoot.unmount();
          delete window.atomicStore;
          window.mountAtomicStore();
        });
        await page.waitForFunction(() => window.atomicStore?.canRedo === true);
        const restored = await readAtomicStore(page);
        assert.deepEqual(restored.doc, expectedBefore);
        assert.equal(restored.selection, null);
        assert.deepEqual(restored.saved, state.saved);
        const redone = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.deepEqual(redone.doc, expectedAfter);
        assert.equal(redone.selection, null, "Restored document history does not manufacture trusted local scope context");
      });
    });
  });

  test("regression: immediate autosave uses queued filters for updates, Open and New", async () => {
    await getHarness().run("regression: queued autosave view consistency", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const initial = await readAtomicStore(page);
        await commitAtomicStore(page, () => window.atomicStore.setFilter({ text: "Old filter", nodeType: "nt_browser" }));
        let state = await commitAtomicStore(page, key => {
          window.atomicStore.setFilter({ text: "Queued filter" });
          window.atomicStore.setFilter({ authType: "ApiKey" });
          window.dispatchEvent(new Event("pagehide"));
          window.atomicQueuedViewSaved = JSON.parse(localStorage.getItem(key));
        }, autosaveKey);
        const queuedFilter = { text: "Queued filter", nodeType: "nt_browser", authType: "ApiKey", dataClassification: "" };
        assert.deepEqual(state.filter, queuedFilter);
        assert.deepEqual(state.doc, initial.doc);
        assert.deepEqual(await page.evaluate(() => window.atomicQueuedViewSaved), state.saved,
          "Immediate flush and post-render flush serialize the same full envelope");
        assert.deepEqual(state.saved.view, { activeScenarioId: "s_primary", filter: queuedFilter });
        assert.deepEqual(state.saved.past, []);
        assert.deepEqual(state.saved.future, []);

        const imported = structuredClone(initial.doc);
        imported.nodes.find(node => node.id === "n_api").title = "Opened with a different filter";
        const importedFilter = { text: "Imported filter", nodeType: "", authType: "", dataClassification: "" };
        state = await commitAtomicStore(page, ({ doc, filter, key }) => {
          window.atomicStore.importJson({
            format: "secure-design-studio-diagram", version: 2, doc,
            view: { activeScenarioId: "s_archive", filter },
          });
          window.dispatchEvent(new Event("pagehide"));
          window.atomicQueuedViewSaved = JSON.parse(localStorage.getItem(key));
        }, { doc: imported, filter: importedFilter, key: autosaveKey });
        assert.deepEqual(state.doc, imported);
        assert.deepEqual(state.saved.view, { activeScenarioId: "s_archive", filter: importedFilter });
        assert.deepEqual(state.saved.past, [initial.doc]);
        assert.deepEqual(state.saved.future, []);
        assert.deepEqual(await page.evaluate(() => window.atomicQueuedViewSaved), state.saved,
          "Open does not combine its new document/scenario with the prior nonempty filter");
        await page.evaluate(() => {
          window.atomicRoot.unmount();
          delete window.atomicStore;
          window.mountAtomicStore();
        });
        await page.waitForFunction(() => window.atomicStore?.activeScenarioId === "s_archive");
        const restored = await readAtomicStore(page);
        assert.deepEqual(restored.doc, imported);
        assert.deepEqual(restored.filter, importedFilter);
        assert.deepEqual(restored.saved, state.saved);

        state = await commitAtomicStore(page, key => {
          window.atomicStore.newDocument();
          window.dispatchEvent(new Event("pagehide"));
          window.atomicQueuedViewSaved = JSON.parse(localStorage.getItem(key));
        }, autosaveKey);
        assert.equal(state.doc.nodes.length, 0);
        assert.deepEqual(state.saved.view, {
          activeScenarioId: null, filter: { text: "", nodeType: "", authType: "", dataClassification: "" },
        });
        assert.deepEqual(state.saved.past.at(-1), imported);
        assert.deepEqual(state.saved.future, []);
        assert.deepEqual(await page.evaluate(() => window.atomicQueuedViewSaved), state.saved,
          "New synchronously clears the saved filter with its new document/history");
      });
    });
  });

  test("regression: queued classification defaults and enabled choices govern authoring only after successful storage", async () => {
    await getHarness().run("regression: queued classification authoring", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const initial = await readAtomicStore(page);
        const next = structuredClone(initial.classificationLibrary);
        const oldDefault = next.defaultId;
        next.defaultId = "AtomicNewClassification";
        next.classifications = [
          ...next.classifications.map(item => item.id === oldDefault ? { ...item, disabled: true } : item),
          { id: next.defaultId, label: "Atomic new classification", description: "Synthetic queue fixture", disabled: false },
        ];
        const authored = await commitAtomicStore(page, ({ library, oldDefault }) => {
          const store = window.atomicStore;
          store.applyClassificationLibrary(library, store.classificationLibrary);
          window.atomicCreatedData = [store.createData(), store.createData(library.defaultId)];
          store.updateData("d_response", { classification: library.defaultId });
          window.atomicClassificationRejections = [];
          try { store.createData(oldDefault); } catch (error) { window.atomicClassificationRejections.push(error.message); }
          try { store.updateData("d_response", { classification: oldDefault }); }
          catch (error) { window.atomicClassificationRejections.push(error.message); }
        }, { library: next, oldDefault });
        const created = await page.evaluate(() => window.atomicCreatedData);
        assert.equal(created.length, 2);
        assert.ok(created.every(item => item.classification === next.defaultId),
          "Same-turn default and explicit newly enabled authoring use the persisted queued library");
        const expected = structuredClone(initial.doc);
        expected.data.push(...created);
        expected.data.find(item => item.id === "d_response").classification = next.defaultId;
        assert.deepEqual(authored.doc, expected);
        assert.deepEqual(authored.classificationLibrary, next);
        assert.equal(authored.saved.past.length, 2, "Library and the ordinary authoring gesture remain separate; rejected choices create no snapshots");
        assert.deepEqual(await page.evaluate(() => window.atomicClassificationRejections), [
          "Choose an enabled classification from the active library for new data.",
          "Choose an enabled classification from the active library; existing out-of-list values are retained.",
        ]);
        const captured = await page.evaluate(async ({ doc, library }) => {
          const { withCatalogDefinitions } = await import("/src/catalogDefinitions.ts");
          const { classificationDefinitionsForLibrary } = await import("/src/classificationLibrary.ts");
          return withCatalogDefinitions(doc, classificationDefinitionsForLibrary(library));
        }, { doc: expected, library: next });
        assert.deepEqual(authored.saved.doc, captured, "Portable dependency capture follows the new profile without erasing retained old definitions");

        const beforeFailure = await readAtomicStore(page);
        const failedNext = structuredClone(next);
        failedNext.defaultId = oldDefault;
        failedNext.classifications = failedNext.classifications.map(item =>
          item.id === oldDefault ? { ...item, disabled: false } : item);
        const failure = await page.evaluate(library => {
          const original = Storage.prototype.setItem;
          const key = "secure-design-studio:classification-library:v1";
          const beforeRaw = localStorage.getItem(key);
          Storage.prototype.setItem = function(name, value) {
            if (name === key) throw new Error("Synthetic queued profile denial");
            return original.call(this, name, value);
          };
          let message;
          try { window.atomicStore.applyClassificationLibrary(library, window.atomicStore.classificationLibrary); }
          catch (error) { message = error.message; }
          finally { Storage.prototype.setItem = original; }
          return { message, beforeRaw, afterRaw: localStorage.getItem(key) };
        }, failedNext);
        assert.match(failure.message, /Synthetic queued profile denial/);
        assert.equal(failure.afterRaw, failure.beforeRaw);
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        assert.deepEqual(await readAtomicStore(page), beforeFailure,
          "Failed persistence leaves current document, history, profile, view and authoring availability unchanged");
        const afterFailure = await commitAtomicStore(page, () => { window.atomicAfterFailureData = window.atomicStore.createData(); });
        assert.equal(await page.evaluate(() => window.atomicAfterFailureData.classification), next.defaultId);
        assert.deepEqual(afterFailure.classificationLibrary, next);
      });
    });
  });

  test("regression: atomic profile-backed history stays coherent on queued edits and failed storage", async () => {
    await getHarness().run("regression: atomic profile library history", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const baseline = await readAtomicStore(page);
        const queued = await commitAtomicStore(page, () => {
          window.atomicStore.setNodeSize("n_archive", { width: 204, height: 87 });
          window.atomicStore.saveAuthenticationMethod({ id: "SyntheticAtomicAuth", label: "Synthetic proof", description: "Unverified synthetic method" });
          window.atomicStore.undo();
        });
        const sized = structuredClone(baseline.doc);
        sized.nodes.find(node => node.id === "n_archive").size = { width: 204, height: 87 };
        assert.deepEqual(queued.doc, sized);
        assert.deepEqual(queued.authenticationLibrary, baseline.authenticationLibrary, "Same-turn profile mutation is visible to Undo preflight");
        const authApplied = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.ok(authApplied.authenticationLibrary.some(method => method.id === "SyntheticAtomicAuth"));
        const failure = await commitAtomicStore(page, () => {
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key.includes("authentication")) throw new Error("Synthetic storage denial");
            return original.call(this, key, value);
          };
          try { window.atomicStore.undo(); } finally { Storage.prototype.setItem = original; }
        });
        assert.match(failure.authenticationStorageError, /Synthetic storage denial/);
        for (const key of ["doc", "authenticationLibrary", "canUndo", "canRedo"]) assert.deepEqual(failure[key], authApplied[key]);
        assert.deepEqual(failure.saved.past, authApplied.saved.past);
        assert.deepEqual(failure.saved.future, authApplied.saved.future);
        await commitAtomicStore(page, () => window.atomicStore.undo());

        const beforeClassification = await readAtomicStore(page);
        const next = structuredClone(beforeClassification.classificationLibrary);
        next.classifications[0].label += " synthetic";
        const classified = await commitAtomicStore(page, library => {
          window.atomicStore.applyClassificationLibrary(library, window.atomicStore.classificationLibrary);
          window.atomicStore.undo();
          window.atomicStore.redo();
        }, next);
        assert.deepEqual(classified.classificationLibrary, next, "Queued classification Undo/Redo observes current profile state");
        const classificationFailure = await commitAtomicStore(page, () => {
          const original = Storage.prototype.setItem;
          Storage.prototype.setItem = function(key, value) {
            if (key.includes("classification")) throw new Error("Synthetic classification denial");
            return original.call(this, key, value);
          };
          try { window.atomicStore.undo(); } finally { Storage.prototype.setItem = original; }
        });
        assert.match(classificationFailure.classificationStorageError, /Synthetic classification denial/);
        for (const key of ["doc", "classificationLibrary", "canUndo", "canRedo"]) assert.deepEqual(classificationFailure[key], classified[key]);
        assert.deepEqual(classificationFailure.saved.past, classified.saved.past);
        assert.deepEqual(classificationFailure.saved.future, classified.saved.future);
        const undone = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undone.doc, beforeClassification.doc);
        assert.deepEqual(undone.classificationLibrary, beforeClassification.classificationLibrary);
      });
    });
  });

  test("regression: DFD role and scenario reason authoring preserves identity, history, clones and recovery", async () => {
    await getHarness().run("regression: DFD role and scope", async ({ page }) => {
      const input = modelFixture();
      input.doc.nodeTypes[0].definition.defaultDfdRole = "DataStore";
      input.doc.nodes[0].dfdRoleOverride = "ExternalInteractor";
      input.doc.scenarios[0].nodeScopeReasons = { n_client: "Contradictory retained evidence", n_api: "Owned elsewhere" };
      input.doc.issues = [{ id: "manual", targetKind: "node", targetId: "n_api", scenarioIds: ["s_primary"],
        title: "Keep authored threat", description: "Not automatically resolved", status: "Resolved", createdAt: 1, replies: [] }];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "roles.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("roles.tma", { exact: true }).waitFor();
      const selectNode = async id => {
        await page.locator(`.react-flow__node-process[data-id="${id}"] .ps-node-title`).click();
        await page.getByRole("tab", { name: /^Properties/ }).click();
      };
      await selectNode("n_client");
      assert.equal(await page.getByRole("textbox", { name: /^Out-of-scope reason/ }).isDisabled(), true);
      assert.match(await page.locator(".ps-details").innerText(), /stored reason is inactive/);
      assert.equal((await exportModel(page)).doc.scenarios[0].nodeScopeReasons.n_client, "Contradictory retained evidence");
      await selectNode("n_api");
      const role = page.getByRole("combobox", { name: "DFD role", exact: true });
      const reason = page.getByRole("textbox", { name: /^Out-of-scope reason/ });
      assert.equal(await role.inputValue(), "default");
      await role.selectOption("Process");
      let saved = await exportModel(page);
      assert.equal(saved.doc.nodes.find(node => node.id === "n_api").type, "nt_browser");
      assert.equal(saved.doc.nodes.find(node => node.id === "n_api").dfdRoleOverride, "Process");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await selectNode("n_api");
      assert.equal(await role.inputValue(), "default");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await selectNode("n_api");
      assert.equal(await role.inputValue(), "Process");
      const serviceType = page.getByPlaceholder("Select or enter a node type");
      await serviceType.fill("Azure SQL");
      await serviceType.press("Enter");
      saved = await exportModel(page);
      assert.equal(saved.doc.nodes.find(node => node.id === "n_api").type, "azure.databases.sql");
      assert.equal(saved.doc.nodes.find(node => node.id === "n_api").dfdRoleOverride, "Process");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await selectNode("n_api");
      assert.equal(await role.inputValue(), "Process");
      await reason.fill("Managed by another team");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await reason.inputValue(), "Owned elsewhere");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.equal(await reason.inputValue(), "Managed by another team");
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_archive");
      await selectNode("n_api");
      assert.equal(await reason.inputValue(), "");
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_primary");
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.getByRole("menuitem", { name: "Duplicate current scenario", exact: true }).click();
      await selectNode("n_api");
      assert.equal(await reason.inputValue(), "Managed by another team");
      await reason.fill("Independent clone reason");
      saved = await exportModel(page);
      assert.equal(saved.doc.scenarios.find(item => item.id === "s_primary").nodeScopeReasons.n_api, "Managed by another team");
      assert.equal(saved.doc.scenarios.find(item => item.name === "Primary copy").nodeScopeReasons.n_api, "Independent clone reason");
      assert.deepEqual(saved.doc.issues, input.doc.issues);
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.scenarios
        ?.some(scenario => scenario.nodeScopeReasons?.n_api === "Independent clone reason"), autosaveKey);
      await page.reload();
      await selectNode("n_api");
      assert.equal(await reason.inputValue(), "Independent clone reason");
      assert.equal(await role.inputValue(), "Process");
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "reopened-roles.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)),
      });
      await page.getByLabel("Document status").getByText("reopened-roles.tma", { exact: true }).waitFor();
      assert.deepEqual((await exportModel(page)).doc, saved.doc);
    });
  });

  test("regression: editable scope reasons clear through the field while inactive and malformed evidence remains recoverable", async () => {
    await getHarness().run("regression: scope reason clearing and recovery", async ({ page }) => {
      const input = modelFixture();
      input.doc.nodes[0].dfdRoleOverride = "ExternalInteractor";
      input.doc.nodes[1].dfdRoleOverride = "Process";
      input.doc.scenarios[0].nodeScopeReasons = {
        n_client: "Imported external reason",
        n_api: "Owned by another team",
      };
      input.doc.scenarios[1].nodeScopeReasons = { n_api: "Keep other scenario" };
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "reason-recovery.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("reason-recovery.tma", { exact: true }).waitFor();
      await measureAllFixtureNodes(page, input.doc.nodes.length, input.view.activeScenarioId);
      const selectNode = async id => {
        await page.locator(`.react-flow__node-process[data-id="${id}"] .ps-node-title`).click();
        await page.getByRole("tab", { name: /^Properties/ }).click();
      };
      const reason = page.getByRole("textbox", { name: /^Out-of-scope reason/ });
      const role = page.getByRole("combobox", { name: "DFD role", exact: true });
      const clearButtons = page.getByRole("button", { name: /^Clear (?:stored|inactive|unrecognized) scope reason$/ });
      await selectNode("n_api");
      const before = await exportModel(page);
      assert.equal(await clearButtons.count(), 0, "An editable string has no redundant clear button");
      await reason.fill("");
      const cleared = await exportModel(page);
      const expected = structuredClone(before.doc);
      delete expected.scenarios.find(scenario => scenario.id === "s_primary").nodeScopeReasons.n_api;
      assert.deepEqual(cleared.doc, expected, "Clearing the field removes only this scenario's reason");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await reason.inputValue(), "Owned by another team");
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.equal(await reason.inputValue(), "");
      assert.deepEqual((await exportModel(page)).doc, cleared.doc);

      await selectNode("n_client");
      assert.equal(await reason.isDisabled(), true);
      assert.equal(await reason.inputValue(), "Imported external reason");
      const externalBefore = await exportModel(page);
      await page.getByRole("button", { name: "Clear inactive scope reason", exact: true }).press("Enter");
      const externalCleared = await exportModel(page);
      const externalExpected = structuredClone(externalBefore.doc);
      delete externalExpected.scenarios.find(scenario => scenario.id === "s_primary").nodeScopeReasons.n_client;
      assert.deepEqual(externalCleared.doc, externalExpected, "Recovery removes only the inactive evidence explicitly selected");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await reason.inputValue(), "Imported external reason");
      assert.deepEqual((await exportModel(page)).doc, externalBefore.doc);
      await role.selectOption("Process");
      assert.equal(await reason.isEnabled(), true);
      assert.equal(await reason.inputValue(), "Imported external reason", "Changing role does not erase saved evidence");
      assert.equal(await clearButtons.count(), 0, "The clear affordance disappears when the reason becomes editable");
      await role.selectOption("ExternalInteractor");
      assert.equal(await reason.isDisabled(), true);
      assert.equal(await reason.inputValue(), "Imported external reason");
      await page.getByRole("button", { name: "Clear inactive scope reason", exact: true }).waitFor();
      const beforeShowAll = await exportModel(page);
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("");
      await selectNode("n_client");
      assert.equal(await reason.isDisabled(), true);
      assert.equal(await clearButtons.count(), 0, "Show all must not clear an arbitrary scenario");
      assert.deepEqual((await exportModel(page)).doc, beforeShowAll.doc);

      const malformed = structuredClone(input);
      malformed.doc.scenarios[0].nodeScopeReasons.n_api = { invalid: '{"legacyReason":true}' };
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "malformed-reason.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(malformed)),
      });
      await page.getByLabel("Document status").getByText("malformed-reason.tma", { exact: true }).waitFor();
      await selectNode("n_api");
      assert.equal(await reason.inputValue(), "", "Malformed evidence is not silently coerced into editable text");
      await page.locator(".ps-dfd-recovery").filter({ hasText: '{"legacyReason":true}' }).waitFor();
      const malformedBefore = await exportModel(page);
      await page.getByRole("button", { name: "Clear unrecognized scope reason", exact: true }).press("Enter");
      const malformedExpected = structuredClone(malformedBefore.doc);
      delete malformedExpected.scenarios.find(scenario => scenario.id === "s_primary").nodeScopeReasons.n_api;
      assert.deepEqual((await exportModel(page)).doc, malformedExpected);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, malformedBefore.doc, "Undo restores original malformed evidence exactly");
      await reason.fill("Owner clarified the retained reason");
      const replaced = await exportModel(page);
      assert.equal(replaced.doc.scenarios.find(scenario => scenario.id === "s_primary").nodeScopeReasons.n_api,
        "Owner clarified the retained reason");
      assert.equal(await clearButtons.count(), 0, "Explicitly replacing malformed input restores the normal field-only flow");

      for (const blank of ["", " \n "]) {
        const blankInput = structuredClone(input);
        blankInput.doc.scenarios[0].nodeScopeReasons.n_client = blank;
        blankInput.doc.nodes[1].dfdRoleOverride = "UnknownSavedRole";
        const fileName = `blank-reason-${blank.length}.tma`;
        await page.locator("#ps-file-open-input").setInputFiles({
          name: fileName, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(blankInput)),
        });
        await page.getByLabel("Document status").getByText(fileName, { exact: true }).waitFor();
        await selectNode("n_client");
        assert.equal(await reason.isDisabled(), true);
        assert.equal(await reason.inputValue(), blank);
        assert.equal(await clearButtons.count(), 0, "An empty/whitespace external string has no meaningful inactive text to clear");
        assert.equal((await exportModel(page)).doc.scenarios.find(scenario => scenario.id === "s_primary").nodeScopeReasons.n_client,
          blank, "Hiding the redundant affordance never silently erases stored input");
        await selectNode("n_api");
        assert.equal(await reason.isEnabled(), true, "An unresolved role remains conservative and its string reason is editable");
        assert.equal(await reason.inputValue(), "Owned by another team");
        assert.equal(await clearButtons.count(), 0);
      }
    });
  });

  test("regression: app scope Undo and Redo restore complete text and the same editor without reselection", async () => {
    await getHarness().run("regression: scope history gestures and editor context", async ({ page }) => {
      const input = modelFixture();
      input.doc.scenarios[0].nodeScopeReasons = {};
      input.doc.scenarios[1].nodeScopeReasons = { n_api: "Other scenario stays unchanged" };
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "scope-history.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("scope-history.tma", { exact: true }).waitFor();
      const selectedNode = page.locator('.react-flow__node-process[data-id="n_api"]');
      await selectedNode.locator(".ps-node-title").click();
      const reason = page.getByRole("textbox", { name: /^Out-of-scope reason/ });
      const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
      const history = action => page.getByRole("button", { name: action, exact: true }).click();
      const assertEditor = async value => {
        await reason.waitFor({ state: "visible" });
        assert.equal(await reason.inputValue(), value);
        assert.equal(await scenario.inputValue(), "s_primary");
        assert.match(await selectedNode.getAttribute("class"), /\bselected\b/);
        await page.waitForFunction(() => document.activeElement?.id === "ps-inspector-tab-properties");
      };
      const before = await exportModel(page);
      const expectedWithReason = value => {
        const expected = structuredClone(before.doc);
        if (value) expected.scenarios.find(item => item.id === "s_primary").nodeScopeReasons.n_api = value;
        return expected;
      };
      await reason.pressSequentially("synthetic-owner");
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.scenarios
        ?.find(scenario => scenario.id === "s_primary")?.nodeScopeReasons?.n_api === "synthetic-owner", autosaveKey);
      const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey);
      assert.equal(Object.hasOwn(persisted, "scopeReason"), false);
      for (const entry of [persisted.doc, ...persisted.past, ...persisted.future]) {
        assert.equal(Object.hasOwn(entry, "scopeReason"), false, "Local editor context never enters persisted document/history snapshots");
        assert.equal(Object.hasOwn(entry, "editSession"), false);
      }
      await history("Undo");
      await assertEditor("");
      assert.deepEqual((await exportModel(page)).doc, before.doc, "One app Undo restores the pre-typing complete document");
      await history("Redo");
      await assertEditor("synthetic-owner");
      assert.deepEqual((await exportModel(page)).doc, expectedWithReason("synthetic-owner"));

      await reason.focus();
      await reason.press("ControlOrMeta+A");
      await reason.press("Backspace");
      await history("Undo");
      await assertEditor("synthetic-owner");
      assert.deepEqual((await exportModel(page)).doc, expectedWithReason("synthetic-owner"));
      await history("Redo");
      await assertEditor("");
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Redo reapplies deletion without hiding the editor");

      await reason.pressSequentially("one continuous reason");
      await reason.press("ControlOrMeta+A");
      await reason.press("Backspace");
      await history("Undo");
      await assertEditor("one continuous reason");
      assert.deepEqual((await exportModel(page)).doc, expectedWithReason("one continuous reason"),
        "Deletion starts a separate gesture even without a blur after typing");
      await history("Undo");
      await assertEditor("");
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await history("Redo");
      await assertEditor("one continuous reason");
      await history("Redo");
      await assertEditor("");
      await reason.pressSequentially("erase");
      await page.getByRole("textbox", { name: "Title", exact: true }).focus();
      await reason.focus();
      await reason.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
      for (let i = 0; i < 5; i++) await reason.press("Backspace");
      await history("Undo");
      await assertEditor("erase");
      await history("Redo");
      await assertEditor("");

      await reason.pressSequentially("first");
      await page.getByRole("textbox", { name: "Title", exact: true }).focus();
      await reason.pressSequentially(" second");
      await history("Undo");
      await assertEditor("first");
      await history("Undo");
      await assertEditor("");
      await reason.pressSequentially("line one");
      await reason.press("Enter");
      await reason.pressSequentially("line two");
      await history("Undo");
      await assertEditor("line one");
      await history("Redo");
      await assertEditor("line one\nline two");
      assert.deepEqual((await exportModel(page)).doc, expectedWithReason("line one\nline two"),
        "Enter keeps multiline input semantics while separating edit groups");

      const title = page.getByRole("textbox", { name: "Title", exact: true });
      await title.fill("Unrelated title edit");
      await history("Undo");
      assert.equal(await reason.count(), 0, "Non-scope history keeps its existing selection cleanup");
      assert.deepEqual((await exportModel(page)).doc, expectedWithReason("line one\nline two"),
        "A different field remains a separate document transaction");
      await history("Undo");
      await assertEditor("line one");
      assert.deepEqual((await exportModel(page)).doc, expectedWithReason("line one"));

      await selectedNode.focus();
      await selectedNode.press("Delete");
      await selectedNode.waitFor({ state: "detached" });
      assert.equal(await reason.count(), 0);
      await history("Undo");
      await selectedNode.waitFor({ state: "visible" });
      assert.equal(await reason.count(), 0, "Undoing node deletion does not reuse stale scope editor context");
      await history("Undo");
      await assertEditor("");
      assert.deepEqual((await exportModel(page)).doc, before.doc);
    });
  });

  test("regression: same-focus selected scope replacement is one app history gesture", async () => {
    await getHarness().run("regression: scope selected replacement history", async ({ page }) => {
      const input = modelFixture();
      input.doc.scenarios[0].nodeScopeReasons = {};
      input.doc.scenarios[1].nodeScopeReasons = { n_api: "Other scenario stays unchanged" };
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "scope-replacement.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("scope-replacement.tma", { exact: true }).waitFor();
      const selectedNode = page.locator('.react-flow__node-process[data-id="n_api"]');
      await selectedNode.locator(".ps-node-title").click();
      const before = await exportModel(page);
      const reason = page.getByRole("textbox", { name: /^Out-of-scope reason/ });
      const readHistory = async value => {
        await page.waitForFunction(({ key, value }) => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.scenarios
          ?.find(scenario => scenario.id === "s_primary")?.nodeScopeReasons?.n_api === value,
        { key: autosaveKey, value });
        return page.evaluate(key => JSON.parse(localStorage.getItem(key)).past.length, autosaveKey);
      };
      await reason.evaluate(element => {
        window.scopeReplacementEvents = [];
        for (const type of ["input", "blur"]) {
          element.addEventListener(type, event => window.scopeReplacementEvents.push({
            type, inputType: event.inputType, trusted: event.isTrusted,
          }));
        }
      });
      await reason.pressSequentially("first-owner");
      const firstHistory = await readHistory("first-owner");
      await reason.press("ControlOrMeta+A");
      assert.deepEqual(await reason.evaluate(element => ({
        start: element.selectionStart, end: element.selectionEnd, focused: document.activeElement === element,
      })), { start: 0, end: 11, focused: true });
      await reason.pressSequentially("second-owner");
      const replacementHistory = await readHistory("second-owner");
      const events = await page.evaluate(() => window.scopeReplacementEvents);
      assert.equal(events.filter(event => event.type === "blur").length, 0, "Replacement occurs in the same focused editor");
      assert.ok(events.filter(event => event.type === "input").every(event => event.trusted && event.inputType === "insertText"));
      assert.equal(replacementHistory - firstHistory, 1, "The complete replacement creates exactly one history entry");
      const expected = value => {
        const doc = structuredClone(before.doc);
        doc.scenarios.find(scenario => scenario.id === "s_primary").nodeScopeReasons.n_api = value;
        return doc;
      };
      for (const [action, value] of [["Undo", "first-owner"], ["Redo", "second-owner"]]) {
        await page.getByRole("button", { name: action, exact: true }).click();
        await reason.waitFor({ state: "visible" });
        assert.equal(await reason.inputValue(), value);
        assert.match(await selectedNode.getAttribute("class"), /\bselected\b/);
        assert.equal(await page.getByRole("combobox", { name: "Scenario", exact: true }).inputValue(), "s_primary");
        assert.deepEqual((await exportModel(page)).doc, expected(value), "Only the entire targeted reason changes, not a prefix or other field");
      }
    });
  });

  test("regression: scope history stays bounded to its node and active scenario", async () => {
    await getHarness().run("regression: scope history scenario and target boundaries", async ({ page }) => {
      const input = modelFixture();
      input.doc.scenarios[0].nodeScopeReasons = {};
      input.doc.scenarios[1].nodeScopeReasons = {};
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "scope-history-boundaries.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("scope-history-boundaries.tma", { exact: true }).waitFor();
      await measureAllFixtureNodes(page, input.doc.nodes.length, input.view.activeScenarioId);
      const selectNode = id => page.locator(`.react-flow__node-process[data-id="${id}"] .ps-node-title`).click();
      const reason = page.getByRole("textbox", { name: /^Out-of-scope reason/ });
      const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
      const history = action => page.getByRole("button", { name: action, exact: true }).click();
      await selectNode("n_api");
      const before = await exportModel(page);
      await reason.pressSequentially("Scenario A reason");
      await scenario.selectOption("s_archive");
      await reason.pressSequentially("Scenario B reason");
      await history("Undo");
      await reason.waitFor({ state: "visible" });
      assert.equal(await reason.inputValue(), "");
      assert.equal(await scenario.inputValue(), "s_archive");
      assert.match(await page.locator('.react-flow__node-process[data-id="n_api"]').getAttribute("class"), /\bselected\b/);
      assert.equal((await exportModel(page)).doc.scenarios.find(item => item.id === "s_primary").nodeScopeReasons.n_api, "Scenario A reason");
      await history("Undo");
      assert.equal(await scenario.inputValue(), "s_archive", "History does not unexpectedly switch active scenarios");
      assert.equal(await reason.count(), 0, "A different scenario does not receive the old scope editor context");
      assert.deepEqual((await exportModel(page)).doc, before.doc);

      await scenario.selectOption("s_primary");
      await selectNode("n_client");
      await reason.pressSequentially("Client reason");
      await selectNode("n_api");
      await reason.pressSequentially("API reason");
      await history("Undo");
      assert.equal(await reason.inputValue(), "");
      assert.match(await page.locator('.react-flow__node-process[data-id="n_api"]').getAttribute("class"), /\bselected\b/);
      await history("Undo");
      assert.equal(await reason.inputValue(), "");
      assert.match(await page.locator('.react-flow__node-process[data-id="n_client"]').getAttribute("class"), /\bselected\b/);
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await reason.pressSequentially("Client is not in Archive");
      await scenario.selectOption("s_archive");
      await history("Undo");
      assert.equal(await reason.count(), 0, "A nonmember target never becomes selected in the active scenario");
      assert.equal(await scenario.inputValue(), "s_archive");
      assert.deepEqual((await exportModel(page)).doc, before.doc);
    });
  });

  test("regression: DFD scenario and Show all cues preserve complete model geometry", async () => {
    await getHarness().run("regression: DFD view-independent geometry", async ({ page }) => {
      const input = modelFixture();
      for (const [index, role] of ["DataStore", "Process", "ExternalInteractor"].entries()) {
        input.doc.nodes[index].dfdRoleOverride = role;
      }
      for (const scenario of input.doc.scenarios) scenario.nodeIds = input.doc.nodes.map(node => node.id);
      input.doc.scenarios[0].nodeScopeReasons = { n_client: "External ownership", n_api: "Infrastructure" };
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "scope-geometry.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("scope-geometry.tma", { exact: true }).waitFor();
      const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
      const measure = async () => {
        await page.waitForFunction(key => {
          const elements = [...document.querySelectorAll(".react-flow__node-process")];
          const doc = JSON.parse(localStorage.getItem(key) || "null")?.doc;
          return elements.length === 3 && elements.every(element => {
            const node = doc?.nodes.find(node => node.id === element.getAttribute("data-id"));
            return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
          });
        }, autosaveKey);
        return page.locator(".react-flow__node-process").evaluateAll(elements =>
          elements.map(element => ({ id: element.getAttribute("data-id"), width: element.offsetWidth, height: element.offsetHeight }))
            .sort((a, b) => a.id.localeCompare(b.id)));
      };
      const beforeSize = await measure();
      const before = await exportModel(page);
      for (const id of ["s_archive", "", "s_primary", "", "s_archive"]) {
        await scenario.selectOption(id);
        await page.waitForFunction(({ selector, expected }) => {
          const cue = document.querySelector(selector);
          return cue instanceof HTMLElement && cue.getClientRects().length > 0 &&
            getComputedStyle(cue).visibility === "visible" && cue.innerText === expected;
        }, {
          selector: '.react-flow__node-process[data-id="n_api"] .ps-node-semantics',
          expected: `Process\n${id === "s_primary" ? "Out of scope" : id ? "In scope" : "Scope varies by scenario"}`,
        }, { timeout: 6000 });
        assert.deepEqual(await measure(), beforeSize, `Rendered dimensions stay constant in ${id || "Show all"}`);
        assert.deepEqual((await exportModel(page)).doc, before.doc, "View changes preserve every persisted field, including size");
      }
      const viewMenu = page.locator('button[aria-controls="ps-command-menu-view"]');
      await viewMenu.click();
      await page.getByRole("menuitemradio", { name: "Sequence", exact: true }).click();
      await viewMenu.click();
      await page.getByRole("menuitemradio", { name: "Diagram", exact: true }).click();
      assert.deepEqual(await measure(), beforeSize, "Sequence-to-diagram restoration preserves dimensions");
      assert.deepEqual((await exportModel(page)).doc, before.doc);
    });
  });

  test("usability: DFD scope appearance opt-out preserves canvas Space panning", async () => {
    await getHarness().run("usability: canvas Space remains active outside scope summary", async ({ page, observations }) => {
      await measureAllFixtureNodes(page, 3, "s_primary");
      const canvasNode = page.locator('.react-flow__node-process[data-id="n_api"]');
      await canvasNode.locator(".ps-node-title").click();
      const before = await exportModel(page);
      await waitForDfdSavedView(page, before.view);
      const historyBefore = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey);
      await canvasNode.focus();
      assert.equal(await canvasNode.evaluate(element => element === document.activeElement && !element.closest(".nokey")), true);
      const pane = await page.locator(".react-flow__pane").boundingBox();
      assert.ok(pane && pane.width > 40 && pane.height > 40);
      await page.mouse.move(pane.x + 20, pane.y + 20);
      const viewport = page.locator(".react-flow__viewport");
      const readViewport = () => viewport.evaluate(element => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      });
      const initialViewport = await readViewport();
      await page.evaluate(() => {
        window.dfdCanvasSpaceEvents = [];
        window.dfdCanvasSpaceObserver = event => {
          if (event.code !== "Space") return;
          const target = event.target instanceof Element ? event.target : null;
          window.dfdCanvasSpaceEvents.push({
            key: event.key, code: event.code, trusted: event.isTrusted,
            defaultPrevented: event.defaultPrevented,
            canvasOwned: !!target?.closest(".react-flow"),
            optedOut: !!target?.closest(".nokey"),
          });
        };
        window.addEventListener("keydown", window.dfdCanvasSpaceObserver, { passive: true });
      });
      try {
        await page.keyboard.down("Space");
        await page.waitForFunction(() => window.dfdCanvasSpaceEvents.length === 1);
        await page.mouse.wheel(0, 160);
        await page.waitForFunction(previousY => {
          const element = document.querySelector(".react-flow__viewport");
          return element && new DOMMatrix(getComputedStyle(element).transform).f !== previousY;
        }, initialViewport.y);
        const pannedViewport = await readViewport();
        observations.canvasSpace = await page.evaluate(() => window.dfdCanvasSpaceEvents);
        assert.deepEqual(observations.canvasSpace, [{
          key: " ", code: "Space", trusted: true, defaultPrevented: true, canvasOwned: true, optedOut: false,
        }], "The actual canvas-owned key still reaches normal Space-pan handling");
        assert.notEqual(pannedViewport.y, initialViewport.y);
        assert.equal(pannedViewport.zoom, initialViewport.zoom, "Space plus wheel pans instead of normal wheel zoom");
        observations.viewportBefore = initialViewport;
        observations.viewportAfter = pannedViewport;
      } finally {
        await page.keyboard.up("Space");
        await page.evaluate(() => {
          window.removeEventListener("keydown", window.dfdCanvasSpaceObserver);
          delete window.dfdCanvasSpaceObserver;
          delete window.dfdCanvasSpaceEvents;
        });
      }
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey), historyBefore,
        "Canvas panning preserves the full saved document/view/history");
      assert.deepEqual((await exportModel(page)).doc, before.doc);
    });
  });

  for (const dark of [false, true]) {
    for (const viewport of [{ width: 1517, height: 1163 }, { width: 320, height: 640 }]) {
      const name = `usability: DFD scope appearance disclosure spacing and keyboard at ${viewport.width}px (${dark ? "dark" : "light"})`;
      test(name, async () => {
        await getHarness().run(name, async ({ page, observations }) => {
          const input = modelFixture();
          input.doc.nodeTypes[0].definition.endpointRegex = "^https://synthetic\\.invalid/";
          input.doc.scenarios[0].nodeScopeReasons = { n_api: "Synthetic external ownership." };
          await page.locator("#ps-file-open-input").setInputFiles({
            name: "scope-appearance.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
          });
          await page.getByLabel("Document status").getByText("scope-appearance.tma", { exact: true }).waitFor();
          const settings = page.getByRole("button", { name: "Settings", exact: true });
          await settings.click();
          const theme = page.getByRole("menuitemcheckbox", { name: /Dark Theme/ });
          if ((await theme.getAttribute("aria-checked") === "true") !== dark) await theme.click();
          await page.waitForFunction(expected => document.querySelector(".ps-shell")?.classList.contains("ps-theme-dark") === expected, dark);
          if (await settings.getAttribute("aria-expanded") === "true") await settings.click();
          await measureAllFixtureNodes(page, 3, "s_primary");
          await page.locator('.react-flow__node-process[data-id="n_api"] .ps-node-title').click();
          await page.setViewportSize(viewport);
          await page.waitForFunction(key => {
            const doc = JSON.parse(localStorage.getItem(key) || "null")?.doc;
            const nodes = [...document.querySelectorAll(".react-flow__node-process")];
            return nodes.length === 2 && nodes.every(element => {
              const node = doc?.nodes.find(item => item.id === element.getAttribute("data-id"));
              return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
            });
          }, autosaveKey);
          const summary = page.locator(".ps-details > details > summary")
            .filter({ hasText: "Scope appearance (this browser)" });
          const details = page.locator(".ps-details > details");
          const otherCard = page.locator(".ps-details > .ps-node-type-summary")
            .filter({ hasText: "Instance metadata differs" });
          assert.equal(await otherCard.count(), 1, "Exercise a real card outside the disclosure adjacency");
          const before = await exportModel(page);
          await waitForDfdSavedView(page, before.view);
          const historyBefore = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey);
          const readLayout = async () => {
            await summary.scrollIntoViewIfNeeded();
            return summary.evaluate(element => {
              const disclosure = element.parentElement;
              const card = disclosure.nextElementSibling;
              if (!(disclosure instanceof HTMLDetailsElement) || !(card instanceof HTMLElement)
                || !card.matches(".ps-node-type-summary")) throw new Error("Expected native disclosure followed by its type card");
              const rect = node => {
                const r = node.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
              };
              const range = document.createRange();
              range.selectNodeContents(element);
              return {
                open: disclosure.open, summary: rect(element), details: rect(disclosure), card: rect(card),
                cardMarginTop: getComputedStyle(card).marginTop,
                text: [...range.getClientRects()].map(r => ({
                  top: r.top, bottom: r.bottom, left: r.left, right: r.right,
                })),
              };
            });
          };
          const checkLayout = async open => {
            const layout = await readLayout();
            assert.equal(layout.open, open);
            assert.equal(layout.cardMarginTop, "8px");
            assert.ok(layout.card.top - layout.details.bottom >= 8,
              "The following card leaves eight CSS pixels after the whole disclosure, not just a nonnegative gap");
            for (const text of layout.text) {
              assert.ok(text.top >= layout.summary.top && text.bottom <= layout.summary.bottom);
              assert.ok(text.left >= layout.summary.left && text.right <= layout.summary.right);
              assert.ok(layout.card.top > text.bottom, "The card border cannot enter the summary text rectangle");
            }
            assert.equal(await otherCard.evaluate(element => getComputedStyle(element).marginTop), "-4px",
              "Cards outside the disclosure adjacency retain their existing spacing");
            return layout;
          };
          const checkFocus = async locator => assert.equal(
            await locator.evaluate(element => element === document.activeElement), true);
          const waitOpen = open => page.waitForFunction(expected =>
            document.querySelector(".ps-details > details")?.open === expected, open);
          await summary.focus();
          await checkFocus(summary);
          observations.collapsed = await checkLayout(false);
          await summary.press("Enter");
          await waitOpen(true);
          await checkFocus(summary);
          observations.expanded = await checkLayout(true);
          const outOfScope = details.getByLabel("Out-of-scope accent", { exact: true });
          const external = details.getByLabel("External Interactor accent", { exact: true });
          await summary.press("Tab");
          await checkFocus(outOfScope);
          await outOfScope.press("Tab");
          await checkFocus(external);
          await external.press("Shift+Tab");
          await checkFocus(outOfScope);
          await outOfScope.press("Shift+Tab");
          await checkFocus(summary);
          await summary.press("Space");
          await waitOpen(false);
          await checkFocus(summary);
          observations.collapsedAgain = await checkLayout(false);
          await summary.press("Tab");
          await checkFocus(otherCard.getByRole("button", { name: "Use type metadata", exact: true }));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          const inventory = page.getByRole("textbox", { name: "Inventory ID", exact: true });
          await inventory.scrollIntoViewIfNeeded();
          assert.equal(await inventory.isVisible(), true);
          assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey), historyBefore,
            "Disclosure focus, expansion and scrolling preserve the entire saved document/view/history");
          assert.deepEqual((await exportModel(page)).doc, before.doc,
            "Native disclosure interactions preserve every document field, including geometry");
        });
      });
    }
  }

  test("usability: DFD semantic labels, keyboard role selection and scenario-only editing at narrow width", async () => {
    await getHarness().run("usability: DFD controls", async ({ page }) => {
      await page.locator('.react-flow__node-process[data-id="n_api"] .ps-node-title').click();
      const role = page.getByRole("combobox", { name: "DFD role", exact: true });
      assert.equal(await role.inputValue(), "legacy");
      await role.focus();
      await role.press("e");
      await role.press("Enter");
      assert.equal(await role.inputValue(), "ExternalInteractor");
      assert.match(await page.locator('.react-flow__node-process[data-id="n_api"]').getAttribute("aria-label"), /External Interactor/);
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("");
      assert.equal(await page.getByRole("textbox", { name: /^Out-of-scope reason/ }).isDisabled(), true);
      assert.match(await page.locator(".ps-details").innerText(), /Primary: External/);
    });
  });
}
