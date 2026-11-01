import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { autosaveKey, modelFixture, unavailableIssueFixture, unavailableCatalogFixture, catalogSnapshotFixture, catalogReferenceSnapshot } from "./fixture.mjs";
import { startHarness, until } from "./harness.mjs";
import { registerAuthenticationContracts } from "./authentication-contracts.mjs";
import { registerAssistantLayoutContracts } from "./assistant-layout-contracts.mjs";
import { registerClassificationContracts } from "./classification-contracts.mjs";
import { registerClassificationEditorContracts } from "./classification-editor-contracts.mjs";
import { registerLibraryContracts } from "./libraries-contracts.mjs";
import { registerEndpointContracts } from "./endpoint-contracts.mjs";
import { registerAuthenticationExtractionContracts } from "./authentication-extraction-contracts.mjs";
import { registerNodeMetadataContracts } from "./node-metadata-contracts.mjs";
import { registerInventoryContracts } from "./inventory-contracts.mjs";
import { registerTaxonomyContracts } from "./taxonomy-contracts.mjs";
import { registerPmexpContracts } from "./pmexp-contracts.mjs";
import { registerJsonImportContracts } from "./json-import-contracts.mjs";
import { registerProvenanceContracts } from "./provenance-contracts.mjs";
import { registerDfdContracts } from "./dfd-contracts.mjs";
import { registerTm7Contracts } from "./tm7-contracts.mjs";
import { registerTextAnnotationContracts } from "./text-annotation-contracts.mjs";
import { registerThreatNoteContracts } from "./threat-note-contracts.mjs";
import { registerSampleContracts } from "./sample-contracts.mjs";
import { registerDesignerContracts } from "./designer-contracts.mjs";
import { registerAiGuidanceContracts } from "./ai-guidance-contracts.mjs";
import { unzipSync, strFromU8 } from "fflate";
import { DOMParser } from "@xmldom/xmldom";

let harness;
before(async () => { harness = await startHarness(); });
after(async () => { if (harness) await harness.stop(); });

const node = (page, id) => page.locator(`.react-flow__node-process[data-id="${id}"]`);
const scenario = page => page.getByRole("combobox", { name: "Scenario", exact: true });
const fileMenu = page => page.locator('button[aria-controls="ps-command-menu-file"]');

async function exportModel(page) {
  await fileMenu(page).click();
  await page.getByRole("menuitem", { name: /^Save\s/ }).click();
  const dialog = page.getByRole("dialog", { name: "Save as", exact: true });
  await dialog.getByLabel("File name", { exact: true }).fill("roundtrip.tma");
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "roundtrip.tma");
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

registerAuthenticationContracts({ getHarness: () => harness, exportModel });
registerAssistantLayoutContracts({ getHarness: () => harness });
registerClassificationContracts({ getHarness: () => harness, exportModel });
registerClassificationEditorContracts({ getHarness: () => harness, exportModel });
registerLibraryContracts({ getHarness: () => harness });
registerEndpointContracts({ getHarness: () => harness, exportModel });
registerAuthenticationExtractionContracts({ getHarness: () => harness, exportModel });
registerNodeMetadataContracts({ getHarness: () => harness, exportModel });
registerInventoryContracts({ getHarness: () => harness, exportModel });
registerTaxonomyContracts({ getHarness: () => harness, exportModel });
registerPmexpContracts({ getHarness: () => harness, exportModel });
registerJsonImportContracts({ getHarness: () => harness, exportModel });
registerProvenanceContracts({ getHarness: () => harness, exportModel });
registerDfdContracts({ getHarness: () => harness, exportModel });
registerTm7Contracts({ getHarness: () => harness, exportModel });
registerTextAnnotationContracts({ getHarness: () => harness, exportModel });
registerThreatNoteContracts({ getHarness: () => harness, exportModel });
registerSampleContracts({ getHarness: () => harness, exportModel });
registerDesignerContracts({ getHarness: () => harness });
registerAiGuidanceContracts({ getHarness: () => harness, exportModel });

test("usability: all inspector tabs share one persistent docked, floating and popup surface and workbook", async () => {
  await harness.run("usability: unified inspector presentations", async ({ page }) => {
    const input = modelFixture();
    input.doc.workItems = [{ id: "wi_export", description: "=Work to retain", link: "" }];
    input.doc.comments = [{ id: "c_export", scenarioId: "s_primary", targetKind: "edge", targetId: "e_request",
      status: "Active", createdAt: 0, text: "Comment to retain", replies: [] }];
    input.doc.deviations = [{ id: "dev_export", key: "synthetic", kind: "other", title: "Deviation to retain",
      description: "Synthetic evidence", explanation: "Missing evidence", status: "Active", scenarioIds: [],
      evidenceIds: [], createdAt: 0, updatedAt: 0 }];
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "inspector.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
    });
    const comparison = structuredClone(input);
    comparison.doc.edges[0].title = "Previous flow";
    await page.locator("#ps-file-compare-input").setInputFiles({
      name: "before.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(comparison)),
    });
    await until(() => page.evaluate(key => Boolean(localStorage.getItem(key)), autosaveKey), "inspector fixture autosaved");
    const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey);
    await page.getByRole("tab", { name: /^Comments\b/ }).click();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await page.getByPlaceholder("Reply…", { exact: true }).fill("Unsent reply survives");

    for (const [tab, id] of [
      ["Properties", "properties"], ["Edges", "edges"], ["Issues", "issues"], ["Comments", "comments"],
      ["Deviations", "deviations"], ["Changes", "changes"], ["Data", "data"], ["Work", "work"], ["Findings", "assistant"],
    ]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}\\b`) }).click();
      const panelId = `#ps-inspector-panel-${id}`;
      await page.locator(panelId).evaluate(element => { element.dataset.surfaceIdentity = "same-mounted-panel"; });
      await page.getByRole("combobox", { name: "Inspector display", exact: true }).selectOption("floating");
      const floating = page.getByRole("dialog", { name: "Inspector", exact: true });
      await floating.waitFor();
      assert.equal(await page.locator(".ps-inspector-dock").isVisible(), false);
      assert.equal(await floating.locator(panelId).getAttribute("data-surface-identity"), "same-mounted-panel");
      const pending = page.context().waitForEvent("page");
      await floating.getByRole("combobox", { name: "Inspector display", exact: true }).selectOption("window");
      const child = await pending;
      await child.locator(panelId).waitFor();
      assert.equal(await child.locator(panelId).getAttribute("data-surface-identity"), "same-mounted-panel");
      assert.equal(await child.getByRole("tablist", { name: "Inspector views" }).count(), 1);
      assert.equal(await child.evaluate(() => window.opener), null);
      assert.equal(await child.locator("script").count(), 0, "Popup only receives styles and the existing portal");
      if (id === "comments") {
        assert.equal(await child.getByPlaceholder("Reply…", { exact: true }).inputValue(), "Unsent reply survives");
        await child.getByPlaceholder("Reply…", { exact: true }).fill("Edited in popup");
      }
      if (id === "work" || id === "data" || id === "comments") {
        const dialogPending = child.waitForEvent("dialog", { timeout: 6000 });
        const deleting = id === "comments"
          ? child.getByRole("button", { name: "Delete", exact: true })
          : child.locator(panelId).locator(".ps-data-actions button").first();
        const clickPending = deleting.click();
        const dialog = await dialogPending;
        assert.equal(dialog.type(), "confirm", "Confirmation belongs to the inspector window");
        await dialog.dismiss();
        await clickPending;
      }
      if (id === "data") {
        await child.getByRole("tab", { name: /^Work\b/ }).click();
        await child.getByRole("tab", { name: /^Data\b/ }).click();
        const downloadPending = child.waitForEvent("download");
        await child.getByRole("button", { name: "Export all inspector data (.xlsx)", exact: true }).click();
        const download = await downloadPending;
        assert.equal(download.suggestedFilename(), "secure-design-studio-inspector.xlsx");
        const chunks = [];
        for await (const chunk of await download.createReadStream()) chunks.push(chunk);
        const files = unzipSync(Buffer.concat(chunks));
        const workbook = new DOMParser().parseFromString(strFromU8(files["xl/workbook.xml"]), "application/xml");
        const names = [...workbook.getElementsByTagName("sheet")].map(sheet => sheet.getAttribute("name"));
        for (const name of ["Data", "Work", "Comments", "Edges", "Scenarios", "Deviations", "Changes", "AI findings", "Issues"]) {
          assert.ok(names.includes(name), name);
        }
        assert.match(strFromU8(files[`xl/worksheets/sheet${names.indexOf("Work") + 1}.xml`]), /=Work to retain/);
        assert.match(strFromU8(files[`xl/worksheets/sheet${names.indexOf("Edges") + 1}.xml`]), /Archive payload/,
          "Other scenarios export too");
        assert.match(strFromU8(files[`xl/worksheets/sheet${names.indexOf("Changes") + 1}.xml`]), /Previous flow/);
      }
      await child.close();
      await page.locator(panelId).waitFor();
      assert.equal(await page.getByRole("combobox", { name: "Inspector display", exact: true }).inputValue(), "docked");
      assert.equal(await page.locator(panelId).getAttribute("data-surface-identity"), "same-mounted-panel");
    }
    await page.getByRole("tab", { name: /^Comments\b/ }).click();
    assert.equal(await page.getByPlaceholder("Reply…", { exact: true }).inputValue(), "Edited in popup");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.getByRole("button", { name: "Open inspector", exact: true }).click();
    assert.equal(await page.getByPlaceholder("Reply…", { exact: true }).inputValue(), "Edited in popup",
      "Closing/reopening also preserves unfinished tab drafts");
    const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), autosaveKey);
    assert.deepEqual(after.doc, before.doc);
    assert.deepEqual(after.past, before.past);
    await page.getByRole("tab", { name: /^Changes\b/ }).click();
    const pending = page.context().waitForEvent("page");
    await page.getByRole("combobox", { name: "Inspector display", exact: true }).selectOption("window");
    const child = await pending;
    const confirmation = child.waitForEvent("dialog", { timeout: 6000 });
    const removal = child.getByRole("button", { name: "Remove comparison", exact: true }).click();
    await (await confirmation).accept();
    await removal;
    await until(() => child.locator("#ps-inspector-tab-properties").evaluate(element => element === element.ownerDocument.activeElement),
      "Removing a comparison restores Properties focus inside the popup");
    await child.close();
  });
});

test("regression: catalog selector groups Microsoft, scopes Generic and discovers future sources", async () => {
  await harness.run("regression: catalog source routes", async ({ page }) => {
    const input = modelFixture();
    // Old documents must acquire newly shipped types without losing custom types.
    input.doc.nodeTypes = input.doc.nodeTypes.filter(type => !type.id.startsWith("generic."));
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "old-catalog.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
    });
    const model = page.getByRole("button", { name: "Model", exact: true });
    await model.click();
    assert.equal(await page.getByRole("menuitem", { name: /^(Azure|Generic) Type Catalog/ }).count(), 0);
    await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
    const catalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
    const selector = catalog.getByRole("combobox", { name: "Catalog", exact: true });
    assert.equal(await selector.inputValue(), "all");
    await selector.selectOption({ label: "Document" });
    await catalog.getByRole("button", { name: /Browser test process/ }).waitFor();
    await selector.selectOption({ label: "Generic" });
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 29);
    await catalog.getByRole("searchbox").fill("firewall");
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 2);
    await catalog.getByRole("searchbox").fill("Dataverse");
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 0);
    await catalog.getByText("No node types match this catalog and search.", { exact: true }).waitFor();
    await catalog.getByRole("searchbox").fill("Host (server / VM)");
    await catalog.locator(".ps-catalog-row").click();
    assert.equal(await catalog.getByRole("textbox", { name: "Stable ID", exact: true }).inputValue(), "generic.compute.host");
    assert.match(await catalog.getByRole("textbox", { name: "Guidance content", exact: true }).inputValue(), /Controls to verify\n/);
    assert.equal(await catalog.getByRole("combobox", { name: "Catalog", exact: true }).isDisabled(), true);
    await catalog.getByRole("textbox", { name: "Label", exact: true }).fill("Saved generic host");
    await catalog.getByRole("button", { name: "Save type", exact: true }).click();
    await catalog.getByRole("button", { name: "Close", exact: true }).click();
    await model.click();
    await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
    assert.equal(await selector.inputValue(), "all");
    await selector.selectOption({ label: "Generic" });
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 29);
    await catalog.getByRole("button", { name: /Saved generic host/ }).waitFor();
    await selector.selectOption({ label: "Microsoft" });
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 169);
    for (const id of ["Dataverse", "m365_copilot"]) {
      await catalog.getByRole("searchbox").fill(id);
      assert.ok(await catalog.locator(".ps-catalog-row").count() > 0, id);
    }
    await catalog.getByRole("searchbox").fill("");
    await selector.selectOption("all");
    await catalog.getByRole("searchbox").fill("Browser test process");
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 1);
    await catalog.getByRole("button", { name: "Close", exact: true }).click();
  });
});

test("usability: scoped catalogs support keyboard entry, focus return and narrow layout", async () => {
  await harness.run("usability: scoped catalog navigation", async ({ page }) => {
    const model = page.getByRole("button", { name: "Model", exact: true });
    for (const label of ["Generic", "Microsoft"]) {
      await model.focus();
      await page.keyboard.press("ArrowDown");
      await until(() => page.evaluate(() => document.activeElement?.getAttribute("role") === "menuitem"), "Model menu keyboard focus");
      await page.keyboard.press("N");
      await page.keyboard.press("Enter");
      const catalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
      await catalog.waitFor();
      assert.equal(await catalog.getByRole("searchbox").evaluate(el => el === document.activeElement), true);
      await catalog.getByRole("combobox", { name: "Catalog", exact: true }).selectOption({ label });
      assert.equal(await catalog.locator(".ps-catalog-row").count(), label === "Generic" ? 29 : 169);
      await page.keyboard.press("Escape");
      await until(() => model.evaluate(el => el === document.activeElement), "catalog focus returns to Model");
    }
    await page.setViewportSize({ width: 320, height: 640 });
    await model.click();
    await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
    const catalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
    await catalog.getByRole("combobox", { name: "Catalog", exact: true }).selectOption({ label: "Generic" });
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 29);
    await catalog.getByRole("combobox", { name: "Catalog", exact: true }).selectOption({ label: "Microsoft" });
    assert.equal(await catalog.locator(".ps-catalog-row").count(), 169);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await catalog.getByRole("button", { name: "Close", exact: true }).click();
  });
});

for (const { boundaryType, theme } of ["security", "privacy"].flatMap(boundaryType =>
  ["light", "dark"].map(theme => ({ boundaryType, theme })))) {
  test(`regression: ${boundaryType} boundary moves only from its perimeter, not its empty interior (${theme})`, async () => {
    await harness.run(`regression: ${boundaryType} boundary perimeter interaction (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      if (theme === "dark") {
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("menuitemcheckbox", { name: /Dark Theme/ }).click();
        await page.keyboard.press("Escape");
      }
      const input = modelFixture();
      input.doc.nodes = input.doc.nodes.slice(0, 2);
      input.doc.nodes[0].position = { x: 180, y: 190 };
      input.doc.nodes[1].position = { x: 520, y: 190 };
      input.doc.edges = input.doc.edges.slice(0, 1);
      input.doc.scenarios = input.doc.scenarios.slice(0, 1);
      input.doc.scenarios[0].edgeIds = ["e_request"];
      input.doc.scenarios[0].edgeNumbers = { e_request: 7 };
      input.doc.boundaries = [{
        id: "b_drag", type: boundaryType, title: "Drag perimeter", nodeIds: ["n_client", "n_api"],
        position: { x: 80, y: 80 }, size: { width: 760, height: 460 },
      }];
      input.doc.scenarios[0].boundaryIds = ["b_drag"];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "boundary-drag.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      const boundary = page.locator('.react-flow__node-boundary[data-id="b_drag"]');
      await boundary.waitFor();
      await page.getByRole("button", { name: "Fit model to view", exact: true }).click();
      await page.getByRole("button", { name: /^Reset canvas zoom to 100%/ }).click();
      await until(() => page.locator(".react-flow__viewport").evaluate(el =>
        new DOMMatrix(getComputedStyle(el).transform).a === 1), "exact authored scale after fitting");
      const initialBox = await boundary.boundingBox();
      const canvasBox = await page.locator(".ps-canvas").boundingBox();
      const panX = canvasBox.x + canvasBox.width - 30;
      const panY = canvasBox.y + canvasBox.height - 120;
      await page.mouse.move(panX, panY);
      await page.mouse.down();
      await page.mouse.move(
        panX + canvasBox.x + (canvasBox.width - initialBox.width) / 2 - initialBox.x,
        panY + canvasBox.y + (canvasBox.height - initialBox.height) / 2 - initialBox.y,
        { steps: 10 },
      );
      await page.mouse.up();
      await until(async () => {
        const box = await boundary.boundingBox();
        const canvas = await page.locator(".ps-canvas").boundingBox();
        return box && box.x > canvas.x && box.y > canvas.y &&
          box.x + box.width < canvas.x + canvas.width && box.y + box.height < canvas.y + canvas.height;
      }, "boundary fitted inside canvas");
      const read = () => page.evaluate(async key => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.dispatchEvent(new Event("pagehide"));
        return JSON.parse(localStorage.getItem(key));
      }, autosaveKey);
      const drag = async (x, y, dx, dy) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 10 });
        await page.mouse.up();
      };
      const before = await read();
      let box = await boundary.boundingBox();
      await drag(box.x + box.width * .65, box.y + box.height * .72, 25, 20);
      let state = await read();
      assert.deepEqual(state.doc, before.doc, "Empty interior drag must not move the boundary or its nodes");
      assert.deepEqual(state.past, before.past, "Canvas panning must not create a model history entry");

      // All four border strips must move the boundary and both members together.
      for (const side of ["left", "right", "top", "bottom"]) {
        const prior = await read();
        box = await boundary.boundingBox();
        const x = side === "left" ? box.x + 1 : side === "right" ? box.x + box.width - 1 : box.x + box.width * .72;
        const y = side === "top" ? box.y + 1 : side === "bottom" ? box.y + box.height - 1 : box.y + box.height * .72;
        await drag(x, y, 18, 12);
        state = await read();
        const moved = state.doc.boundaries[0];
        const original = prior.doc.boundaries[0];
        assert.ok(moved.position.x > original.position.x && moved.position.y > original.position.y, `${side} border drag moves`);
        assert.deepEqual(moved.size, original.size, "Border dragging is not resizing");
        for (const n of state.doc.nodes) {
          const old = prior.doc.nodes.find(item => item.id === n.id);
          assert.ok(Math.abs(n.position.x - old.position.x - moved.position.x + original.position.x) < .01);
          assert.ok(Math.abs(n.position.y - old.position.y - moved.position.y + original.position.y) < .01);
        }
        assert.equal(state.past.length, prior.past.length + 1, "One snapshot per perimeter gesture");
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        assert.deepEqual((await read()).doc, prior.doc);
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        assert.deepEqual((await read()).doc, state.doc);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
      }

      await boundary.locator(".ps-boundary-title").click();
      const selected = await read();
      box = await boundary.boundingBox();
      await drag(box.x + box.width * .7, box.y + box.height * .75, -20, -15);
      assert.deepEqual((await read()).doc, selected.doc, "Selected boundary interior also passes through");
      assert.deepEqual((await read()).past, selected.past);
      const edge = page.locator('.react-flow__edge[data-id="e_request"]');
      const edgePoint = await edge.locator(".react-flow__edge-path").evaluate(path => {
        const point = path.getPointAtLength(path.getTotalLength() * .65);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
        return { x: screen.x, y: screen.y };
      });
      await page.mouse.click(edgePoint.x, edgePoint.y);
      await until(() => edge.getAttribute("class").then(value => /\bselected\b/.test(value)), "flow under boundary interior selectable");
      const routed = await read();
      assert.deepEqual(routed.doc.boundaries, selected.doc.boundaries, "Editing the underlying flow must not move the boundary");
      assert.deepEqual(routed.doc.nodes, selected.doc.nodes);
      assert.equal(routed.doc.edges[0].waypoints.length, 1, "The existing flow-line gesture still creates its routing waypoint");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await read()).doc, selected.doc);
      await node(page, "n_client").click();
      const nodeBefore = await read();
      const nodeBox = await node(page, "n_client").boundingBox();
      await drag(nodeBox.x + nodeBox.width * .5, nodeBox.y + nodeBox.height * .75, 20, 12);
      const nodeAfter = await read();
      assert.deepEqual(nodeAfter.doc.boundaries, nodeBefore.doc.boundaries, "Dragging a member inside must not move the boundary");
      assert.notDeepEqual(nodeAfter.doc.nodes[0].position, nodeBefore.doc.nodes[0].position);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await read()).doc, nodeBefore.doc);

      await boundary.locator(".ps-boundary-title").dblclick();
      await boundary.locator(".ps-boundary-title-input").fill("Renamed boundary");
      await boundary.locator(".ps-boundary-title-input").press("Enter");
      await until(async () => (await read()).doc.boundaries[0].title === "Renamed boundary", "boundary title remains editable");
      const resizeBefore = await read();
      const handle = boundary.locator(".ps-boundary-resize-handle.bottom.right");
      const handleBox = await handle.boundingBox();
      assert.ok(handleBox, "Selected boundary keeps its resize handle");
      await drag(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2, 25, 18);
      const resized = await read();
      assert.ok(resized.doc.boundaries[0].size.width > resizeBefore.doc.boundaries[0].size.width);
      assert.deepEqual(resized.doc.nodes, resizeBefore.doc.nodes);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await read()).doc, resizeBefore.doc);
    });
  });
}

test("regression: an outer boundary does not intercept an inner boundary perimeter", async () => {
  await harness.run("regression: nested boundary perimeter", async ({ page }) => {
    const input = modelFixture();
    input.doc.nodes = input.doc.nodes.slice(0, 2);
    input.doc.edges = input.doc.edges.slice(0, 2);
    input.doc.scenarios = input.doc.scenarios.slice(0, 1);
    input.doc.boundaries = [
      { id: "inner", title: "Inner boundary", type: "privacy", nodeIds: ["n_client", "n_api"],
        position: { x: 60, y: 60 }, size: { width: 640, height: 360 } },
      { id: "outer", title: "Outer boundary", type: "security", nodeIds: ["n_client", "n_api"],
        position: { x: 0, y: 0 }, size: { width: 820, height: 520 } },
    ];
    input.doc.scenarios[0].boundaryIds = ["inner", "outer"];
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "nested-boundaries.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
    });
    const inner = page.locator('.react-flow__node-boundary[data-id="inner"]');
    const outer = page.locator('.react-flow__node-boundary[data-id="outer"]');
    await inner.waitFor();
    await page.getByRole("button", { name: "Fit model to view", exact: true }).click();
    await outer.locator(".ps-boundary-title").click();
    const read = () => page.evaluate(async key => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.dispatchEvent(new Event("pagehide"));
      return JSON.parse(localStorage.getItem(key));
    }, autosaveKey);
    const before = await read();
    const box = await inner.boundingBox();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height * .7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 19, box.y + box.height * .7 + 10, { steps: 10 });
    await page.mouse.up();
    const after = await read();
    assert.notDeepEqual(after.doc.boundaries.find(b => b.id === "inner").position, before.doc.boundaries.find(b => b.id === "inner").position);
    assert.deepEqual(after.doc.boundaries.find(b => b.id === "outer"), before.doc.boundaries.find(b => b.id === "outer"));
    assert.equal(after.past.length, before.past.length + 1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual((await read()).doc, before.doc);
  });
});

test("usability: service disclosure reflects credential-free local configuration without destinations or requests", async () => {
  await harness.run("usability: local service disclosure", async ({ page }) => {
    await page.getByRole("button", { name: "About", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "About SecureDesignStudio", exact: true });
    await dialog.getByText("Collaboration is disabled in local-only mode.", { exact: true }).waitFor();
    assert.match(await dialog.innerText(), /Design Assistant is disabled in credential-free local mode/);
    assert.equal(await dialog.locator("code").count(), 0);
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("tab", { name: /^Findings\b/ }).click();
    await page.locator(".ps-service-notice").filter({ hasText: /credential-free local mode/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Analyze model", exact: true }).isDisabled(), true);
  });
});

test("regression: Analyze retains unavailable evidence through UI, native files, history, recovery and reports", async () => {
  await harness.run("regression: unavailable analyzer evidence", async ({ page }) => {
    const input = unavailableIssueFixture();
    const upload = async (model, name) => {
      await page.locator("#ps-file-open-input").setInputFiles({
        name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
      });
      await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
    };
    const openIssues = () => page.getByRole("tab", { name: /^Issues/ }).click();
    const runAnalyze = async () => {
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
    };
    const panel = page.locator(".ps-allissues");
    const retained = panel.locator(".ps-allissues-row").filter({ hasText: "Saved i_unavailable" });
    await upload(input, "unavailable-findings.tma");
    await runAnalyze();
    await panel.getByRole("status").filter({ hasText: "2 not re-evaluated" }).waitFor();
    assert.match(await retained.innerText(), /Resolved[\s\S]*Not re-evaluated: rule unavailable/i);
    assert.equal(await retained.getByRole("link", { name: /Resolution guidance/ }).getAttribute("href"),
      "https://example.invalid/remediation");
    await retained.getByRole("button", { name: "Details", exact: true }).press("Enter");
    await retained.getByText("Saved review decision.", { exact: true }).waitFor();
    assert.match(await retained.innerText(), /Coverage is incomplete/);
    await panel.getByRole("searchbox").fill("not re-evaluated");
    assert.equal(await panel.locator(".ps-allissues-row").count(), 2);
    await panel.getByRole("searchbox").fill("");
    const saved = await exportModel(page);
    for (const [id, reason] of [["i_unavailable", "rule-unavailable"], ["i_policy", "policy-unavailable"]]) {
      assert.deepEqual(saved.doc.issues.find(issue => issue.id === id),
        { ...input.doc.issues.find(issue => issue.id === id), notEvaluatedReason: reason });
    }
    assert.equal(saved.doc.issues.some(issue => issue.id === "i_clear"), false);
    assert.deepEqual(saved.doc.issues.find(issue => issue.id === "i_manual"),
      JSON.parse(JSON.stringify(input.doc.issues.find(issue => issue.id === "i_manual"))));
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await openIssues();
    assert.equal(await panel.locator(".ps-issue-evaluation").count(), 0);
    assert.equal((await exportModel(page)).doc.issues.some(issue => issue.id === "i_clear"), true);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await openIssues();
    assert.deepEqual((await exportModel(page)).doc.issues, saved.doc.issues);
    await upload(saved, "reopened-findings.tma");
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.issues
      ?.find(issue => issue.id === "i_unavailable")?.notEvaluatedReason === "rule-unavailable", autosaveKey);
    await page.reload();
    await openIssues();
    await retained.locator(".ps-issue-evaluation").waitFor();
    assert.deepEqual((await exportModel(page)).doc.issues, saved.doc.issues);
    await page.locator('button[aria-controls="ps-command-menu-export"]').click();
    const reportEvent = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /Review report \(\.html\)/i }).click();
    const chunks = [];
    for await (const chunk of await (await reportEvent).createReadStream()) chunks.push(chunk);
    assert.match(Buffer.concat(chunks).toString("utf8"), /Not re-evaluated: required policy definition unavailable/);
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(await retained.locator(".ps-issue-evaluation").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.locator('.ps-edge-label[data-edge-id="e_request"] .ps-edge-num').click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    await page.locator(".ps-target-issues .ps-allissues-row").filter({ hasText: "Saved i_unavailable" })
      .getByText("Not re-evaluated: rule unavailable", { exact: true }).waitFor();
  });
});

test("regression: failed Analyze leaves document and history unchanged with an explicit diagnostic", async () => {
  await harness.run("regression: atomic analyzer failure", async ({ page }) => {
    const before = await exportModel(page);
    await page.evaluate(async () => {
      const { IssueManager } = await import("/src/IssueManager.ts");
      const original = IssueManager.prototype.analyze;
      IssueManager.prototype.analyze = function () {
        IssueManager.prototype.analyze = original;
        throw new Error("Synthetic evaluator failure");
      };
      const alert = window.alert;
      window.alert = message => {
        window.alert = alert;
        window.analyzerDiagnostic = message;
      };
    });
    const historyBefore = await page.evaluate(key => {
      window.dispatchEvent(new Event("pagehide"));
      const { past, future } = JSON.parse(localStorage.getItem(key));
      return { past, future };
    }, autosaveKey);
    await page.locator('button[aria-controls="ps-command-menu-review"]').click();
    await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
    assert.equal(await page.evaluate(() => window.analyzerDiagnostic),
      "Analyze failed. The model, findings and history were not changed: Synthetic evaluator failure");
    await page.keyboard.press("Escape");
    assert.deepEqual((await exportModel(page)).doc, before.doc);
    const historyAfter = await page.evaluate(key => {
      window.dispatchEvent(new Event("pagehide"));
      const { past, future } = JSON.parse(localStorage.getItem(key));
      return { past, future };
    }, autosaveKey);
    assert.deepEqual(historyAfter, historyBefore);
  });
});

test("regression: saved catalog snapshots override labels and survive native, history and recovery", async () => {
  await harness.run("regression: saved catalog snapshots", async ({ page }) => {
    const upload = async (model, name) => {
      await page.locator("#ps-file-open-input").setInputFiles({
        name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
      });
      await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
    };
    const profileKey = "secure-design-studio:authentication-library:v1";
    const profileBefore = await page.evaluate(key => localStorage.getItem(key), profileKey);
    const input = catalogSnapshotFixture();
    await upload(input, "saved-definitions.tma");
    const notice = page.locator(".ps-catalog-snapshots");
    await notice.locator("summary").press("Enter");
    assert.match(await notice.innerText(), /Differs from installed definition; saved definition retained/);
    assert.match(await notice.innerText(), /example-library @ 1.0.0 \(unverified\)/);
    assert.match(await notice.innerText(), /Document-only definition/);
    await notice.locator("summary").press("Enter");
    await page.getByRole("tab", { name: /^Data/ }).click();
    const classification = page.getByRole("combobox", { name: "Classification for Synthetic request", exact: true });
    assert.equal(await classification.locator("option:checked").textContent(), "Partner restricted data (saved)");
    assert.equal(await classification.locator('option[value="EUII"]').textContent(), "Saved EUII label (saved)");
    assert.match(await page.locator('[data-edge-id="e_request"] .ps-edge-classification-badge').getAttribute("aria-label"),
      /Partner restricted data/);
    const saved = await exportModel(page);
    for (const definition of input.doc.catalogDefinitions) {
      assert.deepEqual(saved.doc.catalogDefinitions.find(item => item.kind === definition.kind && item.id === definition.id), definition);
    }
    await upload(modelFixture(), "without-snapshots.tma");
    await page.getByRole("tab", { name: /^Data/ }).click();
    assert.equal(await classification.locator('option[value="EUII"]').textContent(), "EUII (saved)");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("tab", { name: /^Data/ }).click();
    assert.equal(await classification.locator("option:checked").textContent(), "Partner restricted data (saved)");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await upload(saved, "reopened-snapshots.tma");
    assert.deepEqual((await exportModel(page)).doc, saved.doc);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.catalogDefinitions
      ?.some(def => def.id === "ExampleRestricted"), autosaveKey);
    await page.reload();
    await page.getByRole("tab", { name: /^Data/ }).click();
    assert.equal(await classification.locator("option:checked").textContent(), "Partner restricted data (saved)");
    assert.deepEqual((await exportModel(page)).doc.catalogDefinitions, saved.doc.catalogDefinitions);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), profileKey), profileBefore);
    await page.setViewportSize({ width: 320, height: 640 });
    await notice.locator("summary").press("Enter");
    assert.equal(await notice.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    const withoutAvailableDefinitions = unavailableCatalogFixture();
    withoutAvailableDefinitions.doc.data[1].classification = "AnotherMissingDefinition";
    await upload(withoutAvailableDefinitions, "unknown-only.tma");
    assert.deepEqual((await exportModel(page)).doc.catalogDefinitions, [],
      "An explicit Open without definitions clears the previous document's snapshots");
  });
});

test("regression: invalid catalog snapshots reject atomically and recovery never overwrites corrupt data", async () => {
  await harness.run("regression: invalid catalog snapshot recovery", async ({ page }) => {
    const before = await exportModel(page);
    const invalid = catalogSnapshotFixture();
    invalid.doc.catalogDefinitions[0].script = "not an allowed field";
    await page.evaluate(() => {
      const original = window.alert;
      window.alert = message => {
        window.alert = original;
        if (message !== 'Failed to import JSON: Catalog definitions[0]: unsupported field "script".') {
          throw new Error("Unexpected import diagnostic");
        }
        window.catalogImportRejected = true;
      };
    });
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "invalid.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)),
    });
    await page.waitForFunction(() => window.catalogImportRejected === true);
    assert.deepEqual((await exportModel(page)).doc, before.doc);
    const corrupt = JSON.stringify({ version: 1, doc: invalid.doc, past: [], future: [], view: invalid.view });
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: autosaveKey, value: corrupt });
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "Saved diagram recovery is paused" }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), autosaveKey), corrupt);
    const valid = catalogSnapshotFixture();
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "recovery.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(valid)),
    });
    await page.getByLabel("Document status").getByText("recovery.tma", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").filter({ hasText: "Saved diagram recovery is paused" }).count(), 0);
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) ?? "null")?.doc.catalogDefinitions
      ?.every(def => !("script" in def)), autosaveKey);
  });
});

test("regression: unavailable catalog references survive controls, native save, history and recovery", async () => {
  await harness.run("regression: unavailable catalog references", async ({ page }) => {
    const input = unavailableCatalogFixture();
    input.view.filter.dataClassification = "ExampleRestricted";
    const expected = catalogReferenceSnapshot(input.doc);
    const upload = async (model, name) => {
      await page.locator("#ps-file-open-input").setInputFiles({
        name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
      });
      await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
    };
    await upload(input, "unavailable.tma");
    const filter = page.locator('button[aria-controls="ps-command-menu-filter"]');
    await filter.click();
    const classificationFilter = page.getByRole("combobox", { name: "Data classification", exact: true });
    assert.equal(await classificationFilter.inputValue(), "ExampleRestricted");
    assert.equal(await classificationFilter.locator("option:checked").textContent(), "ExampleRestricted (unresolved)");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.match(await page.locator('[data-edge-id="e_request"] .ps-edge-classification-badge').getAttribute("aria-label"),
      /ExampleRestricted \(unresolved\)/);
    for (const [id, name, value] of [["b_security", "Security subtype", "ExampleSecurity"],
      ["b_privacy", "Privacy subtype", "ExamplePrivacy"]]) {
      await page.locator(`.react-flow__node-boundary[data-id="${id}"] .ps-boundary-title-text`).click();
      const subtype = page.getByRole("combobox", { name, exact: true });
      assert.equal(await subtype.inputValue(), value);
      assert.match(await subtype.locator("option:checked").textContent(), /unresolved/);
    }

    await page.getByRole("tab", { name: /^Data/ }).click();
    const classification = page.getByRole("combobox", { name: "Classification for Synthetic request", exact: true });
    assert.equal(await classification.inputValue(), "ExampleRestricted");
    assert.match(await classification.locator("option:checked").textContent(), /unresolved/);
    await classification.selectOption("System Metadata");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("tab", { name: /^Data/ }).click();
    await until(async () => await classification.inputValue() === "ExampleRestricted", "undo restores unavailable classification");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page.getByRole("tab", { name: /^Data/ }).click();
    await until(async () => await classification.inputValue() === "System Metadata", "redo restores explicit selection");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByRole("tab", { name: /^Data/ }).click();

    await page.getByRole("tab", { name: /^Edges/ }).click();
    await page.getByRole("row", { name: /^Request payload, sequence/ }).click();
    await page.getByRole("tab", { name: /^Properties/ }).click();
    assert.equal(await page.getByRole("combobox", { name: "Tenant", exact: true }).count(), 0,
      "Historical tenant evidence is not exposed as an editable selector");
    assert.equal(await page.getByRole("textbox", { name: "Application ID (GUID)", exact: true }).inputValue(), "",
      "Historical identity evidence is not promoted to the active caller ID");
    const identityEvidence = page.locator("details").filter({ hasText: "Retained identity evidence" });
    await identityEvidence.locator("summary").click();
    await identityEvidence.getByText(/ExampleTenant/).waitFor();
    await identityEvidence.locator("summary").click();
    await page.getByRole("tab", { name: /^Deviations/ }).click();
    assert.equal(await page.locator(".ps-deviation-kind").textContent(), "example-evidence (unresolved)");

    await page.getByRole("button", { name: "Model", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Node Type Catalog/ }).click();
    const catalog = page.getByRole("dialog", { name: "Node type catalog", exact: true });
    await catalog.getByRole("button", { name: /Browser test process/ }).click();
    assert.equal(await catalog.getByRole("combobox", { name: "Classification for data rule 1" }).inputValue(), "ExampleRestricted");
    assert.equal(await catalog.getByRole("combobox", { name: "Privacy boundary", exact: true }).inputValue(), "ExamplePrivacy");
    await catalog.getByRole("textbox", { name: "Label", exact: true }).fill("Renamed synthetic type");
    await catalog.getByRole("button", { name: "Save type", exact: true }).click();
    await catalog.getByRole("button", { name: "Close", exact: true }).click();

    const saved = await exportModel(page);
    assert.deepEqual(catalogReferenceSnapshot(saved.doc), expected);
    assert.equal(saved.view.filter.dataClassification, "ExampleRestricted");
    await upload(modelFixture(), "different.tma");
    await upload(saved, "reopened.tma");
    const reopened = await exportModel(page);
    assert.deepEqual(reopened.doc, saved.doc);
    assert.deepEqual(reopened.view, saved.view);
    await page.waitForFunction(key => {
      const autosave = JSON.parse(localStorage.getItem(key) ?? "null");
      return autosave?.doc.data.some(item => item.classification === "ExampleRestricted");
    }, autosaveKey);
    await page.reload();
    await page.getByRole("tab", { name: /^Data/ }).click();
    assert.equal(await classification.inputValue(), "ExampleRestricted");
    const recovered = await exportModel(page);
    assert.deepEqual(catalogReferenceSnapshot(recovered.doc), expected);
    assert.equal(recovered.view.filter.dataClassification, "ExampleRestricted");
  });
});

test("regression: scenario visibility, parallel flows, sequence view, and native round-trip", async () => {
  await harness.run("regression: model round-trip", async ({ page }) => {
    assert.equal(await page.locator(".react-flow__edge").count(), 2);
    assert.equal(await node(page, "n_archive").count(), 0);
    await scenario(page).selectOption("s_archive");
    await node(page, "n_archive").waitFor({ state: "visible" });
    assert.equal(await node(page, "n_client").count(), 0);
    await page.getByRole("button", { name: "Sequence", exact: true }).click();
    const sequenceFlow = page.locator('.ps-seq-svg [data-seq-edge="e_archive"]');
    await sequenceFlow.waitFor({ state: "visible" });
    assert.match(await sequenceFlow.textContent(), /Archive payload/);
    await page.getByRole("button", { name: "Diagram", exact: true }).click();
    await scenario(page).selectOption("s_primary");
    const exported = await exportModel(page);
    assert.equal(exported.format, "secure-design-studio-diagram");
    assert.equal(exported.version, 2);
    const expected = modelFixture().doc;
    assert.deepEqual(exported.doc.edges.map(({ id, source, target }) => ({ id, source, target })),
      expected.edges.map(({ id, source, target }) => ({ id, source, target })));
    for (const original of expected.scenarios) {
      const actual = exported.doc.scenarios.find(item => item.id === original.id);
      for (const key of ["nodeIds", "edgeIds", "edgeNumbers", "edgeRequestData", "edgeResponseData"]) {
        assert.deepEqual(actual[key], original[key], `${original.name}.${key}`);
      }
    }
    const empty = modelFixture();
    for (const field of ["nodes", "edges", "scenarios", "boundaries", "data", "comments", "issues", "workItems"]) {
      empty.doc[field] = [];
    }
    empty.view.activeScenarioId = null;
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "empty.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(empty)),
    });
    await until(async () => (await page.locator(".react-flow__node-process").count()) === 0 &&
      (await page.locator(".react-flow__edge").count()) === 0, "model cleared before reopening");
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "roundtrip.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)),
    });
    await until(() => page.locator(".react-flow__edge").count().then(count => count === 2), "reopened parallel flows");
    assert.equal(await scenario(page).inputValue(), exported.view.activeScenarioId);
    const reopened = await exportModel(page);
    assert.deepEqual(reopened.doc, exported.doc, "Reopening restores the complete canonical model");
    assert.deepEqual(reopened.view, exported.view, "Reopening restores the saved view");
  });
});

test("regression: editing, undo, redo, autosave, and reload retain the current model", async () => {
  await harness.run("regression: history and recovery", async ({ page }) => {
    await node(page, "n_client").click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Edited client");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await until(() => node(page, "n_client").innerText().then(text => text.includes("Client")), "undo title");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await until(() => node(page, "n_client").innerText().then(text => text.includes("Edited client")), "redo title");
    await page.waitForFunction(key => {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      return saved?.doc.nodes.some(item => item.id === "n_client" && item.title === "Edited client");
    }, autosaveKey);
    await page.reload();
    await node(page, "n_client").waitFor({ state: "visible" });
    assert.match(await node(page, "n_client").innerText(), /Edited client/);
    assert.equal(await scenario(page).inputValue(), "s_primary");
  });
});

test("regression: creating an edge is one undoable history action", async () => {
  await harness.run("regression: edge creation history", async ({ page }) => {
    const source = node(page, "n_client").locator(".react-flow__handle-right");
    const target = node(page, "n_api").locator(".react-flow__handle-left");
    const sourceBounds = await source.boundingBox();
    const targetBounds = await target.boundingBox();
    assert.ok(sourceBounds && targetBounds, "Connection handles are visible");

    await page.mouse.move(
      sourceBounds.x + sourceBounds.width / 2,
      sourceBounds.y + sourceBounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBounds.x + targetBounds.width / 2,
      targetBounds.y + targetBounds.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();

    await until(() => page.locator(".react-flow__edge").count().then(count => count === 3),
      "parallel edge created");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await until(() => page.locator(".react-flow__edge").count().then(count => count === 2),
      "edge creation undone in one step");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await until(() => page.locator(".react-flow__edge").count().then(count => count === 3),
      "edge creation redone in one step");
  });
});

test("regression: inert room fragments and editing without network connectivity", async () => {
  await harness.run("regression: offline local-only behavior", async ({ page, context }) => {
    assert.equal(new URL(page.url()).hash, "#room=synthetic-test-room&key=synthetic-test-key");
    await context.setOffline(true);
    await node(page, "n_client").click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Offline client");
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.doc.nodes
      .some(item => item.id === "n_client" && item.title === "Offline client"), autosaveKey);
    const caches = await page.evaluate(async () => ({
      storage: Object.keys(localStorage),
      databases: (await indexedDB.databases()).map(database => database.name || ""),
    }));
    assert.ok(![...caches.storage, ...caches.databases].some(name => /(?:privsec|secure-design-studio):collab:/.test(name)));
    assert.equal(await page.getByRole("menuitem", { name: /Start collaboration|Copy collaboration link/ }).count(), 0);
  }, { hash: "#room=synthetic-test-room&key=synthetic-test-key" });
});

test("regression: light theme defaults, saved choices, and preference reset", async () => {
  await harness.run("regression: light theme preferences", async ({ page }) => {
    const settings = page.getByRole("button", { name: "Settings", exact: true });
    const preferenceKey = "ps-ui-preferences-v2";
    const isDark = () => page.locator(".ps-shell")
      .evaluate(element => element.classList.contains("ps-theme-dark"));
    assert.equal(await isDark(), false, "Fresh profiles default to light mode");

    for (const dark of [true, false]) {
      await settings.click();
      const option = page.getByRole("menuitemcheckbox", { name: /Dark Theme/ });
      await option.click();
      await until(async () => await isDark() === dark, "chosen theme rendered");
      assert.equal(await option.getAttribute("aria-checked"), String(dark));
      await page.waitForFunction(({ key, dark }) =>
        JSON.parse(localStorage.getItem(key) || "null")?.darkTheme === dark,
      { key: preferenceKey, dark });
      await page.reload();
      await page.locator(".ps-shell").waitFor();
      assert.equal(await isDark(), dark, "Explicit theme choices survive reload");
    }

    await settings.click();
    await page.getByRole("menuitemcheckbox", { name: /Dark Theme/ }).click();
    assert.equal(await isDark(), true);
    await page.getByRole("menuitem", { name: "Reset all preferences", exact: true }).click();
    await until(async () => !await isDark(), "Reset restores light mode");
    await page.waitForFunction(key =>
      JSON.parse(localStorage.getItem(key) || "null")?.darkTheme === false, preferenceKey);
    await page.reload();
    await page.locator(".ps-shell").waitFor();
    assert.equal(await isDark(), false, "Reset light theme survives reload");
  });
});

test("regression: light theme fallback for missing or invalid saved theme", async () => {
  await harness.run("regression: light theme fallback", async ({ page }) => {
    for (const raw of ['{"inspectorWidth":560}', '{"darkTheme":"true"}', "{invalid", "null"]) {
      await page.evaluate(value => localStorage.setItem("ps-ui-preferences-v2", value), raw);
      await page.reload();
      await page.locator(".ps-shell").waitFor();
      assert.equal(await page.locator(".ps-shell.ps-theme-dark").count(), 0,
        "Missing, invalid or malformed preferences use the light default");
    }
  });
});

test("usability: File menu keyboard navigation and focus return", async () => {
  await harness.run("usability: keyboard command navigation", async ({ page }) => {
    const trigger = fileMenu(page);
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("menu").waitFor({ state: "visible" });
    await until(() => page.locator(":focus").innerText().then(text => /New/.test(text)), "first menu item focus");
    await page.keyboard.press("ArrowDown");
    await until(() => page.locator(":focus").innerText().then(text => /Open/.test(text)), "next menu item focus");
    await page.keyboard.press("ArrowDown");
    await until(() => page.locator(":focus").innerText().then(text => /Design with AI/.test(text)), "AI builder follows Open");
    await page.keyboard.press("Enter");
    const designer = page.getByRole("dialog", { name: "Threat Model Designer", exact: true });
    await designer.waitFor();
    await page.keyboard.press("Escape");
    await designer.waitFor({ state: "detached" });
    await until(() => trigger.evaluate(element => element === document.activeElement), "AI builder returns focus to File");
    await page.keyboard.press("ArrowDown");
    await until(() => page.locator(":focus").innerText().then(text => /New/.test(text)), "reopened menu receives initial focus");
    await page.keyboard.press("End");
    await until(() => page.locator(":focus").innerText().then(text => /Compare/.test(text)), "last menu item focus");
    await page.keyboard.press("Escape");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await until(() => trigger.evaluate(element => element === document.activeElement), "File focus return");
  });
});

test("usability: filters stage changes, cancel, apply with Enter, and clear immediately", async () => {
  await harness.run("usability: staged filters", async ({ page }) => {
    const trigger = page.getByRole("button", { name: /^Filter,/ });
    await trigger.click();
    let dialog = page.getByRole("dialog", { name: "Filter model" });
    await dialog.getByRole("searchbox").fill("Client");
    assert.equal(await page.locator(".react-flow__node-process").count(), 2);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Filter model" });
    assert.equal(await dialog.getByRole("searchbox").inputValue(), "");
    await dialog.getByRole("searchbox").fill("Client");
    await dialog.getByRole("searchbox").press("Enter");
    await until(() => page.locator(".react-flow__node-process").count().then(count => count === 1), "applied filter");
    assert.equal(await trigger.getAttribute("aria-label"), "Filter, 1 active");
    await trigger.click();
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await until(() => page.locator(".react-flow__node-process").count().then(count => count === 2), "cleared filter");
    assert.equal(await dialog.isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  });
});

const layouts = ["light", "dark"].flatMap(theme =>
  [320, 375, 480, 768, 1024, 1366].map(width => ({ theme, width })));
for (const { theme, width } of layouts) {
  test(`usability: responsive reflow and reachable controls at ${width}px (${theme})`, async () => {
    await harness.run(`usability: responsive controls at ${width}px (${theme})`, async ({ page, observations }) => {
      await node(page, "n_client").click();
      const settings = page.getByRole("button", { name: "Settings", exact: true });
      await settings.click();
      const themeOption = page.getByRole("menuitemcheckbox", { name: /Dark Theme/ });
      if ((await themeOption.getAttribute("aria-checked") === "true") !== (theme === "dark")) {
        await themeOption.click();
      }
      await until(() => page.locator(".ps-shell").evaluate(element => element.classList.contains("ps-theme-dark"))
        .then(dark => dark === (theme === "dark")), "requested color theme");
      observations.theme = theme;
      if (await settings.getAttribute("aria-expanded") === "true") await settings.click();
      const reopenBeforeResize = page.getByRole("button", { name: "Open inspector", exact: true });
      if (await reopenBeforeResize.isVisible()) await reopenBeforeResize.click();
      await page.setViewportSize({ width, height: 900 });
      const close = page.getByRole("button", { name: "Close inspector", exact: true });
      await close.waitFor({ state: "visible" });
      await until(async () => {
        observations.reflow = await page.evaluate(() => ({
          viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        }));
        return observations.reflow.viewport === width && observations.reflow.scrollWidth <= width + 1;
      }, `No page-level horizontal overflow at ${width}px`);
      for (const locator of [close, fileMenu(page), scenario(page),
        ...["Model", "Review", "View", "Settings"].map(name => page.getByRole("button", { name, exact: true })),
        page.getByRole("button", { name: /^Filter,/ }),
        page.getByRole("button", { name: "Zoom in", exact: true }),
        page.getByRole("button", { name: "Zoom out", exact: true })]) {
        const bounds = await locator.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 &&
          bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 901,
        `${locator} must be within the viewport at ${width}px`);
        await locator.click({ trial: true });
      }
      const controls = await page.getByRole("group", { name: "Canvas zoom controls" }).boundingBox();
      const canvas = await page.locator(".ps-canvas").boundingBox();
      assert.ok(controls.x >= canvas.x && controls.x - canvas.x <= 24, "Zoom controls remain left anchored");
      if (width <= 640) {
        const inspector = await page.locator(".ps-inspector").boundingBox();
        assert.ok(controls.y + controls.height <= inspector.y, "Zoom controls stay above the bottom sheet");
      }
      await close.click();
      const reopen = page.getByRole("button", { name: "Open inspector", exact: true });
      await until(() => reopen.evaluate(element => element === document.activeElement), "inspector focus return");
      await reopen.click();
      await close.waitFor({ state: "visible" });
    });
  });
}

test("usability: inspector keyboard tabs, pinning, and keyboard resizing", async () => {
  await harness.run("usability: inspector interactions", async ({ page }) => {
    await node(page, "n_client").click();
    const properties = page.getByRole("tab", { name: "Properties", exact: true });
    await properties.focus();
    await page.keyboard.press("ArrowRight");
    const edges = page.getByRole("tab", { name: /^Edges/ });
    assert.equal(await edges.getAttribute("aria-selected"), "true");
    await node(page, "n_api").click();
    assert.equal(await edges.getAttribute("aria-selected"), "true", "Edges intentionally keeps its context on selection");
    const issues = page.getByRole("tab", { name: /^Issues/ });
    await issues.click();
    await page.getByRole("button", { name: "Pin inspector tab", exact: true }).click();
    await node(page, "n_client").click();
    assert.equal(await issues.getAttribute("aria-selected"), "true");
    await page.getByRole("button", { name: "Unpin inspector tab", exact: true }).click();
    await node(page, "n_api").click();
    await until(() => properties.getAttribute("aria-selected").then(value => value === "true"), "unpinned selection follows Properties");
    const resize = page.getByRole("separator", { name: "Resize inspector" });
    await resize.focus();
    const before = Number(await resize.getAttribute("aria-valuenow"));
    const minimum = Number(await resize.getAttribute("aria-valuemin"));
    const maximum = Number(await resize.getAttribute("aria-valuemax"));
    assert.ok(maximum > minimum, "Desktop inspector exposes a resizable range");
    const grow = before < maximum;
    const expected = grow ? Math.min(maximum, before + 16) : Math.max(minimum, before - 16);
    await page.keyboard.press(grow ? "ArrowLeft" : "ArrowRight");
    await until(() => resize.getAttribute("aria-valuenow").then(value => Number(value) === expected), "bounded keyboard resize");
    const after = Number(await resize.getAttribute("aria-valuenow"));
    assert.notEqual(after, before, "Keyboard resizing changes the width within its declared limits");
    const rendered = await page.locator(".ps-inspector").boundingBox();
    assert.ok(Math.abs(rendered.width - after) <= 2, "ARIA width agrees with the rendered width");
  });
});

test("regression: deviations require and only allow explanation edits", async () => {
  await harness.run("regression: deviations", async ({ page }) => {
    assert.equal(await page.getByRole("tab", { name: /^Deviations/ }).count(), 0);
    assert.equal(
      await page.getByLabel("Quick actions").getByRole("button", { name: /^Deviations/ }).count(),
      0,
    );
    await page.locator('button[aria-controls="ps-command-menu-review"]').click();
    assert.equal(
      await page.locator("#ps-command-menu-review")
        .getByRole("menuitem", { name: /^Deviations/ }).count(),
      0,
    );
    await page.locator('button[aria-controls="ps-command-menu-review"]').click();
    await page.locator('button[aria-controls="ps-command-menu-view"]').click();
    assert.equal(
      await page.locator("#ps-command-menu-view")
        .getByRole("menuitem", { name: "Deviations", exact: true }).count(),
      0,
    );
    await page.locator('button[aria-controls="ps-command-menu-view"]').click();
    const withDeviation = modelFixture();
    withDeviation.doc.deviations = [{
      id: "dev_imported",
      key: "coverage:network-endpoint:imported.example.test",
      kind: "network-endpoint",
      title: "Imported endpoint deviation",
      description: "Imported evidence details.",
      explanation: "Imported reviewer explanation.",
      status: "Active",
      evidenceIds: ["network-record-imported"],
      sampleCalls: [
        { source: "api-service", destination: "https://one.example.test/v1/call", count: 12 },
        { source: "worker-service", destination: "https://two.example.test/v2/call", count: 8 },
        { source: "job-service", destination: "three.example.test", count: 3 },
      ],
      scenarioIds: [],
      createdAt: 1,
      updatedAt: 1,
    }];
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "with-deviation.tma",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(withDeviation)),
    });
    const deviationsTab = page.getByRole("tab", { name: /^Deviations/ });
    await deviationsTab.waitFor();
    await page.getByLabel("Quick actions")
      .getByRole("button", { name: /^Deviations/ }).waitFor();
    await deviationsTab.click();
    const importedRow = page.locator(".ps-deviation-row").filter({
      hasText: "Imported endpoint deviation",
    });
    await importedRow.getByRole("button", {
      name: "View sample calls",
      exact: true,
    }).click();
    const sampleDialog = page.getByRole("dialog", { name: "Sample calls", exact: true });
    await sampleDialog.getByText("https://one.example.test/v1/call", {
      exact: true,
    }).waitFor();
    assert.equal(await sampleDialog.getByRole("row").count(), 4);
    await sampleDialog.getByRole("button", { name: "Close", exact: true }).click();
    await importedRow.getByRole("button", {
      name: "View sample calls",
      exact: true,
    }).waitFor();
    await page.getByRole("button", { name: "Add deviation", exact: true }).click();
    await page.getByLabel("Stable key", { exact: true }).fill(
      "coverage:network-endpoint:api.example.test",
    );
    await page.locator(".ps-deviation-create select").selectOption("network-endpoint");
    await page.getByLabel("Title", { exact: true }).fill("Missing external endpoint");
    await page.getByLabel("Evidence details", { exact: true }).fill(
      "Network evidence observed api.example.test.",
    );
    await page.getByLabel("Evidence IDs", { exact: true }).fill("network-record-123");
    await page.getByRole("button", { name: "Create deviation", exact: true }).click();
    await page.getByRole("alert").getByText("Deviation explanation is required.").waitFor();
    await page.getByLabel(/^Explanation/).fill(
      "Track until the endpoint and flow are represented.",
    );
    await page.getByRole("button", { name: "Create deviation", exact: true }).click();
    await page.getByText("Missing external endpoint", { exact: true }).waitFor();
    const row = page.locator(".ps-deviation-row").filter({
      hasText: "Missing external endpoint",
    });
    assert.equal(await row.getByText(/^Key:/).count(), 0);
    assert.equal(await row.getByText(/^Evidence:/).count(), 0);
    await row.getByText("Network evidence observed api.example.test.", {
      exact: true,
    }).waitFor();
    assert.equal(await row.getByRole("button", { name: "Edit", exact: true }).count(), 0);
    assert.equal(await row.getByRole("button", { name: "Resolve", exact: true }).count(), 0);
    assert.equal(await row.getByRole("button", { name: "Reopen", exact: true }).count(), 0);
    assert.equal(await row.getByRole("button", { name: "Delete", exact: true }).count(), 0);
    await row.getByText("Active", { exact: true }).waitFor();
    await row.getByRole("button", { name: "Explain", exact: true }).click();
    const editor = page.locator(".ps-deviation-row");
    const explanation = editor.getByLabel(/^Explanation/);
    await explanation.fill("Retain until the endpoint and flow are represented.");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await row.getByText(
      "Explanation: Retain until the endpoint and flow are represented.",
      { exact: true },
    ).waitFor();
    const empty = modelFixture();
    await page.locator("#ps-file-open-input").setInputFiles({
      name: "without-deviations.tma",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(empty)),
    });
    await until(
      () => page.getByRole("tab", { name: /^Deviations/ }).count().then(count => count === 0),
      "deviations tab hidden for empty model",
    );
    await until(
      () => page.getByRole("tab", { name: "Properties", exact: true })
        .getAttribute("aria-selected").then(value => value === "true"),
      "inspector falls back after deviations disappear",
    );
  });
});
