import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { modelFixture } from "./fixture.mjs";
import { openEndpointDialog } from "./endpoint-contracts.mjs";

test("libraries production: configured hosted manifest, missing fallback, and self-contained export/reopen", async () => {
  const dist = resolve("dist");
  const standalone = resolve("dist-single", "index.html");
  const manifest = (await readdir(resolve(dist, "assets"))).find(name => /^custom-libraries\..*\.json$/.test(name));
  assert.ok(manifest, "Build with SDS_LIBRARY_PATHS selecting examples\\custom-libraries\\example first.");
  const browser = await chromium.launch({ channel: process.env.SDS_TEST_BROWSER_CHANNEL ?? "msedge", headless: true });
  const folder = await mkdtemp(resolve(tmpdir(), "sds-libraries-"));
  const exported = resolve(folder, "embedded.html");
  let exportedWritten = false;
  const faults = [];
  try {
    for (const missing of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      context.setDefaultTimeout(10000);
      const origin = "http://localhost:43191";
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (/^(data:|blob:)$/.test(url.protocol)) return route.continue();
        if (url.origin !== origin || url.pathname.includes("/api/")) {
          faults.push("Unexpected hosted request");
          return route.abort();
        }
        const file = resolve(dist, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
        if (!file.startsWith(dist + sep)) { faults.push("Out-of-root request"); return route.abort(); }
        if (missing && url.pathname.endsWith(manifest)) {
          return route.fulfill({ status: 200, contentType: "text/html", body: "<html>SPA fallback</html>" });
        }
        const contentType = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
          ".html": "text/html", ".json": "application/json" }[extname(file)] ?? "application/octet-stream";
        await route.fulfill({ status: 200, contentType, body: await readFile(file) });
      });
      await context.routeWebSocket(/.*/, socket => { faults.push("Unexpected WebSocket"); socket.close(); });
      const page = await context.newPage();
      page.on("pageerror", error => faults.push(error.message));
      await page.goto(origin);
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "synthetic.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(modelFixture())),
      });
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.getByRole("menuitem", { name: "Custom Libraries", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Custom Libraries", exact: true });
      await dialog.getByText(missing ? "0 loaded; 1 unavailable or rejected" : "1 loaded; 0 unavailable or rejected", { exact: true }).waitFor();
      if (missing) assert.match(await dialog.innerText(), /not JSON/);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      const endpointDialog = await openEndpointDialog(page);
      const example = endpointDialog.getByRole("textbox", { name: "Endpoint import example", exact: true });
      if (missing) assert.equal(await example.count(), 0);
      else assert.equal(await example.inputValue(), "https://example.invalid/service\nhttps://example.invalid/other");
      await context.close();
    }
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
    const allowed = new Set([pathToFileURL(standalone).href, pathToFileURL(exported).href]);
    await context.route("**/*", route => {
      if (allowed.has(route.request().url()) || /^(data:|blob:)/.test(route.request().url())) return route.continue();
      faults.push("Unexpected standalone request"); return route.abort();
    });
    await context.routeWebSocket(/.*/, socket => { faults.push("Unexpected standalone WebSocket"); socket.close(); });
    const page = await context.newPage();
    page.on("pageerror", error => faults.push(error.message));
    await page.goto(pathToFileURL(standalone).href);
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "synthetic.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(modelFixture())),
    });
    await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    await page.getByRole("textbox", { name: /^Example owner ID/ }).fill("saved-owner");
    await page.locator('button[aria-controls="ps-command-menu-file"]').click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /Standalone HTML/i }).click();
    await (await downloadEvent).saveAs(exported);
    exportedWritten = true;
    const reopened = await context.newPage();
    reopened.on("pageerror", error => faults.push(error.message));
    await reopened.goto(pathToFileURL(exported).href);
    await reopened.getByLabel("Custom Libraries status").getByText("1 loaded; 0 unavailable or rejected", { exact: true }).waitFor();
    await reopened.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    assert.equal(await reopened.getByRole("textbox", { name: /^Example owner ID/ }).inputValue(), "saved-owner");
    const endpointDialog = await openEndpointDialog(reopened);
    assert.equal(await endpointDialog.getByRole("textbox", { name: "Endpoint import example", exact: true }).inputValue(),
      "https://example.invalid/service\nhttps://example.invalid/other");
    assert.deepEqual(faults, []);
    await context.close();
  } finally {
    await browser.close();
    if (exportedWritten) await unlink(exported);
    await rmdir(folder);
  }
});
