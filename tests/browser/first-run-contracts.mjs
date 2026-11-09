import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveKey, modelFixture, scenarioDfdJsonFixture } from "./fixture.mjs";
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

async function cancelChooser(fileChooser) {
  await fileChooser.setFiles([]);
  await fileChooser.element().dispatchEvent("cancel");
}

async function savedModelAndHistory(page) {
  return page.evaluate(key => {
    window.dispatchEvent(new Event("pagehide"));
    const { doc, past, future } = JSON.parse(localStorage.getItem(key));
    return { doc, past, future };
  }, autosaveKey);
}

const firstRunTm7 = `<ThreatModel xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
  <DrawingSurfaceList><DrawingSurfaceModel><Guid>70000000-0000-4000-8000-000000000001</Guid>
    <Borders><KeyValueOfguidanyType><Key>70000000-0000-4000-8000-000000000002</Key><Value i:type="StencilEllipse">
      <GenericTypeId>GE.P</GenericTypeId><Guid>70000000-0000-4000-8000-000000000002</Guid><TypeId>GE.P</TypeId>
      <Properties><anyType><DisplayName>Name</DisplayName><Value>First-run process</Value></anyType></Properties>
      <Left>100</Left><Top>100</Top><Width>100</Width><Height>100</Height>
    </Value></KeyValueOfguidanyType></Borders><Lines />
  </DrawingSurfaceModel></DrawingSurfaceList>
  <Notes>Synthetic unsupported detail must be disclosed.</Notes>
</ThreatModel>`;

async function recordImportDialogs(page, acceptTm7 = true) {
  await page.evaluate(accept => {
    window.firstRunAlerts = [];
    window.firstRunConfirmations = [];
    window.alert = message => window.firstRunAlerts.push(String(message));
    window.confirm = message => {
      if (!message.startsWith("Import 1 scenario from TM7") ||
          !message.includes("Notes content is not imported.") ||
          !message.endsWith("REPLACE the current diagram (undoable with Ctrl+Z)?")) {
        throw new Error(`Unexpected first-run confirmation: ${message}`);
      }
      window.firstRunConfirmations.push(message);
      return accept;
    };
  }, acceptTm7);
}

export function registerFirstRunContracts({ getHarness }) {
  test("usability: first-run keyboard traversal stays inside the blocking dialog", async () => {
    await getHarness().run("usability: first-run keyboard boundaries", async ({ page }) => {
      await page.addInitScript(key => localStorage.removeItem(key), autosaveKey);
      await page.reload();
      const dialog = page.getByRole("dialog", { name: "Create your first scenario", exact: true });
      await dialog.waitFor();
      await until(() => dialog.getByLabel("Title", { exact: true })
        .evaluate(element => element === document.activeElement), "first-launch Title focus");
      await dialog.getByRole("button", { name: "Create", exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true,
        "Tab from the last action stays inside the modal");
      await dialog.getByRole("button", { name: "Open model (.tma)…", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true,
        "Shift+Tab from the first action stays inside the modal");
    });
  });

  test("usability: first-run picker cancellation keeps keyboard focus inside the dialog", async () => {
    await getHarness().run("usability: first-run picker cancellation", async ({ page }) => {
      const dialog = await blankDocument(page);
      await dialog.getByLabel("Title", { exact: true }).fill("Keep this draft");
      const before = await savedModelAndHistory(page);
      for (const name of ["Open model (.tma)…", "Import TM7…", "Import JSON…"]) {
        const { fileChooser } = await chosenInput(page, dialog.getByRole("button", { name, exact: true }));
        await cancelChooser(fileChooser);
        await until(() => dialog.evaluate(element => element.contains(document.activeElement)),
          `${name} cancellation returns focus inside the first-run dialog`);
        await page.waitForTimeout(100);
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true,
          "Deferred File focus restoration must not move focus behind the blocking dialog");
        assert.equal(await dialog.getByLabel("Title", { exact: true }).inputValue(), "Keep this draft");
        assert.deepEqual(await savedModelAndHistory(page), before, "Cancellation preserves the full model and history");
      }
    });
  });

  test("regression: first-run failed imports and declined TM7 replacement preserve the draft and history", async () => {
    await getHarness().run("regression: first-run import recovery", async ({ page }) => {
      const dialog = await blankDocument(page);
      await dialog.getByLabel("Title", { exact: true }).fill("Recoverable draft");
      const before = await savedModelAndHistory(page);
      await recordImportDialogs(page, false);
      for (const [index, name, filename, prefix] of [
        [0, "Open model (.tma)…", "invalid.tma", "Failed to import JSON:"],
        [1, "Import TM7…", "invalid.tm7", "Failed to import TM7 file:"],
        [2, "Import JSON…", "invalid.json", "Failed to import JSON format:"],
      ]) {
        const { fileChooser } = await chosenInput(page, dialog.getByRole("button", { name, exact: true }));
        await fileChooser.setFiles({ name: filename, mimeType: "text/plain", buffer: Buffer.from("{ invalid") });
        await until(() => page.evaluate(count => window.firstRunAlerts.length === count, index + 1), `${name} failure`);
        assert.ok((await page.evaluate(index => window.firstRunAlerts[index], index)).startsWith(prefix));
        await until(() => dialog.evaluate(element => element.contains(document.activeElement)), `${name} recovery focus`);
        assert.deepEqual(await savedModelAndHistory(page), before);
      }
      const { fileChooser } = await chosenInput(page, dialog.getByRole("button", { name: "Import TM7…", exact: true }));
      await fileChooser.setFiles({ name: "declined.tm7", mimeType: "application/xml", buffer: Buffer.from(firstRunTm7) });
      await until(() => page.evaluate(() => window.firstRunConfirmations.length === 1), "TM7 loss-summary cancellation");
      await until(() => dialog.evaluate(element => element.contains(document.activeElement)), "Declined TM7 focus");
      assert.equal(await dialog.getByLabel("Title", { exact: true }).inputValue(), "Recoverable draft");
      assert.deepEqual(await savedModelAndHistory(page), before, "Declining replacement does not mutate document or history");
    });
  });

  test("regression: first-run TM7 and scenario JSON imports complete without a placeholder scenario", async () => {
    for (const kind of ["TM7", "JSON"]) {
      await getHarness().run(`regression: first-run actual ${kind} import`, async ({ page, observations }) => {
        const dialog = await blankDocument(page);
        const before = await savedModelAndHistory(page);
        await recordImportDialogs(page);
        const { fileChooser } = await chosenInput(page, dialog.getByRole("button", { name: `Import ${kind}…`, exact: true }));
        await fileChooser.setFiles({
          name: kind === "TM7" ? "first-run.tm7" : "first-run.json",
          mimeType: kind === "TM7" ? "application/xml" : "application/json",
          buffer: Buffer.from(kind === "TM7" ? firstRunTm7 : JSON.stringify(scenarioDfdJsonFixture())),
        });
        await dialog.waitFor({ state: "hidden" });
        await until(() => page.locator('button[aria-controls="ps-command-menu-file"]')
          .evaluate(element => element === document.activeElement), "Completed import File focus");
        const after = await savedModelAndHistory(page);
        assert.equal(after.doc.scenarios.length, kind === "TM7" ? 1 : 3);
        if (kind === "TM7") {
          assert.equal(after.doc.scenarios[0].id, "70000000-0000-4000-8000-000000000001");
          assert.equal(after.doc.nodes[0].title, "First-run process");
        } else {
          assert.deepEqual(after.doc.scenarios.map(s => s.name), ["JSON primary", "JSON archive", "JSON empty"]);
          assert.equal(after.doc.nodes.length, 4);
          assert.equal(after.doc.edges.length, 4);
        }
        assert.equal(after.past.length, before.past.length + 1, "Import adds exactly one document snapshot");
        assert.deepEqual(after.past.at(-1), before.doc);
        observations.confirmations = await page.evaluate(() => window.firstRunConfirmations);
        observations.alerts = await page.evaluate(() => window.firstRunAlerts);
        assert.equal(observations.confirmations.length, kind === "TM7" ? 1 : 0);
        assert.equal(observations.alerts.length, kind === "JSON" ? 1 : 0);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await dialog.waitFor();
        assert.deepEqual((await savedModelAndHistory(page)).doc, before.doc);
        await dialog.getByLabel("Title", { exact: true }).fill("Created after Undo");
        await dialog.getByLabel("Title", { exact: true }).press("Enter");
        await dialog.waitFor({ state: "hidden" });
        assert.deepEqual((await savedModelAndHistory(page)).doc.scenarios.map(s => s.name), ["Created after Undo"]);
      });
    }
  });

  test("usability: ordinary New scenario does not offer first-run replacement actions", async () => {
    await getHarness().run("usability: optional scenario dialog scope", async ({ page }) => {
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.getByRole("menuitem", { name: "New scenario…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "New scenario", exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole("region", { name: "Already have a model?", exact: true }).count(), 0);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    });
  });

  test("usability: first-run controls remain reachable in light and dark short layouts", async () => {
    for (const darkTheme of [false, true]) {
      await getHarness().run(`usability: first-run short layout ${darkTheme ? "dark" : "light"}`, async ({ page }) => {
        await page.evaluate(dark => {
          const key = "ps-ui-preferences-v2";
          const preferences = JSON.parse(localStorage.getItem(key) || "{}");
          localStorage.setItem(key, JSON.stringify({ ...preferences, darkTheme: dark }));
        }, darkTheme);
        await page.reload();
        await until(() => page.locator(".ps-shell").evaluate((element, dark) =>
          element.classList.contains("ps-theme-dark") === dark, darkTheme), "Requested theme");
        const dialog = await blankDocument(page);
        await page.setViewportSize({ width: 320, height: 480 });
        for (const control of await dialog.locator("button, input, textarea").all()) {
          await control.scrollIntoViewIfNeeded();
          await control.focus();
          const box = await control.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= 320 &&
            box.y >= 0 && box.y + box.height <= 480, "Every first-run control can be reached in the viewport");
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      });
    }
  });

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
      const tm7Chooser = await chosenInput(page, tm7);
      assert.equal(tm7Chooser.id, "ps-tm7-import-input");
      await cancelChooser(tm7Chooser.fileChooser);
      const jsonChooser = await chosenInput(page, json);
      assert.equal(jsonChooser.id, "ps-tmc-import-input");
      await cancelChooser(jsonChooser.fileChooser);
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
