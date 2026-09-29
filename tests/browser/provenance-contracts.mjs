import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { modelFixture } from "./fixture.mjs";

const notice = JSON.parse(await readFile(new URL("../../src/data/vsdxTemplateNotice.json", import.meta.url), "utf8"));
export function registerProvenanceContracts({ getHarness, exportModel, configured = false }) {
  test(`regression: deprecated-auth guidance is ${configured ? "package-sourced" : "absent from core"} without changing the finding`, async () => {
    await getHarness().run(`regression: ${configured ? "configured" : "core"} analyzer guidance`, async ({ page }) => {
      const input = modelFixture();
      delete input.doc.nodeTypes[0].definition.policyStatus;
      input.doc.nodeTypes[0].definition.allowedAuthMethods = [{ id: "ApiKey", status: "Deprecated" }];
      input.doc.nodeTypes[0].definition.allowedDataTypes = [{ id: "*", retention: "*", action: "Allow" }];
      input.doc.edges[0].authenticationTypes = ["ApiKey"];
      await page.locator("#ps-file-open-input").setInputFiles({
        name: "guidance.tma", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)),
      });
      await page.getByLabel("Document status").getByText("guidance.tma", { exact: true }).waitFor();
      const before = await exportModel(page);
      await page.locator('button[aria-controls="ps-command-menu-review"]').click();
      await page.getByRole("menuitem", { name: "Analyze", exact: true }).click();
      const row = page.locator(".ps-allissues-row").filter({ hasText: "Edge uses auth not accepted by target node" });
      await row.waitFor();
      await row.getByRole("button", { name: "Details", exact: true }).click();
      assert.match(await row.innerText(), /deprecated/);
      const links = row.getByRole("link", { name: /Resolution guidance/ });
      assert.equal(await links.count(), configured ? 1 : 0);
      if (configured) assert.equal(await links.getAttribute("href"), "https://example.invalid/deprecated-auth");
      const analyzed = await exportModel(page);
      const issue = analyzed.doc.issues.find(item => item.kind === "Edge_auth_not_accepted" && item.targetId === "e_request");
      assert.equal(issue.resolutionLink, configured ? "https://example.invalid/deprecated-auth" : undefined);
      assert.equal(issue.status, "Active");
      assert.deepEqual(analyzed.doc.edges, before.doc.edges);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, before.doc);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      assert.deepEqual((await exportModel(page)).doc, analyzed.doc);
    });
  });

  test("usability: template notice is readable with keyboard and travels in the VSDX download", async () => {
    await getHarness().run(`usability: template attribution ${configured ? "configured" : "core"}`, async ({ page }) => {
      await page.getByRole("button", { name: "About", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "About SecureDesignStudio", exact: true });
      const summary = dialog.locator("summary").filter({ hasText: "Visio template notice" });
      await summary.focus();
      await summary.press("Enter");
      const text = summary.locator("..").locator("pre");
      await text.waitFor({ state: "visible" });
      assert.equal(await text.textContent(), notice.notice);
      assert.equal(await dialog.getByRole("link", { name: "Pinned upstream source", exact: true }).getAttribute("href"), notice.sourceUrl);
      await dialog.locator("summary").filter({ hasText: /^Dependency notices/ }).click();
      await dialog.locator("summary").filter({ hasText: /^react 18\.3\.1 / }).click();
      assert.match(await dialog.locator("details").filter({ has: page.locator("summary", { hasText: /^react 18\.3\.1 / }) }).last().innerText(), /Permission is hereby granted/);
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await summary.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.locator('button[aria-controls="ps-command-menu-file"]').click();
      const event = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "Microsoft Visio (.vsdx)…", exact: true }).click();
      const download = await event;
      assert.equal(download.suggestedFilename(), "secure-design-studio-diagram.vsdx");
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const files = unzipSync(Buffer.concat(chunks));
      assert.equal(files["docProps/custom.xml"], undefined);
      assert.equal(files["docProps/thumbnail.emf"], undefined);
      const xml = strFromU8(files["docProps/core.xml"]);
      assert.match(xml, /<dc:creator>SecureDesignStudio<\/dc:creator>/);
      assert.match(xml, /BSD 3-Clause License/);
      assert.match(xml, /Copyright \(c\) 2020, Dave Howard/);
      assert.equal(Object.keys(files).filter(name => /^visio\/pages\/page\d+\.xml$/.test(name)).length, 2);
      await page.getByRole("dialog", { name: "VSDX export complete", exact: true }).getByRole("button", { name: "Got it", exact: true }).click();
    });
  });
}
