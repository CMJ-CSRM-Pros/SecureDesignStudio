import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveKey, modelFixture, scenarioDfdJsonFixture } from "./fixture.mjs";
import { until } from "./harness.mjs";

const fileButton = page => page.locator('button[aria-controls="ps-command-menu-file"]');
const input = page => page.locator("#ps-tmc-import-input");
const confirmation = 'Importing scenario/DFD JSON will REPLACE the current diagram (undoable with Ctrl+Z). This command requires the supported "scenarios" and "dfds" structure, not arbitrary JSON. Use File > Open for native model JSON. Continue?';

async function stubDialogs(page, accept = true) {
  await page.evaluate(({ accept, confirmation }) => {
    window.jsonImportAlerts = [];
    window.jsonImportConfirmations = [];
    window.confirm = message => {
      if (message !== confirmation) throw new Error(`Unexpected confirmation: ${message}`);
      window.jsonImportConfirmations.push(message);
      return accept;
    };
    window.alert = message => window.jsonImportAlerts.push(String(message));
  }, { accept, confirmation });
}

async function chooseJson(page, raw) {
  await fileButton(page).click();
  const command = page.getByRole("menuitem", { name: "Import JSON format…", exact: true });
  assert.match(await command.getAttribute("title"), /supported "scenarios" and "dfds".*Not arbitrary JSON.*File > Open/);
  const event = page.waitForEvent("filechooser");
  await command.click();
  const chooser = await event;
  assert.equal(await chooser.element().getAttribute("accept"), "application/json,.json");
  await chooser.setFiles({
    name: "scenario-dfd.json", mimeType: "application/json",
    buffer: Buffer.from(typeof raw === "string" ? raw : JSON.stringify(raw)),
  });
}

async function alertAt(page, index = 0) {
  await page.waitForFunction(index => window.jsonImportAlerts.length > index, index);
  return page.evaluate(index => window.jsonImportAlerts[index], index);
}

async function fileFocused(page) {
  await until(() => fileButton(page).evaluate(el => el === document.activeElement), "JSON importer File focus");
}

async function uploadNative(page, model, name) {
  await page.locator("#ps-file-open-input").setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
  });
  await page.getByLabel("Document status").getByText(name.endsWith(".tma") ? name : `${name}.tma`, { exact: true }).waitFor();
}

async function measureAllNodes(page, count, restoreScenario) {
  const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
  await scenario.selectOption("");
  await page.waitForFunction(({ count, key }) => {
    const elements = [...document.querySelectorAll(".react-flow__node-process")];
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    const doc = saved?.doc;
    return document.querySelector('select[aria-label="Scenario"]')?.value === "" &&
      saved?.view?.activeScenarioId === null &&
      elements.length === count && elements.every(element => {
      const node = doc?.nodes.find(node => node.id === element.getAttribute("data-id"));
      return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
    });
  }, { count, key: autosaveKey });
  await scenario.selectOption(restoreScenario);
  await page.waitForFunction(({ key, restoreScenario }) => {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return document.querySelector('select[aria-label="Scenario"]')?.value === restoreScenario &&
      saved?.view?.activeScenarioId === (restoreScenario || null);
  }, { key: autosaveKey, restoreScenario });
}

export function registerJsonImportContracts({ getHarness, exportModel }) {
  test("usability: JSON format command distinguishes native Open and preserves confirmation and picker cancellation", async () => {
    await getHarness().run("usability: JSON format command and cancellation", async ({ page }) => {
      const before = await exportModel(page);
      assert.equal(await input(page).getAttribute("aria-label"), "Choose a supported scenario/DFD JSON file");
      for (const width of [1366, 320]) {
        await page.setViewportSize({ width, height: 640 });
        await stubDialogs(page, false);
        let chooserCount = 0;
        const onChooser = () => { chooserCount++; };
        page.on("filechooser", onChooser);
        await fileButton(page).focus();
        await fileButton(page).press("ArrowDown");
        const command = page.getByRole("menuitem", { name: "Import JSON format…", exact: true });
        await command.waitFor();
        assert.equal(await page.getByRole("menuitem", { name: /TMC/ }).count(), 0);
        assert.equal(await page.getByRole("menuitem", { name: /^Open/ }).count(), 1);
        assert.equal(await page.getByRole("menuitem", { name: "Threat Modeling Tool (.tm7)…", exact: true }).count(), 1);
        const rect = await command.boundingBox();
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1);
        await command.focus();
        await command.press("Enter");
        await fileFocused(page);
        assert.equal(await page.evaluate(() => window.jsonImportConfirmations.length), 1);
        assert.equal(chooserCount, 0);
        page.off("filechooser", onChooser);
        assert.deepEqual((await exportModel(page)).doc, before.doc);

        await stubDialogs(page);
        await fileButton(page).click();
        const event = page.waitForEvent("filechooser");
        await page.getByRole("menuitem", { name: "Import JSON format…", exact: true }).click();
        const chooser = await event;
        assert.equal(await chooser.element().getAttribute("accept"), "application/json,.json");
        await chooser.setFiles([]);
        await input(page).dispatchEvent("cancel");
        await fileFocused(page);
        assert.deepEqual((await exportModel(page)).doc, before.doc);
        assert.equal(await page.evaluate(() => window.jsonImportAlerts.length), 0);
      }
    });
  });

  test("regression: JSON format import rejects invalid schemas without replacing the model or native Open", async () => {
    await getHarness().run("regression: JSON format invalid input", async ({ page }) => {
      const before = await exportModel(page);
      await stubDialogs(page);
      const cases = [
        ["invalid-json", /File is not valid JSON/],
        [modelFixture(), /top-level "scenarios".*Use File > Open/],
        [{ data: [] }, /top-level "scenarios"/],
        [{ scenarios: {} }, /scenarios\.threatModel/],
        [{ scenarios: { threatModel: { scenarios: [] } } }, /top-level "dfds"/],
        [{ scenarios: { threatModel: { scenarios: [] } }, dfds: { items: [] } }, /no scenarios and no diagrams/],
      ];
      for (let i = 0; i < cases.length; i++) {
        await chooseJson(page, cases[i][0]);
        const message = await alertAt(page, i);
        assert.match(message, /^Failed to import JSON format:/);
        assert.match(message, cases[i][1]);
        await fileFocused(page);
        assert.equal(await input(page).inputValue(), "");
        assert.deepEqual((await exportModel(page)).doc, before.doc);
      }
      await uploadNative(page, before, "native-still-supported.json");
      assert.deepEqual((await exportModel(page)).doc, before.doc);
    });
  });

  test("regression: JSON format conversion preserves source identity, scenarios, nested boundaries and replacement history", async () => {
    await getHarness().run("regression: JSON format conversion and recovery", async ({ page }) => {
      await measureAllNodes(page, 3, "s_primary");
      const before = await exportModel(page);
      await stubDialogs(page);
      await chooseJson(page, scenarioDfdJsonFixture());
      assert.equal(await alertAt(page),
        "Imported 3 scenarios from scenario/DFD JSON.\nNodes: 4 unique source instances (from 5 records).\nBoundaries: 2.\nEdges: 4.\nSplit 1 multi-numbered label into separate edges.\nSkipped 1 freetext annotation (this external importer does not map them to native canvas text).\nSkipped 2 edges whose source/target was a freetext, boundary, or unknown id.\n1 scenario had no diagram and were imported empty.\n1 diagram in the export had no matching scenario and were ignored.");
      await fileFocused(page);
      const primaryId = await page.getByRole("combobox", { name: "Scenario", exact: true }).inputValue();
      await measureAllNodes(page, 4, primaryId);
      const saved = await exportModel(page), doc = saved.doc;
      assert.deepEqual(doc.scenarios.map(s => s.name), ["JSON primary", "JSON archive", "JSON empty"]);
      assert.equal(saved.view.activeScenarioId, doc.scenarios[0].id);
      assert.deepEqual(saved.view.filter, { text: "", nodeType: "", authType: "", dataClassification: "" });
      assert.equal(doc.nodes.length, 4);
      assert.equal(doc.edges.length, 4);
      assert.equal(doc.boundaries.length, 2);
      assert.equal(doc.nodes.some(n => n.id === "n_client"), false, "Import replaces rather than merges");
      const client = doc.nodes.find(n => n.title === "Client");
      const api = doc.nodes.find(n => n.title === "API" && n.position.x === 320);
      assert.deepEqual(client.position, { x: 130, y: 120 });
      assert.deepEqual(api.position, { x: 320, y: 150 });
      assert.equal(new Set(doc.nodes.filter(n => n.title === "API").map(n => n.id)).size, 2);
      assert.deepEqual(doc.boundaries.find(b => b.title === "Inner").position, { x: 300, y: 120 });
      const primaryEdges = doc.scenarios[0].edgeIds.map(id => doc.edges.find(e => e.id === id));
      assert.deepEqual(primaryEdges.map(e => e.title), ["Reply", "Send", "Follow-up"]);
      assert.deepEqual(primaryEdges.map(e => [e.source, e.target]), [[api.id, client.id], [client.id, api.id], [client.id, api.id]]);
      assert.equal(primaryEdges[1].description, "Opaque detail");
      assert.deepEqual(Object.values(doc.scenarios[0].edgeNumbers), [1, 2, 3]);
      assert.ok(doc.edges.every(e => e.waypoints.length === 1 && e.authenticationTypes === undefined));
      assert.deepEqual(doc.data, []);
      assert.deepEqual(doc.scenarios[2].nodeIds, []);
      assert.equal(doc.nodes.every(n => !n.type), true);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, doc);
      await chooseJson(page, scenarioDfdJsonFixture());
      await alertAt(page, 1);
      await measureAllNodes(page, 4, primaryId);
      assert.deepEqual((await exportModel(page)).doc, doc, "Repeated source imports produce the same model");
      await uploadNative(page, before, "clear-json-import.tma");
      await uploadNative(page, saved, "json-import-reopened.tma");
      assert.deepEqual((await exportModel(page)).doc, doc);
      await page.reload();
      await page.getByLabel("Document status").getByText("Local mode", { exact: true }).waitFor();
      assert.deepEqual((await exportModel(page)).doc, doc);
    });
  });
}
