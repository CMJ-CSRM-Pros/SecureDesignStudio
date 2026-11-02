import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture, catalogSnapshotFixture } from "./fixture.mjs";
import { until } from "./harness.mjs";

const libraryKey = "secure-design-studio:classification-library:v1";
const authKey = "secure-design-studio:authentication-library:v1";
const externalCatalog = {
  format: "secure-design-studio-classification-catalog", version: 1,
  id: "example-external", name: "Example external classifications", revision: "1",
  defaultId: "ExamplePublic",
  classifications: [
    { id: "ExamplePublic", label: "Example public", description: "Synthetic public category." },
    { id: "ExampleRestricted", label: "Active restricted label", description: "Synthetic restricted category." },
    { id: "ExampleDisabled", label: "Disabled category", disabled: true },
  ],
};

async function upload(page, model, name) {
  await page.locator("#ps-file-open-input").setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
  });
  await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
}

async function setProfileAndReload(page, value) {
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: libraryKey, value: typeof value === "string" ? value : JSON.stringify(value),
  });
  await page.reload();
  await page.getByLabel("Document status").getByText("Local mode", { exact: true }).waitFor();
}

async function openData(page) {
  await page.getByRole("tab", { name: /^Data/ }).click();
}

async function newDocument(page) {
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
  const scenario = page.getByRole("dialog", { name: "Create your first scenario", exact: true });
  await scenario.getByRole("button", { name: "Create", exact: true }).click();
  await scenario.waitFor({ state: "hidden" });
}

export function registerClassificationContracts({ getHarness, exportModel }) {
  test("regression: Classification Library shipped defaults preserve authoring and presentation", async () => {
    await getHarness().run("regression: Classification Library defaults", async ({ page }) => {
      await openData(page);
      assert.match(await page.locator(".ps-classification-library-status").innerText(), /Default classifications.*shipped/);
      assert.equal(await page.locator(".ps-data-classification-link").getAttribute("href"),
        "https://learn.microsoft.com/en-us/purview/purview-privacy");
      const badge = page.locator('[data-edge-id="e_request"] .ps-edge-classification-badge');
      assert.equal(await badge.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(239, 68, 68)");
      await page.getByRole("button", { name: "+ Add data item", exact: true }).click();
      const input = page.getByRole("combobox", { name: "Classification for New Data", exact: true });
      assert.equal(await input.inputValue(), "EUII");
      assert.equal(await input.locator("option:not(:disabled)").count(), 12);
      for (const id of ["Administrator Data", "Customer Data", "Customer Content"]) {
        assert.equal(await input.locator(`option[value="${id}"]`).count(), 1);
      }
      assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), null,
        "Using shipped defaults does not create or rewrite profile preferences");
    });
  });

  test("regression: shared Administrator Data and Customer Data survive authoring, history, native and recovery", async () => {
    await getHarness().run("regression: shared classification authoring", async ({ page }) => {
      await openData(page);
      const request = page.getByRole("combobox", { name: "Classification for Synthetic request", exact: true });
      const responseName = modelFixture().doc.data[1].name;
      const response = page.getByRole("combobox", { name: `Classification for ${responseName}`, exact: true });
      const before = await response.inputValue();
      await request.selectOption("Administrator Data");
      await response.selectOption("Customer Data");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await response.inputValue(), before);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.equal(await response.inputValue(), "Customer Data");
      const saved = await exportModel(page);
      for (const id of ["Administrator Data", "Customer Data"]) {
        assert.ok(saved.doc.data.some(data => data.classification === id));
        const def = saved.doc.catalogDefinitions.find(def => def.kind === "classification" && def.id === id);
        assert.match(def.description, /Purview/);
        assert.deepEqual(def.library, { id: "sds-default-classifications", version: "1.1.0" });
        assert.equal(def.presentation, undefined);
      }
      await upload(page, modelFixture(), "clear-shared.tma");
      await upload(page, saved, "shared-classifications.tma");
      await openData(page);
      assert.equal(await request.inputValue(), "Administrator Data");
      assert.equal(await response.inputValue(), "Customer Data");
      await page.reload();
      await openData(page);
      assert.equal(await request.inputValue(), "Administrator Data");
      assert.equal(await response.inputValue(), "Customer Data");
      assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), null);
    });
  });

  test("regression: Classification Library profile controls new choices without reclassifying models", async () => {
    await getHarness().run("regression: Classification Library profile isolation", async ({ page }) => {
      const authBefore = await page.evaluate(key => localStorage.getItem(key), authKey);
      await setProfileAndReload(page, externalCatalog);
      await openData(page);
      assert.match(await page.locator(".ps-classification-library-status").innerText(), /Example external classifications.*profile/);
      assert.equal(await page.locator(".ps-data-classification-link").count(), 0);
      assert.equal(await page.locator('[data-edge-id="e_request"] .ps-edge-classification-badge')
        .evaluate(element => getComputedStyle(element).backgroundColor), "rgb(71, 85, 105)");
      const existing = page.getByRole("combobox", { name: "Classification for Synthetic request", exact: true });
      assert.equal(await existing.inputValue(), "EUII");
      assert.equal(await existing.locator("option:checked").isDisabled(), true);
      assert.match(await existing.locator("option:checked").textContent(), /EUII.*saved/);
      await page.getByRole("button", { name: "+ Add data item", exact: true }).click();
      const fresh = page.getByRole("combobox", { name: "Classification for New Data", exact: true });
      assert.equal(await fresh.inputValue(), "ExamplePublic");
      assert.deepEqual(await fresh.locator("option:not(:disabled)").evaluateAll(elements => elements.map(el => el.value).sort()),
        ["ExamplePublic", "ExampleRestricted"]);
      assert.equal(await fresh.locator('option[value="EUII"], option[value="ExampleDisabled"]').count(), 0);
      const saved = await exportModel(page);
      assert.equal(saved.doc.data.find(item => item.id === "d_request").classification, "EUII");
      const custom = saved.doc.catalogDefinitions.find(def => def.id === "ExamplePublic");
      assert.deepEqual(custom.library, { id: externalCatalog.id, version: externalCatalog.revision });
      assert.equal("disabled" in custom || "presentation" in custom || "defaultId" in custom, false);
      assert.equal(saved.doc.catalogDefinitions.some(def => def.id === "ExampleDisabled"), false);
      assert.equal("classificationLibrary" in saved.doc, false);

      await upload(page, catalogSnapshotFixture(), "saved-labels.tma");
      await openData(page);
      assert.equal(await existing.locator("option:checked").textContent(), "Partner restricted data (saved)");
      await upload(page, modelFixture(), "legacy-ids.tma");
      await openData(page);
      assert.equal(await existing.locator("option:checked").textContent(), "EUII (unresolved)");
      const legacy = await exportModel(page);
      assert.equal(legacy.doc.data[0].classification, "EUII");
      assert.deepEqual(legacy.doc.catalogDefinitions, [], "The shipped internal list was not recaptured");
      await newDocument(page);
      await openData(page);
      await page.getByRole("button", { name: "+ Add data item", exact: true }).click();
      assert.equal(await fresh.inputValue(), "ExamplePublic");
      await page.reload();
      await openData(page);
      assert.match(await page.locator(".ps-classification-library-status").innerText(), /Example external classifications/);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), JSON.stringify(externalCatalog));
      assert.equal(await page.evaluate(key => localStorage.getItem(key), authKey), authBefore);
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    });
  });

  test("regression: Classification Library corrupt preferences are visible and never overwritten", async () => {
    await getHarness().run("regression: Classification Library corrupt preference", async ({ page }) => {
      const corrupt = '{"format":"not-a-classification-catalog"}';
      await setProfileAndReload(page, corrupt);
      await page.getByRole("alert").filter({ hasText: "Classification Library could not be loaded" }).waitFor();
      await openData(page);
      assert.match(await page.locator(".ps-classification-library-status").filter({ hasText: "Default for new data" }).innerText(),
        /Default classifications.*shipped/);
      await page.getByRole("button", { name: "+ Add data item", exact: true }).click();
      assert.equal(await page.getByRole("combobox", { name: "Classification for New Data", exact: true }).inputValue(), "EUII");
      await exportModel(page);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), corrupt);
    });
  });

  test("regression: Classification Library does not remap recognized PMEXP source classifications", async () => {
    await getHarness().run("regression: Classification Library PMEXP preservation", async ({ page }) => {
      await setProfileAndReload(page, externalCatalog);
      const model = modelFixture();
      model.doc.nodes.find(node => node.id === "n_api").serviceTreeId = "11111111-1111-4111-8111-111111111111";
      await upload(page, model, "pmexp-target.tma");
      await page.evaluate(() => {
        const original = window.alert;
        window.alert = message => {
          window.alert = original;
          const expected = "Imported 1 record from the PMEXP file.\nServices: 1 mapped to existing, 0 created, 0 ignored.\nData items: 1 created, 0 reused.\nAttachments: 2 added across scenarios.\nUse Ctrl+Z to undo.";
          if (message !== expected) throw new Error(`Unexpected synthetic PMEXP summary: ${message}`);
          window.pmexpComplete = true;
        };
      });
      await page.locator("#ps-privacy-manager-import-input").setInputFiles({
        name: "synthetic.pmexp", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ data: [{
          serviceId: "11111111-1111-4111-8111-111111111111", serviceName: "Synthetic service",
          elementName: "PM synthetic element", sampleData: "SYNTHETIC_ONLY",
          dataClassification: "End User Identifiable Information (EUII)",
          dataRetainDuration: "7 days", dataStoreBoundary: "Stored",
        }] })),
      });
      await page.waitForFunction(() => window.pmexpComplete === true);
      const saved = await exportModel(page);
      assert.equal(saved.doc.data.find(item => item.name === "PM synthetic element").classification, "EUII");
      assert.equal(saved.doc.catalogDefinitions.some(def => def.kind === "classification" && def.id === "EUII"), false);
      await openData(page);
      const selection = page.getByRole("combobox", { name: "Classification for PM synthetic element", exact: true });
      assert.equal(await selection.locator("option:checked").textContent(), "EUII (unresolved)");
      assert.equal(await selection.locator("option:checked").isDisabled(), true);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal((await exportModel(page)).doc.data.some(item => item.name === "PM synthetic element"), false);
    });
  });
}
