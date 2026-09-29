import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture, autosaveKey } from "./fixture.mjs";

export function registerNodeMetadataContracts({ getHarness, exportModel }) {
  test("regression: opening node properties preserves saved metadata; type defaults are explicit and undoable", async () => {
    await getHarness().run("regression: non-mutating node metadata", async ({ page }) => {
      const model = modelFixture();
      model.doc.nodes[0].type = "Metadata process";
      model.doc.nodeTypes.push({ id: "Metadata process", label: "Metadata process", definition: {
        serviceTreeId: "33333333-3333-4333-8333-333333333333",
        endpointRegex: "^https://supplied\\.example\\.invalid/", allowedAuthMethods: [],
        allowedDataTypes: [{ id: "*", retention: "*", action: "Allow" }],
      } });
      model.doc.nodes[0].serviceTreeId = "11111111-1111-4111-8111-111111111111";
      model.doc.nodes[0].endpointRegex = "^https://retained\\.example\\.invalid/";
      model.doc.nodes[1].type = "Legacy Service (v1)";
      model.doc.nodeTypes.push({ id: "Legacy Service (v1)", label: "Legacy service fixture" });
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "retained-node.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
      });
      await page.getByLabel("Document status").getByText("retained-node.tma", { exact: true }).waitFor();
      const before = await exportModel(page);
      await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
      const service = page.getByRole("textbox", { name: "Inventory ID", exact: true });
      const endpoint = page.getByRole("textbox", { name: "EndpointRegex", exact: true });
      assert.equal(await service.inputValue(), model.doc.nodes[0].serviceTreeId);
      assert.equal(await endpoint.inputValue(), model.doc.nodes[0].endpointRegex);
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Viewing properties must not mutate the model");
      const type = page.getByPlaceholder("Select or enter a node type");
      await type.fill("Metadata process");
      await type.press("Enter");
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Recommitting the same type must not reset instance values");
      const confirm = async answer => page.evaluate(answer => {
        const original = window.confirm;
        window.confirm = message => {
          window.confirm = original;
          if (message !== "Replace this node's Inventory ID and EndpointRegex where type defaults are supplied? Other node data will be kept.") {
            throw new Error("Unexpected metadata confirmation.");
          }
          return answer;
        };
      }, answer);
      await confirm(false);
      await page.getByRole("button", { name: "Use type metadata", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await confirm(true);
      await page.getByRole("button", { name: "Use type metadata", exact: true }).click();
      const applied = await exportModel(page);
      assert.notEqual(applied.doc.nodes[0].serviceTreeId, before.doc.nodes[0].serviceTreeId);
      assert.notEqual(applied.doc.nodes[0].endpointRegex, before.doc.nodes[0].endpointRegex);
      assert.deepEqual({
        ...applied.doc.nodes[0],
        serviceTreeId: before.doc.nodes[0].serviceTreeId,
        endpointRegex: before.doc.nodes[0].endpointRegex,
      }, before.doc.nodes[0], "Only supplied metadata fields change");
      assert.deepEqual(applied.doc.nodes.slice(1), before.doc.nodes.slice(1));
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, applied.doc);
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.nodes
        ?.some(node => node.id === "n_client" && node.serviceTreeId !== "11111111-1111-4111-8111-111111111111"), autosaveKey);
      await page.reload();
      await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
      assert.equal(await service.inputValue(), applied.doc.nodes[0].serviceTreeId);
      await type.fill("Browser test process");
      await type.press("Enter");
      assert.equal(await service.inputValue(), applied.doc.nodes[0].serviceTreeId);
      assert.equal(await endpoint.inputValue(), applied.doc.nodes[0].endpointRegex);
      await page.locator('.react-flow__node-process[data-id="n_api"] .ps-node-title').click();
      await page.getByRole("status").filter({ hasText: "Node type definition unavailable" }).waitFor();
      assert.equal((await exportModel(page)).doc.nodeTypes.find(type => type.id === "Legacy Service (v1)").definition, undefined);
    });
  });
}
