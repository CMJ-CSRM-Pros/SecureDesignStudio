import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture } from "./fixture.mjs";

export function registerInventoryContracts({ getHarness, exportModel, configured = false }) {
  test(`regression: ${configured ? "selected ServiceTree" : "public Inventory ID"} keeps serialized identity and scoped requirements`, async () => {
    await getHarness().run(`regression: ${configured ? "selected" : "core"} inventory field`, async ({ page }) => {
      const label = configured ? "ServiceTreeId" : "Inventory ID";
      await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
      const field = page.getByRole("textbox", { name: label, exact: true });
      await field.fill(configured ? "11111111-1111-4111-8111-111111111111" : "ASSET-123");
      assert.equal(await field.getAttribute("aria-invalid"), null);
      const saved = await exportModel(page);
      assert.equal(saved.doc.nodes.find(node => node.id === "n_client").serviceTreeId,
        configured ? "11111111-1111-4111-8111-111111111111" : "ASSET-123");
      assert.equal("inventoryId" in saved.doc.nodes[0], false);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal((await exportModel(page)).doc.nodes.find(node => node.id === "n_client").serviceTreeId, "");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
      const analyzed = await exportModel(page);
      assert.equal(analyzed.doc.issues.some(issue => issue.kind === "Node_must_have_servicetree"), configured);
      if (!configured) {
        await page.locator('button[aria-controls="ps-command-menu-model"]').click();
        await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
        const catalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
        await catalog.getByRole("searchbox").fill("Browser test process");
        await catalog.getByRole("button", { name: /^Browser test process/ }).click();
        await catalog.getByRole("textbox", { name: "Inventory ID", exact: true }).fill("CATALOG-123");
        await catalog.getByRole("button", { name: "Save type", exact: true }).click();
        await catalog.getByRole("button", { name: "Close", exact: true }).click();
        assert.equal((await exportModel(page)).doc.nodeTypes.find(type => type.id === "nt_browser").definition.serviceTreeId, "CATALOG-123");
      }
      const input = modelFixture();
      input.doc.nodes[0].type = "Unavailable historical inventory service";
      input.doc.nodes[0].serviceTreeId = "HISTORICAL-123";
      input.doc.issues = [{
        id: "i_inventory_old", kind: "Node_must_have_servicetree", targetKind: "node", targetId: "n_client",
        scenarioIds: [], title: "Historical inventory finding", description: "Retained evidence.",
        status: "Resolved", createdAt: 1, replies: [],
      }];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "old-inventory.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("old-inventory.tma", { exact: true }).waitFor();
      await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
      assert.equal(await field.inputValue(), "HISTORICAL-123");
      if (!configured) {
        assert.equal(await page.getByRole("button", { name: "Use type metadata", exact: true }).count(), 0);
        await page.getByRole("status").filter({ hasText: "Node type definition unavailable" }).waitFor();
        await field.fill("HISTORICAL-456");
        assert.equal(await field.inputValue(), "HISTORICAL-456");
      } else assert.equal(await field.getAttribute("aria-invalid"), "true");
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
      const old = (await exportModel(page)).doc.issues.find(issue => issue.id === "i_inventory_old");
      if (configured) assert.equal(old, undefined);
      else assert.equal(old.notEvaluatedReason, "rule-unavailable");
      await page.locator('button[aria-controls="ps-command-menu-export"]').click();
      const event = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: /Review report \(\.html\)/i }).click();
      const chunks = [];
      for await (const chunk of await (await event).createReadStream()) chunks.push(chunk);
      assert.ok(Buffer.concat(chunks).toString("utf8").includes(`<th>${label}</th>`));
    });
  });
}
