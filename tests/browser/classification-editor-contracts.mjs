import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveKey } from "./fixture.mjs";
import { until } from "./harness.mjs";

const key = "secure-design-studio:classification-library:v1";
const modal = page => page.locator(".ps-classification-library");
const stored = page => page.evaluate(key => {
  const raw = localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}, key);
const partner = (disableCurrent = false) => ({
  format: "secure-design-studio-classification-catalog", version: 1,
  id: "partner-library", name: "Partner classifications", revision: "2",
  defaultId: "PartnerPublic",
  classifications: [
    { id: "PartnerPublic", label: "Partner public", description: "Synthetic public category." },
    { id: "EUII", label: "Imported personal", description: "Synthetic replacement metadata.", disabled: disableCurrent },
  ],
});

async function open(page) {
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("menuitem", { name: "Customize classifications", exact: true }).click();
  await modal(page).waitFor();
  return modal(page);
}
async function close(page) {
  await modal(page).getByRole("button", { name: "Close", exact: true }).click();
  await modal(page).waitFor({ state: "hidden" });
}
async function select(page, id) {
  const dialog = modal(page);
  const label = (await stored(page))?.classifications.find(item => item.id === id)?.label ?? id;
  await dialog.getByRole("searchbox", { name: "Search classifications" }).fill(id);
  await dialog.locator(".ps-auth-list button").filter({ has: page.getByText(label, { exact: true }) }).click();
}
async function add(page, name) {
  const dialog = modal(page);
  await dialog.getByRole("button", { name: "Add classification", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Synthetic classification description.");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  return (await stored(page)).classifications.find(item => item.label === name);
}
async function chooseDefault(page, id) {
  const dialog = modal(page);
  await dialog.getByRole("button", { name: "Library settings", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Default for new data", exact: true }).selectOption(id);
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
}
async function upload(page, catalog) {
  await modal(page).locator('input[type="file"]').setInputFiles({
    name: "classifications.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(catalog)),
  });
  await modal(page).getByRole("heading", { name: "Preview classification catalog import" }).waitFor();
}
async function readDownload(page, action) {
  const pending = page.waitForEvent("download");
  await action();
  const download = await pending;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString("utf8") };
}

export function registerClassificationEditorContracts({ getHarness, exportModel }) {
  test("regression: classification editor CRUD, default protection and safe history", async () => {
    await getHarness().run("regression: classification editor CRUD", async ({ page }) => {
      const dialog = await open(page);
      const added = await add(page, "Partner confidential");
      assert.ok(added.id.startsWith("cls_"));
      await dialog.getByRole("button", { name: "Edit classification", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Partner restricted");
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      assert.equal((await stored(page)).classifications.find(item => item.id === added.id).label, "Partner restricted");
      await chooseDefault(page, added.id);
      await select(page, added.id);
      assert.equal(await dialog.getByRole("button", { name: "Disable classification", exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByRole("button", { name: "Delete classification...", exact: true }).isDisabled(), true);
      await chooseDefault(page, "EUII");
      await select(page, added.id);
      await dialog.getByRole("button", { name: "Disable classification", exact: true }).click();
      assert.equal((await stored(page)).classifications.find(item => item.id === added.id).disabled, true);
      await dialog.getByRole("button", { name: "Enable classification", exact: true }).click();
      await dialog.getByRole("button", { name: "Delete classification...", exact: true }).click();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.ok((await stored(page)).classifications.some(item => item.id === added.id));
      await dialog.getByRole("button", { name: "Delete classification...", exact: true }).click();
      await dialog.getByRole("button", { name: "Delete classification", exact: true }).click();
      assert.equal((await stored(page)).classifications.some(item => item.id === added.id), false);
      await dialog.getByRole("button", { name: "Undo", exact: true }).click();
      assert.ok((await stored(page)).classifications.some(item => item.id === added.id));
      await dialog.getByRole("button", { name: "Redo", exact: true }).click();
      await select(page, "EUPI");
      assert.equal(await dialog.getByRole("button", { name: "Delete classification...", exact: true }).isDisabled(), true);
      assert.match(await dialog.innerText(), /Undo\/Redo history|node policy/);
      await close(page);
    });
  });

  test("regression: classification edits pin old diagram meaning and resolution is independently undoable", async () => {
    await getHarness().run("regression: classification editor definition and recovery", async ({ page }) => {
      let dialog = await open(page);
      await select(page, "EUII");
      await dialog.getByRole("button", { name: "Edit classification", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Organization personal");
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await close(page);
      const beforeResolution = await exportModel(page);
      assert.equal(beforeResolution.doc.catalogDefinitions.find(def => def.id === "EUII").label, "EUII");
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.classificationHistory?.past.some(Boolean), autosaveKey);
      await page.reload();
      dialog = await open(page);
      await dialog.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal((await stored(page)).classifications.find(item => item.id === "EUII").label, "EUII");
      await dialog.getByRole("button", { name: "Redo", exact: true }).click();
      assert.equal((await stored(page)).classifications.find(item => item.id === "EUII").label, "Organization personal");
      await select(page, "EUII");
      await dialog.getByRole("button", { name: "Use active definition in this diagram...", exact: true }).click();
      await dialog.getByRole("button", { name: "Use active definition", exact: true }).click();
      await close(page);
      assert.equal((await exportModel(page)).doc.catalogDefinitions.find(def => def.id === "EUII").label, "Organization personal");
      dialog = await open(page);
      await dialog.getByRole("button", { name: "Undo", exact: true }).click();
      await close(page);
      assert.equal((await exportModel(page)).doc.catalogDefinitions.find(def => def.id === "EUII").label, "EUII");
      assert.equal((await stored(page)).classifications.find(item => item.id === "EUII").label, "Organization personal");
    });
  });

  test("regression: classification import previews separate merge and replace and export the active list", async () => {
    await getHarness().run("regression: classification catalog merge replace", async ({ page }) => {
      const before = await exportModel(page);
      const dialog = await open(page);
      await upload(page, partner());
      assert.equal(await stored(page), null, "Preview does not write preferences");
      assert.equal(await dialog.getByRole("button", { name: "Apply import", exact: true }).isDisabled(), true);
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Apply import", exact: true }).click();
      const merged = await stored(page);
      assert.equal(merged.defaultId, "EUII");
      assert.equal(merged.id, "sds-default-classifications");
      assert.equal(merged.classifications.find(item => item.id === "EUII").label, "Imported personal");
      await close(page);
      assert.equal((await exportModel(page)).doc.catalogDefinitions.find(def => def.id === "EUII").label,
        before.doc.catalogDefinitions.find(def => def.id === "EUII").label);
      await open(page);
      await upload(page, partner(true));
      await dialog.getByRole("alert").filter({ hasText: "defaultId" }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "Apply import", exact: true }).isDisabled(), true);
      await dialog.getByRole("combobox", { name: "Import mode", exact: true }).selectOption("replace");
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Apply import", exact: true }).click();
      const replaced = await stored(page);
      assert.equal(replaced.id, "partner-library");
      assert.equal(replaced.defaultId, "PartnerPublic");
      assert.equal(replaced.classifications.length, 2);
      const exported = await readDownload(page, () => dialog.getByRole("button", { name: "Export JSON", exact: true }).click());
      assert.equal(exported.name, "secure-design-studio-classification-catalog.json");
      assert.deepEqual(JSON.parse(exported.text), replaced);
      await close(page);
      await page.getByRole("tab", { name: /^Data/ }).click();
      const existing = page.getByRole("combobox", { name: "Classification for Synthetic request" });
      assert.equal(await existing.inputValue(), "EUII");
      assert.equal(await existing.locator("option:checked").isDisabled(), true);
      await page.getByRole("button", { name: "+ Add data item", exact: true }).click();
      assert.equal(await page.getByRole("combobox", { name: "Classification for New Data" }).inputValue(), "PartnerPublic");
    });
  });

  test("regression: classification editor storage failures and stale drafts do not partially apply", async () => {
    await getHarness().run("regression: classification editor atomic failure", async ({ page }) => {
      const before = await exportModel(page);
      let dialog = await open(page);
      await dialog.getByRole("button", { name: "Add classification", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Rejected write");
      await page.evaluate(key => {
        window.originalClassificationSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(name, value) {
          if (name === key) throw new DOMException("Synthetic quota", "QuotaExceededError");
          return window.originalClassificationSetItem.call(this, name, value);
        };
      }, key);
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "not saved" }).waitFor();
      assert.equal(await stored(page), null);
      await page.evaluate(() => { Storage.prototype.setItem = window.originalClassificationSetItem; });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await close(page);
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      dialog = await open(page);
      await dialog.getByRole("button", { name: "Add classification", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Stale write");
      await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key, value: partner() });
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "changed in another tab" }).waitFor();
      assert.equal((await stored(page)).name, "Partner classifications");
      assert.equal((await stored(page)).classifications.some(item => item.label === "Stale write"), false);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await close(page);
      assert.deepEqual((await exportModel(page)).doc, before.doc);
    });
  });

  test("regression: classification editor backs up and explicitly repairs corrupt preferences", async () => {
    await getHarness().run("regression: classification editor repair", async ({ page }) => {
      const corrupt = '{"format":"wrong"}';
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: corrupt });
      await page.reload();
      const dialog = await open(page);
      const backup = await readDownload(page, () => dialog.getByRole("button", { name: "Download stored backup" }).click());
      assert.equal(backup.text, corrupt);
      await dialog.getByRole("button", { name: "Use shipped defaults..." }).click();
      assert.equal(await dialog.getByRole("button", { name: "Apply import", exact: true }).isDisabled(), true);
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Apply import", exact: true }).click();
      assert.equal((await stored(page)).format, "secure-design-studio-classification-catalog");
      assert.equal(await dialog.getByRole("button", { name: "Download stored backup" }).count(), 0);
      await dialog.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal((await stored(page)).format, "secure-design-studio-classification-catalog",
        "Undo restores effective values, never corrupt storage bytes");
      await close(page);
    });
  });

  test("regression: classification editor rejects invalid JSON and ignores a cancelled file read", async () => {
    await getHarness().run("regression: classification editor file cancellation", async ({ page }) => {
      const dialog = await open(page);
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"format":"wrong"}'),
      });
      await dialog.getByRole("alert").filter({ hasText: "Import not applied" }).waitFor();
      assert.equal(await stored(page), null);
      await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = function() {
          if (this.name !== "slow.json") return original.call(this);
          return new Promise(resolve => { window.finishClassificationRead = resolve; })
            .then(value => { window.classificationReadFinished = true; return value; });
        };
      });
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "slow.json", mimeType: "application/json", buffer: Buffer.from("{}"),
      });
      await dialog.getByRole("status").filter({ hasText: "Reading and validating catalog" }).waitFor();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.evaluate(value => window.finishClassificationRead(JSON.stringify(value)), partner());
      await page.waitForFunction(() => window.classificationReadFinished === true);
      assert.equal(await dialog.getByRole("heading", { name: "Preview classification catalog import" }).count(), 0);
      assert.equal(await stored(page), null);
      await close(page);
    });
  });

  test("usability: classification editor layers trap focus and preserve Model focus at 320px", async () => {
    await getHarness().run("usability: classification editor", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      const dialog = await open(page);
      await until(() => dialog.getByRole("searchbox").evaluate(element => element === document.activeElement), "classification search focus");
      await dialog.getByRole("button", { name: "Add classification", exact: true }).click();
      const name = dialog.getByRole("textbox", { name: "Name", exact: true });
      await until(() => name.evaluate(element => element === document.activeElement), "classification name focus");
      await name.fill("Unsaved draft");
      await name.press("Control+s");
      assert.equal(await page.getByRole("dialog", { name: "Save as", exact: true }).count(), 0);
      await name.press("Escape");
      assert.equal(await dialog.getByRole("textbox", { name: "Name", exact: true }).count(), 0);
      await upload(page, partner());
      await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Escape");
      assert.equal(await dialog.getByRole("heading", { name: "Preview classification catalog import" }).count(), 0);
      const closeButton = dialog.getByRole("button", { name: "Close", exact: true });
      await closeButton.focus();
      await closeButton.press("Tab");
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await closeButton.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await until(() => page.getByRole("button", { name: "Model", exact: true })
        .evaluate(element => element === document.activeElement), "return focus to Model");
    });
  });
}
