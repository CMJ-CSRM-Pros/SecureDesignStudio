import assert from "node:assert/strict";
import { test } from "node:test";
import { until } from "./harness.mjs";

export function registerLibraryContracts({ getHarness }) {
  test("usability: Custom Libraries is read-only, keyboard accessible and honest about core content", async () => {
    await getHarness().run("usability: Custom Libraries status", async ({ page }) => {
      const trigger = page.locator('button[aria-controls="ps-command-menu-model"]');
      await trigger.click();
      await page.getByRole("menuitem", { name: "Custom Libraries", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Custom Libraries", exact: true });
      await dialog.getByText("No optional libraries configured", { exact: true }).waitFor();
      assert.match(await dialog.innerText(), /not a public-content release/);
      assert.equal(await dialog.getByRole("button", { name: "Close Custom Libraries" }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.getByRole("button", { name: "Close", exact: true }).evaluate(el => el === document.activeElement), true);
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.count(), 0);
      await page.setViewportSize({ width: 1366, height: 900 });
      await trigger.click();
      await page.getByRole("menuitem", { name: "Custom Libraries", exact: true }).click();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await until(() => trigger.evaluate(el => el === document.activeElement), "Custom Libraries returns focus to Model");
    });
  });
}
