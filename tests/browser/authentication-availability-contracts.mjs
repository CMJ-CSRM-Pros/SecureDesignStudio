import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture, autosaveKey } from "./fixture.mjs";
import { historicalAuthenticationDefinitions } from "../authentication/catalog-fixtures.mjs";

export function registerAuthenticationAvailabilityContracts({ getHarness, exportModel }) {
  test("regression: retained authentication conflicts cannot silently change behavior or clear findings", async () => {
    await getHarness().run("regression: authentication installed contract guard", async ({ page }) => {
      const id = "EntraApplicationOnlyWithCdt";
      const shipped = historicalAuthenticationDefinitions().find(method => method.id === id);
      const input = modelFixture();
      input.doc.edges[0].authenticationTypes = [id];
      input.doc.edges[0].audience = "saved audience";
      input.doc.edges[0].constraints = "saved constraints";
      input.doc.authenticationDefinitions = [{
        ...shipped, behavior: { ...shipped.behavior, productionIdentity: "optional", audience: false, constraints: false },
      }];
      input.doc.issues = [{
        id: "i_contract", kind: "Edge_missing_production_identity", targetKind: "edge", targetId: "e_request",
        scenarioIds: [], title: "Original identity finding", description: "Original reviewer evidence.",
        status: "Resolved", createdAt: 1, replies: [{ id: "ir_contract", text: "Retain my decision.", createdAt: 2 }],
      }];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "retained-contract.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("retained-contract.tma", { exact: true }).waitFor();
      await page.locator('.ps-edge-label[data-edge-id="e_request"] .ps-edge-num').click();
      const auth = page.getByRole("combobox", { name: /^Authentication method/ });
      assert.equal(await auth.inputValue(), id);
      await page.locator(".ps-auth-selection-warning").filter({ hasText: "differs from the installed contract" }).waitFor();
      assert.equal(await auth.locator(`option[value="${id}"]`).evaluate(option => option.disabled && option.matches(":disabled")), true);
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
      const finding = page.locator(".ps-allissues-row").filter({ hasText: "Original identity finding" }).filter({ visible: true });
      await finding.getByText("Not re-evaluated: analyzer rule retired", { exact: true }).waitFor();
      const preserved = await exportModel(page);
      assert.equal(preserved.doc.authenticationDefinitions.find(method => method.id === id).behavior.productionIdentity, "optional");
      assert.equal(JSON.stringify(preserved.doc).includes("unavailableReason"), false);
      assert.equal(preserved.doc.edges[0].audience, "saved audience");
      assert.equal(preserved.doc.edges[0].constraints, "saved constraints");
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.issues
        ?.some(issue => issue.id === "i_contract" && issue.notEvaluatedReason === "rule-retired"), autosaveKey);
      await page.reload();
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.getByRole("menuitem", { name: "Customize authentication", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Authentication Library", exact: true });
      const details = dialog.locator("details").filter({ hasText: `Review definition: ${shipped.label}` });
      await details.locator("summary").click();
      await details.getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Use library definition in this diagram?", exact: true })
        .getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      const repaired = await exportModel(page);
      assert.equal(repaired.doc.authenticationDefinitions.find(method => method.id === id).behavior.productionIdentity, "required");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal((await exportModel(page)).doc.authenticationDefinitions.find(method => method.id === id).behavior.productionIdentity, "optional");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
      const updated = (await exportModel(page)).doc.issues.find(issue => issue.id === "i_contract");
      assert.equal(updated.notEvaluatedReason, "rule-retired");
      assert.equal(updated.status, "Resolved");
      assert.deepEqual(updated.replies, input.doc.issues[0].replies);
    });
  });
}
