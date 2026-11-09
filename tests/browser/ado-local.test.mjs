import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { requireFreePort, until, hasLocalReadyMessage } from "./harness.mjs";
import { modelFixture } from "./fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "http://localhost:5173";
const msalModule = `
export const BrowserCacheLocation = { MemoryStorage: "memoryStorage" };
export class PublicClientApplication {
  constructor(settings) { window.__adoSettings = settings; }
  async initialize() {}
  async loginPopup() { window.__adoPopups = (window.__adoPopups || 0) + 1; return { account: { homeAccountId: "synthetic" } }; }
  setActiveAccount(account) { this.account = account; }
  getActiveAccount() { return this.account; }
  async acquireTokenSilent() { return { accessToken: "synthetic-test-token" }; }
}`;

test("local ADO: explicit mode enables connection and accepted-only submission with synthetic MSAL and ADO", { timeout: 120_000 }, async () => {
  await requireFreePort();
  await requireFreePort(5173, "127.0.0.1");
  await requireFreePort(5173, "::1");
  const output = mkdtempSync(join(tmpdir(), "sds-ado-local-"));
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(VITE_|SDS_LIBRARY_PATHS|SDS_SERVICE_CONFIG)/.test(name)) delete env[name];
  env.VITE_ADO_TENANT_ID = "11111111-1111-4111-8111-111111111111";
  env.VITE_ADO_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
  const server = spawn(process.execPath, [resolve(root, "node_modules", "vite", "bin", "vite.js"), "--mode", "ado"],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let serverOutput = "", browser, context, page, failure;
  const faults = [], posts = [];
  server.stdout.on("data", chunk => { serverOutput += chunk; });
  server.stderr.on("data", chunk => { serverOutput += chunk; });
  server.on("error", error => { failure = error; });
  try {
    await until(async () => {
      if (failure) throw failure;
      if (server.exitCode !== null) throw new Error(`Owned Vite exited: ${serverOutput}`);
      if (!hasLocalReadyMessage(serverOutput)) return false;
      try { return (await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    }, "owned ADO-mode Vite ready", 30_000);
    const unsigned = await fetch(`${origin}/api/ado-work-items`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(unsigned.status, 401, "The real local adapter loads the relay and rejects missing bearer authorization");
    const crossOrigin = await fetch(`${origin}/api/ado-work-items`, {
      method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(crossOrigin.status, 403, "The real local adapter rejects cross-origin calls before any ADO request");
    browser = await chromium.launch({ channel: process.env.SDS_TEST_BROWSER_CHANNEL ?? "msedge", headless: true });
    context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
    context.setDefaultTimeout(10_000);
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && /\/@azure_msal-browser\.js$/.test(url.pathname)) {
        return route.fulfill({ contentType: "application/javascript", body: msalModule });
      }
      if (url.origin === origin && url.pathname === "/api/ado-work-items") {
        const payload = request.postDataJSON();
        posts.push(payload);
        assert.equal(request.headers().authorization, "Bearer synthetic-test-token");
        const id = 41 + posts.filter(post => !post.validateOnly).length;
        return route.fulfill({ contentType: "application/json",
          body: JSON.stringify(payload.validateOnly ? { validated: true } :
            { id, url: `https://dev.azure.com/synthetic/Synthetic%20Project/_workitems/edit/${id}` }) });
      }
      if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
      if (["data:", "blob:"].includes(url.protocol)) return route.continue();
      faults.push(`Unexpected request: ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket(/.*/, socket => {
      if (new URL(socket.url()).origin === "ws://localhost:5173") socket.connectToServer();
      else { faults.push("Unexpected WebSocket"); socket.close(); }
    });
    page = await context.newPage();
    page.on("pageerror", error => faults.push(error.message));
    await page.goto(`${origin}/#room=synthetic&key=inert`);
    const model = modelFixture();
    model.doc.workItems = [
      { id: "wi_accepted", title: "Synthetic accepted", description: "Synthetic finding", severity: "2 - High",
        workItemType: "Bug", weaknessType: "Bug weakness", decision: "accepted", link: "" },
      { id: "wi_task", title: "Synthetic task", description: "Synthetic follow-up", severity: "4 - Low",
        workItemType: "Task", decision: "accepted", link: "" },
      { id: "wi_pending", title: "Synthetic pending", description: "Not queued", decision: "pending", link: "" },
    ];
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "synthetic-ado.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
    });
    await page.getByRole("tab", { name: /^Work\b/ }).click();
    const panel = page.locator("#ps-inspector-panel-work");
    await panel.getByText("ADO configuration", { exact: true }).click();
    const configEditor = panel.getByLabel("ADO configuration (JSON)", { exact: true });
    const configuration = {
      organizationUrl: "https://dev.azure.com/synthetic", project: "Synthetic Project",
      defaults: {},
    };
    await configEditor.fill(JSON.stringify(configuration));
    await panel.getByRole("button", { name: "Save ADO configuration", exact: true }).click();
    assert.match(await panel.innerText(), /Connected local ADO mode/);
    assert.equal(await panel.getByLabel("Entra tenant ID", { exact: true }).count(), 0);
    const connect = panel.getByRole("button", { name: "Connect to Azure DevOps", exact: true });
    assert.equal(await connect.isEnabled(), true);
    assert.equal(posts.length, 0, "Opening, authoring and accepting work never sends it");
    await connect.click();
    await panel.getByRole("button", { name: "Reconnect to Azure DevOps", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__adoPopups), 1);
    assert.equal(await page.evaluate(() => window.__adoSettings.auth.redirectUri), `${origin}/`);
    assert.equal(posts.length, 0, "Sign-in alone never submits work");
    await configEditor.fill(JSON.stringify({ ...configuration, project: "Different Project" }));
    assert.equal(await panel.getByRole("button", { name: "Submit accepted (2)", exact: true }).isDisabled(), true,
      "An unsaved configuration cannot submit through the previously connected destination");
    assert.equal(await panel.getByRole("button", { name: "Reconnect to Azure DevOps", exact: true }).isDisabled(), true);
    assert.equal(posts.length, 0);
    await configEditor.fill(JSON.stringify(configuration, null, 2));
    page.once("dialog", async dialog => { assert.equal(dialog.type(), "confirm"); await dialog.accept(); });
    await panel.getByRole("button", { name: "Submit accepted (2)", exact: true }).click();
    await panel.getByRole("heading", { name: "Submission summary", exact: true }).waitFor();
    assert.equal(posts.length, 4);
    assert.deepEqual(posts.map(post => post.validateOnly), [true, true, false, false]);
    assert.deepEqual(posts.map(post => post.draft.title), ["Synthetic accepted", "Synthetic task", "Synthetic accepted", "Synthetic task"]);
    assert.deepEqual(posts.map(post => post.draft.workItemType), ["Bug", "Task", "Bug", "Task"]);
    assert.deepEqual(posts.map(post => post.draft.weaknessType), ["Bug weakness", undefined, "Bug weakness", undefined]);
    assert.ok(posts.filter(post => post.draft.workItemType === "Task").every(post => !Object.hasOwn(post.draft, "weaknessType")));
    assert.ok(posts.every(post => post.configuration.workItemType === undefined));
    assert.equal(await panel.getByRole("button", { name: "Submit accepted (0)", exact: true }).isDisabled(), true);
    await until(() => page.evaluate(() =>
      localStorage.getItem("secure-design-studio:autosave:v1")?.includes('"adoId":42')),
    "submitted receipt autosaved");
    await page.screenshot({ path: join(output, "connected-local-result.png") });
    await page.reload();
    await page.getByRole("tab", { name: /^Work\b/ }).click();
    assert.equal(await panel.getByRole("button", { name: "Submit accepted (0)", exact: true }).isDisabled(), true);
    assert.equal(posts.length, 4, "Reload never repeats creation");
    assert.deepEqual(faults, []);
  } catch (error) {
    failure = error;
    if (page) await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    if (server.pid && server.exitCode === null) { server.kill(); await once(server, "exit"); }
    writeFileSync(join(output, "server.log"), serverOutput);
    writeFileSync(join(output, "results.json"), JSON.stringify({
      status: failure ? "failed" : "passed", faults, syntheticPosts: posts.length,
      realAuthentication: "not-run", liveAdoWrites: "none", humanUsability: "not-run",
    }, null, 2));
    console.log(`Local ADO browser evidence: ${output}`);
  }
});
