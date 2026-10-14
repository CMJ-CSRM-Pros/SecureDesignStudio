import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { requireFreePort, until, hasLocalReadyMessage } from "./harness.mjs";
import { modelFixture, autosaveKey } from "./fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "http://localhost:5173";
const endpoint = "http://localhost:5173/api/design-assistant";
const capabilities = {
  defaultProvider: "claude",
  providers: [
    { id: "azure", label: "Azure OpenAI / Foundry", available: false, message: "Configure an Azure deployment." },
    { id: "claude", label: "Claude Code", available: true, message: "Synthetic Claude subscription ready." },
    { id: "codex", label: "Codex", available: true, message: "Synthetic ChatGPT subscription ready." },
  ],
};

test("AI providers: shared selection, readiness, request routing, persistence and late-response guards", { timeout: 120_000 }, async () => {
  await requireFreePort();
  await requireFreePort(5173, "127.0.0.1");
  await requireFreePort(5173, "::1");
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(VITE_|SDS_LIBRARY_PATHS|SDS_SERVICE_CONFIG)/.test(name)) delete env[name];
  const server = spawn(process.execPath, [resolve(root, "node_modules", "vite", "bin", "vite.js"), "--mode", "ai"],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", chunk => { output += chunk; });
  server.stderr.on("data", chunk => { output += chunk; });
  let browser, context;
  const faults = [], posts = [];
  let readinessError = false;
  let designResponse = { answer: "Synthetic clarification.", assumptions: [], design: null };
  let hold;
  try {
    await until(async () => {
      if (server.exitCode !== null) throw new Error(`Owned Vite exited: ${output}`);
      if (!hasLocalReadyMessage(output)) return false;
      try { return (await fetch(origin)).ok; } catch { return false; }
    }, "owned AI-mode Vite ready", 30_000);
    browser = await chromium.launch({ channel: process.env.SDS_TEST_BROWSER_CHANNEL ?? "msedge", headless: true });
    context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: "block" });
    context.setDefaultTimeout(10_000);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.href === endpoint) {
        if (request.method() === "GET") return route.fulfill({
          status: readinessError ? 503 : 200, contentType: "application/json",
          body: JSON.stringify(readinessError ? { error: "Synthetic readiness outage" } : capabilities),
        });
        const payload = request.postDataJSON();
        posts.push(payload);
        if (hold) await hold;
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify(payload.mode === "design-plan"
            ? { nodeTypeIds: payload.context.nodeTypeIndex.slice(0, 1).map(type => type.id), protocolIds: [], rationale: "Synthetic plan." }
            : payload.mode === "design"
            ? designResponse
            : { answer: "Synthetic review.", references: [], findings: [] }) });
      }
      if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
      if (["data:", "blob:"].includes(url.protocol)) return route.continue();
      faults.push(`Unexpected network: ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket(/.*/, socket => {
      if (!socket.url().startsWith("ws://localhost:5173/")) { faults.push("Unexpected WebSocket"); socket.close(); }
      else socket.connectToServer();
    });
    const page = await context.newPage();
    page.on("pageerror", error => faults.push(error.message));
    await page.goto(origin);
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "synthetic-provider.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(modelFixture())),
    });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("menuitem", { name: "Design Assistant", exact: true }).click();
    const analysis = page.locator(".ps-assistant");
    const selection = analysis.getByLabel("AI provider", { exact: true });
    await until(async () => await selection.inputValue() === "claude", "launcher default applied");
    assert.equal(await selection.locator('option[value="azure"]').isDisabled(), true);
    const otherSetup = analysis.locator(".ps-ai-provider details");
    assert.equal(await otherSetup.getAttribute("open"), null);
    assert.match(await analysis.locator(".ps-ai-provider [role=status]").innerText(), /Claude Code: Synthetic Claude/);
    await otherSetup.getByText("Other provider setup", { exact: true }).click();
    assert.match(await otherSetup.innerText(), /Configure an Azure deployment/);
    await otherSetup.getByText("Other provider setup", { exact: true }).click();
    await selection.selectOption("codex");
    assert.match(await analysis.locator(".ps-ai-provider [role=status]").innerText(), /Codex: Synthetic ChatGPT/);
    assert.doesNotMatch(await analysis.locator(".ps-ai-provider [role=status]").innerText(), /Azure|Foundry/);
    await analysis.getByRole("button", { name: "Analyze model", exact: true }).click();
    await until(() => posts.length === 1, "review sent");
    assert.equal(posts[0].provider, "codex");
    assert.equal(posts[0].mode, "analyze");
    await analysis.getByRole("tab", { name: "Chat", exact: true }).click();
    await analysis.getByLabel("Ask about this model", { exact: true }).fill("Synthetic chat request");
    await analysis.getByRole("button", { name: "Send question", exact: true }).click();
    await analysis.getByText("Synthetic review.", { exact: true }).waitFor();
    assert.equal(posts[1].provider, "codex");
    assert.equal(posts[1].mode, "chat");
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Design with AI/ }).click();
    const designer = page.getByRole("dialog", { name: "Threat Model Designer", exact: true });
    const designerSelection = designer.getByLabel("AI provider", { exact: true });
    assert.equal(await designerSelection.inputValue(), "codex");
    await designerSelection.selectOption("claude");
    assert.equal(await selection.inputValue(), "claude");
    await designer.getByLabel("What would you like to design or change?").fill("Synthetic clarification only");
    let release;
    hold = new Promise(resolve => { release = resolve; });
    await designer.getByRole("button", { name: "Build design", exact: true }).click();
    await until(() => posts.length === 3, "design plan sent");
    assert.equal(posts[2].provider, "claude");
    assert.equal(posts[2].mode, "design-plan");
    assert.equal(posts[2].context.aiDesignGuidance, undefined);
    assert.equal(await designerSelection.isDisabled(), true);
    assert.equal(await selection.isDisabled(), true);
    release();
    hold = null;
    await until(async () => {
      assert.deepEqual(await designer.getByRole("alert").allTextContents(), [], "Synthetic design must not report an error");
      return designer.getByText("Synthetic clarification.", { exact: true }).isVisible();
    }, "synthetic design clarification", 10_000);
    assert.equal(posts.length, 4);
    assert.equal(posts[3].provider, "claude");
    assert.equal(posts[3].mode, "design");
    assert.ok(posts[3].context.catalogScope);
    await designerSelection.selectOption("codex");
    assert.equal(await designer.getByText("Synthetic clarification.", { exact: true }).count(), 0);
    await designer.getByLabel("What would you like to design or change?").fill("Synthetic stopped request");
    hold = new Promise(resolve => { release = resolve; });
    await designer.getByRole("button", { name: "Build design", exact: true }).click();
    await until(() => posts.length === 5, "cancelled design plan sent");
    assert.equal(posts[4].provider, "codex");
    assert.equal(posts[4].mode, "design-plan");
    await designer.getByRole("button", { name: "Stop generating", exact: true }).click();
    await until(async () => await designerSelection.isEnabled(), "stop releases provider lock");
    await designerSelection.selectOption("claude");
    release();
    hold = null;
    await page.waitForTimeout(100);
    assert.equal(posts.length, 5, "A cancelled plan must not start a design request");
    assert.equal(await designer.getByText("Synthetic clarification.", { exact: true }).count(), 0);
    await designerSelection.selectOption("codex");
    await designer.getByRole("button", { name: "Close Threat Model Designer", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("menuitem", { name: "Design Assistant", exact: true }).click();
    await until(async () => await selection.inputValue() === "codex", "local preference restored");
    await analysis.getByRole("tab", { name: "AI Analysis", exact: true }).click();
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey);
    assert.equal(JSON.stringify(saved.doc).includes('"provider"'), false, "Provider choice stays outside the model");
    readinessError = true;
    await analysis.getByRole("button", { name: "Refresh providers", exact: true }).click();
    await analysis.getByRole("alert").filter({ hasText: "readiness check failed" }).waitFor();
    assert.equal(await analysis.getByRole("button", { name: "Analyze model", exact: true }).isDisabled(), true);
    readinessError = false;
    await analysis.getByRole("button", { name: "Refresh providers", exact: true }).click();
    await until(async () => await selection.isEnabled(), "readiness refresh recovered");
    await page.evaluate(() => localStorage.setItem("secure-design-studio:ai-provider:v1", '{"provider":"invalid"}'));
    await page.reload();
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("menuitem", { name: "Design Assistant", exact: true }).click();
    await until(async () => await selection.inputValue() === "claude", "corrupt preference diagnosed");
    await analysis.getByText(/saved AI preference could not be read/).waitFor();
    designResponse = {
      answer: "This full design was applied (synthetic claim that must not be shown).", assumptions: [],
      design: {
        scenario: {}, humanReviewNotes: ["The owner must confirm the gateway target and authentication."],
        nodes: [{ id: "pending-gateway", type: "", title: "Pending gateway", description: "Proposed ingress.", dfdRole: "Process" }],
        edges: [], boundaries: [], data: [],
      },
    };
    const beforePartial = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).doc, autosaveKey);
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Design with AI/ }).click();
    await designer.getByLabel("What would you like to design or change?").fill("Add a gateway but leave its unknown decisions for me");
    await designer.getByRole("button", { name: "Build design", exact: true }).click();
    await designer.getByRole("status").filter({ hasText: "Partial design added for human review." }).waitFor();
    assert.equal(await designer.getByText(designResponse.answer, { exact: true }).count(), 0);
    await page.locator(".ps-text-annotation-content").filter({ hasText: "Human interaction required" }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const partial = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).doc, autosaveKey);
    assert.equal(partial.nodes.at(-1).title, "Pending gateway");
    assert.deepEqual(partial.nodes.slice(0, -1), beforePartial.nodes);
    assert.deepEqual(partial.edges, beforePartial.edges);
    assert.equal(partial.textAnnotations.length, 1);
    await designer.getByRole("button", { name: "Undo model change", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).doc, autosaveKey), beforePartial);
    await designer.getByRole("button", { name: "Redo", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).doc, autosaveKey), partial);
    await page.reload();
    await page.locator(".ps-text-annotation-content").filter({ hasText: "Human interaction required" }).waitFor();
    designResponse.design.nodes = [];
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Design with AI/ }).click();
    await designer.getByLabel("What would you like to design or change?").fill("Record the remaining decision without adding components");
    await designer.getByRole("button", { name: "Build design", exact: true }).click();
    await designer.getByRole("status").filter({ hasText: "Partial design added for human review." }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const pending = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).doc, autosaveKey);
    await designer.getByLabel("What would you like to design or change?").fill("Record the same remaining decision");
    await designer.getByRole("button", { name: "Build design", exact: true }).click();
    await designer.getByRole("status").filter({ hasText: "The design still requires human interaction." }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).doc, autosaveKey), pending);
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(faults, []);
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    if (server.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else server.kill("SIGTERM");
      if (server.exitCode === null) await Promise.race([once(server, "exit"), new Promise((_, reject) => setTimeout(() => reject(new Error("Owned Vite failed to stop")), 5000))]);
    }
  }
});
