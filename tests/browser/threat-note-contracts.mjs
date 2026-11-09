import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveKey, modelFixture } from "./fixture.mjs";

export function registerThreatNoteContracts({ getHarness, exportModel }) {
  test("regression: TM7 threat-note preflight exposes aggregation, projection and native default risk before download", async () => {
    await getHarness().run("regression: threat note export preflight", async ({ page, observations }) => {
      const input = modelFixture(), doc = input.doc;
      doc.scenarios[1].nodeIds.push("n_client");
      doc.scenarios[1].edgeIds.push("e_request");
      doc.scenarios[1].edgeNumbers.e_request = 7;
      const note = (id, targetKind, targetId, scenarioIds, status, justification) => ({
        id, origin: "authored-threat", targetKind, targetId, scenarioIds, status, justification,
        title: id, description: `Authored ${id}\nMitigation proposal only.`, createdAt: 1, replies: [],
      });
      doc.issues = [
        note("Node note", "node", "n_api", ["s_primary"], "Active", ""),
        note("Flow active", "edge", "e_request", ["s_primary"], "Active", "Supplied reason"),
        note("Flow resolved", "edge", "e_request", ["s_archive"], "Resolved", ""),
      ];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "native-threat-export.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("native-threat-export.tma", { exact: true }).waitFor();
      const before = await exportModel(page);
      await page.evaluate(() => {
        window.threatExportAccepted = false;
        window.threatExportNotice = "";
        window.confirm = message => {
          if (!message.startsWith("Export the supported TM7 drawing projection?")) throw new Error(`Unexpected confirmation: ${message}`);
          window.threatExportNotice = message;
          return window.threatExportAccepted;
        };
      });
      const exportCommand = async () => {
        await page.locator('button[aria-controls="ps-command-menu-file"]').click();
        await page.getByRole("menuitem", { name: /^Microsoft Threat Modeling Tool \(\.tm7\)/ }).click();
      };
      let downloads = 0;
      const countDownload = () => { downloads++; };
      page.on("download", countDownload);
      await exportCommand();
      assert.equal(downloads, 0, "Cancelled preflight produces no download");
      const notice = await page.evaluate(() => window.threatExportNotice);
      assert.match(notice, /aggregated into one native record/);
      assert.match(notice, /projected onto "Primary" only/);
      assert.match(notice, /both current and legacy Priority and display High/);
      assert.match(notice, /not SDS Active\/Resolved/);
      await page.evaluate(() => { window.threatExportAccepted = true; });
      const downloaded = page.waitForEvent("download");
      await exportCommand();
      const chunks = [];
      for await (const chunk of await (await downloaded).createReadStream()) chunks.push(chunk);
      const xml = Buffer.concat(chunks).toString("utf8");
      assert.equal((xml.match(/<a:KeyValueOfstringThreatpc_P0_PhOB>/g) ?? []).length, 2);
      for (const issue of doc.issues) assert.ok(xml.includes(issue.description));
      assert.ok(xml.includes("Supplied reason"));
      assert.ok(xml.includes("SDS severity: Unspecified"));
      page.off("download", countDownload);
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      observations.preflight = notice;
      observations.nativeThreatCount = 2;
    });
  });

  test("regression: authored threat notes preserve native history, recovery and scenario-view geometry", async () => {
    await getHarness().run("regression: authored threat note lifecycle", async ({ page, observations }) => {
      const input = modelFixture();
      // Keep graph membership constant so only scenario-scoped note badges vary.
      for (const scenario of input.doc.scenarios) {
        scenario.nodeIds = input.doc.nodes.map(n => n.id);
        scenario.edgeIds = input.doc.edges.map(e => e.id);
        scenario.edgeNumbers = { e_request: 7, e_parallel: 9, e_archive: 1 };
      }
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "threat-notes.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("threat-notes.tma", { exact: true }).waitFor();
      const geometry = () => page.locator(".react-flow__node-process").evaluateAll(elements => elements.map(element => ({
        id: element.getAttribute("data-id"), width: element.offsetWidth, height: element.offsetHeight,
      })).sort((a, b) => a.id.localeCompare(b.id)));
      const settled = async () => {
        await page.waitForFunction(key => {
          const doc = JSON.parse(localStorage.getItem(key) || "null")?.doc;
          return [...document.querySelectorAll(".react-flow__node-process")].every(element => {
            const node = doc?.nodes.find(n => n.id === element.getAttribute("data-id"));
            return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
          });
        }, autosaveKey);
      };
      await settled();
      const before = await exportModel(page), beforeGeometry = await geometry();
      await page.locator('.react-flow__node-process[data-id="n_api"] .ps-node-title').click();
      const editor = page.locator("#ps-inspector-panel-properties .ps-threat-note-editor");
      await editor.getByRole("button", { name: "Add threat note", exact: true }).press("Enter");
      await editor.getByLabel("Title", { exact: true }).fill("Authored node threat");
      await editor.getByLabel("Threat / mitigation notes", { exact: true }).fill("Threat prose\nMitigation still proposed.");
      await editor.getByLabel("Justification (optional)", { exact: true }).fill("A supplied reason");
      await page.getByRole("tab", { name: /^Issues/ }).click();
      await page.getByRole("tab", { name: /^Properties/ }).click();
      assert.equal(await editor.getByRole("textbox", { name: "Title", exact: true }).inputValue(), "Authored node threat");
      assert.equal(await editor.getByRole("textbox", { name: "Threat / mitigation notes", exact: true }).inputValue(), "Threat prose\nMitigation still proposed.");
      assert.equal(await editor.getByRole("textbox", { name: "Justification (optional)", exact: true }).inputValue(), "A supplied reason");
      await editor.getByRole("button", { name: "Save threat note", exact: true }).press("Enter");
      await editor.getByRole("status").getByText("Threat note added.", { exact: true }).waitFor();
      await settled();
      assert.equal(await editor.getByRole("button", { name: "Add threat note", exact: true })
        .evaluate(element => element === document.activeElement), true, "Rendering a badge does not steal editor focus");
      const saved = await exportModel(page), note = saved.doc.issues.find(i => i.origin === "authored-threat");
      assert.ok(note);
      assert.deepEqual(note.scenarioIds, ["s_primary"]);
      observations.beforeCreationGeometry = beforeGeometry;
      observations.afterCreationGeometry = await geometry();
      assert.deepEqual({ ...saved.doc, issues: before.doc.issues }, before.doc, "Adding a note must not mutate geometry or unrelated model fields");
      assert.deepEqual(await geometry(), beforeGeometry, "Badge authoring must not resize nodes");
      for (const id of ["s_archive", "", "s_primary"]) {
        await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption(id);
        await settled();
        assert.deepEqual(await geometry(), beforeGeometry, `Rendered dimensions remain constant in ${id || "Show all"}`);
        assert.deepEqual((await exportModel(page)).doc, saved.doc, "View-only changes preserve the complete model");
      }
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await settled();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await settled();
      assert.deepEqual((await exportModel(page)).doc, saved.doc);
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: /^Issues\s*\d+$/ }).click();
      const row = page.locator("#ps-inspector-panel-issues .ps-allissues-row").filter({ hasText: "Authored node threat" });
      await row.getByRole("button", { name: "Resolve", exact: true }).click();
      const resolved = await exportModel(page);
      assert.deepEqual(resolved.doc.issues.find(i => i.id === note.id), { ...note, status: "Resolved" });
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || "null")?.doc.issues.some(i => i.status === "Resolved"), autosaveKey);
      await page.reload();
      assert.deepEqual((await exportModel(page)).doc, resolved.doc);
      observations.geometryBefore = beforeGeometry;
      observations.geometryAfter = await geometry();
    });
  });

  test("regression: comment and issue badge counts preserve geometry, full documents and history across scenarios", async () => {
    await getHarness().run("regression: node review badge geometry", async ({ page, observations }) => {
      const input = modelFixture();
      for (const scenario of input.doc.scenarios) {
        scenario.nodeIds = input.doc.nodes.map(node => node.id);
        scenario.edgeIds = input.doc.edges.map(edge => edge.id);
        scenario.edgeNumbers = { e_request: 7, e_parallel: 9, e_archive: 1 };
      }
      input.doc.scenarios.push({ ...structuredClone(input.doc.scenarios[0]), id: "s_without_notes", name: "No notes" });
      const upload = async (model, name) => {
        await page.locator("#ps-file-open-input").setInputFiles({
          name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(model)),
        });
        await page.getByLabel("Document status").getByText(name, { exact: true }).waitFor();
      };
      const geometry = async () => {
        await page.waitForFunction(key => {
          const elements = [...document.querySelectorAll(".react-flow__node-process")];
          const doc = JSON.parse(localStorage.getItem(key) || "null")?.doc;
          return elements.length === 3 && elements.every(element => {
            const node = doc?.nodes.find(item => item.id === element.dataset.id);
            return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
          });
        }, autosaveKey);
        return page.locator(".react-flow__node-process").evaluateAll(elements => elements.map(element => ({
          id: element.dataset.id, width: element.offsetWidth, height: element.offsetHeight,
        })).sort((a, b) => a.id.localeCompare(b.id)));
      };
      await upload(input, "empty-badges.tma");
      const beforeGeometry = await geometry(), before = await exportModel(page);
      observations.beforeGeometry = beforeGeometry;
      observations.badgeScenarios = [];
      const withBadges = structuredClone(before);
      withBadges.doc.comments = [0, 1, 2].map(index => ({
        id: `c_badge_${index}`, targetKind: "node", targetId: "n_api",
        scenarioId: index === 1 ? "s_archive" : "s_primary", status: index ? "Resolved" : "Active",
        text: "Synthetic scenario discussion", createdAt: 1, replies: [],
      }));
      withBadges.doc.issues = [0, 1, 2].map(index => ({
        id: `i_badge_${index}`, targetKind: "node", targetId: "n_api",
        scenarioIds: [index === 1 ? "s_archive" : "s_primary"], status: index ? "Resolved" : "Active",
        title: "Synthetic issue", description: "Keep counts outside node sizing", createdAt: 1, replies: [],
      }));
      await upload(withBadges, "scoped-badges.tma");
      assert.deepEqual(await geometry(), beforeGeometry, "Importing comment/issue badges does not resize nodes");
      const saved = await exportModel(page);
      assert.deepEqual(saved.doc, withBadges.doc, "All imported fields, including sizes, remain exact");
      const cases = [
        ["s_primary", ["1 active issue", "1 open comment", "1 resolved comment", "1 resolved issue"]],
        ["s_archive", ["1 resolved comment", "1 resolved issue"]],
        ["", ["1 active issue", "1 open comment", "2 resolved comments", "2 resolved issues"]],
        ["s_without_notes", []],
      ];
      for (const [scenarioId, titles] of cases) {
        await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption(scenarioId);
        await page.waitForFunction(expected => {
          const node = document.querySelector('.react-flow__node-process[data-id="n_api"]');
          if (!node) return false;
          const badges = node.querySelectorAll(".ps-comment-badge, .ps-issue-badge");
          return JSON.stringify([...badges].map(badge => badge.title).sort()) === JSON.stringify(expected);
        }, titles);
        assert.deepEqual(await geometry(), beforeGeometry, `Badges in ${scenarioId || "Show all"} cannot change geometry`);
        assert.deepEqual((await exportModel(page)).doc, saved.doc, "Scenario views preserve the entire document");
        const bounds = await page.locator('.react-flow__node-process[data-id="n_api"]').evaluate(node => {
          const rect = element => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
          };
          const handle = node.querySelector(".react-flow__handle-bottom");
          const handleBox = handle.getBoundingClientRect();
          const handleHit = document.elementFromPoint(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
          return { title: rect(node.querySelector(".ps-node-title")), semantics: rect(node.querySelector(".ps-node-semantics")),
            handle: rect(handle), handleReachable: handle === handleHit || handle.contains(handleHit),
            badges: [...node.querySelectorAll(".ps-comment-badge, .ps-issue-badge")].map(badge => {
              const box = badge.getBoundingClientRect();
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return { ...rect(badge), reachable: badge === hit || badge.contains(hit) };
            }) };
        });
        observations.badgeScenarios.push({ scenarioId, bounds });
        assert.equal(bounds.handleReachable, true, "The bottom connection handle remains reachable");
        assert.equal(bounds.badges.length, titles.length);
        for (const badge of bounds.badges) {
          assert.ok(badge.bottom > badge.top && badge.right > badge.left, "Count remains rendered");
          assert.equal(badge.reachable, true, "The visible count is not clipped or covered");
          assert.ok(badge.top > bounds.semantics.bottom && badge.top > bounds.title.bottom, "Counts do not cover title or DFD cues");
          assert.ok(badge.top > bounds.handle.bottom, "Counts do not cover the bottom connection handle");
        }
      }
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await geometry(), beforeGeometry);
      assert.deepEqual((await exportModel(page)).doc, before.doc, "Undo restores the full badge-free model");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual(await geometry(), beforeGeometry);
      assert.deepEqual((await exportModel(page)).doc, saved.doc, "Redo restores notes without geometry churn");
      await page.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("s_primary");
      const reviewedNode = page.locator('.react-flow__node-process[data-id="n_api"]');
      for (const title of cases[0][1]) {
        await page.locator('.react-flow__node-process[data-id="n_client"] .ps-node-title').click();
        await reviewedNode.getByTitle(title, { exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.react-flow__node-process[data-id="n_api"]')?.classList.contains("selected"));
        assert.match(await reviewedNode.getAttribute("class"), /selected/, "Badge activation selects its own target");
      }
      const strip = reviewedNode.getByRole("group", { name: "Node comments and issues" });
      assert.match(await strip.getAttribute("class"), /\bnodrag\b/);
      assert.match(await strip.getAttribute("class"), /\bnopan\b/);
      const badgeBox = await reviewedNode.getByTitle("1 active issue", { exact: true }).boundingBox();
      assert.ok(badgeBox);
      await page.mouse.move(badgeBox.x + badgeBox.width / 2, badgeBox.y + badgeBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(badgeBox.x + badgeBox.width / 2 + 5, badgeBox.y + badgeBox.height / 2 + 2, { steps: 3 });
      await page.mouse.up();
      assert.deepEqual((await exportModel(page)).doc, saved.doc, "Interacting with review counts cannot drag the node");
      await page.getByRole("button", { name: "Fit model to view", exact: true }).click();
      const sourceHandle = reviewedNode.locator(".react-flow__handle-bottom");
      const targetHandle = page.locator('.react-flow__node-process[data-id="n_archive"] .react-flow__handle-left');
      await sourceHandle.hover();
      await targetHandle.hover();
      const source = await sourceHandle.boundingBox();
      const target = await targetHandle.boundingBox();
      assert.ok(source && target);
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelectorAll(".react-flow__edge").length === 4);
      const connected = await exportModel(page);
      const newFlow = connected.doc.edges.find(edge => !saved.doc.edges.some(before => before.id === edge.id));
      assert.equal(newFlow?.source, "n_api");
      assert.equal(newFlow?.sourceHandle, "bottom");
      assert.equal(newFlow?.target, "n_archive");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll(".react-flow__edge").length === 3);
      assert.deepEqual((await exportModel(page)).doc, saved.doc, "Handle operation remains one undoable action");
      assert.deepEqual(await geometry(), beforeGeometry);
      observations.beforeGeometry = beforeGeometry;
      observations.finalGeometry = await geometry();
    });
  });

  test("usability: flow threat-note authoring supports blank explanations, narrow controls and Escape", async () => {
    await getHarness().run("usability: threat note controls", async ({ page }) => {
      await page.locator('.ps-edge-label[data-edge-id="e_request"] .ps-edge-num').click();
      const panel = page.locator("#ps-inspector-panel-properties"), editor = panel.locator(".ps-threat-note-editor");
      await editor.getByRole("button", { name: "Add threat note", exact: true }).click();
      await editor.getByLabel("Title", { exact: true }).fill("Flow note");
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      await editor.getByRole("button", { name: "Save threat note", exact: true }).press("Enter");
      const doc = (await exportModel(page)).doc, note = doc.issues.find(i => i.origin === "authored-threat");
      assert.equal(note.targetKind, "edge"); assert.equal(note.targetId, "e_request");
      assert.equal(note.description, ""); assert.equal(note.justification, undefined);
      await editor.getByRole("button", { name: "Add threat note", exact: true }).click();
      await editor.getByLabel("Title", { exact: true }).press("Escape");
      await editor.getByRole("button", { name: "Add threat note", exact: true }).waitFor({ state: "visible" });
      await page.waitForFunction(() =>
        document.querySelector("#ps-inspector-panel-properties .ps-threat-note-editor button") === document.activeElement);
      assert.equal(await editor.getByRole("button", { name: "Add threat note", exact: true }).evaluate(el => el === document.activeElement), true);
      assert.deepEqual((await exportModel(page)).doc, doc, "Cancelled note authoring does not mutate the model");
    });
  });
}
