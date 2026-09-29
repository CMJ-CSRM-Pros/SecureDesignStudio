import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, stat, unlink, rmdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { catalogSnapshotFixture, catalogReferenceSnapshot, unavailableIssueFixture, autosaveKey } from "./fixture.mjs";
import { historicalAuthenticationDefinitions, historicalTaxonomyDefinitions } from "../authentication/catalog-fixtures.mjs";

test("production: standalone Authentication Library definition and version survive export/reopen", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const file = resolve(root, "dist-single", "index.html");
  assert.ok((await stat(file)).size > 0, "Run the full frontend build first");
  const version = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
  const artifactDirectory = await mkdtemp(resolve(tmpdir(), "sds-auth-html-"));
  const exportedFile = resolve(artifactDirectory, "exported-model.html");
  const allowedFiles = new Set([pathToFileURL(file).href, pathToFileURL(exportedFile).href]);
  let artifactWritten = false;
  const browser = await chromium.launch({
    channel: process.env.SDS_TEST_BROWSER_CHANNEL ?? "msedge", headless: true,
  });
  const faults = [];
  let context;
  try {
    context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(30000);
    await context.route("**/*", route => {
      const url = route.request().url();
      if (allowedFiles.has(url) || /^(data:|blob:)/.test(url)) return route.continue();
      faults.push(`Unexpected production request: ${new URL(url).protocol}`);
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket(/.*/, socket => { faults.push("Unexpected production WebSocket"); socket.close(); });
    await context.addInitScript(() => {
      Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
    });
    const page = await context.newPage();
    page.on("pageerror", error => faults.push(error.message));
    page.on("console", message => { if (message.type() === "error") faults.push(message.text()); });
    page.on("dialog", async dialog => { faults.push(`Unexpected ${dialog.type()}`); await dialog.dismiss(); });
    await page.goto(pathToFileURL(file).href);
    assert.equal(await page.locator(".ps-command-version").textContent(), `v${version}`);
    const input = catalogSnapshotFixture();
    input.doc.data.push(
      { id: "d_admin", name: "Portable administrator", classification: "Administrator Data", sample: "SYNTHETIC" },
      { id: "d_customer", name: "Portable customer data", classification: "Customer Data", sample: "SYNTHETIC" },
    );
    const privateTaxonomy = historicalTaxonomyDefinitions().filter(def => ["M365ComplianceBoundary", "ests-relationship"].includes(def.id));
    input.doc.catalogDefinitions.push(...privateTaxonomy);
    input.doc.boundaries.push({ id: "b_portable_taxonomy", type: "privacy", privacySubtype: "M365ComplianceBoundary",
      title: "Portable privacy perimeter", position: { x: 830, y: 340 }, size: { width: 280, height: 180 }, nodeIds: [] });
    input.doc.scenarios[0].boundaryIds.push("b_portable_taxonomy");
    input.doc.deviations.push({ id: "dv_portable_taxonomy", key: "synthetic:portable-taxonomy", kind: "ests-relationship",
      title: "Portable historical evidence", description: "Synthetic", explanation: "Retain", status: "Resolved",
      scenarioIds: [input.doc.scenarios[0].id], evidenceIds: ["synthetic"], createdAt: 1, updatedAt: 2 });
    input.doc.nodes[0].type = "Dataverse";
    input.doc.nodes[0].serviceTreeId = "11111111-1111-4111-8111-111111111111";
    input.doc.nodes[0].endpointRegex = "^https://retained-node\\.example\\.invalid/";
    input.doc.issues = unavailableIssueFixture().doc.issues.filter(issue => issue.id === "i_unavailable");
    input.doc.catalogDefinitions[0].description = "Literal </ScRiPt><b>saved display text</b>.";
    input.doc.edges[1].productionIdentity = structuredClone(input.doc.edges[0].productionIdentity);
    input.doc.authenticationDefinitions = [{
      id: "auth_portable", label: "Portable proof",
      description: "Preserve <b>literal</b> and mixed </ScRiPt> text, not executable markup.",
    }];
    const retainedContract = historicalAuthenticationDefinitions().find(def => def.id === "EntraApplicationOnlyWithCdt");
    input.doc.authenticationDefinitions.push({
      ...retainedContract,
      behavior: { ...retainedContract.behavior, productionIdentity: "optional", audience: false, constraints: false },
    });
    input.doc.edges[1].authenticationTypes = [retainedContract.id];
    input.doc.edges[0].authenticationTypes = ["auth_portable"];
    input.doc.edges[0].productionIdentity = { kind: "ManagedIdentity" };
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "portable.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
    });
    await page.getByLabel("Document status").getByText("portable.tma", { exact: true }).waitFor();
    await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    assert.equal(await page.getByRole("textbox", { name: "Inventory ID", exact: true }).inputValue(), input.doc.nodes[0].serviceTreeId);
    assert.equal(await page.getByRole("textbox", { name: "EndpointRegex", exact: true }).inputValue(), input.doc.nodes[0].endpointRegex);
    await page.locator('button[aria-controls="ps-command-menu-review"]').click();
    await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
    await page.locator(".ps-allissues").getByText("Not re-evaluated: rule unavailable", { exact: true }).waitFor();
    await page.getByRole("tab", { name: /^Edges/ }).click();
    await page.getByRole("row", { name: /^Request payload, sequence/ }).click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    assert.equal(await page.locator(".ps-auth-description").textContent(), input.doc.authenticationDefinitions[0].description);
    await page.locator('button[aria-controls="ps-command-menu-file"]').click();
    const exportEntry = page.getByRole("menuitem", { name: /Standalone HTML/i });
    const downloadEvent = page.waitForEvent("download");
    await exportEntry.click();
    const download = await downloadEvent;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const html = Buffer.concat(chunks).toString("utf8");
    const embedded = html.match(/<script type="application\/json" id="ps-embedded-doc">([\s\S]*?)<\/script>/);
    assert.ok(embedded, "The exported artifact contains the native wrapper");
    const payload = JSON.parse(embedded[1]);
    for (const id of ["Administrator Data", "Customer Data"]) {
      assert.ok(payload.doc.data.some(item => item.classification === id));
      assert.match(payload.doc.catalogDefinitions.find(def => def.kind === "classification" && def.id === id).description, /Purview/);
    }
    for (const definition of privateTaxonomy) {
      assert.deepEqual(payload.doc.catalogDefinitions.find(def => def.kind === definition.kind && def.id === definition.id), definition);
    }
    assert.equal(payload.doc.nodes.find(node => node.id === "n_client").serviceTreeId, input.doc.nodes[0].serviceTreeId);
    assert.equal(payload.doc.nodes.find(node => node.id === "n_client").endpointRegex, input.doc.nodes[0].endpointRegex);
    assert.equal(payload.doc.authenticationDefinitions.find(def => def.id === retainedContract.id).behavior.productionIdentity, "optional");
    assert.equal(JSON.stringify(payload.doc).includes("unavailableReason"), false);
    assert.deepEqual(payload.doc.issues.find(issue => issue.id === "i_unavailable"),
      { ...input.doc.issues[0], notEvaluatedReason: "rule-unavailable" });
    assert.equal(payload.doc.authenticationDefinitions.find(def => def.id === "auth_portable").description,
      input.doc.authenticationDefinitions[0].description);
    assert.deepEqual(payload.doc.edges[0].productionIdentity, { kind: "ManagedIdentity" });
    assert.deepEqual(catalogReferenceSnapshot(payload.doc), catalogReferenceSnapshot(input.doc));
    for (const definition of input.doc.catalogDefinitions) {
      assert.deepEqual(payload.doc.catalogDefinitions.find(def => def.kind === definition.kind && def.id === definition.id), definition);
    }
    await download.saveAs(exportedFile);
    artifactWritten = true;
    await context.addInitScript(key => {
      localStorage.setItem(key, JSON.stringify({
        version: 1, doc: { version: 1, nodes: [], edges: [], nodeTypes: [], scenarios: [] },
        past: [], future: [], view: {},
      }));
    }, autosaveKey);
    const reopened = await context.newPage();
    reopened.on("pageerror", error => faults.push(error.message));
    await reopened.goto(pathToFileURL(exportedFile).href);
    assert.equal(await reopened.locator(".ps-command-version").textContent(), `v${version}`);
    await reopened.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    assert.equal(await reopened.getByRole("textbox", { name: "Inventory ID", exact: true }).inputValue(), input.doc.nodes[0].serviceTreeId);
    assert.equal(await reopened.getByRole("textbox", { name: "EndpointRegex", exact: true }).inputValue(), input.doc.nodes[0].endpointRegex);
    await reopened.getByRole("tab", { name: /^Issues/ }).click();
    const savedIssue = reopened.locator(".ps-allissues-row").filter({ hasText: "Saved i_unavailable" });
    await savedIssue.getByText("Not re-evaluated: rule unavailable", { exact: true }).waitFor();
    await savedIssue.getByRole("button", { name: "Details", exact: true }).click();
    await savedIssue.getByText("Saved review decision.", { exact: true }).waitFor();
    assert.equal(await savedIssue.getByRole("link", { name: /Resolution guidance/ }).getAttribute("href"),
      "https://example.invalid/remediation");
    await reopened.getByRole("tab", { name: /^Edges/ }).click();
    await reopened.getByRole("row", { name: /^Request payload, sequence/ }).click();
    await reopened.getByRole("tab", { name: /^Properties/ }).click();
    assert.equal(await reopened.locator(".ps-auth-description").textContent(), input.doc.authenticationDefinitions[0].description);
    assert.equal(await reopened.getByRole("combobox", { name: /^Authentication method/ }).inputValue(), "auth_portable");
    await reopened.getByRole("tab", { name: /^Data/ }).click();
    assert.equal(await reopened.getByRole("combobox", { name: "Classification for Portable administrator", exact: true }).inputValue(), "Administrator Data");
    assert.equal(await reopened.getByRole("combobox", { name: "Classification for Portable customer data", exact: true }).inputValue(), "Customer Data");
    assert.equal(await reopened.getByRole("combobox", { name: "Classification for Synthetic request", exact: true }).inputValue(),
      "ExampleRestricted");
    assert.equal(await reopened.getByRole("combobox", { name: "Classification for Synthetic request", exact: true })
      .locator("option:checked").textContent(), "Partner restricted data (saved)");
    await reopened.locator(".ps-catalog-snapshots summary").click();
    await reopened.locator(".ps-catalog-snapshots").getByText(input.doc.catalogDefinitions[0].description, { exact: true }).waitFor();
    await reopened.locator(".ps-catalog-snapshots summary").click();
    await reopened.getByRole("tab", { name: /^Edges/ }).click();
    await reopened.getByRole("row", { name: /^Parallel flow, sequence/ }).click();
    await reopened.getByRole("tab", { name: /^Properties/ }).click();
    await reopened.locator(".ps-auth-selection-warning").filter({ hasText: "Required authentication library is unavailable" }).waitFor();
    assert.equal(await reopened.getByRole("combobox", { name: /^Authentication method/ })
      .locator(`option[value="${retainedContract.id}"]`).evaluate(option => option.disabled), true);
    assert.equal(await reopened.getByRole("combobox", { name: "Tenant", exact: true }).inputValue(), "ExampleTenant");
    await reopened.locator('button[aria-controls="ps-command-menu-review"]').click();
    await reopened.getByRole("menuitem", { name: /^Deviations/ }).click();
    await reopened.locator(".ps-deviations").getByText("Historical ests-relationship", { exact: true }).waitFor();
    assert.deepEqual(faults, [], "No network/API, runtime errors or unexpected dialogs");
    console.log(`Production standalone version ${version}; browser ${browser.version()}; embedded authentication and identity retained.`);
  } finally {
    if (context) await context.close();
    await browser.close();
    if (artifactWritten) await unlink(exportedFile);
    await rmdir(artifactDirectory);
  }
});
