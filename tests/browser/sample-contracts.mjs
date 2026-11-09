import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { until } from "./harness.mjs";
import { autosaveKey, modelFixture } from "./fixture.mjs";
import { sampleExpectations } from "../authentication/sample-expectations.mjs";

const directory = new URL("../../samples/", import.meta.url);
const readSamples = () => readdirSync(directory).filter(file => file.endsWith(".tma"));

async function upload(page, model, name) {
  await page.locator("#ps-file-open-input").setInputFiles({
    name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
  });
  await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
}

export function registerSampleContracts({ getHarness, exportModel,
  samples = readSamples().map(file => ({
    file, input: JSON.parse(readFileSync(new URL(file, directory), "utf8")), authenticationReminders: [],
  })),
}) {
  for (const { file, input, authenticationReminders = [], portableExpected, nodeExpectations = sampleExpectations[file]?.nodes } of samples) {
    test(`regression: sample ${file} renders and round-trips every scenario`, async () => {
      await getHarness().run(`regression: sample ${file}`, async ({ page, observations }) => {
        await upload(page, input, file);
        const expected = portableExpected ?? await page.evaluate(async doc => {
          const { normalizeDoc } = await import("/src/store.tsx");
          const { AUTH_TYPE_DEFS } = await import("/src/types.ts");
          const { withAuthenticationDefinitions } = await import("/src/authentication.ts");
          const { withCatalogDefinitions } = await import("/src/catalogDefinitions.ts");
          return JSON.parse(JSON.stringify(withCatalogDefinitions(withAuthenticationDefinitions(normalizeDoc(doc), AUTH_TYPE_DEFS))));
        }, input.doc);
        const picker = page.getByRole("combobox", { name: "Scenario", exact: true });
        assert.equal(await picker.inputValue(), input.view.activeScenarioId);
        const close = page.getByRole("button", { name: "Close inspector", exact: true });
        if (await close.isVisible()) await close.click();
        // Auto-sized process nodes use the host's system font, not the sample author's font.
        await picker.selectOption("");
        await page.waitForFunction(({ count, key }) => {
          window.dispatchEvent(new Event("pagehide"));
          const doc = JSON.parse(localStorage.getItem(key) ?? "null")?.doc;
          const elements = [...document.querySelectorAll(".react-flow__node-process")];
          return elements.length === count && elements.every(element => {
            const node = doc?.nodes.find(node => node.id === element.dataset.id);
            return element.offsetWidth > 0 && element.offsetHeight > 0 &&
              node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
          });
        }, { count: expected.nodes.length, key: autosaveKey });
        const hostSizes = await page.locator(".react-flow__node-process").evaluateAll(elements =>
          Object.fromEntries(elements.map(element => [element.dataset.id,
            { width: element.offsetWidth, height: element.offsetHeight }])));
        for (const node of expected.nodes) {
          assert.ok(hostSizes[node.id], `${node.id}: independent host measurement required`);
          node.size = hostSizes[node.id];
        }
        assert.deepEqual((await exportModel(page)).doc, expected,
          "Initial import preserves every authored field and independently measured host geometry");
        await picker.selectOption(input.view.activeScenarioId);
        const output = process.env.SDS_TEST_OUTPUT_DIR ?? mkdtempSync(path.join(os.tmpdir(), "sds-samples-"));
        observations.screenshots = [];
        observations.geometryViolations = [];
        observations.measuredNodes = {};
        for (const scenario of input.doc.scenarios) {
          await picker.selectOption(scenario.id);
          await until(async () => await page.locator(".react-flow__node-process").count() === scenario.nodeIds.length,
            `${scenario.name}: node count`);
          await until(async () => await page.locator(".ps-edge-label").count() === scenario.edgeIds.length,
            `${scenario.name}: flow count`);
          await page.getByRole("button", { name: "Fit model to view", exact: true }).click();
          await page.waitForFunction(() => {
            const transform = document.querySelector(".react-flow__viewport")?.getAttribute("style");
            const prior = window.sampleViewportStability;
            if (!prior || prior.transform !== transform) {
              window.sampleViewportStability = { transform, since: performance.now() };
              return false;
            }
            return performance.now() - prior.since > 350;
          });
          const geometry = await page.evaluate(() => {
            const rect = element => {
              const box = element.getBoundingClientRect();
              return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
            };
            return {
              canvas: rect(document.querySelector(".react-flow")),
              nodes: [...document.querySelectorAll(".react-flow__node-process")]
                .map(element => ({ id: element.dataset.id, width: element.offsetWidth, height: element.offsetHeight, ...rect(element) })),
              labels: [...document.querySelectorAll(".ps-edge-label")]
                .map(element => ({ id: element.dataset.edgeId, ...rect(element) })),
              titles: [...document.querySelectorAll(".ps-boundary-title")]
                .map(element => ({ id: element.closest(".react-flow__node").dataset.id, ...rect(element) })),
              paths: [...document.querySelectorAll(".react-flow__edge-path")].map(element => {
                const length = element.getTotalLength();
                const transform = element.getScreenCTM();
                const points = [];
                for (let distance = 0; distance <= length; distance += 3) {
                  const point = element.getPointAtLength(distance);
                  const screen = new DOMPoint(point.x, point.y).matrixTransform(transform);
                  points.push({ x: screen.x, y: screen.y });
                }
                return { id: element.closest(".react-flow__edge").dataset.id, points };
              }),
            };
          });
          assert.deepEqual(geometry.nodes.map(node => node.id).sort(), [...scenario.nodeIds].sort());
          for (const node of geometry.nodes) {
            observations.measuredNodes[node.id] = { width: node.width, height: node.height };
            assert.deepEqual(observations.measuredNodes[node.id], hostSizes[node.id],
              `${scenario.name}: ${node.id} retains its independently measured dimensions`);
          }
          assert.deepEqual(geometry.labels.map(label => label.id).sort(), [...scenario.edgeIds].sort());
          const screenshot = path.join(output, `${file}-${scenario.id}.png`);
          await page.screenshot({ path: screenshot, fullPage: true });
          observations.screenshots.push(screenshot);
          const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
          const boxes = [...geometry.nodes, ...geometry.labels, ...geometry.titles];
          for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (!(box.x >= geometry.canvas.x && box.y >= geometry.canvas.y &&
              box.right <= geometry.canvas.right && box.bottom <= geometry.canvas.bottom)) {
              observations.geometryViolations.push(`${scenario.name}: ${box.id} is clipped after Fit`);
            }
            for (const other of boxes.slice(i + 1)) {
              if (overlaps(box, other)) observations.geometryViolations.push(`${scenario.name}: ${box.id} overlaps ${other.id}`);
            }
          }
          assert.equal(geometry.paths.length, scenario.edgeIds.length);
          for (const flow of geometry.paths) {
            for (const label of [...geometry.labels, ...geometry.titles].filter(label => label.id !== flow.id)) {
              if (flow.points.some(point => point.x > label.x + 1 && point.x < label.right - 1 &&
                point.y > label.y + 1 && point.y < label.bottom - 1)) {
                observations.geometryViolations.push(`${scenario.name}: ${flow.id} passes under the unrelated ${label.id} label`);
              }
            }
          }
          const expectedReminders = authenticationReminders.filter(id => scenario.edgeIds.includes(id));
          assert.equal(await page.locator(".ps-edge-auth-review").count(), expectedReminders.length,
            "Only explicitly documented unverified authentication methods have review badges");
          assert.equal(await page.locator(".ps-edge-auth-missing").count(), 0, "No missing methods");
          for (const id of scenario.nodeIds) {
            const modelNode = input.doc.nodes.find(node => node.id === id);
            assert.ok(nodeExpectations?.[id], `${id}: independent architecture expectation required`);
            const [service, role] = nodeExpectations[id];
            assert.equal(modelNode.type, service);
            const label = { Process: "Process", DataStore: "Data Store", ExternalInteractor: "External Interactor" }[role];
            assert.ok(label, `${id}: an authored role is required`);
            assert.match(await page.locator(`.react-flow__node-process[data-id="${id}"]`).innerText(),
              new RegExp(label), `${id}: the intended role is rendered`);
            const semanticNode = page.locator(`.react-flow__node-process[data-id="${id}"] .ps-node`);
            assert.match(await semanticNode.getAttribute("class"), new RegExp(`\\bps-dfd-${role}\\b`));
            assert.match(await semanticNode.getAttribute("class"),
              new RegExp(`\\bps-dfd-scope-${role === "ExternalInteractor" ? "external" : "inScope"}\\b`));
            if (service === "azure.databases.sql") assert.match(await semanticNode.innerText(), /Azure SQL/);
          }
          await page.getByRole("button", { name: "Sequence", exact: true }).click();
          for (const id of scenario.edgeIds) {
            const flow = page.locator(`.ps-seq-svg [data-seq-edge="${id}"]`);
            await flow.waitFor({ state: "visible" });
            assert.match(await flow.textContent(), new RegExp(`^${scenario.edgeNumbers[id]}\\b`));
          }
          await page.getByRole("button", { name: "Diagram", exact: true }).click();
        }
        await picker.selectOption("");
        await until(async () => await page.locator(".react-flow__node-process").count() === input.doc.nodes.length, "Show all nodes");
        await page.getByRole("button", { name: "Fit model to view", exact: true }).click();
        await page.waitForFunction(() => {
          const transform = document.querySelector(".react-flow__viewport")?.getAttribute("style");
          const prior = window.sampleViewportStability;
          if (!prior || prior.transform !== transform) {
            window.sampleViewportStability = { transform, since: performance.now() };
            return false;
          }
          return performance.now() - prior.since > 350;
        });
        const showAll = path.join(output, `${file}-show-all.png`);
        await page.screenshot({ path: showAll, fullPage: true });
        observations.screenshots.push(showAll);
        assert.equal(await page.locator(".ps-edge-label").count(), input.doc.edges.length);
        const overview = await page.evaluate(() => {
          const rect = el => {
            const b = el.getBoundingClientRect();
            return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
          };
          return { canvas: rect(document.querySelector(".react-flow")),
            nodes: [...document.querySelectorAll(".react-flow__node-process")].map(el => ({ id: el.dataset.id, ...rect(el) })),
            labels: [...document.querySelectorAll(".ps-edge-label")].map(el => ({ id: el.dataset.edgeId, ...rect(el) })) };
        });
        for (const box of [...overview.nodes, ...overview.labels]) {
          assert.ok(box.x >= overview.canvas.x && box.right <= overview.canvas.right &&
            box.y >= overview.canvas.y && box.bottom <= overview.canvas.bottom, `Show all: ${box.id} is not clipped`);
        }
        if (sampleExpectations[file]) {
          const boxes = [...overview.nodes, ...overview.labels];
          for (let i = 0; i < boxes.length; i++) for (const other of boxes.slice(i + 1)) {
            const box = boxes[i];
            assert.ok(!(Math.min(box.right, other.right) - Math.max(box.x, other.x) > 1 &&
              Math.min(box.bottom, other.bottom) - Math.max(box.y, other.y) > 1),
            `Reference Show all: ${box.id} overlaps ${other.id}: ${JSON.stringify({ box, other })}`);
          }
        }
        await picker.selectOption(input.view.activeScenarioId);
        const saved = await exportModel(page);
        assert.deepEqual(saved.doc, expected,
          "Every authored field, saved definition and measured node size survives all view switches");
        assert.deepEqual(saved.view, input.view);
        await upload(page, modelFixture(), "clear-sample.tma");
        await upload(page, saved, "reopened-sample.tma");
        const reopened = await exportModel(page);
        assert.deepEqual(reopened.doc, saved.doc);
        assert.deepEqual(reopened.view, saved.view);
        await page.locator('button[aria-controls="ps-command-menu-review"]').click();
        await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
        const analyzed = await exportModel(page);
        assert.deepEqual(analyzed.doc.scenarios, saved.doc.scenarios,
          "Analyze must not invent omitted retention data");
        assert.deepEqual(analyzed.doc.issues.filter(issue => !issue.kind), saved.doc.issues.filter(issue => !issue.kind),
          "Authored notes and historical manual issues remain distinct and unchanged");
        assert.deepEqual(analyzed.doc.issues.filter(issue => issue.kind === "Edge_authentication_definition_review")
          .map(issue => issue.targetId).sort(), [...authenticationReminders].sort());
        observations.scenarios = input.doc.scenarios.map(scenario => scenario.name);
        observations.findings = analyzed.doc.issues.map(issue => ({ kind: issue.kind, target: issue.targetId }));
        assert.deepEqual(observations.geometryViolations, [], "Every scenario must remain readable without clipping or overlap");
      });
    });
  }
}
