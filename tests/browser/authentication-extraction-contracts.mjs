import assert from "node:assert/strict";
import { test } from "node:test";
import { modelFixture, autosaveKey } from "./fixture.mjs";
import { historicalAuthenticationDefinitions, PACKAGE_METHOD_IDS } from "../authentication/catalog-fixtures.mjs";

const guid = "11111111-1111-4111-8111-111111111111";
const methodId = "EntraApplicationOnlyWithCdt";
async function selectFlow(page, title = "Request payload") {
  await page.getByRole("tab", { name: /^Edges/ }).click();
  await page.getByRole("row", { name: new RegExp(`^${title}, sequence`) }).click();
  await page.getByRole("tab", { name: /^Properties/ }).click();
}
const selector = page => page.getByRole("combobox", { name: /^Authentication method/ });

export function registerAuthenticationExtractionContracts({ getHarness, exportModel, configured = false }) {
  test(`regression: ${configured ? "selected" : "absent"} authentication library controls authoring, not cached identity data`, async () => {
    await getHarness().run(`regression: authentication extraction ${configured ? "selected" : "absent"}`, async ({ page }) => {
      await selectFlow(page);
      for (const id of PACKAGE_METHOD_IDS) {
        assert.equal(await selector(page).locator(`option[value="${id}"]`).count(), configured ? 1 : 0);
      }
      await selector(page).selectOption("EntraApplicationOnlyAccess");
      await page.getByRole("textbox", { name: "App ID (GUID)", exact: true }).fill(guid);
      const tenant = page.getByRole("combobox", { name: "Tenant", exact: true });
      for (const id of ["ME", "FirstParty"]) {
        assert.equal(await tenant.locator(`option[value="${id}"]`).count(), configured ? 1 : 0);
      }
      const preferences = await page.evaluate(async history => {
        const { AUTH_TYPE_DEFS, exportAuthenticationCatalog, AUTHENTICATION_STORAGE_KEY } = await import("/src/authentication.ts");
        const methods = [...AUTH_TYPE_DEFS, ...history].map(method =>
          method.id === "EntraApplicationOnlyWithCdt" ? { ...method, label: "Personal CDT name" } : method);
        const raw = exportAuthenticationCatalog(methods);
        localStorage.setItem(AUTHENTICATION_STORAGE_KEY, raw);
        return raw;
      }, historicalAuthenticationDefinitions());
      await page.reload();
      await selectFlow(page);
      assert.equal(await page.evaluate(() => localStorage.getItem("secure-design-studio:authentication-library:v1")), preferences);
      for (const id of PACKAGE_METHOD_IDS) {
        assert.equal(await selector(page).locator(`option[value="${id}"]`).count(), configured ? 1 : 0);
      }
      const input = modelFixture();
      input.doc.edges[0] = {
        ...input.doc.edges[0], authenticationTypes: [methodId],
        audience: "Retained audience", constraints: "Retained constraints",
        productionIdentity: { kind: "AppId", appId: guid, tenant: "ME" },
      };
      input.doc.authenticationDefinitions = historicalAuthenticationDefinitions();
      input.doc.nodeTypes[0].definition.allowedAuthMethods = [{ id: methodId, status: "Allowed" }];
      input.doc.catalogDefinitions = [{ kind: "tenant", id: "ME", label: "Saved tenant label" }];
      input.doc.issues = [{
        id: "i_private_identity", kind: "Edge_missing_production_identity", targetKind: "edge", targetId: "e_request",
        title: "Historical identity finding", description: "Keep until the rule can evaluate.", scenarioIds: [],
        status: "Resolved", createdAt: 1, replies: [{ id: "ir_private", text: "Retained decision.", createdAt: 2 }],
      }];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "historical-auth.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("historical-auth.tma", { exact: true }).waitFor();
      await selectFlow(page);
      assert.equal(await selector(page).inputValue(), methodId);
      assert.equal(await selector(page).locator(`option[value="${methodId}"]`).evaluate(option => option.disabled), !configured);
      assert.equal(await tenant.inputValue(), "ME");
      assert.equal(await tenant.locator('option[value="ME"]').evaluate(option => option.disabled), !configured);
      assert.equal(await page.getByRole("textbox", { name: "Audience", exact: true }).inputValue(), "Retained audience");
      assert.equal(await page.getByRole("textbox", { name: "Constraints (CDT)", exact: true }).inputValue(), "Retained constraints");
      if (!configured) await page.locator(".ps-auth-selection-warning").filter({ hasText: "Required authentication library is unavailable" }).waitFor();
      await page.getByRole("textbox", { name: "App ID (GUID)", exact: true }).fill("22222222-2222-4222-8222-222222222222");
      const saved = await exportModel(page);
      assert.equal(saved.doc.edges[0].productionIdentity.tenant, "ME");
      assert.equal(saved.doc.edges[0].audience, "Retained audience");
      assert.equal(saved.doc.edges[0].constraints, "Retained constraints");
      assert.deepEqual(saved.doc.authenticationDefinitions, input.doc.authenticationDefinitions);
      assert.equal(JSON.stringify(saved.doc).includes("unavailableReason"), false);
      assert.equal(await page.evaluate(() => localStorage.getItem("secure-design-studio:authentication-library:v1")), preferences);
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
      const nodeCatalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
      const downloaded = page.waitForEvent("download");
      await nodeCatalog.getByRole("button", { name: "Export custom catalog", exact: true }).click();
      const chunks = [];
      for await (const chunk of await (await downloaded).createReadStream()) chunks.push(chunk);
      const exportedCatalog = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.deepEqual(exportedCatalog.authenticationDefinitions, [input.doc.authenticationDefinitions.find(def => def.id === methodId)]);
      assert.equal(JSON.stringify(exportedCatalog).includes("unavailableReason"), false);
      await nodeCatalog.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
      const analyzed = await exportModel(page);
      const finding = analyzed.doc.issues.find(issue => issue.id === "i_private_identity");
      if (configured) assert.equal(finding, undefined, "Available contract can clear the obsolete identity finding");
      else {
        assert.equal(finding.notEvaluatedReason, "policy-unavailable");
        assert.equal(finding.status, "Resolved");
      }
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.edges
        ?.some(edge => edge.id === "e_request" && edge.productionIdentity?.tenant === "ME"), autosaveKey);
      await page.reload();
      await selectFlow(page);
      assert.equal(await tenant.inputValue(), "ME");
      await selectFlow(page, "Parallel flow");
      for (const id of PACKAGE_METHOD_IDS) assert.equal(await selector(page).locator(`option[value="${id}"]`).count(), configured ? 1 : 0);
    });
  });

  if (configured) {
    test("regression: configured methods support minimal preference imports and persistent Undo/Redo", async () => {
      await getHarness().run("regression: installed authentication profile history", async ({ page }) => {
        await page.evaluate(() => localStorage.setItem("secure-design-studio:authentication-library:v1", JSON.stringify({
          format: "secure-design-studio-authentication-catalog", version: 1,
          methods: [{ id: "EntraApplicationOnlyWithCdt", label: "Minimal owner label", description: "Presentation preference only." }],
        })));
        await page.reload();
        await selectFlow(page);
        await selector(page).selectOption(methodId);
        const selected = (await exportModel(page)).doc.authenticationDefinitions.find(def => def.id === methodId);
        assert.equal(selected.label, "Minimal owner label");
        assert.equal(selected.behavior.productionIdentity, "required");
        assert.equal(selected.behavior.constraints, true);
        await page.locator('button[aria-controls="ps-command-menu-model"]').click();
        await page.getByRole("menuitem", { name: "Customize authentication", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Authentication Library", exact: true });
        await dialog.getByRole("searchbox").fill("Minimal owner label");
        await dialog.getByRole("button", { name: /^Minimal owner label/ }).click();
        await dialog.getByRole("button", { name: "Edit method", exact: true }).click();
        await dialog.getByRole("textbox", { name: "Method", exact: true }).fill("Edited owner label");
        await dialog.getByRole("button", { name: "Save method", exact: true }).click();
        await dialog.getByRole("button", { name: "Undo", exact: true }).click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("secure-design-studio:authentication-library:v1")).methods
          .find(def => def.id === "EntraApplicationOnlyWithCdt").label), "Minimal owner label");
        await dialog.getByRole("button", { name: "Redo", exact: true }).click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("secure-design-studio:authentication-library:v1")).methods
          .find(def => def.id === "EntraApplicationOnlyWithCdt").label), "Edited owner label");
      });
    });
  }
}
