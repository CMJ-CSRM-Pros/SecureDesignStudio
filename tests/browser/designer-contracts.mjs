import assert from "node:assert/strict";
import { test } from "node:test";
import { withAtomicStore, commitAtomicStore, readAtomicStore } from "./dfd-contracts.mjs";
import { until } from "./harness.mjs";
import { publicPowerPlatformPrompt, publicPowerPlatformDesignFixture } from "./fixture.mjs";

export function registerDesignerContracts({ getHarness }) {
  test("regression: default Power Pages Copilot Studio Dataverse design uses real choices and one coherent Undo step", async () => {
    await getHarness().run("regression: public Power Platform design history", async ({ page }) => {
      await withAtomicStore(page, async () => {
        await commitAtomicStore(page, () => window.atomicStore.newDocument());
        const before = await readAtomicStore(page);
        const applied = await commitAtomicStore(page, ({ response, question }) => {
          const store = window.atomicStore;
          const expected = store.prepareThreatModelDesign();
          window.publicProductRequest = { mode: "design", question, history: [], context: expected.context };
          store.applyThreatModelDesign(response, expected);
        }, { response: publicPowerPlatformDesignFixture(), question: publicPowerPlatformPrompt });
        const request = await page.evaluate(() => window.publicProductRequest);
        assert.equal(request.question, publicPowerPlatformPrompt);
        for (const id of ["PowerPages", "CopilotStudio", "Dataverse", "Dataverse Table", "Dataverse Plugin", "PowerPlatformConnectors"]) {
          assert.ok(request.context.catalog.nodeTypes.some(type => type.id === id), `${id} is an actual default choice`);
          assert.ok(request.context.aiDesignGuidance.some(entry => entry.typeId === id));
        }
        assert.deepEqual(applied.doc.nodes.map(node => node.type), ["", "PowerPages", "CopilotStudio", "Dataverse"]);
        assert.deepEqual(applied.doc.nodes.map(node => node.dfdRoleOverride), ["ExternalInteractor", "Process", "Process", "DataStore"]);
        assert.equal(applied.saved.past.length, before.saved.past.length + 1);
        assert.deepEqual(applied.saved.doc, applied.doc);
        assert.deepEqual((await commitAtomicStore(page, () => window.atomicStore.undo())).doc, before.doc);
        assert.deepEqual((await commitAtomicStore(page, () => window.atomicStore.redo())).doc, applied.doc);
        const exported = await page.evaluate(() => window.atomicStore.exportJson());
        await commitAtomicStore(page, () => window.atomicStore.newDocument());
        const reopened = await commitAtomicStore(page, json => window.atomicStore.importJson(JSON.parse(json)), exported);
        assert.deepEqual(reopened.doc, applied.doc);
        assert.deepEqual(reopened.authenticationLibrary, before.authenticationLibrary);
        assert.deepEqual(reopened.classificationLibrary, before.classificationLibrary);
      });
    });
  });

  test("regression: AI global deletion and rerouting restore complete shared models with one Undo", async () => {
    await getHarness().run("regression: AI full graph edits", async ({ page }) => {
      await withAtomicStore(page, async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        const before = await readAtomicStore(page);
        const edited = await commitAtomicStore(page, () => {
          const store = window.atomicStore;
          window.fullEditResponse = {
            answer: "Replace API with new gateway", assumptions: [], design: {
              scenario: {},
              remove: { nodeIds: ["n_api"], edgeIds: ["e_parallel"], boundaryIds: [] },
              nodes: [{ id: "gateway", type: "nt_browser", title: "Gateway", description: "Proposed secured ingress", dfdRole: "Process" }],
              edges: [{ id: "e_request", source: "n_client", target: "gateway", title: "Through gateway",
                description: "Gateway replaces old endpoint", authenticationType: null, requestDataIds: [], responseDataIds: [], dataMode: "replace" }],
              boundaries: [], data: [],
            },
          };
          const result = store.applyThreatModelDesign(window.fullEditResponse, store.prepareThreatModelDesign());
          window.fullEditResult = result;
        });
        assert.equal(edited.doc.nodes.some(node => node.id === "n_api"), false);
        assert.deepEqual(edited.doc.edges.map(edge => edge.id), ["e_request"]);
        assert.equal(edited.doc.scenarios.find(s => s.id === "s_archive").nodeIds.includes("n_api"), false);
        assert.deepEqual(edited.doc.scenarios.find(s => s.id === "s_archive").edgeIds, []);
        assert.equal(edited.saved.past.length, before.saved.past.length + 1);
        assert.deepEqual(edited.doc.data, before.doc.data);
        assert.equal(await page.evaluate(() => window.fullEditResult.changed), true);
        assert.match(await page.evaluate(() => window.fullEditResult.summary), /3 deleted; 1 connections rerouted/);
        const rejected = await page.evaluate(() => {
          try { window.atomicStore.applyThreatModelDesign(window.fullEditResponse, window.atomicStore.prepareThreatModelDesign()); }
          catch (error) { return error.message; }
        });
        assert.match(rejected, /unknown element/);
        const undone = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undone.doc, before.doc);
        const redone = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.deepEqual(redone.doc, edited.doc);
        assert.deepEqual(redone.saved.doc, edited.doc, "Autosave keeps the resulting full edit");
      });
    });
  });

  test("regression: AI designer scenario-only patches have one Undo step and repeated patches preserve history", async () => {
    await getHarness().run("regression: AI designer scenario-only history", async ({ page }) => {
      await withAtomicStore(page, async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        const before = await readAtomicStore(page);
        let previous = before;
        for (const patch of [{ name: "Private document hosting" }, { description: "Updated design requirements" }, { description: "" }]) {
          const apply = patch => {
            const store = window.atomicStore;
            store.applyThreatModelDesign({
              answer: "Updated scenario only.", assumptions: [],
              design: { scenario: patch, nodes: [], edges: [], boundaries: [], data: [] },
            }, store.prepareThreatModelDesign());
          };
          const applied = await commitAtomicStore(page, apply, patch);
          const expected = structuredClone(previous.doc);
          Object.assign(expected.scenarios.find(scenario => scenario.id === "s_primary"), patch);
          assert.deepEqual(applied.doc, expected);
          assert.equal(applied.saved.past.length, previous.saved.past.length + 1);
          assert.deepEqual(applied.saved.future, []);
          await page.evaluate(apply, patch);
          await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
          const repeated = await readAtomicStore(page);
          assert.deepEqual(repeated.doc, applied.doc);
          assert.deepEqual(repeated.saved.past, applied.saved.past);
          assert.deepEqual(repeated.saved.future, applied.saved.future);
          const undone = await commitAtomicStore(page, () => window.atomicStore.undo());
          assert.deepEqual(undone.doc, previous.doc, "One Undo restores the complete prior model");
          const redone = await commitAtomicStore(page, () => window.atomicStore.redo());
          assert.deepEqual(redone.doc, applied.doc);
          previous = redone;
        }
        for (let index = 0; index < 3; index++) {
          await commitAtomicStore(page, () => window.atomicStore.undo());
        }
        assert.deepEqual((await readAtomicStore(page)).doc, before.doc);
      });
    });
  });

  test("regression: AI designer applies one atomic history entry per response and rejects stale results", async () => {
    await getHarness().run("regression: AI designer atomic history", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const result = await page.evaluate(() => {
          const store = window.atomicStore;
          const initial = store.prepareThreatModelDesign();
          const response = title => ({
            answer: "Synthetic proposed design", assumptions: [],
            design: {
              scenario: { name: initial.context.scenario.name, description: initial.context.scenario.description },
              nodes: [{ id: title, title, description: "Proposed control.", type: "nt_browser", dfdRole: "Process" }],
              edges: [], boundaries: [], data: [],
            },
          });
          store.setNodeSize("n_client", { width: 211, height: 101 });
          const measured = store.prepareThreatModelDesign();
          store.applyThreatModelDesign(response("first"), initial);
          const first = store.prepareThreatModelDesign();
          store.applyThreatModelDesign(response("second"), first);
          const second = store.prepareThreatModelDesign();
          store.undo();
          const undoSecond = store.prepareThreatModelDesign();
          store.undo();
          const undoFirst = store.prepareThreatModelDesign();
          store.redo();
          const redoFirst = store.prepareThreatModelDesign();
          let stale;
          try { store.applyThreatModelDesign(response("stale"), measured); }
          catch (error) { stale = error.message; }
          const afterStale = store.prepareThreatModelDesign();
          return { measured, first, second, undoSecond, undoFirst, redoFirst, stale, afterStale };
        });
        assert.equal(result.first.context.nodes.length, 3);
        assert.equal(result.second.context.nodes.length, 4);
        assert.deepEqual(result.undoSecond, result.first);
        assert.deepEqual(result.undoFirst, result.measured);
        assert.deepEqual(result.redoFirst, result.first);
        assert.match(result.stale, /changed while AI was working/);
        assert.deepEqual(result.afterStale, result.redoFirst);
      });
    });
  });

  test("regression: AI designer clarification, invalid output and changed catalogs leave document and history untouched", async () => {
    await getHarness().run("regression: AI designer validation gates", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const before = await readAtomicStore(page);
        const checks = await page.evaluate(() => {
          const store = window.atomicStore;
          const expected = store.prepareThreatModelDesign();
          const response = {
            answer: "Proposed", assumptions: [], design: {
              scenario: { name: expected.context.scenario.name, description: expected.context.scenario.description },
              nodes: [{ id: "proposal", title: "Proposed", description: "", type: "nt_browser", dfdRole: "Process" }],
              edges: [], boundaries: [], data: [],
            },
          };
          store.applyThreatModelDesign({ answer: "Clarify", assumptions: [], design: null }, expected);
          const errors = [];
          for (const mutate of [
            value => { value.design.nodes[0].type = "missing"; },
            value => { value.extra = true; },
            value => { value.design.edges.push({ id: "flow", source: "missing", target: "proposal", title: "Flow", description: "",
              authenticationType: null, requestDataIds: [], responseDataIds: [] }); },
          ]) {
            const invalid = structuredClone(response);
            mutate(invalid);
            try { store.applyThreatModelDesign(invalid, expected); errors.push(null); }
            catch (error) { errors.push(error.message); }
          }
          window.designerExpected = expected;
          window.designerResponse = response;
          return errors;
        });
        assert.ok(checks.every(Boolean));
        const unchanged = await readAtomicStore(page);
        assert.deepEqual(unchanged.doc, before.doc);
        assert.equal(unchanged.canUndo, before.canUndo);
        assert.equal(unchanged.canRedo, before.canRedo);
        await commitAtomicStore(page, () => {
          window.atomicStore.setAuthenticationMethodDisabled(window.atomicStore.authenticationLibrary[0].id, true);
        });
        const changed = await readAtomicStore(page);
        const error = await page.evaluate(() => {
          try { window.atomicStore.applyThreatModelDesign(window.designerResponse, window.designerExpected); }
          catch (error) { return error.message; }
        });
        assert.match(error, /model, scenario or catalog changed/);
        assert.deepEqual((await readAtomicStore(page)).doc, changed.doc);
        await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual((await readAtomicStore(page)).doc, before.doc, "Rejected response must not create an extra history step");
      });
    });
  });

  test("usability: AI designer dialog is reachable, local-disabled and responsive without network access", async () => {
    await getHarness().run("usability: AI designer dialog", async ({ page }) => {
      const modules = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => new URL(entry.name).pathname));
      assert.ok(modules.includes("/shared/designContract.ts"), "Local Vite loads the single shared contract outside service routes");
      assert.equal(modules.some(path => /^\/api(?:\/|$)/i.test(path)), false, "API traffic remains forbidden, including source-module requests");
      const model = page.locator('button[aria-controls="ps-command-menu-model"]');
      await model.click();
      assert.equal(await page.getByRole("menuitem", { name: /Design with AI/ }).count(), 0,
        "The builder belongs to File, not Model");
      await page.keyboard.press("Escape");
      const trigger = page.locator('button[aria-controls="ps-command-menu-file"]');
      await trigger.click();
      const menuItems = await page.getByRole("menu").getByRole("menuitem").allTextContents();
      const openIndex = menuItems.findIndex(text => text.startsWith("Open"));
      assert.ok(openIndex >= 0);
      assert.match(menuItems[openIndex + 1], /^Design with AI/, "Design with AI sits directly below Open");
      await page.getByRole("menuitem", { name: /Design with AI/ }).click();
      const dialog = page.getByRole("dialog", { name: "Threat Model Designer", exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Build design", exact: true }).isDisabled(), true);
      await dialog.getByRole("status").filter({ hasText: /credential-free local mode/ }).waitFor();
      for (const [width, height] of [[1366, 640], [480, 640], [320, 640], [320, 400]]) {
        await page.setViewportSize({ width, height });
        await until(async () => {
          const toolbar = await page.locator(".ps-command-bar").boundingBox();
          const box = await dialog.boundingBox();
          return box.y >= toolbar.y + toolbar.height && box.y + box.height <= height;
        }, "designer stays below the wrapped command bar and inside the viewport");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
        const file = page.locator('button[aria-controls="ps-command-menu-file"]');
        await file.click();
        await page.getByRole("menuitem", { name: /^Open…/ }).waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await dialog.isVisible(), true, "Closing the toolbar menu must leave the designer open");
        await dialog.getByRole("button", { name: "Collapse", exact: true }).click();
        assert.equal(await dialog.locator("#ps-designer-content").isVisible(), false);
        await page.getByRole("button", { name: "Zoom out", exact: true }).click();
        await dialog.getByRole("button", { name: "Expand", exact: true }).click();
        await dialog.getByRole("button", { name: "Close Threat Model Designer" }).click();
        await dialog.waitFor({ state: "detached" });
        await trigger.click();
        await page.getByRole("menuitem", { name: /Design with AI/ }).click();
        await dialog.waitFor();
        await dialog.getByRole("button", { name: "Close Threat Model Designer" }).focus();
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-controls") === "ps-command-menu-file");
    });
  });
}
