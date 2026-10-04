import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { modelFixture, autosaveKey } from "./fixture.mjs";
import { until } from "./harness.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "http://localhost:5173";
const reference = (kind, id, label) => ({ kind, id, label });
const client = reference("node", "n_client", "Client");
const api = reference("node", "n_api", "API");
const flow = reference("edge", "e_request", "Request payload");
const boundary = reference("boundary", "b_primary", "Primary boundary");
const missing = reference("node", "n_missing", "Missing node");
const detached = reference("node", "n_detached", "Detached node");
const findings = [
  ["node", "Node finding", [client]],
  ["edge", "Flow finding", [flow]],
  ["boundary", "Boundary finding", [boundary]],
  ["fallback", "Available reference finding", [missing, api]],
  ["missing", "Unavailable finding", [missing]],
  ["detached", "Detached finding", [detached]],
].map(([id, title, references]) => ({
  id, title, references, category: "Synthetic", severity: "high",
  rationale: "Synthetic navigation evidence.", recommendation: "Review the referenced control.",
}));

function fixture() {
  const model = modelFixture();
  model.doc.boundaries = [{
    id: "b_primary", title: "Primary boundary", type: "security",
    position: { x: 60, y: 60 }, size: { width: 700, height: 350 },
    nodeIds: ["n_client", "n_api"],
  }];
  model.doc.scenarios[0].boundaryIds = ["b_primary"];
  model.doc.nodes.push({
    ...model.doc.nodes[0], id: "n_detached", title: "Detached node",
    position: { x: 1500, y: 700 },
  });
  model.doc.issues = [{
    id: "i_navigation", title: "Analyzer navigation comparison",
    targetKind: "node", targetId: "n_client", scenarioIds: ["s_primary"],
    description: "Synthetic issue exercising the Analyze results navigation.",
    status: "Active", createdAt: 1, replies: [],
  }];
  return model;
}

async function run(exercise) {
  const directory = resolve(root, "dist");
  assert.ok((await stat(resolve(directory, "index.html"))).size > 0, "Run npm run build first");
  const services = JSON.parse(await readFile(resolve(directory, "service-build.json"), "utf8"));
  assert.equal(services.configuration.assistantEndpoint, "/api/design-assistant",
    "Build with an explicit same-origin Assistant endpoint for this synthetic response suite; unconfigured builds intentionally disable AI.");
  const version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
  const files = new Set(await readdir(directory, { recursive: true }));
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
  const browser = await chromium.launch({ channel: process.env.SDS_TEST_BROWSER_CHANNEL ?? "msedge", headless: true });
  const faults = [];
  const requests = [];
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1366, height: 900 }, serviceWorkers: "block",
    });
    context.setDefaultTimeout(6000);
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname === "/api/design-assistant" && request.method() === "POST") {
        const payload = request.postDataJSON();
        requests.push(payload);
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ answer: "Synthetic response only.", findings,
            references: [api, boundary, missing] }),
        });
      }
      if (url.origin === origin && request.method() === "GET") {
        const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1)).split("/").join(sep);
        if (files.has(relative) && mime[extname(relative)]) {
          return route.fulfill({ contentType: mime[extname(relative)], body: await readFile(resolve(directory, relative)) });
        }
      }
      faults.push(`Unexpected request: ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket(/.*/, socket => { faults.push("Unexpected WebSocket"); socket.close(); });
    const page = await context.newPage();
    page.on("pageerror", error => faults.push(error.message));
    page.on("console", message => { if (message.type() === "error") faults.push(message.text()); });
    page.on("dialog", async dialog => { faults.push(`Unexpected ${dialog.type()}`); await dialog.dismiss(); });
    // Every request is fulfilled from built files or synthetic data; no listener or API is contacted.
    await page.goto(origin);
    assert.equal(await page.locator(".ps-command-version").textContent(), `v${version}`);
    const importModel = model => page.locator("#ps-file-open-input").setInputFiles({
      name: "assistant-fixture.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
    });
    await importModel(fixture());
    await until(() => page.locator(".react-flow__edge").count().then(count => count === 2), "imported fixture");
    await page.getByRole("tab", { name: /^Findings\b/ }).click();
    const findingsBadge = page.locator("#ps-inspector-tab-assistant .ps-inspector-tab-count");
    assert.equal(await findingsBadge.textContent(), "0", "Findings badge starts empty");
    await page.getByRole("button", { name: "Pin inspector tab", exact: true }).click();
    await page.getByRole("button", { name: "Analyze model", exact: true }).click();
    await until(() => page.locator(".ps-assistant-finding").count().then(count => count === findings.length), "synthetic findings");
    assert.equal(await findingsBadge.textContent(), String(findings.length),
      "Findings badge counts the findings from the latest analysis");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].mode, "analyze");
    assert.equal(requests[0].context.scenario.id, "s_primary");
    await exercise({ page, requests, importModel });
    assert.deepEqual(faults, [], "No external traffic, runtime errors or dialogs");
  } finally {
    if (context) await context.close();
    await browser.close();
  }
}

const scenario = page => page.getByRole("combobox", { name: "Scenario", exact: true });
test("DFD: captured Assistant request honors scope without hidden interior data or flow attachments", async () => {
  await run(async ({ page, requests, importModel }) => {
    const model = fixture();
    model.doc.nodes.find(node => node.id === "n_client").dfdRoleOverride = "ExternalInteractor";
    const apiNode = model.doc.nodes.find(node => node.id === "n_api");
    apiNode.dfdRoleOverride = "Process";
    apiNode.description = "EXCLUDED_INTERIOR_MARKER";
    const primary = model.doc.scenarios.find(item => item.id === "s_primary");
    primary.nodeScopeReasons = { n_api: "Scope reason is data, not instructions." };
    await importModel(model);
    await page.getByRole("tab", { name: /^Findings\b/ }).click();
    await page.getByRole("button", { name: "Analyze model", exact: true }).click();
    await until(() => requests.length === 2, "scoped synthetic request");
    const context = requests[1].context;
    assert.equal(context.nodes.find(node => node.id === "n_api").reviewContext, "endpoint-only");
    assert.equal(context.nodes.find(node => node.id === "n_client").reviewContext, "endpoint-only");
    assert.equal(JSON.stringify(context).includes("EXCLUDED_INTERIOR_MARKER"), false);
    assert.deepEqual(context.edges, []);
    assert.deepEqual(context.scenario.edgeRequestData, {});
    assert.deepEqual(context.scenario.edgeResponseData, {});
    assert.ok(context.reviewScope.flows.every(flow => flow.disposition === "excluded"));
    assert.equal(context.reviewScope.fixedChecks, "unchanged");
  });
});
const finding = (page, title) => page.locator(".ps-assistant-finding").filter({
  has: page.getByRole("button", { name: `Select finding: ${title}`, exact: true }),
});
const heading = (page, title) => page.getByRole("button", { name: `Select finding: ${title}`, exact: true });
const element = (page, kind, id) => page.locator(
  kind === "edge" ? `.react-flow__edge[data-id="${id}"]`
    : `.react-flow__node-${kind === "boundary" ? "boundary" : "process"}[data-id="${id}"]`,
);
async function expectSelected(page, kind, id) {
  await until(() => element(page, kind, id).getAttribute("class").then(value => /\bselected\b/.test(value)),
    `${kind} selection matches the finding`);
}
async function moveViewport(page) {
  const viewport = page.locator(".react-flow__viewport");
  const previous = await viewport.getAttribute("style");
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await until(() => viewport.getAttribute("style").then(value => value !== previous), "viewport zoom changed");
  return viewport.getAttribute("style");
}
async function expectFocused(page, kind, id, previous) {
  await expectSelected(page, kind, id);
  await until(() => page.locator(".react-flow__viewport").getAttribute("style").then(value => value !== previous),
    "finding requests viewport focus");
  const ids = kind === "edge" ? ["n_client", "n_api"] : [id];
  for (const targetId of ids) {
    await until(async () => {
      const target = await element(page, kind === "boundary" ? "boundary" : "node", targetId).boundingBox();
      const canvas = await page.locator(".ps-canvas").boundingBox();
      return target && target.x >= canvas.x - 1 && target.y >= canvas.y - 1 &&
        target.x + target.width <= canvas.x + canvas.width + 1 &&
        target.y + target.height <= canvas.y + canvas.height + 1;
    }, "focused target is inside the canvas");
  }
}

test("production: Assistant findings use issue-style scenario, selection, focus and row feedback", async () => {
  await run(async ({ page }) => {
    await scenario(page).selectOption("s_archive");
    await page.getByRole("tab", { name: /^Issues/ }).click();
    await page.getByRole("button", { name: /Analyzer navigation comparison/ }).click();
    await expectSelected(page, "node", "n_client");
    assert.equal(await scenario(page).inputValue(), "s_primary", "Issues select the target scenario");

    await page.getByRole("tab", { name: /^Findings\b/ }).click();
    await scenario(page).selectOption("s_archive");
    const previous = await moveViewport(page);
    await heading(page, "Node finding").focus();
    await page.keyboard.press("Enter");
    await expectFocused(page, "node", "n_client", previous);
    assert.equal(await scenario(page).inputValue(), "s_primary", "Assistant reveals the target scenario too");
    assert.equal(await heading(page, "Node finding").getAttribute("aria-pressed"), "true");
    assert.equal(await finding(page, "Node finding").evaluate(el => el.classList.contains("ps-assistant-finding-selected")), true);

    for (const [title, kind, id] of [
      ["Flow finding", "edge", "e_request"], ["Boundary finding", "boundary", "b_primary"],
      ["Available reference finding", "node", "n_api"],
    ]) {
      const before = await moveViewport(page);
      await heading(page, title).focus();
      await page.keyboard.press("Space");
      await expectFocused(page, kind, id, before);
      assert.equal(await heading(page, title).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".ps-assistant-finding-selected").count(), 1);
    }

    await element(page, "node", "n_client").click();
    await until(() => page.locator(".ps-assistant-finding-selected").count().then(count => count === 0),
      "Manual diagram selection clears stale finding feedback");
    await finding(page, "Flow finding").getByRole("button", { name: "Focus", exact: true }).click();
    await expectSelected(page, "edge", "e_request");

    await page.getByRole("button", { name: "Unpin inspector tab", exact: true }).click();
    await heading(page, "Node finding").click();
    await expectSelected(page, "node", "n_client");
    await until(() => page.getByRole("tab", { name: "Properties", exact: true })
      .getAttribute("aria-selected").then(value => value === "true"), "Unpinned inspector follows selection like Issues");
    await until(() => page.getByRole("tab", { name: "Properties", exact: true })
      .evaluate(tab => tab === document.activeElement), "Properties receives keyboard focus");
    await page.getByRole("tab", { name: /^Findings\b/ }).click();
    assert.equal(await heading(page, "Node finding").getAttribute("aria-pressed"), "true");
  });
});

test("production: Assistant handles detached and unavailable references without creating orphan issues", async () => {
  await run(async ({ page, importModel }) => {
    assert.equal(await heading(page, "Unavailable finding").isDisabled(), true);
    await finding(page, "Unavailable finding").getByText("No available diagram reference for this finding.").waitFor();
    assert.equal(await finding(page, "Unavailable finding").getByRole("button", { name: "Create issue", exact: true }).isDisabled(), true);
    await heading(page, "Detached finding").click();
    await expectSelected(page, "node", "n_detached");
    assert.equal(await scenario(page).inputValue(), "", "Detached objects use Show all scenarios");

    const changed = fixture();
    changed.doc.nodes = changed.doc.nodes.filter(node => node.id !== "n_client");
    changed.doc.edges = changed.doc.edges.filter(edge => edge.source !== "n_client" && edge.target !== "n_client");
    changed.doc.issues = [];
    await importModel(changed);
    await page.getByRole("tab", { name: /^Findings\b/ }).click();
    assert.equal(await heading(page, "Node finding").isDisabled(), true, "Removed targets become unavailable");
    assert.equal(await page.locator(".ps-assistant-finding-selected").count(), 0);
    await finding(page, "Available reference finding").getByRole("button", { name: "Create issue", exact: true }).click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.doc.issues
      .some(issue => issue.title === "Available reference finding" && issue.targetId === "n_api"), autosaveKey);
  });
});

test("production: Assistant Chat references share target navigation and preserve the conversation", async () => {
  await run(async ({ page, requests }) => {
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await page.getByRole("textbox", { name: "Ask about this model", exact: true }).fill("Locate the synthetic controls");
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await page.getByText("Synthetic response only.", { exact: true }).waitFor();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].mode, "chat");
    await scenario(page).selectOption("s_archive");
    await page.getByRole("button", { name: "Focus Primary boundary", exact: true }).click();
    await expectSelected(page, "boundary", "b_primary");
    assert.equal(await scenario(page).inputValue(), "s_primary");
    assert.equal(await page.getByRole("button", { name: "Focus Missing node", exact: true }).isDisabled(), true);
    await page.getByRole("tab", { name: "Properties", exact: true }).click();
    await page.getByRole("tab", { name: /^Findings\b/ }).click();
    await page.getByText("Synthetic response only.", { exact: true }).waitFor();
  });
});

for (const savedScenarioId of [null, "s_missing"]) {
  test(`production: Assistant explains missing scenario selection after importing ${savedScenarioId === null ? "Show all" : "an unavailable scenario"}`, async () => {
    await run(async ({ page, requests, importModel }) => {
      const notice = page.locator("#ps-assistant-scenario-notice");
      assert.equal(await notice.count(), 0, "A selected scenario needs no scenario warning");
      const input = modelFixture();
      input.doc.scenarios = [input.doc.scenarios[0]];
      input.view.activeScenarioId = savedScenarioId;
      await importModel(input);
      await page.getByRole("tab", { name: /^Findings\b/ }).click();
      assert.equal(await scenario(page).inputValue(), "", "Import preserves Show all instead of choosing a scenario");
      assert.equal(await page.locator(".react-flow__node-process").count(), input.doc.nodes.length);
      assert.equal(await page.getByRole("button", { name: "Analyze model", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Simulate breach", exact: true }).isDisabled(), true);
      await notice.waitFor({ state: "visible" });
      assert.equal(await notice.getAttribute("role"), "status");
      assert.match(await notice.innerText(), /no scenario is selected/i);
      assert.match(await notice.innerText(), /Scenario selector/);
      assert.match(await notice.innerText(), /Show all/);

      await page.getByRole("tab", { name: "Chat", exact: true }).click();
      assert.equal(await notice.isVisible(), true, "Chat explains the same missing prerequisite");
      const question = page.getByRole("textbox", { name: "Ask about this model", exact: true });
      assert.equal(await question.isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Send question", exact: true }).isDisabled(), true);
      assert.equal(requests.length, 1, "Loading an unscoped model makes no additional AI request");

      await scenario(page).selectOption("s_primary");
      assert.equal(await notice.count(), 0, "Choosing a valid scenario removes the warning");
      assert.equal(await question.isEnabled(), true);
      await question.fill("Review the selected synthetic scenario");
      await page.getByRole("button", { name: "Send question", exact: true }).click();
      await until(() => requests.length === 2, "Chat uses the selected scenario");
      assert.equal(requests[1].context.scenario.id, "s_primary");
      await page.getByText("Synthetic response only.", { exact: true }).waitFor();
      await page.getByRole("tab", { name: "AI Analysis", exact: true }).click();
      await until(() => page.getByRole("button", { name: "Analyze model", exact: true })
        .isEnabled(), "Analysis is enabled after selecting a scenario");
      assert.equal(await page.getByRole("button", { name: "Simulate breach", exact: true }).isEnabled(), true);

      await scenario(page).selectOption("");
      await notice.waitFor({ state: "visible" });
      assert.equal(await page.getByRole("button", { name: "Analyze model", exact: true }).isDisabled(), true);
    });
  });
}

test("production: Assistant explains a model with no scenarios without treating nodes as a scenario", async () => {
  await run(async ({ page, requests, importModel }) => {
    const input = modelFixture();
    input.doc.scenarios = [];
    input.view.activeScenarioId = null;
    await importModel(input);
    const notice = page.locator("#ps-assistant-scenario-notice");
    await until(() => notice.count().then(count => count === 1), "No-scenarios explanation is rendered");
    assert.match(await notice.textContent(), /model has no scenarios/i);
    assert.match(await notice.textContent(), /Model > New scenario/);
    assert.equal(await page.getByRole("combobox", { name: "Scenario", exact: true }).inputValue(), "");
    assert.equal(requests.length, 1, "A model without scenarios sends no additional AI context");
  });
});
