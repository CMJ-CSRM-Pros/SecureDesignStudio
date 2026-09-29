import assert from "node:assert/strict";
import { test } from "node:test";
import { until } from "./harness.mjs";
import { modelFixture } from "./fixture.mjs";

export async function openEndpointDialog(page, route = "model") {
  await page.locator(`button[aria-controls="ps-command-menu-${route}"]`).click();
  await page.getByRole("menuitem", { name: route === "model" ? /^Endpoint matching/ : /^Endpoints text/ }).click();
  return page.getByRole("dialog", { name: "Import nodes from Endpoints", exact: true });
}

export function registerEndpointContracts({ getHarness, exportModel, configured = false }) {
  test(`usability: endpoint importer ${configured ? "configured help" : "generic help"} stays keyboard accessible`, async () => {
    await getHarness().run(`usability: endpoint help ${configured ? "configured" : "unconfigured"}`, async ({ page }) => {
      let dialog = await openEndpointDialog(page);
      await until(() => dialog.getByRole("button", { name: "Close", exact: true }).evaluate(el => el === document.activeElement), "endpoint dialog focus");
      const example = dialog.getByRole("textbox", { name: "Endpoint import example", exact: true });
      if (configured) {
        assert.equal(await example.inputValue(), "https://example.invalid/service\nhttps://example.invalid/other");
        assert.match(await dialog.innerText(), /Example review library \(example @ 1.0.0\)/);
        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", { configurable: true,
            value: { writeText: async text => { window.endpointCopied = text; } } });
        });
        await dialog.getByRole("button", { name: "Copy to clipboard" }).click();
        await dialog.getByRole("status").getByText("Copied to clipboard.", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.endpointCopied), await example.inputValue());
        await page.evaluate(() => {
          Object.defineProperty(navigator, "clipboard", { configurable: true,
            value: { writeText: async () => { throw new Error("Synthetic clipboard denial"); } } });
        });
        await dialog.getByRole("button", { name: "Copy to clipboard" }).click();
        await dialog.getByRole("status").filter({ hasText: "Clipboard access was unavailable" }).waitFor();
        assert.equal(await example.evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length
          && el === document.activeElement), true);
      } else {
        assert.equal(await example.count(), 0);
        assert.equal(await dialog.getByRole("button", { name: "Copy to clipboard" }).count(), 0);
        assert.match(await dialog.innerText(), /No optional endpoint guidance is configured/);
      }
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.getByRole("button", { name: "Choose file…" }).evaluate(el => el === document.activeElement), true);
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      await page.keyboard.press("Escape");
      await until(() => page.locator('button[aria-controls="ps-command-menu-model"]').evaluate(el => el === document.activeElement), "endpoint dialog return focus");
      await page.setViewportSize({ width: 1366, height: 900 });
      dialog = await openEndpointDialog(page, "file");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await until(() => page.locator('button[aria-controls="ps-command-menu-file"]').evaluate(el => el === document.activeElement), "file route return focus");
    });
  });

  test(`regression: endpoint text matching remains local and idempotent ${configured ? "with" : "without"} help`, async () => {
    await getHarness().run(`regression: endpoint matching ${configured ? "configured" : "unconfigured"}`, async ({ page }) => {
      const model = modelFixture();
      for (const [id, suffix] of [["EndpointGeneral", ""], ["EndpointSpecific", "specific"]]) {
        model.doc.nodeTypes.push({ id, label: id, definition: {
          serviceTreeId: "", endpointRegex: `^https://endpoint-import\\.example\\.invalid/${suffix}`,
          allowedAuthMethods: [], allowedDataTypes: [{ id: "*", retention: "*", action: "Allow" }],
        } });
      }
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "endpoint-fixture.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
      });
      const before = await exportModel(page);
      await page.evaluate(() => { window.endpointAlerts = []; window.alert = message => window.endpointAlerts.push(message); });
      const content = "\nGET https://endpoint-import.example.invalid/specific HTTP/1.1\r\nhttps://endpoint-import.example.invalid/specific\nhttps://unmatched.example.invalid\n";
      const upload = async () => {
        const dialog = await openEndpointDialog(page);
        const chooser = page.waitForEvent("filechooser");
        await dialog.getByRole("button", { name: "Choose file…" }).click();
        const download = page.waitForEvent("download");
        await (await chooser).setFiles({ name: "endpoints.txt", mimeType: "text/plain", buffer: Buffer.from(content) });
        const unknown = await download;
        assert.equal(unknown.suggestedFilename(), "endpoints_unknown.txt");
        const chunks = [];
        for await (const chunk of await unknown.createReadStream()) chunks.push(chunk);
        assert.equal(Buffer.concat(chunks).toString("utf8"), "https://unmatched.example.invalid\n");
      };
      await upload();
      const imported = await exportModel(page);
      const created = imported.doc.nodes.filter(node => !before.doc.nodes.some(old => old.id === node.id));
      assert.equal(created.length, 1);
      assert.equal(created[0].type, "EndpointSpecific");
      assert.ok(imported.doc.scenarios[0].nodeIds.includes(created[0].id));
      assert.deepEqual(imported.doc.edges, before.doc.edges);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc.nodes, before.doc.nodes);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc.nodes, imported.doc.nodes);
      await upload();
      assert.deepEqual((await exportModel(page)).doc, imported.doc);
      const alerts = await page.evaluate(() => window.endpointAlerts);
      assert.equal(alerts.length, 2);
      assert.match(alerts[0], /Imported 1 new node type/);
      assert.match(alerts[1], /Imported 0 new node types/);
    });
  });
}
