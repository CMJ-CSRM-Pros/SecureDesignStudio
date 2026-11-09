import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture } from "./fixture.mjs";
import { until } from "./harness.mjs";

async function blankDocument(page) {
  await page.evaluate(() => {
    const original = window.confirm;
    window.confirm = message => {
      window.confirm = original;
      if (message !== "Create a brand-new document? The current diagram will be cleared. You can use Undo (Ctrl+Z) to recover it.") {
        throw new Error("Unexpected confirmation in synthetic New");
      }
      return true;
    };
  });
  await page.locator('button[aria-controls="ps-command-menu-file"]').click();
  await page.getByRole("menuitem", { name: /^New\s/ }).click();
  await until(() => page.locator(".react-flow__node-process").count().then(count => count === 0), "new document");
  const dialog = page.getByRole("dialog", { name: "Create your first scenario", exact: true });
  await dialog.waitFor();
  return dialog;
}

async function chosenInput(page, button) {
  const chooser = page.waitForEvent("filechooser");
  await button.click();
  const fileChooser = await chooser;
  return { fileChooser, id: await fileChooser.element().evaluate(element => element.id) };
}

export function registerFirstRunContracts({ getHarness }) {
  test("regression: first-run dialog opens or imports existing work without a placeholder scenario", async () => {
    await getHarness().run("regression: first-run existing work", async ({ page }) => {
      const dialog = await blankDocument(page);
      const existing = dialog.getByRole("region", { name: "Already have a model?", exact: true });
      const open = existing.getByRole("button", { name: "Open model (.tma)…", exact: true });
      const tm7 = existing.getByRole("button", { name: "Import TM7…", exact: true });
      const json = existing.getByRole("button", { name: "Import JSON…", exact: true });

      await page.setViewportSize({ width: 320, height: 640 });
      for (const button of [open, tm7, json]) {
        const box = await button.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 320, "Existing-work actions fit at 320px");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
        "No horizontal page scroll at 320px");
      await page.setViewportSize({ width: 1366, height: 900 });

      // Cancelled pickers leave the dialog in place and create nothing.
      assert.equal((await chosenInput(page, tm7)).id, "ps-tm7-import-input");
      assert.equal((await chosenInput(page, json)).id, "ps-tmc-import-input");
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await page.getByRole("combobox", { name: "Scenario", exact: true })
        .locator("option").evaluateAll(options => options.filter(option => option.value).length), 0,
        "No placeholder scenario is created");

      const { fileChooser, id } = await chosenInput(page, open);
      assert.equal(id, "ps-file-open-input");
      await fileChooser.setFiles({
        name: "first-run.tma", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(modelFixture())),
      });
      await page.getByLabel("Document status").getByText("first-run.tma", { exact: true }).waitFor();
      await dialog.waitFor({ state: "hidden" });
      const scenarioIds = await page.getByRole("combobox", { name: "Scenario", exact: true })
        .locator("option").evaluateAll(options => options.map(option => option.value).filter(Boolean));
      assert.deepEqual(scenarioIds.sort(), modelFixture().doc.scenarios.map(scenario => scenario.id).sort(),
        "Only the opened model's scenarios exist");
    });
  });
}
