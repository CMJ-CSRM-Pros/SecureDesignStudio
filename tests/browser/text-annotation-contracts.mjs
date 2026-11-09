import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveKey, modelFixture } from "./fixture.mjs";
import { until } from "./harness.mjs";
import { withAtomicStore, readAtomicStore, commitAtomicStore } from "./dfd-contracts.mjs";

const text = "  Synthetic <img src=x onerror=alert(1)> Ω\n\n Last line  ";
const savedDoc = page => page.evaluate(key => {
  window.dispatchEvent(new Event("pagehide"));
  return JSON.parse(localStorage.getItem(key)).doc;
}, autosaveKey);
const annotationElement = (page, id) => page.locator(`.react-flow__node-annotation[data-id="${id}"]`);

async function measureFixtureBeforeHistory(page) {
  const picker = page.getByRole("combobox", { name: "Scenario", exact: true });
  const previous = await picker.inputValue();
  await picker.selectOption("");
  await until(() => page.evaluate(key => {
    window.dispatchEvent(new Event("pagehide"));
    const doc = JSON.parse(localStorage.getItem(key)).doc;
    const nodes = [...document.querySelectorAll(".react-flow__node-process")];
    return nodes.length === 3 && nodes.every(element => {
      const node = doc.nodes.find(n => n.id === element.getAttribute("data-id"));
      return node?.size?.width === element.offsetWidth && node?.size?.height === element.offsetHeight;
    });
  }, autosaveKey), "All fixture nodes have independently measured geometry before history capture");
  await picker.selectOption(previous);
}

export function registerTextAnnotationContracts({ getHarness, exportModel }) {
  test("usability: text annotations author real typing, preserve drafts, move, resize, delete and recover", async () => {
    await getHarness().run("usability: canvas text annotations", async ({ page }) => {
      await measureFixtureBeforeHistory(page);
      const initial = await savedDoc(page);
      assert.equal(await page.getByRole("menuitem", { name: "New text annotation", exact: true }).count(), 0,
        "The command is not a loose top-bar menuitem");
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.locator("#ps-command-menu-model").getByRole("menuitem", { name: "New text annotation", exact: true }).click();
      const editor = page.getByLabel("Annotation text", { exact: true });
      await editor.waitFor();
      await page.waitForFunction(() => document.activeElement?.id === "ps-inspector-tab-properties");
      await editor.pressSequentially("First");
      await editor.press("Enter");
      await editor.press("Enter");
      await editor.pressSequentially("  second <script> ");
      const typed = await editor.inputValue();
      assert.equal(typed, "First\n\n  second <script> ");
      await page.getByRole("tab", { name: /^Edges/ }).click();
      await page.getByRole("tab", { name: /^Properties/ }).click();
      assert.equal(await editor.inputValue(), typed, "Tab switches preserve unapplied drafts");
      await page.getByRole("button", { name: "Apply text", exact: true }).click();
      const authored = await savedDoc(page), a = authored.textAnnotations[0];
      assert.equal(a.text, typed);
      assert.equal(authored.scenarios.find(s => s.id === "s_primary").textAnnotationIds.includes(a.id), true);
      assert.deepEqual(authored.nodes, initial.nodes);
      assert.deepEqual(authored.edges, initial.edges);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal((await savedDoc(page)).textAnnotations[0].text, "");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), authored, "Apply is a complete atomic document edit");
      assert.equal(await editor.count(), 0, "Ordinary Undo/Redo clears selection under the existing history contract");
      await annotationElement(page, a.id).locator(".ps-text-annotation").click();
      assert.equal(await editor.inputValue(), typed, "Reselecting opens the saved text, not a lost draft");
      await editor.fill(text);
      await page.getByRole("button", { name: "Apply text", exact: true }).click();
      const beforeMove = await savedDoc(page);
      const rendered = annotationElement(page, a.id);
      assert.equal(await rendered.locator("img, script, .react-flow__handle").count(), 0);
      assert.equal(await rendered.locator(".ps-text-annotation-content").textContent(), text);
      const box = await rendered.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 35);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 45, box.y + 65, { steps: 8 });
      await page.mouse.up();
      const moved = await savedDoc(page);
      assert.notDeepEqual(moved.textAnnotations[0].position, beforeMove.textAnnotations[0].position);
      assert.deepEqual(moved.nodes, beforeMove.nodes, "Annotations are never boundary-contained process nodes");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), beforeMove);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), moved);
      await rendered.locator(".ps-text-annotation").click();
      const handle = rendered.locator(".react-flow__resize-control.handle.bottom.right");
      const h = await handle.boundingBox();
      assert.ok(h);
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2 + 25, { steps: 8 });
      await page.mouse.up();
      const resized = await savedDoc(page);
      assert.ok(resized.textAnnotations[0].size.width > moved.textAnnotations[0].size.width);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), moved);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), resized);
      await rendered.locator(".ps-text-annotation").focus();
      await page.keyboard.press("ArrowRight");
      const keyboardMoved = await savedDoc(page);
      assert.equal(keyboardMoved.textAnnotations[0].position.x, resized.textAnnotations[0].position.x + 1);
      await page.keyboard.press("Delete");
      assert.equal((await savedDoc(page)).textAnnotations.length, 0);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), keyboardMoved);
      const exported = await exportModel(page);
      assert.deepEqual(exported.doc, keyboardMoved);
      await page.reload();
      await annotationElement(page, a.id).waitFor();
      assert.deepEqual(await savedDoc(page), keyboardMoved, "Autosave reload retains the entire native document");
    });
  });

  test("regression: annotation store queued history, native/legacy imports, scenario lifecycle and measured updates", async () => {
    await getHarness().run("regression: annotation atomic store", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const before = await readAtomicStore(page);
        const created = await commitAtomicStore(page, () => {
          const s = window.atomicStore;
          window.annotationId = s.createTextAnnotation({ x: 30, y: 40 }).id;
        });
        const id = created.doc.textAnnotations[0].id;
        const expected = structuredClone(before.doc);
        expected.textAnnotations = [{ id, text: "", position: { x: 30, y: 40 }, size: { width: 300, height: 120 } }];
        expected.scenarios.find(s => s.id === "s_primary").textAnnotationIds = [id];
        assert.deepEqual(created.doc, expected);
        const edited = await commitAtomicStore(page, value => {
          const s = window.atomicStore;
          s.setNodeSize("n_api", { width: 201, height: 79 });
          s.updateTextAnnotation(window.annotationId, { text: value });
          s.updateNode("n_api", { title: "Grouped with annotation" });
        }, text);
        const queuedPredecessor = structuredClone(expected);
        queuedPredecessor.nodes.find(n => n.id === "n_api").size = { width: 201, height: 79 };
        const expectedEdit = structuredClone(queuedPredecessor);
        expectedEdit.textAnnotations[0].text = text;
        expectedEdit.nodes.find(n => n.id === "n_api").title = "Grouped with annotation";
        assert.deepEqual(edited.doc, expectedEdit);
        const undone = await commitAtomicStore(page, () => window.atomicStore.undo());
        assert.deepEqual(undone.doc, queuedPredecessor, "The queued nonsnapshot predecessor is retained in full");
        const redone = await commitAtomicStore(page, () => window.atomicStore.redo());
        assert.deepEqual(redone.doc, edited.doc);
        const cloned = await commitAtomicStore(page, () => {
          const s = window.atomicStore;
          window.annotationClone = s.cloneScenario("s_primary", "Annotation copy").id;
        });
        const clone = cloned.doc.scenarios.find(s => s.name === "Annotation copy");
        assert.deepEqual(clone.textAnnotationIds, [id]);
        assert.equal(cloned.doc.textAnnotations.length, 1);
        const deleted = await commitAtomicStore(page, () => window.atomicStore.deleteScenario("s_primary"));
        assert.deepEqual(deleted.doc.textAnnotations, cloned.doc.textAnnotations, "Shared annotation survives scenario deletion");
        const detached = await commitAtomicStore(page, () =>
          window.atomicStore.setTextAnnotationMembership(window.annotationClone, window.annotationId, false));
        const afterDelete = await commitAtomicStore(page, () => window.atomicStore.deleteScenario(window.annotationClone));
        assert.deepEqual(afterDelete.doc.textAnnotations, detached.doc.textAnnotations, "Unrelated detached annotation is not cascade-deleted");
        const wrapped = await commitAtomicStore(page, original =>
          window.atomicStore.importJson({ format: "secure-design-studio-diagram", version: 2, doc: original }), edited.doc);
        assert.deepEqual(wrapped.doc, edited.doc);
        const legacy = await commitAtomicStore(page, original => window.atomicStore.importJson(original), edited.doc);
        assert.deepEqual(legacy.doc, edited.doc);
      });
    });
  });

  test("regression: text-only TM7 public picker previews each omitted flow before replacement and cancel is inert", async () => {
    await getHarness().run("regression: annotation TM7 picker", async ({ page }) => {
      const sid = "72000000-0000-4000-8000-000000000001";
      const aid = "72000000-0000-4000-8000-000000000002";
      const fid = "72000000-0000-4000-8000-000000000003";
      const xml = `<ThreatModel xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><DrawingSurfaceList>
        <DrawingSurfaceModel><Guid>${sid}</Guid><Borders><KeyValueOfguidanyType><Key>${aid}</Key>
        <Value i:type="StencilRectangle"><Guid>${aid}</Guid><GenericTypeId>GE.A</GenericTypeId>
        <Properties><anyType><DisplayName>Name</DisplayName><Value>  &lt;script&gt;\n\n Ω  </Value></anyType></Properties>
        <Left>30</Left><Top>40</Top><Width>320</Width><Height>160</Height></Value></KeyValueOfguidanyType></Borders>
        <Lines><KeyValueOfguidanyType><Key>${fid}</Key><Value i:type="Connector"><Guid>${fid}</Guid><GenericTypeId>GE.DF</GenericTypeId>
        <Properties><anyType><DisplayName>Name</DisplayName><Value>  Unattached label  </Value></anyType></Properties>
        <SourceGuid/><TargetGuid/><SourceX>10</SourceX><SourceY>20</SourceY><TargetX>50</TargetX><TargetY>60</TargetY>
        </Value></KeyValueOfguidanyType></Lines></DrawingSurfaceModel></DrawingSurfaceList></ThreatModel>`;
      await measureFixtureBeforeHistory(page);
      const before = await savedDoc(page);
      const upload = async accept => {
        await page.evaluate(accept => {
          window.confirm = message => { window.annotationConfirmation = message; return accept; };
        }, accept);
        await page.locator('button[aria-controls="ps-command-menu-file"]').click();
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("menuitem", { name: "Threat Modeling Tool (.tm7)…", exact: true }).click();
        await (await chooser).setFiles({ name: "synthetic-text.tm7", mimeType: "application/xml", buffer: Buffer.from(xml) });
        await until(() => page.evaluate(() => Boolean(window.annotationConfirmation)), "Import preview");
      };
      await upload(false);
      assert.deepEqual(await savedDoc(page), before);
      await upload(true);
      await annotationElement(page, aid).waitFor();
      const imported = await savedDoc(page);
      assert.equal(imported.nodes.length, 0); assert.equal(imported.edges.length, 0);
      assert.equal(imported.textAnnotations.length, 2);
      assert.deepEqual(imported.textAnnotations.find(a => a.id === aid),
        { id: aid, text: "  <script>\n\n Ω  ", position: { x: 30, y: 40 }, size: { width: 320, height: 160 } });
      assert.match(await page.evaluate(() => window.annotationConfirmation), /source and target are unattached/);
      assert.equal(imported.textAnnotations.find(a => a.id !== aid).text, "  Unattached label  ");
      const exported = await exportModel(page);
      assert.deepEqual(exported.doc, imported);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), before);
    });
  });

  test("regression: actual store New, legacy Open and history use complete current annotation reconciliation", async () => {
    await getHarness().run("regression: current annotation replacement", async ({ page }) => {
      await withAtomicStore(page, async () => {
        const original = (await readAtomicStore(page)).doc;
        await page.evaluate(async () => {
          const { createYShape } = await import("/src/collab/yDoc.ts");
          const { reconcileCurrentDocumentToY, buildDocFromY } = await import("/src/collab/reconcile.ts");
          window.annotationRoom = createYShape();
          window.publishAnnotationDoc = () => {
            reconcileCurrentDocumentToY(window.annotationRoom, window.atomicStore.doc);
            return buildDocFromY(window.annotationRoom);
          };
        });
        try {
          await commitAtomicStore(page, () => window.atomicStore.createTextAnnotation({ x: 10, y: 20 }));
          assert.equal((await page.evaluate(() => window.publishAnnotationDoc())).textAnnotations.length, 1);
          const opened = await commitAtomicStore(page, doc => window.atomicStore.importJson(doc), original);
          assert.deepEqual(opened.doc, original, "Legacy file keeps its native local empty shape");
          assert.deepEqual((await page.evaluate(() => window.publishAnnotationDoc())).textAnnotations, []);
          await commitAtomicStore(page, () => window.atomicStore.undo());
          assert.equal((await page.evaluate(() => window.publishAnnotationDoc())).textAnnotations.length, 1);
          await commitAtomicStore(page, () => window.atomicStore.redo());
          assert.deepEqual((await page.evaluate(() => window.publishAnnotationDoc())).textAnnotations, []);
          await commitAtomicStore(page, () => window.atomicStore.createTextAnnotation({ x: 10, y: 20 }));
          assert.equal((await page.evaluate(() => window.publishAnnotationDoc())).textAnnotations.length, 1);
          const fresh = await commitAtomicStore(page, () => window.atomicStore.newDocument());
          assert.equal(fresh.doc.textAnnotations, undefined);
          assert.deepEqual((await page.evaluate(() => window.publishAnnotationDoc())).textAnnotations, []);
        } finally {
          await page.evaluate(() => window.annotationRoom.ydoc.destroy());
        }
      });
    });
  });

  test("usability: annotation multi-selection, scenario visibility and narrow Model authoring", async () => {
    await getHarness().run("usability: annotation selection and narrow editor", async ({ page }) => {
      const input = modelFixture();
      input.doc.textAnnotations = [
        { id: "a_first", text: "First plain note\r\n\r\n Ω", position: { x: 100, y: 280 }, size: { width: 230, height: 100 } },
        { id: "a_second", text: "Second plain note", position: { x: 440, y: 280 }, size: { width: 230, height: 100 } },
      ];
      input.doc.scenarios[0].textAnnotationIds = ["a_first", "a_second"];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "annotation-selection.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("annotation-selection.tma", { exact: true }).waitFor();
      await measureFixtureBeforeHistory(page);
      await page.getByRole("button", { name: "Fit model to view", exact: true }).click();
      const before = await savedDoc(page);
      await annotationElement(page, "a_first").locator(".ps-text-annotation").click();
      const sourceEditor = page.getByLabel("Annotation text", { exact: true });
      assert.equal(await sourceEditor.inputValue(), "First plain note\n\n Ω", "The textarea displays the browser-normalized newline representation");
      assert.equal(await page.getByRole("button", { name: "Apply text", exact: true }).isDisabled(), true);
      await sourceEditor.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
      await sourceEditor.pressSequentially("!");
      await page.getByRole("button", { name: "Apply text", exact: true }).click();
      assert.equal((await savedDoc(page)).textAnnotations[0].text, "First plain note\r\n\r\n Ω!", "Real typing preserves the imported CRLF convention");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), before);
      await annotationElement(page, "a_first").locator(".ps-text-annotation").click();
      await annotationElement(page, "a_second").locator(".ps-text-annotation").click({ modifiers: ["ControlOrMeta"] });
      assert.equal(await page.locator(".ps-text-annotation.selected").count(), 2);
      await page.keyboard.press("Delete");
      const deleted = await savedDoc(page);
      const expected = structuredClone(before);
      expected.textAnnotations = [];
      expected.scenarios[0].textAnnotationIds = [];
      assert.deepEqual(deleted, expected, "Multi-delete affects only the two selected notes and their memberships");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual(await savedDoc(page), before, "The compound deletion is one full-model undo");
      const picker = page.getByRole("combobox", { name: "Scenario", exact: true });
      await picker.selectOption("s_archive");
      assert.equal(await page.locator(".react-flow__node-annotation").count(), 0);
      await picker.selectOption("s_primary");
      await until(() => page.locator(".react-flow__node-annotation").count().then(count => count === 2), "Scenario annotations restored");
      assert.deepEqual(await savedDoc(page), before, "Scenario-only navigation does not change annotations or other model fields");
      await page.setViewportSize({ width: 320, height: 720 });
      await page.locator('button[aria-controls="ps-command-menu-model"]').click();
      await page.locator("#ps-command-menu-model").getByRole("menuitem", { name: "New text annotation", exact: true }).click();
      const editor = page.getByLabel("Annotation text", { exact: true });
      await editor.fill("Narrow keyboard note\n\n complete");
      await page.getByRole("button", { name: "Apply text", exact: true }).click();
      assert.equal((await savedDoc(page)).textAnnotations.at(-1).text, "Narrow keyboard note\n\n complete");
      assert.equal(await page.locator(".ps-inspector").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    });
  });
}
