import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture } from "./fixture.mjs";
import { until } from "./harness.mjs";

const fileButton = page => page.locator('button[aria-controls="ps-command-menu-file"]');
const fileInput = page => page.locator("#ps-privacy-manager-import-input");
const mappingDialog = page => page.getByRole("dialog", { name: "PMEXP import", exact: true });
const ids = {
  automatic: "aaaaaaaa-1111-4111-8111-111111111111",
  ambiguous: "bbbbbbbb-2222-4222-8222-222222222222",
  created: "cccccccc-3333-4333-8333-333333333333",
  ignored: "dddddddd-4444-4444-8444-444444444444",
};
const record = (serviceId, serviceName, elementName, dataClassification = "Customer Data") => ({
  serviceId, serviceName, elementName, dataClassification, sampleData: "SYNTHETIC_ONLY",
  dataRetainDuration: "7 days", dataStoreBoundary: "Stored",
});

async function uploadModel(page, model, name) {
  await page.locator("#ps-file-open-input").setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
  });
  await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
}

export async function choosePmexp(page, content) {
  await fileButton(page).click();
  const command = page.getByRole("menuitem", { name: "PMEXP import…", exact: true });
  assert.match(await command.getAttribute("title"), /local PMEXP.*No sign-in or service lookup/);
  const event = page.waitForEvent("filechooser");
  await command.click();
  const chooser = await event;
  assert.equal(await chooser.element().getAttribute("accept"), ".pmexp");
  await chooser.setFiles({
    name: "synthetic.pmexp", mimeType: "application/json",
    buffer: Buffer.from(typeof content === "string" ? content : JSON.stringify(content)),
  });
}

async function recordAlerts(page) {
  await page.evaluate(() => {
    window.pmexpTestAlerts = [];
    window.alert = message => window.pmexpTestAlerts.push(String(message));
  });
}

async function alertAt(page, index = 0) {
  await page.waitForFunction(index => window.pmexpTestAlerts.length > index, index);
  return page.evaluate(index => window.pmexpTestAlerts[index], index);
}

async function expectFileFocus(page) {
  await until(() => fileButton(page).evaluate(el => el === document.activeElement), "PMEXP File focus restoration");
}

export function registerPmexpContracts({ getHarness, exportModel }) {
  test("regression: PMEXP command keeps the local file filter, cancellation and invalid-file diagnostics", async () => {
    await getHarness().run("regression: PMEXP file command and diagnostics", async ({ page }) => {
      const before = await exportModel(page);
      assert.equal(await fileInput(page).getAttribute("aria-label"), "Choose a PMEXP file");
      await fileButton(page).click();
      assert.equal(await page.getByRole("menuitem", { name: /Privacy Manager/ }).count(), 0);
      const event = page.waitForEvent("filechooser");
      await page.getByRole("menuitem", { name: "PMEXP import…", exact: true }).click();
      const chooser = await event;
      assert.equal(await chooser.element().getAttribute("accept"), ".pmexp");
      await chooser.setFiles([]);
      await fileInput(page).dispatchEvent("cancel");
      await expectFileFocus(page);
      assert.deepEqual((await exportModel(page)).doc, before.doc);

      await recordAlerts(page);
      const invalid = [
        ["not json", /^Failed to import PMEXP file: File is not valid JSON:/],
        [{ scenarios: [], dfds: [] }, /^Failed to import PMEXP file: File does not look like a PMEXP inventory/],
        [{ data: [] }, /^No services with data items were found in this PMEXP file\.$/],
      ];
      for (let index = 0; index < invalid.length; index++) {
        await choosePmexp(page, invalid[index][0]);
        assert.match(await alertAt(page, index), invalid[index][1]);
        await expectFileFocus(page);
        assert.equal(await fileInput(page).inputValue(), "");
        assert.equal(await mappingDialog(page).count(), 0);
        assert.deepEqual((await exportModel(page)).doc, before.doc);
      }
      assert.equal(await page.evaluate(() => window.pmexpTestAlerts.length), invalid.length);
    });
  });

  test("regression: PMEXP mapping preserves automatic, ambiguous, create and ignore decisions in one Undo", async () => {
    await getHarness().run("regression: PMEXP mapping and merge", async ({ page }) => {
      const input = modelFixture();
      input.doc.nodes.find(node => node.id === "n_api").serviceTreeId = ` ${ids.automatic.toUpperCase()} `;
      for (const id of ["n_client", "n_archive"]) input.doc.nodes.find(node => node.id === id).serviceTreeId = ids.ambiguous;
      input.doc.data[0].sample = "Curated sample";
      input.doc.scenarios[0].nodeData = { n_api: { d_request: "ProcessingNoStorage" } };
      await uploadModel(page, input, "pmexp-decisions.tma");
      const before = await exportModel(page);
      const records = [
        record(ids.automatic, "Automatic service", "Synthetic request", "End User Identifiable Information (EUII)"),
        record(ids.ambiguous, "Ambiguous service", "Mapped item", "Administrator Data"),
        record(ids.created, "Created service", "Created item"),
        record(ids.ignored, "Ignored service", "Ignored item"),
      ];
      await recordAlerts(page);
      await choosePmexp(page, { data: records });
      const dialog = mappingDialog(page);
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).waitFor();
      assert.equal(await dialog.getByLabel("Action for Automatic service", { exact: true }).count(), 0);
      await dialog.getByText("Automatically mapped (1)", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Ignore all", exact: true }).click();
      for (const name of ["Ambiguous service", "Created service", "Ignored service"]) {
        assert.equal(await dialog.getByLabel(`Action for ${name}`, { exact: true }).inputValue(), "ignore");
      }
      await dialog.getByRole("button", { name: "Create all", exact: true }).click();
      await dialog.getByLabel("Action for Ambiguous service", { exact: true }).selectOption("use-existing");
      const confirm = dialog.getByRole("button", { name: "Import", exact: true });
      assert.equal(await confirm.isDisabled(), true);
      await dialog.getByLabel("Existing node for Ambiguous service", { exact: true }).selectOption("n_client");
      await dialog.getByLabel("Action for Ignored service", { exact: true }).selectOption("ignore");
      assert.equal(await confirm.isEnabled(), true);
      await confirm.click();
      assert.equal(await alertAt(page), "Imported 4 records from the PMEXP file.\nServices: 2 mapped to existing, 1 created, 1 ignored.\nData items: 2 created, 1 reused.\nAttachments: 5 added across scenarios, 1 skipped (already present).\nUse Ctrl+Z to undo.");
      await expectFileFocus(page);
      const saved = await exportModel(page);
      assert.deepEqual(saved.doc.edges, before.doc.edges);
      assert.deepEqual(saved.doc.boundaries, before.doc.boundaries);
      assert.equal(saved.doc.nodes.length, before.doc.nodes.length + 1);
      const created = saved.doc.nodes.find(node => node.title === "Created service");
      assert.equal(created.serviceTreeId, ids.created);
      assert.equal(created.description, `Imported from Privacy Manager (serviceId ${ids.created})`, "Historical source provenance remains unchanged");
      assert.equal(saved.doc.data.find(data => data.id === "d_request").sample, "Curated sample");
      assert.equal(saved.doc.data.some(data => data.name === "Ignored item"), false);
      assert.equal(saved.doc.scenarios[0].nodeData.n_api.d_request, "ProcessingNoStorage");
      const manual = saved.doc.data.find(data => data.name === "Mapped item");
      const fresh = saved.doc.data.find(data => data.name === "Created item");
      for (let i = 0; i < saved.doc.scenarios.length; i++) {
        const scenario = saved.doc.scenarios[i];
        assert.equal(scenario.nodeData.n_client[manual.id], "StorageOver48Hours");
        assert.equal(scenario.nodeData[created.id][fresh.id], "StorageOver48Hours");
        assert.deepEqual(scenario.edgeNumbers, before.doc.scenarios[i].edgeNumbers);
        assert.deepEqual(scenario.edgeRequestData, before.doc.scenarios[i].edgeRequestData);
        assert.deepEqual(scenario.edgeResponseData, before.doc.scenarios[i].edgeResponseData);
      }
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, saved.doc);
      await uploadModel(page, before, "clear-pmexp.tma");
      await uploadModel(page, saved, "pmexp-reopened.tma");
      assert.deepEqual((await exportModel(page)).doc, saved.doc);
      await page.reload();
      await page.getByLabel("Document status").getByText("Local mode", { exact: true }).waitFor();
      assert.deepEqual((await exportModel(page)).doc, saved.doc);
    });
  });

  test("regression: PMEXP direct mapping accepts both envelopes and repeat imports preserve data and retention", async () => {
    await getHarness().run("regression: PMEXP automatic merge and repeat", async ({ page }) => {
      const input = modelFixture();
      input.doc.nodes.find(node => node.id === "n_api").serviceTreeId = ids.automatic;
      await uploadModel(page, input, "pmexp-direct.tma");
      await recordAlerts(page);
      const records = [record(ids.automatic, "Automatic service", "Unknown source category", "Unrecognized synthetic category")];
      await choosePmexp(page, records);
      const first = await alertAt(page);
      assert.match(first, /^Imported 1 record from the PMEXP file\./);
      assert.match(first, /Services: 1 mapped to existing, 0 created, 0 ignored/);
      assert.match(first, /1 record had an unrecognized classification and were imported as "Other"/);
      assert.equal(await mappingDialog(page).count(), 0);
      const saved = await exportModel(page);
      assert.equal(saved.doc.data.find(data => data.name === "Unknown source category").classification, "Other");
      await choosePmexp(page, { data: records });
      const second = await alertAt(page, 1);
      assert.match(second, /Data items: 0 created, 1 reused/);
      assert.match(second, /Attachments: 0 added across scenarios, 2 skipped/);
      assert.deepEqual((await exportModel(page)).doc, saved.doc);
    });
  });

  test("usability: PMEXP mapping labels, focus trap, cancellation and narrow controls remain reachable", async () => {
    await getHarness().run("usability: PMEXP mapping dialog", async ({ page, observations }) => {
      const before = await exportModel(page);
      const records = [record(ids.created, "Synthetic unmapped service with a long descriptive name", "Synthetic data")];
      for (const width of [1366, 320]) {
        await page.setViewportSize({ width, height: 640 });
        await choosePmexp(page, { data: records });
        const dialog = mappingDialog(page);
        await dialog.waitFor();
        await until(() => dialog.getByRole("button", { name: "Cancel", exact: true })
          .evaluate(el => document.activeElement === el), "PMEXP initial Cancel focus");
        assert.match(await dialog.innerText(), /No sign-in, service lookup, or optional library is required/);
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        const confirm = dialog.getByRole("button", { name: "Import", exact: true });
        await confirm.focus();
        await confirm.press("Tab");
        assert.equal(await close.evaluate(el => el === document.activeElement), true);
        await close.press("Shift+Tab");
        assert.equal(await confirm.evaluate(el => el === document.activeElement), true);
        await confirm.press("Control+s");
        await confirm.press("Control+n");
        assert.equal(await page.getByRole("dialog").count(), 1, "No document shortcuts behind the mapping dialog");
        const geometry = await dialog.evaluate(el => {
          const box = el.getBoundingClientRect(), table = el.querySelector("table").getBoundingClientRect();
          return { left: box.left, right: box.right, tableRight: table.right, width: innerWidth,
            pageWidth: document.documentElement.scrollWidth,
            unlabeled: [...el.querySelectorAll("select")].filter(s => !s.getAttribute("aria-label") && !s.labels.length).length };
        });
        observations[`width${width}`] = geometry;
        assert.equal(geometry.unlabeled, 0);
        assert.ok(geometry.left >= 0 && geometry.right <= width && geometry.tableRight <= geometry.right);
        assert.ok(geometry.pageWidth <= width + 1);
        await dialog.getByLabel(`Action for ${records[0].serviceName}`, { exact: true }).selectOption("use-existing");
        await dialog.getByLabel(`Existing node for ${records[0].serviceName}`, { exact: true }).selectOption("n_api");
        const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
        if (width === 1366) await cancel.press("Escape");
        else await cancel.click();
        await dialog.waitFor({ state: "hidden" });
        await expectFileFocus(page);
        assert.deepEqual((await exportModel(page)).doc, before.doc);
      }
    });
  });
}
