import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { startHarness } from "./harness.mjs";
import { registerEndpointContracts, openEndpointDialog } from "./endpoint-contracts.mjs";
import { registerAuthenticationAvailabilityContracts } from "./authentication-availability-contracts.mjs";
import { registerAuthenticationExtractionContracts } from "./authentication-extraction-contracts.mjs";
import { registerInventoryContracts } from "./inventory-contracts.mjs";
import { registerTaxonomyContracts } from "./taxonomy-contracts.mjs";
import { registerPmexpContracts } from "./pmexp-contracts.mjs";
import { registerJsonImportContracts } from "./json-import-contracts.mjs";
import { registerProvenanceContracts } from "./provenance-contracts.mjs";
import { historicalAuthenticationPackage } from "../authentication/catalog-fixtures.mjs";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function exportModel(page) {
  await page.locator('button[aria-controls="ps-command-menu-file"]').click();
  await page.getByRole("menuitem", { name: /^Save\s/ }).click();
  const dialog = page.getByRole("dialog", { name: "Save as", exact: true });
  await dialog.getByLabel("File name", { exact: true }).fill("libraries.tma");
  const event = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const chunks = [];
  for await (const chunk of await (await event).createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const previous = process.env.SDS_LIBRARY_PATHS;
let harness;
let historicalDirectory;
before(async () => {
  assert.equal(previous, undefined, "Run this isolated fixture with no preconfigured library paths.");
  historicalDirectory = await mkdtemp(join(tmpdir(), "sds-historical-auth-"));
  await writeFile(join(historicalDirectory, "library.json"), JSON.stringify(historicalAuthenticationPackage()));
  process.env.SDS_LIBRARY_PATHS = JSON.stringify(["examples\\custom-libraries\\example", historicalDirectory, "missing-synthetic-library"]);
  harness = await startHarness();
});
after(async () => {
  try { if (harness) await harness.stop(); }
  finally {
    if (previous === undefined) delete process.env.SDS_LIBRARY_PATHS;
    else process.env.SDS_LIBRARY_PATHS = previous;
    if (historicalDirectory) {
      await unlink(join(historicalDirectory, "library.json"));
      await rmdir(historicalDirectory);
    }
  }
});

registerEndpointContracts({ getHarness: () => harness, exportModel, configured: true });
registerAuthenticationAvailabilityContracts({ getHarness: () => harness, exportModel });
registerAuthenticationExtractionContracts({ getHarness: () => harness, exportModel, configured: true });
registerInventoryContracts({ getHarness: () => harness, exportModel, configured: true });
registerTaxonomyContracts({ getHarness: () => harness, exportModel, configured: true });
registerPmexpContracts({ getHarness: () => harness, exportModel });
registerJsonImportContracts({ getHarness: () => harness, exportModel });
registerProvenanceContracts({ getHarness: () => harness, exportModel, configured: true });

test("regression: legacy-shaped installed node IDs work in endpoint matching before first use", async () => {
  await harness.run("regression: installed node metadata and endpoint matching", async ({ page }) => {
    const before = await exportModel(page);
    assert.equal(before.doc.nodeTypes.some(type => type.id === "Legacy Service (v1)"), false);
    await page.evaluate(() => {
      const original = window.alert;
      window.alert = message => {
        window.alert = original;
        if (message !== "Imported 1 new node type (1 matched in total). All endpoints recognized.") {
          throw new Error("Unexpected endpoint import result.");
        }
        window.nodePackageImported = true;
      };
    });
    const dialog = await openEndpointDialog(page);
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "Choose file…" }).click();
    await (await chooser).setFiles({
      name: "legacy-endpoint.txt", mimeType: "text/plain",
      buffer: Buffer.from("https://legacy-node.example.invalid/service\n"),
    });
    await page.waitForFunction(() => window.nodePackageImported === true);
    const saved = await exportModel(page);
    const added = saved.doc.nodes.find(node => node.type === "Legacy Service (v1)");
    assert.ok(added);
    assert.equal(added.serviceTreeId, "11111111-1111-4111-8111-111111111111");
    assert.equal(added.endpointRegex, "^https://legacy-node\\.example\\.invalid/");
    assert.ok(saved.doc.nodeTypes.find(type => type.id === added.type)?.definition);
    assert.ok(saved.doc.scenarios[0].nodeIds.includes(added.id));
    assert.deepEqual(saved.doc.edges, before.doc.edges);
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "legacy-node-reopened.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)),
    });
    await page.getByLabel("Document status").getByText("legacy-node-reopened.tma", { exact: true }).waitFor();
    assert.deepEqual((await exportModel(page)).doc, saved.doc);
  });
});

test("libraries configured: catalogs, metadata, rules, profile precedence and portable reopen", async () => {
  await harness.run("libraries configured: complete synthetic package", async ({ page }) => {
    await page.locator('button[aria-controls="ps-command-menu-model"]').click();
    await page.getByRole("menuitem", { name: "Custom Libraries", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Custom Libraries", exact: true });
    await dialog.getByText("2 loaded; 1 unavailable or rejected", { exact: true }).waitFor();
    await dialog.getByRole("heading", { name: "Example review library" }).waitFor();
    await dialog.getByRole("heading", { name: "Example endpoint guidance" }).waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("tab", { name: /^Data/ }).click();
    const choice = page.getByRole("combobox", { name: "Classification for Synthetic request", exact: true });
    assert.ok(await choice.locator('option[value="ExamplePublic"]').count());
    await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    const field = page.getByRole("textbox", { name: /^Example owner ID/ });
    await field.fill("not-a-guid");
    await page.locator('button[aria-controls="ps-command-menu-review"]').click();
    await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
    await page.locator(".ps-allissues .ps-allissues-row").filter({ hasText: "Example owner must be a GUID" }).waitFor();
    await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    await field.fill("11111111-1111-4111-8111-111111111111");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    assert.equal(await field.inputValue(), "not-a-guid");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    assert.equal(await field.inputValue(), "11111111-1111-4111-8111-111111111111");
    await page.getByPlaceholder("Select or enter a node type").fill("Example service");
    await page.getByPlaceholder("Select or enter a node type").press("Enter");
    await page.locator('.ps-edge-label[data-edge-id="e_request"] .ps-edge-num').click();
    await page.getByRole("combobox", { name: /^Authentication method/ }).selectOption("ExampleProof");
    const saved = await exportModel(page);
    assert.equal(saved.doc.nodes.find(node => node.id === "n_client").type, "ExampleService");
    assert.ok(saved.doc.nodeTypes.find(type => type.id === "ExampleService").definition);
    assert.equal(saved.doc.authenticationDefinitions.find(def => def.id === "ExampleProof").label, "Example proof");
    assert.equal(saved.doc.nodes.find(node => node.id === "n_client").metadataFields[0].library.id, "example");
    assert.equal("rules" in saved.doc, false);
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "reopened-libraries.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(saved)),
    });
    assert.deepEqual((await exportModel(page)).doc, saved.doc);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.reload();
    await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    assert.equal(await field.inputValue(), "11111111-1111-4111-8111-111111111111");
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  });
});

test("libraries configured: saved profile choices win without startup writes", async () => {
  await harness.run("libraries configured: profile precedence", async ({ page }) => {
    const profiles = await page.evaluate(async () => {
      const { DEFAULT_CLASSIFICATION_LIBRARY, exportClassificationCatalog, CLASSIFICATION_STORAGE_KEY } = await import("/src/classificationLibrary.ts");
      const { AUTH_TYPE_DEFS, exportAuthenticationCatalog, AUTHENTICATION_STORAGE_KEY } = await import("/src/authentication.ts");
      const classification = exportClassificationCatalog(DEFAULT_CLASSIFICATION_LIBRARY);
      const authentication = exportAuthenticationCatalog([...AUTH_TYPE_DEFS, {
        id: "ExampleProof", label: "Profile proof label", description: "Profile definition wins.",
        shortLabel: "Profile", behavior: { productionIdentity: "unknown", audience: false, constraints: false, anonymous: false, managedIdentity: false },
        disabled: true, aliases: [], legacy: false,
      }]);
      localStorage.setItem(CLASSIFICATION_STORAGE_KEY, classification);
      localStorage.setItem(AUTHENTICATION_STORAGE_KEY, authentication);
      return { classification, authentication };
    });
    await page.reload();
    await page.getByRole("tab", { name: /^Data/ }).click();
    const choice = page.getByRole("combobox", { name: "Classification for Synthetic request", exact: true });
    assert.equal(await choice.locator('option[value="ExamplePublic"]').count(), 0);
    assert.ok(await choice.locator('option[value="EUII"]').count());
    const stored = await page.evaluate(() => ({
      classification: localStorage.getItem("secure-design-studio:classification-library:v1"),
      authentication: localStorage.getItem("secure-design-studio:authentication-library:v1"),
    }));
    assert.deepEqual(stored, profiles);
  });
});
