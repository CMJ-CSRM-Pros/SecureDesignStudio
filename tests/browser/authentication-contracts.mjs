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

const guidanceTrigger = "Edit guidance for this method in this diagram";
const guidanceCard = (overrides = {}) => ({
  content: "Synthetic authentication card </script><script>globalThis.SDS_AUTH_GUIDANCE_EXECUTED=true</script>\n"
    + "<img src=x onerror=alert(1)>\nAsk who acquires and presents the credential; verify receiver validation separately.",
  sources: ["https://example.invalid/auth-reference-a", "https://example.invalid/auth-reference-b"],
  revision: 3, updatedOn: "2026-10-31", ...overrides,
});
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const suppliedMethod = (page, id) => page.evaluate(async id => structuredClone(
  (await import("/src/authentication.ts")).AUTH_TYPE_DEFS.find(method => method.id === id)), id);
const readAutosave = page => page.evaluate(async key => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.dispatchEvent(new Event("pagehide"));
  return JSON.parse(localStorage.getItem(key));
}, autosaveKey);

// Hidden scenario nodes get their first real measurement here, so later scenario switches stay view-only.
async function uploadMeasured(page, model, name) {
  await upload(page.locator("#ps-file-open-input"), model, name);
  const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
  const startingScenario = await scenario.inputValue();
  const waitForMeasuredNodes = ids => page.waitForFunction(({ ids, key }) => {
    window.dispatchEvent(new Event("pagehide"));
    const doc = JSON.parse(localStorage.getItem(key) ?? "null")?.doc;
    const elements = [...document.querySelectorAll(".react-flow__node-process")];
    return elements.length === ids.length && ids.every(id => {
      const element = elements.find(candidate => candidate.getAttribute("data-id") === id);
      const node = doc?.nodes.find(candidate => candidate.id === id);
      return element && element.offsetWidth > 0 && element.offsetHeight > 0
        && node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
    });
  }, { ids, key: autosaveKey });
  await scenario.selectOption("");
  await waitForMeasuredNodes(model.doc.nodes.map(node => node.id));
  await scenario.selectOption(startingScenario);
  await waitForMeasuredNodes(startingScenario
    ? model.doc.scenarios.find(item => item.id === startingScenario).nodeIds
    : model.doc.nodes.map(node => node.id));
}

// Every flow uses ApiKey across both scenarios; flow-specific fields must survive method-wide guidance edits.
function guidanceFlowFixture() {
  const model = modelFixture();
  for (const edge of model.doc.edges) edge.authenticationTypes = ["ApiKey"];
  Object.assign(model.doc.edges[0], {
    audience: "api://retained-audience", constraints: "Retained owner constraint",
    applicationId: "12345678-1234-1234-1234-123456789abc", protocolId: "https",
  });
  return model;
}

async function openAuthenticationGuidance(page, methodId) {
  const sections = page.locator("details.ps-node-guidance")
    .filter({ has: page.locator("summary", { hasText: "Authentication AI design guidance" }) });
  await sections.first().waitFor({ state: "visible" });
  const index = await sections.evaluateAll((elements, id) =>
    elements.findIndex(element => element.textContent.includes(`(${id})`)), methodId);
  assert.ok(index >= 0, `Authentication guidance section for ${methodId}`);
  const section = sections.nth(index);
  if (!await section.evaluate(element => element.open)) await section.locator("summary").click();
  return section;
}

async function fillGuidanceDraft(scope, value) {
  const add = scope.getByRole("button", { name: "Add AI design guidance", exact: true });
  if (await add.count()) await add.click();
  await scope.getByRole("textbox", { name: "Guidance content", exact: true }).fill(value.content);
  await scope.getByRole("textbox", { name: "Source URLs (one per line)", exact: true }).fill((value.sources ?? []).join("\n"));
  await scope.getByLabel("Authored revision", { exact: true }).fill(String(value.revision));
  await scope.getByLabel("Updated on (edit date)", { exact: true }).fill(value.updatedOn);
}

async function answerNextConfirmation(page, expected) {
  await page.evaluate(expected => {
    const original = window.confirm;
    window.confirm = message => {
      window.confirm = original;
      window.SDS_LAST_CONFIRMATION = message;
      return message === expected;
    };
  }, expected);
}

export function registerAuthenticationContracts({ getHarness, exportModel }) {
  test("regression: communication profile edits retain guidance sources and authentication suggestions", async () => {
    await getHarness().run("regression: communication profile edit initialization", async ({ page }) => {
      await page.getByRole("button", { name: "Model", exact: true }).click();
      await page.getByRole("menuitem", { name: "Customize communication profiles", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Communication Library", exact: true });
      await dialog.getByRole("button", { name: "HTTPS", exact: true }).click();
      const original = await page.evaluate(async () =>
        (await import("/src/protocols.ts")).PROTOCOL_TYPE_DEFS.find(profile => profile.id === "https"));
      const sources = dialog.getByRole("textbox", { name: "AI guidance source URLs (one URL per line)", exact: true });
      const suggestions = dialog.getByRole("textbox", {
        name: "Advisory authentication IDs (comma separated; does not change edge authentication)", exact: true,
      });
      assert.equal(await sources.inputValue(), original.aiDesignGuidance.sources.join("\n"));
      assert.equal(await suggestions.inputValue(), original.authenticationSuggestions.join(", "));
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Team HTTPS");
      await dialog.getByRole("button", { name: "Save profile", exact: true }).click();
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("secure-design-studio:protocol-library:v1")).protocols.find(profile => profile.id === "https"));
      assert.deepEqual(saved, { ...original, label: "Team HTTPS" });
      await sources.fill("https://example.invalid/revised-reference");
      await dialog.getByRole("button", { name: "Cancel edits", exact: true }).click();
      assert.equal(await sources.inputValue(), original.aiDesignGuidance.sources.join("\n"));
      await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Revised description.");
      await dialog.getByRole("button", { name: "Save profile", exact: true }).click();
      const revised = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("secure-design-studio:protocol-library:v1")).protocols.find(profile => profile.id === "https"));
      assert.deepEqual(revised, { ...saved, description: "Revised description." });
      await dialog.getByRole("button", { name: "Close Communication Library", exact: true }).click();
    });
  });

  test("regression: opened authentication stays visible independently of absent, null or unresolved protocols", async () => {
    await getHarness().run("regression: protocol independent saved authentication", async ({ page }) => {
      const methods = await page.evaluate(async () => (await import("/src/authentication.ts")).AUTH_TYPE_DEFS);
      const disabledProtocol = await page.evaluate(async () => ({
        ...(await import("/src/protocols.ts")).PROTOCOL_TYPE_DEFS.find(profile => profile.id === "https"),
        disabled: true,
      }));
      const custom = {
        ...structuredClone(methods.find(method => method.id === "ApiKey")),
        id: "auth_saved_partner", label: "Saved partner assertion", shortLabel: "Partner",
        aliases: [], behavior: { productionIdentity: "unknown", audience: false, constraints: false,
          anonymous: false, managedIdentity: false },
      };
      for (const { protocolId, auth, saved, protocolDefinition, expected, short } of [
        { auth: "Microsoft Entra ID - delegated user access", expected: "EntraDelegatedUserAccess", short: "Entra user" },
        { protocolId: null, auth: "EntraManagedIdentity", expected: "EntraManagedIdentity", short: "Managed identity" },
        { protocolId: "future-profile", auth: "ApiKey", expected: "ApiKey", short: "API key" },
        { auth: custom.id, saved: custom, expected: custom.id, short: "Partner" },
        { protocolId: "https", protocolDefinition: disabledProtocol, auth: "ApiKey", expected: "ApiKey", short: "API key" },
        // Promoted to core: a historical compatibility reference now resolves without a companion library.
        { auth: "EntraApplicationOnlyWithCdt", expected: "EntraApplicationOnlyWithCdt", short: "CDT" },
        { auth: "auth_unresolved_partner", expected: "auth_unresolved_partner", short: "Unresolved" },
      ]) {
        const input = modelFixture();
        const edge = input.doc.edges.find(edge => edge.id === "e_request");
        delete edge.authenticationTypes;
        edge.authenticationType = auth;
        if (protocolId !== undefined) edge.protocolId = protocolId;
        if (saved) input.doc.authenticationDefinitions = [saved];
        if (protocolDefinition) input.doc.protocolDefinitions = [protocolDefinition];
        await upload(page.locator("#ps-file-open-input"), input, "legacy-auth.tma");
        await edgeLabel(page).locator(".ps-edge-auth-badge").getByText(short, { exact: true }).waitFor();
        assert.equal(await edgeLabel(page).getByText("Auth —", { exact: true }).count(), 0);
        await selectFlow(page);
        assert.equal(await selector(page).inputValue(), expected);
        assert.ok((await selector(page).locator(`option[value="${expected}"]`).textContent()).trim());
        const exported = await exportModel(page);
        assert.deepEqual(exported.doc.edges.find(edge => edge.id === "e_request").authenticationTypes, [expected]);
        await page.getByRole("tab", { name: /^Edges/ }).click();
        const row = page.getByRole("row", { name: /^Request payload, sequence/ });
        const label = saved?.label ?? methods.find(method => method.id === expected)?.label ?? expected;
        assert.ok((await row.textContent()).includes(label));
        await page.getByRole("button", { name: "Sequence", exact: true }).click();
        assert.ok((await page.locator(".ps-seq-svg").textContent()).includes(`Auth: ${label}`));
        await page.getByRole("button", { name: "Diagram", exact: true }).click();
      }
    });
  });

  test("regression: Internal process call is a distinct selectable built-in", async () => {
    await getHarness().run("regression: internal process authentication", async ({ page }) => {
      await selectFlow(page);
      const appId = "12345678-1234-1234-1234-123456789abc";
      const applicationId = page.getByRole("textbox", { name: "Application ID (GUID)", exact: true });
      await applicationId.fill(appId);
      await selector(page).selectOption("InternalProcessCall");
      await page.getByText(
        "Calls another component within the same process boundary. No particular authentication mechanism is required because the call does not cross that boundary.",
        { exact: true },
      ).waitFor();
      await edgeLabel(page).getByText("Internal", { exact: true }).waitFor();
      assert.equal(await edgeLabel(page).getByText("Anonymous", { exact: true }).count(), 0);
      assert.equal(await applicationId.inputValue(), appId,
        "Changing authentication preserves the independent caller Application ID");
      assert.equal(await page.getByRole("combobox", { name: "Tenant", exact: true }).count(), 0,
        "Legacy tenant evidence is not an editable authentication selector");
      await selector(page).selectOption("ApiKey");
      assert.equal(await applicationId.inputValue(), appId,
        "Changing methods preserves the active caller Application ID");
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
      await page.getByRole("textbox", { name: "Application ID (GUID)", exact: true }).fill(guid);
      await selector(page).selectOption("CustomAuthentication");
      assert.equal(await page.getByRole("textbox", { name: "Application ID (GUID)", exact: true }).inputValue(), guid);
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
      assert.equal(savedEdge.applicationId, guid);
      assert.deepEqual(savedEdge.productionIdentity, undefined,
        "A caller Application ID does not create or rewrite historical identity evidence");
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

  test("regression: authentication AI guidance library authoring, explicit clear, reset and export stay profile-scoped", async () => {
    await getHarness().run("regression: authentication AI guidance library authoring", async ({ page }) => {
      const supplied = await suppliedMethod(page, "ApiKey");
      const card = guidanceCard();
      await selectFlow(page);
      await selector(page).selectOption("ApiKey");
      const profileApiKey = async () => (await library(page))?.methods.find(method => method.id === "ApiKey");
      const diagramApiKey = async () => (await exportModel(page)).doc.authenticationDefinitions.find(method => method.id === "ApiKey");
      const dialog = await openLibrary(page);
      await dialog.getByRole("searchbox").fill(supplied.label);
      await dialog.getByRole("button", { name: new RegExp(`^${escapeRegExp(supplied.label)}`) }).click();
      await dialog.getByRole("button", { name: "Edit method", exact: true }).click();
      await fillGuidanceDraft(dialog, { ...card, sources: ["javascript:alert(1)"] });
      await dialog.getByRole("button", { name: "Save method", exact: true }).click();
      await dialog.locator(".ps-auth-error").filter({ hasText: "AI design guidance" }).waitFor({ state: "visible" });
      assert.equal(await library(page), null, "Invalid guidance writes nothing to the profile");
      assert.equal(await dialog.locator("form").count(), 1, "A failed save keeps the recoverable draft");
      await dialog.getByRole("textbox", { name: "Source URLs (one per line)", exact: true }).fill(card.sources.join("\n"));
      await dialog.getByRole("button", { name: "Save method", exact: true }).click();
      await until(async () => (await profileApiKey())?.aiDesignGuidance?.revision === card.revision, "profile guidance saved");
      assert.deepEqual(await profileApiKey(), { ...supplied, aiDesignGuidance: card },
        "Only guidance changes; protected behavior, aliases and legacy status stay supplied");
      assert.equal(await dialog.locator(".ps-guidance-content").textContent(), card.content);
      assert.deepEqual(await dialog.getByRole("list", { name: "Guidance sources", exact: true }).getByRole("link")
        .evaluateAll(links => links.map(link => link.textContent)), card.sources);
      assert.equal(await page.evaluate(() => globalThis.SDS_AUTH_GUIDANCE_EXECUTED), undefined, "Guidance is inert text");
      await dialog.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await profileApiKey(), supplied);
      await dialog.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual(await profileApiKey(), { ...supplied, aiDesignGuidance: card });
      const exported = await readDownload(page,
        () => dialog.getByRole("button", { name: "Export JSON", exact: true }).click(),
        "secure-design-studio-authentication-catalog.json");
      assert.deepEqual(exported.methods.find(method => method.id === "ApiKey").aiDesignGuidance, card);
      await closeLibrary(page);
      assert.deepEqual((await diagramApiKey()).aiDesignGuidance, card, "The matching diagram definition follows the library edit");

      await openLibrary(page);
      await dialog.getByRole("searchbox").fill(supplied.label);
      await dialog.getByRole("button", { name: new RegExp(`^${escapeRegExp(supplied.label)}`) }).click();
      await dialog.getByRole("button", { name: "Edit method", exact: true }).click();
      const removal = "Remove AI design guidance from this draft? Save method to apply this to your profile library and matching definitions in the current diagram.";
      await answerNextConfirmation(page, removal);
      await dialog.getByRole("button", { name: "Remove guidance from draft", exact: true }).click();
      assert.equal(await page.evaluate(() => window.SDS_LAST_CONFIRMATION), removal);
      await dialog.getByRole("button", { name: "Save method", exact: true }).click();
      await until(async () => !Object.hasOwn(await profileApiKey() ?? { aiDesignGuidance: true }, "aiDesignGuidance"), "profile guidance cleared");
      await closeLibrary(page);
      assert.equal(Object.hasOwn(await diagramApiKey(), "aiDesignGuidance"), false, "Explicit clear follows to the matching diagram definition");
      await page.reload();
      await openLibrary(page);
      await dialog.getByRole("searchbox").fill(supplied.label);
      await dialog.getByRole("button", { name: new RegExp(`^${escapeRegExp(supplied.label)}`) }).click();
      await dialog.getByText("AI design guidance not supplied.", { exact: true }).waitFor({ state: "visible" });
      assert.equal(Object.hasOwn(await profileApiKey(), "aiDesignGuidance"), false, "Reload never resurrects supplied guidance");

      await dialog.getByRole("button", { name: "Edit method", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Method", exact: true }).fill("Team API key");
      await fillGuidanceDraft(dialog, guidanceCard({ content: "Team-specific reset fixture.", revision: 4 }));
      await dialog.getByRole("button", { name: "Save method", exact: true }).click();
      await until(async () => (await profileApiKey())?.label === "Team API key", "renamed method with guidance");
      await dialog.getByRole("button", { name: "Reset built-in presentation", exact: true }).click();
      assert.match(await dialog.innerText(), /Restore the supplied Method, Description, short display label, and AI design guidance/);
      await dialog.getByRole("button", { name: "Reset presentation", exact: true }).click();
      await until(async () => (await profileApiKey())?.label === supplied.label, "reset applied");
      assert.deepEqual(await profileApiKey(), supplied, "Reset restores the supplied guidance, or its absence, exactly");

      await page.evaluate(key => {
        const catalog = JSON.parse(localStorage.getItem(key));
        catalog.methods.find(method => method.id === "ApiKey").aiDesignGuidance = {
          content: "Other tab guidance.", revision: 7, updatedOn: "2026-10-30",
        };
        localStorage.setItem(key, JSON.stringify(catalog));
      }, libraryKey);
      await dialog.getByRole("button", { name: "Edit method", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Stale description.");
      await dialog.getByRole("button", { name: "Save method", exact: true }).click();
      await dialog.locator(".ps-auth-error").filter({ hasText: "changed in another tab" }).waitFor({ state: "visible" });
      assert.equal((await profileApiKey()).aiDesignGuidance.content, "Other tab guidance.",
        "A guidance-only change in another tab is never overwritten");
    });
  });

  test("regression: authentication AI guidance flow edits are method-wide, diagram-only, stale-safe and undoable", async () => {
    await getHarness().run("regression: authentication AI guidance diagram edits", async ({ page }) => {
      const supplied = await suppliedMethod(page, "ApiKey");
      const fixture = guidanceFlowFixture();
      await uploadMeasured(page, fixture, "auth-guidance.tma");
      const libraryBefore = await library(page);
      await selectFlow(page);
      let section = await openAuthenticationGuidance(page, "ApiKey");
      assert.match(await section.locator("summary").textContent(),
        supplied.aiDesignGuidance ? /\/ revision \d+$/ : /\/ not supplied$/);
      assert.match(await section.innerText(), /Method-wide in this diagram, across all scenarios and every flow using this method/);
      const edit = () => section.getByRole("button", { name: guidanceTrigger, exact: true });
      const before = await exportModel(page);
      const history = await readAutosave(page);

      await edit().click();
      await section.getByRole("button", { name: "Cancel guidance edit", exact: true }).click();
      await until(() => edit().evaluate(element => element === document.activeElement), "Cancel returns focus to the edit trigger");
      await edit().click();
      await fillGuidanceDraft(section, guidanceCard({ content: "Cancelled draft." }));
      await section.getByRole("textbox", { name: "Guidance content", exact: true }).press("Escape");
      await until(() => edit().evaluate(element => element === document.activeElement), "Escape returns focus to the edit trigger");
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Cancelled drafts apply nothing");
      await edit().click();
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      assert.equal((await readAutosave(page)).past.length, history.past.length, "An unchanged save adds no history");

      const card = guidanceCard();
      await edit().click();
      await fillGuidanceDraft(section, { ...card, revision: 0 });
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      await section.locator(".ps-catalog-error").filter({ hasText: "revision" }).first().waitFor({ state: "visible" });
      assert.deepEqual((await readAutosave(page)).doc, history.doc, "Invalid guidance never partially mutates");
      await section.getByLabel("Authored revision", { exact: true }).fill(String(card.revision));
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      await edit().waitFor({ state: "visible" });
      assert.equal(await section.locator(".ps-guidance-content").textContent(), card.content);
      assert.equal(await page.evaluate(() => globalThis.SDS_AUTH_GUIDANCE_EXECUTED), undefined, "Guidance is inert text");
      assert.match(await section.locator("summary").textContent(), /\/ revision 3$/);
      assert.match(await section.innerText(), /Saved diagram definition/);
      const applied = await exportModel(page);
      const expected = structuredClone(before.doc);
      expected.authenticationDefinitions.find(method => method.id === "ApiKey").aiDesignGuidance = card;
      assert.deepEqual(applied.doc, expected,
        "Only the method definition's guidance changes; flows, audiences, identities, protocols, scenarios and geometry do not");
      assert.deepEqual(await library(page), libraryBefore, "Diagram guidance never writes the profile library");
      assert.equal((await readAutosave(page)).past.length, history.past.length + 1, "One undoable step");

      await selectFlow(page, "e_parallel");
      assert.match(await (await openAuthenticationGuidance(page, "ApiKey")).locator("summary").textContent(), /\/ revision 3$/);
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_archive");
      await page.getByRole("tab", { name: /^Edges/ }).click();
      await page.getByRole("row", { name: /^Archive payload, sequence/ }).click();
      await page.getByRole("tab", { name: /^Properties/ }).click();
      assert.match(await (await openAuthenticationGuidance(page, "ApiKey")).locator("summary").textContent(), /\/ revision 3$/,
        "The same method guidance applies in every scenario");
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_primary");
      assert.deepEqual((await exportModel(page)).doc, applied.doc, "Inspection and scenario switching are view-only");

      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, applied.doc);

      await selectFlow(page);
      section = await openAuthenticationGuidance(page, "ApiKey");
      await edit().click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Undo restores the document and clears selection");
      assert.equal(await page.getByRole("textbox", { name: "Guidance content", exact: true }).count(), 0,
        "Undo dismisses the draft with the existing selection lifecycle");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, applied.doc);

      await selectFlow(page);
      section = await openAuthenticationGuidance(page, "ApiKey");
      await edit().click();
      const adoption = await openLibrary(page);
      await adoption.locator("details").filter({ has: page.locator("summary", { hasText: `Review definition: ${supplied.label}` }) })
        .locator("summary").click();
      await adoption.getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await adoption.getByRole("button", { name: "Use library definition in this diagram", exact: true }).click();
      await closeLibrary(page);
      const changedDefinitionHistory = await readAutosave(page);
      await section.getByRole("textbox", { name: "Guidance content", exact: true }).fill("Stale draft must not apply.");
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      await section.locator(".ps-catalog-error").filter({ hasText: "changed while you were editing" }).waitFor({ state: "visible" });
      assert.deepEqual((await exportModel(page)).doc, before.doc, "A stale definition edit applies nothing");
      assert.deepEqual((await readAutosave(page)).past, changedDefinitionHistory.past, "A rejected stale edit does not add history");
      assert.deepEqual((await readAutosave(page)).future, changedDefinitionHistory.future, "A rejected stale edit does not alter redo");
      await section.getByRole("button", { name: "Cancel guidance edit", exact: true }).click();
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, applied.doc, "Undo restores the explicitly replaced definition");

      const dialog = await openLibrary(page);
      assert.match(await dialog.innerText(), /saved definition differs/i);
      await dialog.getByRole("searchbox").fill(supplied.label);
      await dialog.getByRole("button", { name: new RegExp(`^${escapeRegExp(supplied.label)}`) }).click();
      await dialog.getByRole("button", { name: "Edit method", exact: true }).click();
      await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Profile-only description edit.");
      await dialog.getByRole("button", { name: "Save method", exact: true }).click();
      await until(async () => (await library(page))?.methods.find(method => method.id === "ApiKey")?.description
        === "Profile-only description edit.", "profile edit saved");
      await closeLibrary(page);
      assert.deepEqual((await exportModel(page)).doc, applied.doc, "A different saved diagram definition ignores later profile edits");

      await selectFlow(page);
      section = await openAuthenticationGuidance(page, "ApiKey");
      await edit().click();
      const removal = "Remove AI design guidance from this draft? Save guidance to remove it for this method throughout this diagram. Your profile library is unchanged.";
      await answerNextConfirmation(page, removal);
      await section.getByRole("button", { name: "Remove guidance from draft", exact: true }).click();
      assert.equal(await page.evaluate(() => window.SDS_LAST_CONFIRMATION), removal);
      await section.getByRole("button", { name: "Save guidance", exact: true }).click();
      await until(() => section.locator("summary").textContent().then(text => /\/ not supplied$/.test(text)),
        "cleared diagram guidance is not resurrected from the library or supplied definition");
      const cleared = await exportModel(page);
      const clearedExpected = structuredClone(applied.doc);
      delete clearedExpected.authenticationDefinitions.find(method => method.id === "ApiKey").aiDesignGuidance;
      assert.deepEqual(cleared.doc, clearedExpected, "Clear keeps the saved definition and removes only guidance");
      await page.reload();
      await selectFlow(page);
      assert.match(await (await openAuthenticationGuidance(page, "ApiKey")).locator("summary").textContent(), /\/ not supplied$/);
      assert.deepEqual((await exportModel(page)).doc, cleared.doc, "Autosave recovery keeps the explicit clear");
      await uploadMeasured(page, applied, "auth-guidance-reopened.tma");
      assert.deepEqual((await exportModel(page)).doc, applied.doc, "Native reopen restores saved guidance exactly");
    });
  });

  test("regression: authentication AI guidance is read-only for unresolved methods and per-method on legacy multi-auth flows", async () => {
    await getHarness().run("regression: authentication AI guidance unresolved and legacy", async ({ page }) => {
      const legacy = modelFixture();
      legacy.doc.edges[0].authenticationTypes = ["CertificateAuthentication", "EntraApplicationOnlyAccess"];
      legacy.doc.edges[1].authenticationTypes = ["auth_missing"];
      await upload(page.locator("#ps-file-open-input"), legacy, "legacy-guidance.tma");
      const before = await exportModel(page);
      await selectFlow(page);
      assert.equal(await page.locator("details.ps-node-guidance")
        .filter({ has: page.locator("summary", { hasText: "Authentication AI design guidance" }) }).count(), 2,
      "Each legacy method keeps its own method-wide guidance section");
      for (const id of ["CertificateAuthentication", "EntraApplicationOnlyAccess"]) {
        const section = await openAuthenticationGuidance(page, id);
        assert.equal(await section.getByRole("button", { name: guidanceTrigger, exact: true }).isDisabled(), false, id);
      }
      await selectFlow(page, "e_parallel");
      const missing = await openAuthenticationGuidance(page, "auth_missing");
      assert.equal(await missing.getByRole("button", { name: guidanceTrigger, exact: true }).isDisabled(), true);
      assert.match(await missing.innerText(), /Resolve this method in Authentication Library before editing guidance/);
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Inspecting guidance is read-only and keeps legacy arrays and unresolved IDs");
    });
  });

  test("regression: authentication AI guidance never borrows a same-ID profile method for an unresolved flow reference", async () => {
    await getHarness().run("regression: authentication AI guidance profile collision", async ({ page }) => {
      const collision = {
        id: "auth_profile_collision", label: "Profile collision proof", description: "Synthetic profile-only method.",
        shortLabel: "Collision", aliases: [], legacy: false, disabled: false,
        behavior: { productionIdentity: "unknown", audience: false, constraints: false, anonymous: false, managedIdentity: false },
        aiDesignGuidance: { content: "Synthetic profile-only collision card.", revision: 1, updatedOn: "2026-10-31" },
      };
      const profile = await page.evaluate(async method => {
        const { AUTH_TYPE_DEFS, exportAuthenticationCatalog, AUTHENTICATION_STORAGE_KEY } = await import("/src/authentication.ts");
        const raw = exportAuthenticationCatalog([...AUTH_TYPE_DEFS, method]);
        localStorage.setItem(AUTHENTICATION_STORAGE_KEY, raw);
        return raw;
      }, collision);
      await page.reload();
      const input = modelFixture();
      input.doc.edges[0].authenticationTypes = [collision.id];
      input.doc.authenticationDefinitions = [];
      await upload(page.locator("#ps-file-open-input"), input, "profile-collision.tma");
      const before = await exportModel(page);
      assert.deepEqual(before.doc.edges.find(edge => edge.id === "e_request").authenticationTypes, [collision.id]);
      assert.equal(before.doc.authenticationDefinitions.some(method => method.id === collision.id), false,
        "Opening and saving never capture the same-ID profile method");
      await edgeLabel(page).locator(".ps-edge-auth-badge").getByText("Unresolved", { exact: true }).waitFor();
      await selectFlow(page);
      const section = await openAuthenticationGuidance(page, collision.id);
      assert.equal(await section.getByRole("button", { name: guidanceTrigger, exact: true }).isDisabled(), true,
        "A library-name coincidence grants no guidance editing authority");
      assert.match(await section.innerText(), /Resolve this method in Authentication Library before editing guidance/);
      assert.equal((await section.innerText()).includes(collision.aiDesignGuidance.content), false,
        "The profile card is never shown as this diagram's guidance");
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Inspection is read-only");
      assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), profile, "The profile library is untouched");
    });
  });

  test("usability: authentication AI guidance inspector editing is keyboard reachable at narrow widths", async () => {
    await getHarness().run("usability: authentication AI guidance keyboard and narrow layout", async ({ page }) => {
      await upload(page.locator("#ps-file-open-input"), guidanceFlowFixture(), "auth-guidance-keyboard.tma");
      await selectFlow(page);
      const section = await openAuthenticationGuidance(page, "ApiKey");
      const before = await readAutosave(page);
      await page.setViewportSize({ width: 375, height: 700 });
      const edit = section.getByRole("button", { name: guidanceTrigger, exact: true });
      await edit.focus();
      await page.keyboard.press("Enter");
      await until(() => page.evaluate(() => !!document.activeElement?.closest(".ps-guidance-editor")),
        "keyboard activation moves focus into the guidance editor");
      await page.keyboard.press("Escape");
      await until(() => edit.evaluate(element => element === document.activeElement), "Escape returns focus to the exact edit trigger");
      assert.deepEqual((await readAutosave(page)).doc, before.doc);
      for (const width of [375, 320]) {
        await page.setViewportSize({ width, height: 700 });
        await edit.scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
          `No page horizontal scroll at ${width}px`);
        const box = await edit.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `Edit action fits ${width}px`);
      }
      await edit.click();
      const save = section.getByRole("button", { name: "Save guidance", exact: true });
      await save.scrollIntoViewIfNeeded();
      const box = await save.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 321, "Save guidance fits 320px");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
        "The open editor causes no horizontal scroll at 320px");
    });
  });
}
