import assert from "node:assert/strict";
import { test } from "node:test";
import { until } from "./harness.mjs";

async function bounds(locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      scrollTop: element.scrollTop, overflowY: getComputedStyle(element).overflowY,
    };
  });
}

function assertInside(inner, outer, label) {
  assert.ok(inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1 &&
    inner.left >= outer.left - 1 && inner.right <= outer.right + 1, label);
}

async function assistantLayout(page, content) {
  const panel = page.locator("#ps-inspector-panel");
  const compact = await page.locator(".ps-assistant-surface-body").evaluate(element => {
    const style = getComputedStyle(element);
    return element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) <= 440;
  });
  return {
    panel, compact,
    scroller: compact || await content.evaluate(element => element.classList.contains("ps-assistant-analysis"))
      ? page.locator(".ps-assistant") : content,
  };
}

export async function exerciseAnalysisLayout({ page, observations }, { width, height }) {
  await page.setViewportSize({ width, height });
  await page.getByRole("tab", { name: /^Findings\b/ }).click();
  const analysis = page.locator(".ps-assistant-analysis");
  observations.initialAnalysis = await bounds(analysis);
  await analysis.waitFor({ state: "visible" });
  if (width === 1366 && height === 900) {
    const intro = await page.locator(".ps-assistant-analysis-intro").boundingBox();
    assert.ok(intro.height < 350, "A short analysis stays content-sized, not stretched to fill the inspector");
  }

  // Layout-only fixture in the real mounted inspector. Do not enable local AI,
  // replace request guards, or claim coverage of inference/finding actions.
  await analysis.evaluate(element => {
    const findings = document.createElement("div");
    findings.className = "ps-assistant-findings";
    findings.setAttribute("aria-live", "polite");
    const heading = document.createElement("h3");
    heading.textContent = "AI findings 10";
    findings.append(heading);
    for (let index = 1; index <= 10; index += 1) {
      const article = document.createElement("article");
      article.className = "ps-assistant-finding";
      const severity = document.createElement("div");
      severity.className = "ps-assistant-finding-heading";
      for (const value of ["high", "Synthetic layout finding"]) {
        const span = document.createElement("span");
        span.textContent = value;
        severity.append(span);
      }
      const title = document.createElement("h4");
      title.textContent = `Synthetic finding ${index}`;
      const rationale = document.createElement("p");
      rationale.textContent = "Synthetic scenario evidence for scroll coverage. ".repeat(4);
      const label = document.createElement("strong");
      label.textContent = "Recommended action";
      const recommendation = document.createElement("p");
      recommendation.textContent = "Review this synthetic boundary and its controls. ".repeat(3);
      const actions = document.createElement("div");
      actions.className = "ps-assistant-actions";
      for (const text of ["Focus", "Create issue", "Create work item"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        actions.append(button);
      }
      article.append(severity, title, rationale, label, recommendation, actions);
      findings.append(article);
    }
    element.append(findings);
  });
  const { panel, compact, scroller } = await assistantLayout(page, analysis);
  observations.compact = compact;
  observations.analysis = await bounds(analysis);
  observations.scroller = await bounds(scroller);
  assert.ok(observations.analysis.clientHeight > 0, "Analysis has usable space");
  assert.ok(observations.scroller.scrollHeight > observations.scroller.clientHeight,
    "Multiple findings overflow a usable scrolling region");
  assert.equal(observations.scroller.overflowY, "auto", "The active layout owns vertical scrolling");
  assertInside(observations.scroller, await bounds(panel), "The scroller is bounded by the inspector");
  assert.equal(observations.analysis.overflowY, "visible", "Results do not create a nested scroller");
  const fixedHeaders = [
    page.locator(".ps-inspector-header"), page.getByRole("tablist", { name: "Inspector views" }),
    page.locator(".ps-assistant-surface-bar"),
  ];
  const fixedBounds = await Promise.all(fixedHeaders.map(bounds));
  await scroller.hover();
  await page.mouse.wheel(0, 500);
  await until(() => scroller.evaluate(element => element.scrollTop > 0), "wheel scrolls analysis");
  assert.deepEqual(await Promise.all(fixedHeaders.map(bounds)), fixedBounds,
    "Inspector headers and display/export controls stay fixed");
  assert.equal((await bounds(panel)).scrollTop, 0, "The outer inspector does not scroll");

  await scroller.evaluate(element => { element.scrollTop = 0; });
  const actions = analysis.locator(".ps-assistant-actions button");
  await actions.first().focus();
  for (let index = 1; index < await actions.count(); index += 1) {
    await page.keyboard.press("Tab");
  }
  const last = actions.last();
  assert.equal(await last.evaluate(element => element === document.activeElement), true,
    "Tab reaches the last finding action");
  assertInside(await bounds(last), await bounds(scroller), "The last action scrolls fully into view");
  await last.click({ trial: true });
  observations.keyboardScrollTop = (await bounds(scroller)).scrollTop;
  assert.ok(observations.keyboardScrollTop > 0, "Keyboard navigation scrolls analysis, not its parent");
  assert.deepEqual(await Promise.all(fixedHeaders.map(bounds)), fixedBounds,
    "Keyboard scrolling preserves the fixed headers");

  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  assert.equal(await analysis.isVisible(), false, "Inactive Assistant is hidden");
  assert.equal(await page.locator(".ps-assistant-finding:visible").count(), 0);
  await page.getByRole("tab", { name: /^Findings\b/ }).click();
  assert.equal(await analysis.locator(".ps-assistant-finding").count(), 10,
    "Inspector tab switches keep the analysis subtree mounted");
  assert.equal((await bounds(scroller)).scrollTop, observations.keyboardScrollTop,
    "Inspector tab switches retain analysis scroll position");
  observations.page = await page.evaluate(() => ({
    width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(observations.page.scrollWidth <= width + 1, "No page-level horizontal overflow");
}

async function exerciseChatLayout({ page, observations }) {
  const modes = page.getByRole("tablist", { name: "Design Assistant modes" });
  await modes.getByRole("tab", { name: "Chat", exact: true }).click();
  const conversation = page.locator(".ps-assistant-conversation");
  const composer = page.locator(".ps-assistant-composer");
  const { panel, compact, scroller } = await assistantLayout(page, conversation);
  const composerBefore = await bounds(composer);
  observations.composer = composerBefore;
  observations.chat = await bounds(conversation);
  assert.ok(observations.chat.clientHeight > 0, "Chat conversation never collapses to zero");
  assert.equal(observations.chat.overflowY, compact ? "visible" : "auto");
  const scrollBounds = await bounds(scroller);
  assert.ok(scrollBounds.scrollHeight > scrollBounds.clientHeight, "Chat suggestions exercise overflow");
  if (!compact) assertInside(composerBefore, await bounds(panel), "Chat composer remains visible");
  await scroller.hover();
  await page.mouse.wheel(0, 500);
  await until(() => scroller.evaluate(element => element.scrollTop > 0), "Chat scrolls");
  if (compact) {
    await scroller.focus();
    await page.keyboard.press("End");
    await until(async () => (await bounds(composer)).bottom <= (await bounds(scroller)).bottom + 1,
      "Keyboard scrolling reaches the complete compact composer");
    assertInside(await bounds(composer), await bounds(scroller), "Compact Chat composer is fully reachable");
  } else {
    assert.deepEqual(await bounds(composer), composerBefore, "Roomy Chat keeps its composer fixed");
  }
  assert.equal(await page.locator(".ps-assistant-analysis").count(), 0,
    "Chat does not retain a competing analysis scroller");
}

export async function exerciseComposerResize({ page, observations }) {
  const textarea = page.getByRole("textbox", { name: "Ask about this model", exact: true });
  await textarea.scrollIntoViewIfNeeded();
  const style = await textarea.evaluate(element => {
    const computed = getComputedStyle(element);
    return { resize: computed.resize, minHeight: parseFloat(computed.minHeight), overflowY: computed.overflowY };
  });
  assert.equal(style.resize, "vertical");
  assert.equal(style.overflowY, "auto");
  const before = await textarea.boundingBox();
  async function dragBy(delta) {
    await textarea.scrollIntoViewIfNeeded();
    const rect = await textarea.boundingBox();
    const x = rect.x + rect.width - 3;
    const y = rect.y + rect.height - 3;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + delta, { steps: 8 });
    await page.mouse.up();
  }
  await dragBy(90);
  const grown = await textarea.boundingBox();
  assert.ok(grown.height > before.height, "Dragging the native handle grows the Chat text box");
  assert.equal(grown.width, before.width, "Resizing is vertical only");
  await dragBy(500);
  const maximum = await textarea.boundingBox();
  assert.ok(maximum.height <= 180, "Text box growth is bounded");
  const conversation = page.locator(".ps-assistant-conversation");
  assert.ok((await bounds(conversation)).clientHeight > 0, "Even maximum input height leaves Chat usable");
  const { compact, scroller, panel } = await assistantLayout(page, conversation);
  if (compact) await textarea.scrollIntoViewIfNeeded();
  assertInside(await bounds(textarea), await bounds(compact ? scroller : panel),
    "Maximum-size input remains reachable");
  if (!compact) {
    assertInside(await bounds(page.locator(".ps-assistant-composer")), await bounds(panel),
      "Maximum-size input keeps the desktop composer visible");
  }
  await dragBy(-500);
  const minimum = await textarea.boundingBox();
  assert.ok(Math.abs(minimum.height - style.minHeight) <= 1, "Text box respects its minimum height");
  assert.ok((await bounds(conversation)).clientHeight > 0, "Resizing does not collapse Chat");
  if (compact) await textarea.scrollIntoViewIfNeeded();
  assertInside(await bounds(textarea), await bounds(compact ? scroller : panel),
    "Resized input is reachable");
  observations.textareaResize = { before, grown, maximum, minimum };
}

export async function exerciseAssistantLayout(exercise, viewport) {
  await exerciseAnalysisLayout(exercise, viewport);
  await exerciseChatLayout(exercise);
  await exerciseComposerResize(exercise);
}

async function setTheme(page, theme) {
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  const option = page.getByRole("menuitemcheckbox", { name: /Dark Theme/ });
  if ((await option.getAttribute("aria-checked") === "true") !== (theme === "dark")) {
    await option.click();
  }
  if (await settings.getAttribute("aria-expanded") === "true") await settings.click();
}

export function registerAssistantLayoutContracts({ getHarness }) {
  for (const theme of ["light", "dark"]) {
    for (const viewport of [
      { width: 1366, height: 900 },
      { width: 1366, height: 600 },
      { width: 768, height: 700 },
      { width: 320, height: 900 },
      { width: 320, height: 640 },
    ]) {
      const name = `usability: Assistant analysis scrolling at ${viewport.width}x${viewport.height} (${theme})`;
      test(name, async () => {
        await getHarness().run(name, async exercise => {
          const { page, observations } = exercise;
          await setTheme(page, theme);
          observations.theme = theme;
          await exerciseAssistantLayout(exercise, viewport);
        });
      });
    }

    for (const height of [640, 900]) {
      test(`usability: Assistant bottom-sheet expansion and restore at 320x${height} (${theme})`, async () => {
        await getHarness().run(`usability: Assistant expansion at 320x${height} (${theme})`, async ({ page, observations }) => {
          await setTheme(page, theme);
          observations.theme = theme;
          await exerciseAnalysisLayout({ page, observations }, { width: 320, height });
          const inspector = page.locator(".ps-inspector");
          const restore = page.getByRole("button", { name: "Restore inspector size", exact: true });
          assert.equal(await restore.getAttribute("aria-expanded"), "true", "Narrow Assistant opens expanded");
          await restore.click();
          const original = await inspector.boundingBox();
          const expand = page.getByRole("button", { name: "Expand inspector", exact: true });
          await expand.focus();
          await page.keyboard.press("Enter");
          await until(() => restore.getAttribute("aria-expanded").then(value => value === "true"), "expanded state");
          const expanded = await inspector.boundingBox();
          assert.ok(expanded.height > original.height, "Expansion adds usable inspector height");
          const main = await page.locator(".ps-main").boundingBox();
          assertInside(await bounds(inspector), await bounds(page.locator(".ps-main")), "Expansion stays inside app content");
          const zoom = await page.getByRole("group", { name: "Canvas zoom controls" }).boundingBox();
          assert.ok(zoom.y >= main.y && zoom.y + zoom.height <= expanded.y,
            "Canvas zoom remains visible above the expanded inspector");
          assert.equal(await restore.evaluate(element => element === document.activeElement), true,
            "Expansion retains keyboard focus on the toggle");
          assert.equal(await page.locator(".ps-assistant-finding").count(), 10, "Expansion keeps findings mounted");
          const last = page.locator(".ps-assistant-actions button").last();
          await last.focus();
          const { scroller } = await assistantLayout(page, page.locator(".ps-assistant-analysis"));
          assertInside(await bounds(last), await bounds(scroller), "Final finding remains reachable after expansion");
          await restore.focus();
          await page.keyboard.press("Space");
          await until(() => expand.getAttribute("aria-expanded").then(value => value === "false"), "restored state");
          assert.ok(Math.abs((await inspector.boundingBox()).height - original.height) <= 1, "Restore returns original height");
          await expand.press("Enter");
          await page.setViewportSize({ width: 1366, height });
          await until(() => page.getByRole("tab", { name: /^Findings\b/ })
            .evaluate(element => element === document.activeElement), "Hidden expand control returns focus to active tab");
          assert.equal(await page.locator(".ps-inspector-expand").isVisible(), false);
          await page.setViewportSize({ width: 320, height });
          assert.equal(await restore.getAttribute("aria-expanded"), "true", "Returning to the narrow Assistant expands it for review");
          observations.expansion = { original, expanded, zoom };
        });
      });
    }
  }
}
