import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { autosaveKey, modelFixture } from "./fixture.mjs";

const mode = process.env.SDS_SERVICE_TEST_MODE;
assert.ok(["disabled", "invalid", "configured", "defaults", "missing", "conflict", "profile", "selected"].includes(mode),
  "Build the matching service configuration and select its documented SDS_SERVICE_TEST_MODE.");
const enabled = ["configured", "profile", "selected"].includes(mode);
const mocked = mode === "configured" || mode === "profile";
const configurationError = ["invalid", "missing", "conflict"].includes(mode);
const tokenEndpoint = "https://services.example.invalid/api/collab-token";
const assistantEndpoint = "https://services.example.invalid/api/design-assistant";
const shareAppUrl = "https://diagram.example.invalid/app/";
const syntheticKey = Buffer.alloc(32, 3).toString("base64url");
const hash = `#room=synthetic-service-room&key=${syntheticKey}`;

for (const delivery of ["hosted", "standalone"]) {
  test(`services production: ${mode} ${delivery} guards and disclosure`, async () => {
    const dist = resolve("dist"), standalone = resolve("dist-single", "index.html");
    assert.ok((await stat(standalone)).size > 0, "Build both formats for this configuration first.");
    const version = JSON.parse(await readFile("package.json", "utf8")).version;
    const origin = "http://localhost:43199";
    const pageUrl = delivery === "hosted" ? `${origin}/` : pathToFileURL(standalone).href;
    const browser = await chromium.launch({ channel: process.env.SDS_TEST_BROWSER_CHANNEL ?? "msedge", headless: true });
    let context;
    const faults = [], tokenRequests = [], assistantRequests = [];
    try {
      context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
      context.setDefaultTimeout(12000);
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (/^(data:|blob:)$/.test(url.protocol)) return route.continue();
        if (mocked && `${url.origin}${url.pathname}` === tokenEndpoint) {
          assert.equal(request.method(), "GET");
          assert.deepEqual([...url.searchParams.keys()], ["room"]);
          assert.equal(url.searchParams.get("room"), "synthetic-service-room");
          assert.equal(url.hash, "");
          tokenRequests.push("synthetic token request");
          return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Synthetic token outage"}' });
        }
        if (mocked && url.href === assistantEndpoint && request.method() === "POST") {
          const body = request.postDataJSON();
          assistantRequests.push(body);
          return route.fulfill({ status: 200, contentType: "application/json",
            body: JSON.stringify({ answer: "Synthetic service reply.", references: [], findings: [] }) });
        }
        if (delivery === "standalone" && url.href === pageUrl) return route.continue();
        if (delivery === "hosted" && url.origin === origin && !url.pathname.includes("/api/")) {
          const file = resolve(dist, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
          if (!file.startsWith(dist + sep)) { faults.push("Out-of-root asset"); return route.abort(); }
          return route.fulfill({ status: 200, body: await readFile(file), contentType:
            { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" }[extname(file)] ?? "application/octet-stream" });
        }
        faults.push("Unexpected service or asset request");
        return route.abort("blockedbyclient");
      });
      await context.routeWebSocket(/.*/, socket => { faults.push("Unexpected WebSocket"); socket.close(); });
      await context.addInitScript(() => {
        Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
      });
      const page = await context.newPage();
      page.on("pageerror", error => faults.push(error.message));
      page.on("dialog", async dialog => { faults.push(`Unexpected ${dialog.type()}`); await dialog.dismiss(); });
      await page.goto(pageUrl + (!enabled ? hash : ""));
      assert.equal(await page.locator(".ps-command-version").textContent(), `v${version}`);
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "service-fixture.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(modelFixture())),
      });
      await page.getByLabel("Document status").getByText("service-fixture.tma", { exact: true }).waitFor();
      if (process.env.SDS_SERVICE_EXPECT_LIBRARIES === "1") {
        await page.getByLabel("Custom Libraries status").getByText("1 loaded; 0 unavailable or rejected", { exact: true }).waitFor();
      }
      await page.getByRole("button", { name: "About", exact: true }).click();
      const about = page.getByRole("dialog", { name: "About SecureDesignStudio", exact: true });
      const text = await about.innerText();
      if (!enabled) {
        if (configurationError) {
          const diagnostic = mode === "missing" ? /missing or unreadable/
            : mode === "conflict" ? /cannot be combined/ : /invalid endpoint/;
          assert.match(text, diagnostic);
          assert.ok(await about.getByRole("alert").count() >= 2);
        } else {
          assert.match(text, /no token endpoint/);
          assert.match(text, /no endpoint is configured/);
          if (mode === "defaults") assert.match(text, /No service configuration/);
        }
        assert.equal(await about.locator("code").count(), 0, "No rejected addresses disclosed");
        assert.equal(text.includes("SYNTHETIC_REJECTED_MARKER"), false);
        assert.equal(new URL(page.url()).hash, hash, "Disabled startup leaves the fragment untouched");
      } else {
        assert.match(text, /Collaboration is configured/);
        if (mocked) {
          assert.ok(text.includes(tokenEndpoint));
          assert.ok(text.includes(assistantEndpoint));
          if (delivery === "standalone") {
            assert.equal(await about.locator("p").filter({ hasText: "Share destination:" }).locator("code").innerText(), shareAppUrl);
          }
          else assert.match(text, /current hosted page/);
          if (mode === "profile") assert.match(text, /Example services \(example\)/);
        } else {
          assert.match(text, delivery === "standalone" ? /no endpoint is configured/ : /Design Assistant is configured/);
        }
      }
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await about.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await about.getByRole("button", { name: "Close", exact: true }).click();
      await page.setViewportSize({ width: 1366, height: 900 });
      const caches = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name ?? ""));
      assert.equal(caches.some(name => /(?:privsec|secure-design-studio):collab:/.test(name)), false,
        "No room persistence before enabled joining; disabled fragments are inert");
      await page.getByRole("tab", { name: /^Findings\b/ }).click();
      const analyze = page.getByRole("button", { name: "Analyze model", exact: true });
      assert.equal(await analyze.isEnabled(), mocked || (mode === "selected" && delivery === "hosted"));
      if (mocked) {
        assert.match(await page.locator(".ps-service-notice").innerText(), /send the included model context/);
        await analyze.click();
        await analyze.waitFor();
        assert.equal(await analyze.isEnabled(), true);
        assert.equal(assistantRequests.length, 1);
        assert.equal(assistantRequests[0].mode, "analyze");
        assert.equal(assistantRequests[0].context.scenario.id, "s_primary");
        assert.equal(tokenRequests.length, 0);

        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.doc.scenarios
          .some(scenario => scenario.id === "s_primary"), autosaveKey);
        await page.goto(pageUrl + hash);
        await page.reload();
        const status = page.locator('button[aria-controls="ps-command-menu-collaboration"]');
        await status.getByText("Error", { exact: true }).waitFor();
        await status.click();
        await page.getByRole("alert").filter({ hasText: "Collaboration token request failed (503)." }).waitFor();
        assert.ok(tokenRequests.length >= 1);
        await page.getByRole("menuitem", { name: "Leave session", exact: true }).click();
      } else if (!enabled) {
        await page.locator('button[aria-controls="ps-command-menu-collaboration"]').click();
        assert.equal(await page.getByRole("menuitem", { name: "Start collaboration", exact: true }).count(), 0);
        await page.keyboard.press("Escape");
        await context.setOffline(true);
        await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
        await page.getByRole("textbox", { name: "Title", exact: true }).fill("Offline services-disabled edit");
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.doc.nodes
          .some(node => node.id === "n_client" && node.title === "Offline services-disabled edit"), autosaveKey);
        assert.equal(tokenRequests.length, 0);
        assert.equal(assistantRequests.length, 0);
        const after = await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name ?? ""));
        assert.equal(after.some(name => /(?:privsec|secure-design-studio):collab:/.test(name)), false);
      }
      assert.deepEqual(faults, []);
    } finally { if (context) await context.close(); await browser.close(); }
  });
}
