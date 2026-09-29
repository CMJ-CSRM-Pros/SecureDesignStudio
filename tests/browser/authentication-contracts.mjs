import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { modelFixture, autosaveKey } from "./fixture.mjs";
import { until } from "./harness.mjs";

const libraryKey = "secure-design-studio:authentication-library:v1";
const modal = page => page.locator(".ps-auth-library");
const selector = page => page.getByRole("combobox", { name: /^Authentication method/ });
const edgeLabel = (page, id = "e_request") => page.locator(`.ps-edge-label[data-edge-id="${id}"]`);
const catalogFile = methods => ({ format: "secure-design-studio-authentication-catalog", version: 1, methods });
async function upload(locator, value, name = "catalog.json") {
  await locator.setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
  });
  if (name.endsWith(".tma")) {
    await locator.page().getByLabel("Document status").getByText(name, { exact: true }).waitFor({ state: "visible" });
  }
}
const library = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), libraryKey);

async function openLibrary(page) {
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await page.getByRole("menuitem", { name: "Customize authentication", exact: true }).click();
  await modal(page).waitFor({ state: "visible" });
  return modal(page);
}

async function closeLibrary(page) {
  await modal(page).getByRole("button", { name: "Close", exact: true }).click();
  await modal(page).waitFor({ state: "hidden" });
}

async function addMethod(page, label = "Partner contract", description = "Validates the documented partner assertion.") {
  const dialog = await openLibrary(page);
  await dialog.getByRole("button", { name: "Add method", exact: true }).click();
  const form = dialog.locator("form");
  assert.equal(await form.locator("input,textarea,select").count(), 2, "Only Method and Description are authored");
  await form.getByRole("textbox", { name: "Method", exact: true }).fill(label);
  await form.getByRole("textbox", { name: "Description", exact: true }).fill(description);
  await dialog.getByRole("button", { name: "Save method", exact: true }).click();
  const result = (await library(page)).methods.find(method => method.label === label);
  assert.ok(result?.id.startsWith("auth_"));
  return result;
}

async function selectFlow(page, id = "e_request") {
  const title = id === "e_request" ? "Request payload" : "Parallel flow";
  await page.getByRole("tab", { name: /^Edges/ }).click();
  await page.getByRole("row", { name: new RegExp(`^${title}, sequence`) }).click();
  await page.getByRole("tab", { name: /^Properties/ }).click();
  await selector(page).waitFor({ state: "visible" });
}

async function readDownload(page, action, expectedName) {
  const pending = page.waitForEvent("download");
  await action();
  const download = await pending;
  assert.equal(download.suggestedFilename(), expectedName);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function newModel(page) {
  await page.evaluate(() => {
    const original = window.confirm;
    window.confirm = message => {
      window.confirm = original;
      if (message !== "Create a brand-new document? The current diagram will be cleared. You can use Undo (Ctrl+Z) to recover it.") {
        throw new Error("Unexpected confirmation instead of synthetic New document.");
      }
      return true;
    };
  });
  await page.locator('button[aria-controls="ps-command-menu-file"]').click();
  await page.getByRole("menuitem", { name: /^New\s/ }).click();
  await until(async () => await page.locator(".react-flow__edge").count() === 0
    && await page.locator(".react-flow__node-process").count() === 0, "empty diagram");
}

export function registerAuthenticationContracts({ getHarness, exportModel }) {
  test("regression: Internal process call is a distinct selectable built-in", async () => {
    await getHarness().run("regression: internal process authentication", async ({ page }) => {
      await selectFlow(page);
      const productionIdentity = page.getByRole("group", { name: "Production identity" });
      const appId = "12345678-1234-1234-1234-123456789abc";
      await productionIdentity.getByLabel("App ID (GUID)").fill(appId);
      await selector(page).selectOption("InternalProcessCall");
      await page.getByText(
        "Calls another component within the same process boundary. No particular authentication mechanism is required because the call does not cross that boundary.",
        { exact: true },
      ).waitFor();
      await edgeLabel(page).getByText("Internal", { exact: true }).waitFor();
      assert.equal(await edgeLabel(page).getByText("Anonymous", { exact: true }).count(), 0);
      assert.equal(await productionIdentity.count(), 0,
        "Internal process calls do not prompt for production identity");
      await selector(page).selectOption("ApiKey");
      await productionIdentity.waitFor();
      assert.equal(await productionIdentity.getByLabel("App ID (GUID)").inputValue(), appId,
        "Changing methods preserves existing production identity evidence");
    });
  });

  test("regression: authentication compatibility is neutral on this build while definition warnings stay actionable", async () => {
    await getHarness().run("regression: compatible build and genuine authentication warnings", async ({ page, observations }) => {
      let dialog = await openLibrary(page);
      assert.equal(await dialog.locator(".ps-auth-compatibility, .ps-auth-warnings").count(), 0,
        "Unused modern library methods do not create diagram notices");
      await closeLibrary(page);
      const input = modelFixture();
      input.doc.edges[0].authenticationTypes = ["ApiKey"];
      await upload(page.locator("#ps-file-open-input"), input, "compatible.tma");
      dialog = await openLibrary(page);
      const heading = dialog.getByRole("heading", { name: "Authentication compatibility", exact: true });
      await until(() => heading.evaluate(element => element === document.activeElement), "neutral compatibility entry focus");
      const runningVersion = (await page.locator(".ps-command-version").textContent()).replace(/^v/, "");
      assert.match(await dialog.locator(".ps-auth-compatibility").innerText(), new RegExp(`This running build \\(${runningVersion.replaceAll(".", "\\.")}\\) meets the minimum version \\(0\\.1\\.5\\)`));
      assert.equal(await dialog.locator(".ps-auth-warnings").count(), 0);
      assert.equal(await page.locator(".ps-auth-warning-trigger").count(), 0);
      assert.equal(await dialog.getByRole("heading", { name: /Compatibility warning/ }).count(), 0);
      await dialog.locator(".ps-auth-affected summary").press("Enter");
      assert.match(await dialog.locator(".ps-auth-affected").innerText(), /Authentication methods: 1; flows: 1; node-type policies: 0/);
      await closeLibrary(page);

      const method = await addMethod(page);
      await closeLibrary(page);
      input.doc.edges[0].authenticationTypes = [method.id];
      await upload(page.locator("#ps-file-open-input"), input, "missing-definition.tma");
      dialog = await openLibrary(page);
      assert.match(await dialog.locator(".ps-auth-warnings").innerText(), /definition missing/);
      assert.match(await dialog.locator(".ps-auth-compatibility").innerText(), /meets the minimum version/);
      await dialog.locator(".ps-auth-warnings summary").press("Enter");
      await dialog.getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await dialog.getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await until(() => heading.evaluate(element => element === document.activeElement), "removed warning returns focus to neutral compatibility heading");
      assert.equal(await dialog.locator(".ps-auth-warnings").count(), 0);
      await dialog.locator(".ps-auth-affected summary").press("Enter");
      assert.match(await dialog.locator(".ps-auth-affected").innerText(), /Partner contract/);
      assert.doesNotMatch(await dialog.locator(".ps-auth-affected").innerText(), /unresolved/);
      observations.runningVersion = runningVersion;
      observations.versionWarning = "absent for compatible runtime; inventory remains available";
      observations.resolutionFocus = "compatibility heading after missing-definition warning is removed";
    });
  });

  test("regression: authentication compatibility inventory covers whole diagram and updates after edits", async () => {
    await getHarness().run("regression: authentication compatibility inventory", async ({ page, observations }) => {
      const input = modelFixture();
      input.doc.edges[0].authenticationTypes = ["ApiKey", "OAuthAccessToken", "ApiKey"];
      input.doc.edges[1].authenticationTypes = ["ApiKey"];
      input.doc.edges[2].authenticationTypes = ["OAuthAccessToken"];
      input.doc.edges.push({
        ...structuredClone(input.doc.edges[0]), id: "e_unassigned", title: "Unassigned call",
        authenticationTypes: ["ApiKey"],
      });
      input.doc.nodeTypes.push({
        ...structuredClone(input.doc.nodeTypes[0]), id: "nt_unused", label: "Unused policy",
        definition: {
          ...input.doc.nodeTypes[0].definition,
          allowedAuthMethods: [
            { id: "ApiKey", status: "Allowed" }, { id: "ClientCertificateMtls", status: "Deprecated" },
            { id: "*", status: "Allowed" },
          ],
        },
      });
      await upload(page.locator("#ps-file-open-input"), input, "affected.tma");
      const before = await exportModel(page);
      const dialog = await openLibrary(page);
      const affected = dialog.locator(".ps-auth-affected");
      await affected.locator("summary").press("Enter");
      assert.equal(await affected.evaluate(element => element.open), true);
      assert.match(await affected.innerText(), /Authentication methods: 3; flows: 4; node-type policies: 1/);
      const api = affected.getByRole("region", { name: "API key (ApiKey)", exact: true });
      assert.match(await api.innerText(), /Request payload[\s\S]*Client[\s\S]*n_client[\s\S]*API[\s\S]*n_api/);
      assert.match(await api.innerText(), /Scenarios: Primary \(s_primary\)/);
      assert.match(await api.innerText(), /Unassigned call[\s\S]*No scenario \(unassigned flow\)/);
      assert.match(await api.innerText(), /Unused policy[\s\S]*nt_unused[\s\S]*allowedAuthMethods[\s\S]*Allowed/);
      const oauth = affected.locator(".ps-auth-affected-method").filter({ hasText: "(OAuthAccessToken)" });
      assert.match(await oauth.innerText(), /Archive payload[\s\S]*Scenarios: Archive \(s_archive\)/);
      const policyOnly = affected.locator(".ps-auth-affected-method").filter({ hasText: "(ClientCertificateMtls)" });
      assert.match(await policyOnly.innerText(), /Node-type policy only/);
      assert.match(await policyOnly.innerText(), /Deprecated/);
      assert.equal(await policyOnly.getByText(/^Flows \(/).count(), 0);
      if (process.env.SDS_TEST_OUTPUT_DIR) {
        observations.screenshot = "authentication-affected-items.png";
        await dialog.screenshot({ path: join(process.env.SDS_TEST_OUTPUT_DIR, observations.screenshot) });
      }
      await closeLibrary(page);
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Opening and expanding the inventory is read-only");

      await selectFlow(page);
      await selector(page).selectOption("EntraApplicationOnlyAccess");
      await openLibrary(page);
      await affected.locator("summary").press("Enter");
      assert.match(await affected.innerText(), /Authentication methods: 3; flows: 3; node-type policies: 1/);
      assert.doesNotMatch(await affected.innerText(), /Request payload/);
      observations.scope = "Inactive and unassigned flows plus unused explicit node policies; unique totals; live edits";
    });
  });

  test("usability: authentication compatibility disclosure stays readable and keyboard reachable at 320px", async () => {
    for (const theme of ["light", "dark"]) {
      await getHarness().run(`usability: authentication compatibility disclosure at 320px (${theme})`, async ({ page, observations }) => {
        const settings = page.getByRole("button", { name: "Settings", exact: true });
        await settings.click();
        const option = page.getByRole("menuitemcheckbox", { name: /Dark Theme/ });
        if ((await option.getAttribute("aria-checked") === "true") !== (theme === "dark")) await option.click();
        if (await settings.getAttribute("aria-expanded") === "true") await settings.click();
        await until(() => page.locator(".ps-shell").evaluate(element => element.classList.contains("ps-theme-dark"))
          .then(dark => dark === (theme === "dark")), "compatibility theme applied");

        const method = { id: "auth_long", label: `Method ${"M".repeat(73)}`, description: "Synthetic long-label contract." };
        await openLibrary(page);
        await upload(modal(page).locator('input[type="file"]'), catalogFile([method]));
        await modal(page).getByRole("button", { name: "Apply import", exact: true }).click();
        await closeLibrary(page);
        const input = modelFixture();
        input.doc.authenticationDefinitions = [method];
        input.doc.nodes[0].title = "Source" + "S".repeat(180);
        input.doc.nodes[1].title = "Target" + "T".repeat(180);
        input.doc.nodeTypes[0].label = "Type" + "N".repeat(180);
        input.doc.nodeTypes[0].definition.allowedAuthMethods = [{ id: method.id, status: "Allowed" }];
        input.doc.edges = Array.from({ length: 25 }, (_, index) => ({
          ...input.doc.edges[0], id: index ? `e_long_${index}` : "e_request",
          title: `Flow ${index} ${"F".repeat(180)}`, authenticationTypes: [method.id],
        }));
        await upload(page.locator("#ps-file-open-input"), input, "long-items.tma");
        await page.setViewportSize({ width: 320, height: 640 });
        const dialog = await openLibrary(page);
        const disclosure = dialog.locator(".ps-auth-affected");
        const summary = disclosure.locator("summary");
        await summary.focus();
        await page.keyboard.press("Enter");
        assert.equal(await disclosure.evaluate(element => element.open), true);
        assert.match(await disclosure.innerText(), /Authentication methods: 1; flows: 25; node-type policies: 1/);
        assert.equal(await disclosure.locator("li").count(), 26, "All flows and the policy remain present");
        await disclosure.getByText(input.doc.edges[24].title, { exact: true }).scrollIntoViewIfNeeded();
        const widths = await dialog.evaluate(element => ({
          page: document.documentElement.scrollWidth, viewport: innerWidth,
          body: element.querySelector(".ps-auth-library-body").clientWidth,
          bodyScroll: element.querySelector(".ps-auth-library-body").scrollWidth,
          inventory: element.querySelector(".ps-auth-affected").clientWidth,
          inventoryScroll: element.querySelector(".ps-auth-affected").scrollWidth,
        }));
        assert.ok(widths.page <= widths.viewport + 1, "No page horizontal scroll");
        assert.ok(widths.bodyScroll <= widths.body + 1, "No dialog body horizontal scroll");
        assert.ok(widths.inventoryScroll <= widths.inventory + 1, "No inventory horizontal scroll");
        observations.widths = widths;
        if (process.env.SDS_TEST_OUTPUT_DIR) {
          observations.screenshot = `authentication-affected-320-${theme}.png`;
          await dialog.screenshot({ path: join(process.env.SDS_TEST_OUTPUT_DIR, observations.screenshot) });
        }
        await summary.focus();
        await page.keyboard.press("Space");
        assert.equal(await disclosure.evaluate(element => element.open), false);
        const close = dialog.getByRole("button", { name: "Close", exact: true });
        await close.focus();
        await page.keyboard.press("Tab");
        assert.equal(await dialog.getByRole("button", { name: "Close Authentication Library", exact: true })
          .evaluate(element => element === document.activeElement), true);
        await page.keyboard.press("Escape");
        await until(() => page.getByRole("button", { name: "Model", exact: true })
          .evaluate(element => element === document.activeElement), "compatibility modal restores Model focus");
      });
    }
  });

  test("regression: Authentication Library authoring, IDs, full native round-trip, and persistent history", async () => {
    await getHarness().run("regression: authentication library authoring and portability", async ({ page, context, observations }) => {
      const description = "Partner proof <b>not HTML</b> [unsafe](javascript:alert(1)). Never store a credential here.";
      const method = await addMethod(page, "Partner contract", description);
      if (process.env.SDS_TEST_OUTPUT_DIR) {
        observations.screenshot = "authentication-library.png";
        await page.screenshot({ path: join(process.env.SDS_TEST_OUTPUT_DIR, observations.screenshot), fullPage: true });
      }
      await closeLibrary(page);
      await selectFlow(page);
      assert.equal(await selector(page).locator('option[value=""]').textContent(), "Not specified");
      await selector(page).selectOption(method.id);
      assert.equal(await page.locator(".ps-auth-description").textContent(), description);
      assert.equal(await page.locator(".ps-auth-description b, .ps-auth-description script, a[href^='javascript:']").count(), 0);
      assert.match(await page.locator(".ps-auth-selection-warning").first().textContent(), /Unverified/);
      const guid = "12345678-1234-1234-1234-123456789abc";
      await page.getByRole("textbox", { name: "App ID (GUID)", exact: true }).fill(guid);
      await selector(page).selectOption("CustomAuthentication");
      assert.equal(await page.getByRole("textbox", { name: "App ID (GUID)", exact: true }).inputValue(), guid);
      await selector(page).selectOption(method.id);

      const dialog = await openLibrary(page);
      await dialog.getByRole("searchbox").fill("Partner contract");
      await dialog.getByRole("button", { name: /^Partner contract/ }).click();
      await dialog.getByRole("button", { name: "Edit method", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Method", exact: true }).fill("Partner renamed");
      await dialog.getByRole("button", { name: "Save method", exact: true }).click();
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, "Partner renamed");
      await dialog.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, "Partner contract");
      await dialog.getByRole("button", { name: "Redo", exact: true }).click();
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, "Partner renamed");
      const exportedLibrary = await readDownload(page,
        () => dialog.getByRole("button", { name: "Export JSON", exact: true }).click(),
        "secure-design-studio-authentication-catalog.json");
      assert.equal(exportedLibrary.methods.find(entry => entry.id === method.id).label, "Partner renamed");
      await closeLibrary(page);
      assert.equal(await edgeLabel(page).locator(".ps-edge-auth-badge").textContent(), "Partner renamed");
      assert.match(await edgeLabel(page).locator(".ps-edge-auth-review").getAttribute("aria-label"), /review required/);
      const saved = await exportModel(page);
      const savedEdge = saved.doc.edges.find(entry => entry.id === "e_request");
      assert.deepEqual(savedEdge.authenticationTypes, [method.id]);
      assert.equal(savedEdge.productionIdentity.appId, guid);
      assert.equal(saved.doc.authenticationDefinitions.find(entry => entry.id === method.id).label, "Partner renamed");
      assert.ok(!Object.hasOwn(saved.doc, "authenticationLibrary"));

      await newModel(page);
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, "Partner renamed");
      await upload(page.locator("#ps-file-open-input"), saved, "saved.tma");
      await edgeLabel(page).waitFor({ state: "visible" });
      const reopened = await exportModel(page);
      assert.deepEqual(reopened.doc, saved.doc, "Full canonical model and authentication definitions survive empty/open");
      assert.deepEqual(reopened.view, saved.view);
      await page.waitForFunction(({ key, id }) => JSON.parse(localStorage.getItem(key) ?? "null")
        ?.doc.authenticationDefinitions.some(entry => entry.id === id), { key: autosaveKey, id: method.id });
      await page.reload();
      await edgeLabel(page).waitFor({ state: "visible" });
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, "Partner renamed");
      await context.setOffline(true);
      await selectFlow(page);
      await page.getByRole("textbox", { name: "Title", exact: true }).fill("Offline authenticated flow");
      assert.equal(await selector(page).inputValue(), method.id);
      observations.nativeRoundTrip = "complete model/view/definitions equal";
      observations.profileAcrossNewOpenReloadOffline = true;
    });
  });

  test("regression: authentication import validation, collision preview, saved precedence and explicit resolution", async () => {
    await getHarness().run("regression: authentication catalog atomic imports and conflicts", async ({ page }) => {
      const method = await addMethod(page);
      const before = await library(page);
      for (const invalid of [
        "{bad JSON",
        catalogFile([{ id: "__proto__", label: "Bad", description: "Bad" }]),
        catalogFile([{ id: "auth_duplicate", label: "One", description: "One" }, { id: "auth_duplicate", label: "Two", description: "Two" }]),
        catalogFile([{ id: "AnonymousAccess", label: "Renamed", description: "Still anonymous", behavior: {
          productionIdentity: "required", audience: false, constraints: false, anonymous: false, managedIdentity: false,
        } }]),
      ]) {
        await upload(modal(page).locator('input[type="file"]'), invalid);
        await modal(page).getByRole("alert").last().waitFor({ state: "visible" });
        assert.deepEqual(await library(page), before, "Invalid catalog import is atomic");
      }
      const replacement = { ...method, label: "Reviewed replacement", description: "Explicit replacement contract." };
      await upload(modal(page).locator('input[type="file"]'), catalogFile([replacement]));
      const apply = modal(page).getByRole("button", { name: "Apply import", exact: true });
      await apply.waitFor({ state: "visible" });
      assert.equal(await apply.isDisabled(), true, "Same-ID changes require explicit approval");
      assert.deepEqual(await library(page), before);
      await modal(page).getByRole("checkbox", { name: /I confirm updating/ }).check();
      await apply.click();
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, replacement.label);
      await closeLibrary(page);

      const incoming = modelFixture();
      incoming.doc.authenticationDefinitions = [{ ...method, label: "Saved partner", description: "Saved contract, different from profile." }];
      incoming.doc.edges[0].authenticationTypes = [method.id];
      incoming.doc.edges[0].productionIdentity = { kind: "ManagedIdentity" };
      await upload(page.locator("#ps-file-open-input"), incoming, "conflict.tma");
      await selectFlow(page);
      assert.equal(await page.locator(".ps-auth-description").textContent(), incoming.doc.authenticationDefinitions[0].description);
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, replacement.label);
      await openLibrary(page);
      assert.match(await modal(page).innerText(), /saved definition differs/i);
      await modal(page).locator("summary").filter({ hasText: "Review definition: Saved partner" }).click();
      await modal(page).getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await modal(page).getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await modal(page).getByRole("button", { name: "Undo", exact: true }).click();
      await closeLibrary(page);
      const undone = await exportModel(page);
      assert.equal(undone.doc.authenticationDefinitions[0].label, "Saved partner");
      assert.equal((await library(page)).methods.find(entry => entry.id === method.id).label, replacement.label);
      assert.deepEqual(undone.doc.edges[0].productionIdentity, { kind: "ManagedIdentity" });
    });
  });

  test("regression: disabled and unresolved methods, legacy arrays, target policies, filters and canvas indicators", async () => {
    await getHarness().run("regression: authentication selection compatibility and policy", async ({ page }) => {
      const method = await addMethod(page);
      await closeLibrary(page);
      await selectFlow(page);
      await selector(page).selectOption(method.id);
      await openLibrary(page);
      await modal(page).getByRole("searchbox").fill("Partner contract");
      await modal(page).getByRole("button", { name: /^Partner contract/ }).click();
      assert.equal(await modal(page).getByRole("button", { name: "Delete method…", exact: true }).isDisabled(), true);
      await modal(page).getByRole("button", { name: "Disable method", exact: true }).click();
      await closeLibrary(page);
      await selectFlow(page);
      assert.equal(await selector(page).inputValue(), method.id);
      await until(() => selector(page).locator(`option[value="${method.id}"]`).evaluate(option => option.disabled),
        "native option is disabled while its saved selection remains visible");
      await selectFlow(page, "e_parallel");
      assert.equal(await selector(page).locator(`option[value="${method.id}"]`).count(), 0);
      await selector(page).selectOption("AnonymousAccess");
      assert.equal(await edgeLabel(page, "e_parallel").locator(".ps-edge-auth-anonymous").textContent(), "Anonymous");

      const legacy = modelFixture();
      legacy.doc.edges[0].authenticationTypes = ["CertificateAuthentication", "EntraApplicationOnlyAccess"];
      legacy.doc.edges[0].productionIdentity = { kind: "ManagedIdentity" };
      legacy.doc.edges[1].authenticationTypes = ["auth_missing"];
      legacy.doc.edges[1].productionIdentity = { kind: "AppId", appId: "12345678-1234-1234-1234-123456789abc", tenant: "Customer" };
      await upload(page.locator("#ps-file-open-input"), legacy, "legacy.tma");
      await selectFlow(page);
      assert.match(await page.getByRole("alert").filter({ hasText: "multiple authentication" }).textContent(), /older model/);
      assert.equal(await edgeLabel(page).locator(".ps-edge-auth-badge").textContent(), "Multiple auth");
      const preserved = await exportModel(page);
      assert.deepEqual(preserved.doc.edges[0].authenticationTypes, legacy.doc.edges[0].authenticationTypes);
      assert.deepEqual(preserved.doc.edges[1].productionIdentity, legacy.doc.edges[1].productionIdentity);
      await selectFlow(page, "e_parallel");
      assert.match(await page.locator(".ps-auth-description").textContent(), /Definition missing/);
      assert.equal(await selector(page).inputValue(), "auth_missing");
      assert.equal(await edgeLabel(page, "e_parallel").locator(".ps-edge-auth-review").textContent(), "Unresolved");

      const policy = modelFixture();
      policy.doc.nodeTypes[0].definition.policyStatus = "Defined";
      policy.doc.nodeTypes[0].definition.allowedDataTypes = [{ id: "*", retention: "*", action: "Allow" }];
      policy.doc.nodeTypes[0].definition.allowedAuthMethods = [{ id: "EntraApplicationOnlyAccess", status: "Deprecated" }];
      await upload(page.locator("#ps-file-open-input"), policy, "policy.tma");
      await selectFlow(page);
      assert.equal(await selector(page).locator('option[value="AnonymousAccess"]').count(), 0);
      assert.match(await selector(page).locator('option[value="EntraApplicationOnlyAccess"]').textContent(), /deprecated/);
      await selector(page).selectOption("EntraApplicationOnlyAccess");
      await page.getByRole("button", { name: /^Filter,/ }).click();
      const filters = page.getByRole("dialog", { name: "Filter model" });
      await filters.getByRole("combobox", { name: /Authentication/ }).selectOption("EntraApplicationOnlyAccess");
      await filters.getByRole("button", { name: "Apply", exact: true }).click();
      await until(() => page.locator(".react-flow__edge").count().then(count => count === 1), "authentication filter");
    });
  });

  test("regression: reusable library JSON, safe deletion, built-in reset and node catalog dependencies", async () => {
    await getHarness().run("regression: library management and node catalog dependencies", async ({ page }) => {
      const method = { id: "auth_reusable", label: "Reusable proof", description: "A synthetic reusable owner contract." };
      await openLibrary(page);
      await upload(modal(page).locator('input[type="file"]'), catalogFile([method]));
      await modal(page).getByRole("button", { name: "Apply import", exact: true }).click();
      await modal(page).getByRole("searchbox").fill(method.label);
      await modal(page).getByRole("button", { name: /^Reusable proof/ }).click();
      await modal(page).getByRole("button", { name: "Delete method…", exact: true }).click();
      await modal(page).getByRole("button", { name: "Delete method", exact: true }).click();
      assert.ok(!(await library(page)).methods.some(entry => entry.id === method.id));
      await modal(page).getByRole("button", { name: "Undo", exact: true }).click();
      assert.ok((await library(page)).methods.some(entry => entry.id === method.id));
      await modal(page).getByRole("searchbox").fill("Entra app");
      await modal(page).getByRole("button", { name: /^Entra app/ }).click();
      await modal(page).getByRole("button", { name: "Edit method", exact: true }).click();
      await modal(page).getByRole("textbox", { name: "Method", exact: true }).fill("Company application");
      await modal(page).getByRole("button", { name: "Save method", exact: true }).click();
      await modal(page).getByRole("searchbox").fill("Company application");
      await modal(page).getByRole("button", { name: /^Company application/ }).click();
      await modal(page).getByRole("button", { name: "Reset built-in presentation", exact: true }).click();
      await modal(page).getByRole("button", { name: "Reset presentation", exact: true }).click();
      assert.equal((await library(page)).methods.find(entry => entry.id === "EntraApplicationOnlyAccess").label, "Entra app");
      await closeLibrary(page);

      const before = await exportModel(page);
      const nodePackage = {
        format: "secure-design-studio-node-catalog", version: 1,
        nodeTypes: [{
          ...modelFixture().doc.nodeTypes[0], id: "nt_dependent", label: "Dependent service",
          definition: {
            ...modelFixture().doc.nodeTypes[0].definition, policyStatus: undefined,
            allowedAuthMethods: [{ id: "auth_dependency", status: "Allowed" }],
            allowedDataTypes: [{ id: "*", retention: "*", action: "Allow" }],
          },
        }],
      };
      const openNodeCatalog = async () => {
        await page.getByRole("button", { name: "Model", exact: true }).click();
        await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
        return page.getByRole("dialog", { name: "Node type catalog", exact: true });
      };
      let nodeDialog = await openNodeCatalog();
      await upload(nodeDialog.locator('input[type="file"]'), nodePackage, "missing-dependency.json");
      assert.match(await nodeDialog.getByRole("alert").textContent(), /missing authentication dependency/);
      await nodeDialog.getByRole("button", { name: "Close", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Missing node dependency rejects the entire import");
      nodePackage.authenticationDefinitions = [{ ...method, id: "auth_dependency", label: "Dependent proof" }];
      nodeDialog = await openNodeCatalog();
      await upload(nodeDialog.locator('input[type="file"]'), nodePackage, "complete-dependency.json");
      await nodeDialog.getByRole("status").filter({ hasText: "Imported 1" }).waitFor({ state: "visible" });
      const exported = await readDownload(page,
        () => nodeDialog.getByRole("button", { name: "Export custom catalog", exact: true }).click(),
        "secure-design-studio-node-catalog.json");
      assert.ok(exported.authenticationDefinitions.some(def => def.id === "auth_dependency"));
      assert.deepEqual(exported.nodeTypes.find(type => type.id === "nt_dependent").definition.allowedAuthMethods,
        [{ id: "auth_dependency", status: "Allowed" }]);
      assert.ok(!(await library(page)).methods.some(entry => entry.id === "auth_dependency"),
        "Incoming node definitions do not overwrite the profile library");
    });
  });

  test("usability: Authentication Library keyboard focus, cancellation and narrow layout", async () => {
    await getHarness().run("usability: authentication library keyboard and 320px layout", async ({ page, observations }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      const dialog = await openLibrary(page);
      await until(() => dialog.getByRole("searchbox").evaluate(element => element === document.activeElement), "library entry focus");
      await dialog.getByRole("button", { name: "Add method", exact: true }).click();
      await until(() => dialog.getByRole("textbox", { name: "Method", exact: true }).evaluate(element => element === document.activeElement), "Method entry focus");
      await page.keyboard.press("Control+n");
      assert.equal(await dialog.locator("form").count(), 1, "New shortcut cannot replace the document behind the dialog");
      await dialog.getByRole("button", { name: "Save method", exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(await dialog.getByRole("button", { name: "Cancel current authentication operation", exact: true })
        .evaluate(element => element === document.activeElement), true, "Focus wraps inside modal");
      await page.keyboard.press("Escape");
      assert.equal(await dialog.locator("form").count(), 0);
      assert.equal(await dialog.isVisible(), true, "Escape dismisses only the current draft");
      for (const name of ["Close", "Add method", "Export JSON"]) {
        const button = dialog.getByRole("button", { name, exact: true });
        await button.scrollIntoViewIfNeeded();
        const bounds = await button.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321 && bounds.y >= 0 && bounds.y + bounds.height <= 641, `${name} reachable at 320px`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.keyboard.press("Escape");
      await until(() => page.getByRole("button", { name: "Model", exact: true }).evaluate(element => element === document.activeElement), "Model focus restored");
      observations.layout = { width: 320, height: 640, keyboardFocusTrap: true };
    });
  });

  test("regression: Authentication Library storage failure is explicit and atomic", async () => {
    await getHarness().run("regression: authentication storage failure is explicit and atomic", async ({ page }) => {
      await page.evaluate(key => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new DOMException("Synthetic quota failure", "QuotaExceededError");
          return original.call(this, name, value);
        };
      }, libraryKey);
      await openLibrary(page);
      await modal(page).getByRole("button", { name: "Add method", exact: true }).click();
      await modal(page).getByRole("textbox", { name: "Method", exact: true }).fill("Must not persist");
      await modal(page).getByRole("textbox", { name: "Description", exact: true }).fill("Storage failure fixture");
      await modal(page).getByRole("button", { name: "Save method", exact: true }).click();
      assert.match(await modal(page).getByRole("alert").textContent(), /not saved.*storage/i);
      assert.equal(await library(page), null);
      assert.equal(await modal(page).locator("form").count(), 1, "Failed save keeps the recoverable draft");
    });
  });

  test("regression: Authentication Library rejects a stale tab write without overwriting newer preferences", async () => {
    await getHarness().run("regression: authentication stale profile guard", async ({ page }) => {
      const method = await addMethod(page);
      await page.evaluate(({ key, method }) => {
        const catalog = JSON.parse(localStorage.getItem(key));
        catalog.methods.push({
          ...method, id: "auth_other_tab", label: "Other tab proof", description: "Newer profile data.",
        });
        localStorage.setItem(key, JSON.stringify(catalog));
      }, { key: libraryKey, method });
      await modal(page).getByRole("searchbox").fill(method.label);
      await modal(page).getByRole("button", { name: /^Partner contract/ }).click();
      await modal(page).getByRole("button", { name: "Edit method", exact: true }).click();
      await modal(page).getByRole("textbox", { name: "Method", exact: true }).fill("Stale replacement");
      await modal(page).getByRole("button", { name: "Save method", exact: true }).click();
      assert.match(await modal(page).getByRole("alert").textContent(), /changed in another tab/);
      const saved = await library(page);
      assert.equal(saved.methods.find(entry => entry.id === method.id).label, method.label);
      assert.ok(saved.methods.some(entry => entry.id === "auth_other_tab"));
    });
  });

  test("regression: browser Yjs authentication synchronization, concurrent fields and reconnect remain local", async () => {
    await getHarness().run("regression: synthetic browser authentication peers", async ({ page, observations }) => {
      const result = await page.evaluate(async fixture => {
        const yjsUrl = performance.getEntriesByType("resource").map(entry => entry.name)
          .find(name => new URL(name).origin === location.origin && new URL(name).pathname.endsWith("/yjs.js"));
        if (!yjsUrl) throw new Error("The application's loaded Yjs module URL was not observed.");
        const Y = await import(yjsUrl);
        const { createYShape, isYShapeEmpty, REMOTE_ORIGIN } = await import("/src/collab/yDoc.ts");
        const { reconcileLocalToY, buildDocFromY } = await import("/src/collab/reconcile.ts");
        const { normalizeDoc } = await import("/src/store.tsx");
        const { emptyDocument } = await import("/src/types.ts");
        const libraryBefore = localStorage.getItem("secure-design-studio:authentication-library:v1");
        const definition = {
          id: "auth_browser_peer", label: "Browser peer proof", description: "Synthetic saved peer contract.",
        };
        fixture.doc.authenticationDefinitions = [definition];
        fixture.doc.edges[0].authenticationTypes = [definition.id];
        fixture.doc.edges[0].productionIdentity = { kind: "ManagedIdentity" };
        const a = createYShape(), b = createYShape(), restored = createYShape(), definitionsOnly = createYShape();
        try {
          const initiallyEmpty = isYShapeEmpty(a);
          reconcileLocalToY(a, normalizeDoc(fixture.doc));
          Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), REMOTE_ORIGIN);
          let echoUpdates = 0;
          const listener = () => { echoUpdates++; };
          a.ydoc.on("update", listener);
          reconcileLocalToY(a, buildDocFromY(a));
          a.ydoc.off("update", listener);
          const docA = buildDocFromY(a), docB = buildDocFromY(b);
          reconcileLocalToY(a, { ...docA, edges: docA.edges.map(edge =>
            edge.id === "e_request" ? { ...edge, title: "Concurrent title" } : edge) });
          reconcileLocalToY(b, { ...docB, authenticationDefinitions: docB.authenticationDefinitions.map(def =>
            ({ ...def, description: "Concurrent definition" })) });
          Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc), REMOTE_ORIGIN);
          Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), REMOTE_ORIGIN);
          const converged = JSON.stringify(buildDocFromY(a)) === JSON.stringify(buildDocFromY(b));
          Y.applyUpdate(restored.ydoc, Y.encodeStateAsUpdate(a.ydoc), REMOTE_ORIGIN);
          const recovered = buildDocFromY(restored);
          reconcileLocalToY(definitionsOnly, normalizeDoc({ ...emptyDocument(), authenticationDefinitions: [definition] }));
          const definitionPreventsSeed = !isYShapeEmpty(definitionsOnly);
          reconcileLocalToY(a, { ...buildDocFromY(a), authenticationDefinitions: [] });
          Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), REMOTE_ORIGIN);
          const afterDeletion = buildDocFromY(b);
          return {
            initiallyEmpty, echoUpdates, converged, definitionPreventsSeed,
            title: recovered.edges.find(edge => edge.id === "e_request").title,
            description: recovered.authenticationDefinitions[0].description,
            recoveredIdentity: recovered.edges.find(edge => edge.id === "e_request").productionIdentity,
            afterDeletionIds: afterDeletion.edges.find(edge => edge.id === "e_request").authenticationTypes,
            afterDeletionDefinitions: afterDeletion.authenticationDefinitions.length,
            profileUntouched: libraryBefore === localStorage.getItem("secure-design-studio:authentication-library:v1"),
            sharedProfile: a.ydoc.share.has("authenticationLibrary"),
          };
        } finally {
          for (const shape of [a, b, restored, definitionsOnly]) shape.ydoc.destroy();
        }
      }, modelFixture());
      assert.deepEqual(result, {
        initiallyEmpty: true, echoUpdates: 0, converged: true, definitionPreventsSeed: true,
        title: "Concurrent title", description: "Concurrent definition",
        recoveredIdentity: { kind: "ManagedIdentity" },
        afterDeletionIds: ["auth_browser_peer"], afterDeletionDefinitions: 0,
        profileUntouched: true, sharedProfile: false,
      });
      observations.syntheticPeers = result;
    });
  });
}
