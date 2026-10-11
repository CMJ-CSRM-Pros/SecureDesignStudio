import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture, autosaveKey } from "./fixture.mjs";
import { until } from "./harness.mjs";

const originalGuidance = {
  content: "Synthetic guidance. Ask about ingress; verify controls separately.",
  revision: 2, updatedOn: "2026-10-08", sources: ["https://example.invalid/design"],
};
function fixture() {
  const model = modelFixture();
  model.doc.nodeTypes[0].definition.aiDesignGuidance = originalGuidance;
  model.doc.nodeTypes[0].definition.serviceTreeId = "type-default";
  model.doc.nodeTypes[0].definition.endpointRegex = "^https://default\\.example\\.invalid/";
  model.doc.nodes[0].serviceTreeId = "retained-instance";
  model.doc.nodes[0].endpointRegex = "^https://retained\\.example\\.invalid/";
  return model;
}
const readState = page => page.evaluate(async key => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.dispatchEvent(new Event("pagehide"));
  return JSON.parse(localStorage.getItem(key));
}, autosaveKey);
const importModel = async (page, model, name = "guidance.tma") => {
  await page.locator("#ps-file-open-input").setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
  });
  await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
  const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
  const startingScenario = await scenario.inputValue();
  const waitForMeasuredNodes = ids => page.waitForFunction(({ ids, key }) => {
    window.dispatchEvent(new Event("pagehide"));
    const doc = JSON.parse(localStorage.getItem(key) ?? "null")?.doc;
    const elements = [...document.querySelectorAll(".react-flow__node-process")];
    return elements.length === ids.length && ids.every(id => {
      const element = elements.find(element => element.getAttribute("data-id") === id);
      const node = doc?.nodes.find(node => node.id === id);
      return element && element.offsetWidth > 0 && element.offsetHeight > 0
        && node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
    });
  }, { ids, key: autosaveKey });
  // Hidden nodes need their first real measurement before a full-document/history baseline.
  await scenario.selectOption("");
  await waitForMeasuredNodes(model.doc.nodes.map(node => node.id));
  await scenario.selectOption(startingScenario);
  await waitForMeasuredNodes(startingScenario
    ? model.doc.scenarios.find(item => item.id === startingScenario).nodeIds
    : model.doc.nodes.map(node => node.id));
};
const openGuidance = async page => {
  await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
  const section = page.locator(".ps-node-guidance");
  if (!await section.evaluate(element => element.open)) await section.locator("summary").click();
  return section;
};

export function registerAiGuidanceContracts({ getHarness, exportModel }) {
  test("regression: AI guidance edits are type-wide, inert, atomic and undoable without changing instances", async () => {
    await getHarness().run("regression: AI guidance editing and history", async ({ page }) => {
      await importModel(page, fixture());
      const section = await openGuidance(page);
      const before = await exportModel(page);
      const history = await readState(page);
      await section.getByRole("button", { name: "Edit guidance for this type in this diagram", exact: true }).click();
      await section.getByRole("textbox", { name: "Guidance content", exact: true }).fill("Cancelled");
      await page.keyboard.press("Escape");
      await until(() => section.getByRole("button", { name: "Edit guidance for this type in this diagram", exact: true }).evaluate(el => el === document.activeElement), "Guidance cancel returns focus to the exact edit trigger");
      assert.equal(await section.getByRole("button", { name: "Edit guidance for this type in this diagram", exact: true }).evaluate(el => el === document.activeElement), true);
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await section.getByRole("button", { name: "Edit guidance for this type in this diagram", exact: true }).click();
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      assert.equal((await readState(page)).past.length, history.past.length, "Unchanged save does not add history");
      await section.getByRole("button", { name: "Edit guidance for this type in this diagram", exact: true }).click();
      await section.getByLabel("Authored revision", { exact: true }).fill("0");
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      assert.deepEqual((await readState(page)).doc, history.doc, "Invalid metadata never partially mutates");
      const content = "Literal </script><script>globalThis.SDS_SYNTHETIC_EXECUTED=true</script>\n<img src=x onerror=alert(1)>\nAsk the owner to verify the proposed control.";
      await section.getByLabel("Authored revision", { exact: true }).fill("3");
      await section.getByRole("textbox", { name: "Guidance content", exact: true }).fill(content);
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      assert.equal(await section.locator(".ps-guidance-content").textContent(), content);
      assert.equal(await page.evaluate(() => globalThis.SDS_SYNTHETIC_EXECUTED), undefined);
      const applied = await exportModel(page);
      const expected = structuredClone(before.doc);
      expected.nodeTypes.find(type => type.id === "nt_browser").definition.aiDesignGuidance = { ...originalGuidance, content, revision: 3 };
      assert.deepEqual(applied.doc, expected, "Only guidance changes, not descriptions, policy, metadata, memberships or geometry");
      assert.equal((await readState(page)).past.length, history.past.length + 1);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, applied.doc);
      await page.reload();
      await openGuidance(page);
      assert.equal(await page.locator(".ps-guidance-content").textContent(), content);
      assert.deepEqual((await exportModel(page)).doc, applied.doc);
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_archive");
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_primary");
      assert.deepEqual((await exportModel(page)).doc, applied.doc, "Scenario switching is view-only");
      await importModel(page, fixture(), "cleared-display.tma");
      await importModel(page, applied, "reopened.tma");
      assert.deepEqual((await exportModel(page)).doc, applied.doc, "Native reopen replaces a different displayed model");
    });
  });

  test("regression: guidance catalog exports, explicit clear and malformed recovery preserve model history", async () => {
    await getHarness().run("regression: AI guidance catalog and recovery", async ({ page }) => {
      await importModel(page, fixture());
      const before = await exportModel(page);
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.getByRole("menuitem", { name: /Node Type Catalog/i }).click();
      const catalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
      const downloadEvent = page.waitForEvent("download");
      await catalog.getByRole("button", { name: "Export custom catalog", exact: true }).click();
      const chunks = [];
      for await (const chunk of await (await downloadEvent).createReadStream()) chunks.push(chunk);
      const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.deepEqual(exported.nodeTypes.find(type => type.id === "nt_browser").definition.aiDesignGuidance, originalGuidance);
      const historyBeforeImport = await readState(page);
      const invalid = structuredClone(exported);
      invalid.nodeTypes[0].definition.aiDesignGuidance.content = "Valid prefix must not be applied.";
      invalid.nodeTypes.push({
        id: "nt_invalid", label: "Invalid synthetic type",
        definition: { ...structuredClone(invalid.nodeTypes[0].definition), aiDesignGuidance: { ...originalGuidance, revision: 0 } },
      });
      await catalog.locator('input[type="file"]').setInputFiles({
        name: "invalid-catalog.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)),
      });
      await catalog.getByRole("alert").filter({ hasText: "Catalog import failed: AI design guidance" }).waitFor();
      assert.deepEqual((await readState(page)).doc, historyBeforeImport.doc);
      assert.deepEqual((await readState(page)).past, historyBeforeImport.past);
      await catalog.locator('input[type="file"]').setInputFiles({
        name: "valid-catalog.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)),
      });
      await catalog.getByText("Imported 1 document node type.", { exact: true }).waitFor();
      await catalog.getByRole("searchbox", { name: "Search node types", exact: true }).fill("Browser test process");
      await catalog.locator(".ps-catalog-row").click();
      await catalog.getByRole("textbox", { name: "Guidance content", exact: true }).fill("Catalog-authored synthetic guidance.");
      await catalog.getByLabel("Authored revision", { exact: true }).fill("4");
      await catalog.getByRole("button", { name: "Save type", exact: true }).click();
      await catalog.getByRole("button", { name: "Close", exact: true }).click();
      const changed = await exportModel(page);
      const expected = structuredClone(before.doc);
      expected.nodeTypes.find(type => type.id === "nt_browser").definition.aiDesignGuidance = {
        ...originalGuidance, content: "Catalog-authored synthetic guidance.", revision: 4,
      };
      assert.deepEqual(changed.doc, expected, "Catalog guidance-only editing must not apply metadata defaults");
      const section = await openGuidance(page);
      await section.getByRole("button", { name: "Edit guidance for this type in this diagram", exact: true }).click();
      await page.evaluate(() => {
        const original = window.confirm;
        window.confirm = message => { window.confirm = original; return message.startsWith("Remove AI design guidance from this draft?"); };
      });
      await section.getByRole("button", { name: "Remove guidance from draft", exact: true }).click();
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      const clear = await exportModel(page);
      const clearExpected = structuredClone(changed.doc);
      delete clearExpected.nodeTypes.find(type => type.id === "nt_browser").definition.aiDesignGuidance;
      assert.deepEqual(clear.doc, clearExpected);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, changed.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, clear.doc);
      const corruptDoc = structuredClone(before.doc);
      corruptDoc.nodeTypes.find(type => type.id === "nt_browser").definition.aiDesignGuidance = null;
      const corrupt = JSON.stringify({ version: 1, doc: clear.doc, past: [corruptDoc], future: [], view: before.view });
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: autosaveKey, value: corrupt });
      await page.reload();
      await page.getByRole("alert").filter({ hasText: "Saved diagram recovery is paused" }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), autosaveKey), corrupt, "Malformed history is retained, not overwritten");
    });
  });

  test("usability: guidance disclosure and inline edit remain keyboard reachable at narrow widths", async () => {
    await getHarness().run("usability: AI guidance narrow keyboard flow", async ({ page }) => {
      await importModel(page, fixture());
      const section = await openGuidance(page);
      const before = await readState(page);
      await page.setViewportSize({ width: 375, height: 700 });
      const edit = section.getByRole("button", { name: "Edit guidance for this type in this diagram", exact: true });
      await edit.focus();
      await page.keyboard.press("Enter");
      assert.equal(await section.getByRole("textbox", { name: "Guidance content", exact: true }).evaluate(el => el === document.activeElement), true);
      await section.getByRole("textbox", { name: "Guidance content", exact: true }).fill("Cancelled keyboard draft.");
      await page.keyboard.press("Escape");
      await until(() => edit.evaluate(el => el === document.activeElement), "Keyboard guidance cancel returns focus to the exact edit trigger");
      assert.equal(await edit.evaluate(el => el === document.activeElement), true);
      assert.deepEqual((await readState(page)).doc, before.doc);
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 700 });
        await edit.scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
        const box = await edit.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, "Edit action fits the viewport");
      }
    });
  });
}
