import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture, autosaveKey } from "./fixture.mjs";
import { historicalTaxonomyDefinitions } from "../authentication/catalog-fixtures.mjs";

export function taxonomyFixture() {
  const model = modelFixture();
  model.doc.catalogDefinitions = historicalTaxonomyDefinitions();
  model.doc.boundaries = [
    { id: "b_private_p", type: "privacy", privacySubtype: "M365ComplianceBoundary", title: "Old privacy", nodeIds: [],
      position: { x: 80, y: 330 }, size: { width: 300, height: 180 } },
    { id: "b_private_s", type: "security", securitySubtype: "CoreServicesIslands", title: "Old security", nodeIds: [],
      position: { x: 450, y: 330 }, size: { width: 300, height: 180 } },
  ];
  model.doc.scenarios[0].boundaryIds = model.doc.boundaries.map(boundary => boundary.id);
  model.doc.nodeTypes[0].definition.defaultPrivacyBoundary = "CAndAIComplianceBoundary";
  delete model.doc.nodeTypes[0].definition.policyStatus;
  model.doc.nodeTypes[0].definition.allowedDataTypes = [{ id: "*", retention: "*", action: "Allow" }];
  model.doc.deviations = [{
    id: "dv_historical", key: "synthetic:historical-taxonomy", kind: "ests-relationship", title: "Retained taxonomy evidence",
    description: "Historical evidence fixture", explanation: "Retain this explanation.", status: "Resolved",
    scenarioIds: ["s_primary"], evidenceIds: ["synthetic:old"], createdAt: 1, updatedAt: 2,
  }];
  return model;
}

export function registerTaxonomyContracts({ getHarness, exportModel, configured = false }) {
  test(`regression: ${configured ? "selected" : "absent"} taxonomy libraries separate saved labels from authoring choices`, async () => {
    await getHarness().run(`regression: taxonomy ${configured ? "selected" : "absent"}`, async ({ page }) => {
      const input = taxonomyFixture();
      const upload = async (model, name) => {
        await page.locator("#ps-file-open-input").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)) });
        await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
      };
      await upload(input, "taxonomy.tma");
      const baseline = await exportModel(page);
      for (const [id, name, oldValue, coreValue] of [
        ["b_private_p", "Privacy subtype", "M365ComplianceBoundary", "GeoBoundary"],
        ["b_private_s", "Security subtype", "CoreServicesIslands", "IFrame"],
      ]) {
        const selectBoundary = () => page.locator(`.react-flow__node-boundary[data-id="${id}"] .ps-boundary-title-text`).click();
        await selectBoundary();
        const choice = page.getByRole("combobox", { name, exact: true });
        assert.equal(await choice.inputValue(), oldValue);
        assert.equal(await choice.locator(`option[value="${oldValue}"]`).evaluate(option => option.disabled), !configured);
        assert.equal(await choice.locator("option:checked").textContent(), `Historical ${oldValue}`);
        const title = page.getByRole("textbox", { name: "Title", exact: true });
        await title.fill(`Edited ${id}`);
        assert.equal(await choice.inputValue(), oldValue);
        await choice.selectOption(coreValue);
        assert.equal(await choice.locator(`option[value="${oldValue}"]`).count(), configured ? 1 : 0);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await selectBoundary();
        assert.equal(await choice.inputValue(), oldValue);
      }
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
      const catalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
      await catalog.getByRole("searchbox").fill("Browser test process");
      await catalog.getByRole("button", { name: /^Browser test process/ }).click();
      const privacy = catalog.getByRole("combobox", { name: "Privacy boundary", exact: true });
      assert.equal(await privacy.inputValue(), "CAndAIComplianceBoundary");
      assert.equal(await privacy.locator('option[value="CAndAIComplianceBoundary"]').evaluate(option => option.disabled), !configured);
      await catalog.getByRole("button", { name: "Cancel", exact: true }).click();
      await catalog.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: /^Deviations/ }).click();
      const deviations = page.locator(".ps-deviations");
      await deviations.getByText("Historical ests-relationship", { exact: true }).waitFor();
      await deviations.getByRole("button", { name: "Add deviation", exact: true }).click();
      assert.equal(await deviations.getByRole("combobox", { name: "Kind", exact: true }).locator('option[value="ests-relationship"]').count(), configured ? 1 : 0);
      await deviations.getByRole("button", { name: "Cancel", exact: true }).first().click();
      const saved = await exportModel(page);
      assert.deepEqual(saved.doc.deviations, baseline.doc.deviations);
      assert.deepEqual(saved.doc.catalogDefinitions, baseline.doc.catalogDefinitions);
      await upload(saved, "reopened-taxonomy.tma");
      assert.deepEqual((await exportModel(page)).doc, saved.doc);
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.deviations?.some(item => item.id === "dv_historical"), autosaveKey);
      await page.reload();
      await page.locator('button[aria-controls="ps-command-menu-export"]').click();
      const event = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: /Review report \(\.html\)/i }).click();
      const chunks = [];
      for await (const chunk of await (await event).createReadStream()) chunks.push(chunk);
      const report = Buffer.concat(chunks).toString("utf8");
      for (const text of ["Historical M365ComplianceBoundary", "Historical CoreServicesIslands", "Historical ests-relationship"]) {
        assert.ok(report.includes(text));
      }
    });
  });
}
