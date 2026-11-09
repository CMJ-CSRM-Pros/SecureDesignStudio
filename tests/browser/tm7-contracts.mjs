import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveKey, modelFixture } from "./fixture.mjs";
import { until } from "./harness.mjs";

const importedScenarioId = "70000000-0000-4000-8000-000000000001";
const importedNodeId = "70000000-0000-4000-8000-000000000002";
const replacementXml = `<ThreatModel xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
  <DrawingSurfaceList><DrawingSurfaceModel><Guid>${importedScenarioId}</Guid>
    <Borders><KeyValueOfguidanyType><Key>${importedNodeId}</Key><Value i:type="StencilEllipse">
      <GenericTypeId>GE.P</GenericTypeId><Guid>${importedNodeId}</Guid><TypeId>GE.P</TypeId>
      <Properties><anyType><DisplayName>Name</DisplayName><Value>Imported replacement</Value></anyType></Properties>
      <Left>100</Left><Top>100</Top><Width>100</Width><Height>100</Height>
    </Value></KeyValueOfguidanyType></Borders><Lines />
  </DrawingSurfaceModel></DrawingSurfaceList>
  <Notes>Synthetic unsupported detail must be disclosed before replacement.</Notes>
</ThreatModel>`;

function badgeFixture() {
  const input = modelFixture();
  const records = [
    ["node", "n_api", "s_primary", "Active"],
    ["node", "n_api", "s_archive", "Resolved"],
    ["edge", "e_request", "s_primary", "Active"],
  ];
  input.doc.comments = records.map(([targetKind, targetId, scenarioId, status], i) => ({
    id: `c_tm7_${i}`, targetKind, targetId, scenarioId, status,
    text: "Synthetic scenario-scoped discussion", createdAt: 1, replies: [],
  }));
  input.doc.issues = records.map(([targetKind, targetId, scenarioId, status], i) => ({
    id: `i_tm7_${i}`, targetKind, targetId, scenarioIds: [scenarioId], status,
    title: "Synthetic manual issue", description: "Retain authored review evidence", createdAt: 1, replies: [],
  }));
  return input;
}

async function readBadges(page) {
  const counts = {};
  for (const [name, selector] of [
    ["node", '.react-flow__node-process[data-id="n_api"]'],
    ["edge", '.ps-edge-label[data-edge-id="e_request"]'],
  ]) {
    await page.locator(selector).waitFor({ state: "attached" });
    counts[name] = await page.locator(selector).locator(".ps-comment-badge, .ps-issue-badge")
      .evaluateAll(elements => elements.map(element => element.title).sort());
  }
  return counts;
}

async function measuredGeometry(page) {
  await page.waitForFunction(key => {
    const elements = [...document.querySelectorAll(".react-flow__node-process")];
    const doc = JSON.parse(localStorage.getItem(key) || "null")?.doc;
    return elements.length === 3 && elements.every(element => {
      const node = doc?.nodes.find(node => node.id === element.getAttribute("data-id"));
      return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
    });
  }, autosaveKey);
  return page.locator(".react-flow__node-process").evaluateAll(elements =>
    elements.map(element => ({
      id: element.getAttribute("data-id"), width: element.offsetWidth, height: element.offsetHeight,
    })).sort((a, b) => a.id.localeCompare(b.id)));
}

async function history(page) {
  return page.evaluate(key => {
    window.dispatchEvent(new Event("pagehide"));
    const { past, future } = JSON.parse(localStorage.getItem(key));
    return { past, future };
  }, autosaveKey);
}

export function registerTm7Contracts({ getHarness, exportModel }) {
  for (const width of [1366, 320]) {
    test(`regression: TM7 import Undo preserves scoped badges, measured geometry and full document at ${width}px`, async () => {
      await getHarness().run(`regression: TM7 import Undo badges at ${width}px`, async ({ page, observations }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.locator("#ps-file-open-input").setInputFiles({
          name: "tm7-badge-history.tma", mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(badgeFixture())),
        });
        await page.getByLabel("Document status").getByText("tm7-badge-history.tma", { exact: true }).waitFor();
        const scenario = page.getByRole("combobox", { name: "Scenario", exact: true });
        assert.equal(await scenario.inputValue(), "s_primary");
        const activeBadges = ["1 active issue", "1 open comment"];
        await until(async () => (await readBadges(page)).node.length === 2, "Primary scenario badges");
        assert.deepEqual(await readBadges(page), { node: activeBadges, edge: activeBadges },
          "A valid scenario excludes other scenarios' comments and issues");

        await scenario.selectOption("");
        const beforeGeometry = await measuredGeometry(page);
        const before = await exportModel(page);
        const beforeHistory = await history(page);
        const beforeBadges = await readBadges(page);
        assert.deepEqual(beforeBadges, {
          node: [...activeBadges, "1 resolved comment", "1 resolved issue"], edge: activeBadges,
        }, "Show all includes both active and resolved scenario-scoped badges");

        await page.evaluate(key => {
          window.tm7HistoryConfirmation = null;
          window.confirm = message => {
            if (!message.startsWith("Import 1 scenario from TM7") ||
                !message.includes("Notes content is not imported.") ||
                !message.endsWith("REPLACE the current diagram (undoable with Ctrl+Z)?")) {
              throw new Error(`Unexpected TM7 confirmation: ${message}`);
            }
            window.dispatchEvent(new Event("pagehide"));
            window.tm7HistoryConfirmation = { message, beforeReplacement: JSON.parse(localStorage.getItem(key)) };
            return true;
          };
        }, autosaveKey);
        const fileButton = page.locator('button[aria-controls="ps-command-menu-file"]');
        await fileButton.click();
        const chooserEvent = page.waitForEvent("filechooser");
        await page.getByRole("menuitem", { name: "Threat Modeling Tool (.tm7)…", exact: true }).click();
        await (await chooserEvent).setFiles({
          name: "replacement.tm7", mimeType: "application/xml", buffer: Buffer.from(replacementXml),
        });
        await until(() => scenario.inputValue().then(id => id === importedScenarioId), "TM7 replacement scenario");
        await until(() => fileButton.evaluate(element => element === document.activeElement), "TM7 File focus return");
        const preflight = await page.evaluate(() => window.tm7HistoryConfirmation);
        assert.deepEqual(preflight.beforeReplacement.doc, before.doc, "Confirmation occurs before replacement");
        assert.deepEqual(preflight.beforeReplacement.past, beforeHistory.past, "Preflight has not mutated history");
        const importedHistory = await history(page);
        assert.equal(importedHistory.past.length, beforeHistory.past.length + 1, "Import takes one snapshot");
        assert.deepEqual(importedHistory.past.at(-1), before.doc);

        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await page.locator('.react-flow__node-process[data-id="n_api"]').waitFor();
        const afterGeometry = await measuredGeometry(page);
        const after = await exportModel(page);
        const afterBadges = await readBadges(page);
        observations.beforeGeometry = beforeGeometry;
        observations.afterGeometry = afterGeometry;
        observations.beforeBadges = beforeBadges;
        observations.afterBadges = afterBadges;
        observations.rawScenarioIdAfterUndo = after.view.activeScenarioId;
        assert.equal(after.view.activeScenarioId, importedScenarioId, "Do not sanitize the raw view ID to mask the regression");
        assert.equal(after.doc.scenarios.some(s => s.id === importedScenarioId), false);
        assert.equal(await scenario.inputValue(), "", "The restored graph resolves the stale ID as Show all");
        assert.deepEqual(afterBadges, beforeBadges, "Badges follow the resolved graph without manually selecting Show all");
        assert.deepEqual(afterGeometry, beforeGeometry, "Actual rendered node dimensions are fully restored");
        assert.deepEqual(after.doc, before.doc, "Undo preserves every document field, including measured sizes");
        assert.deepEqual((await history(page)).past, beforeHistory.past, "Undo consumes exactly the import snapshot");
      });
    });
  }
}
