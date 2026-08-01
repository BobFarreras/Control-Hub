import { expect, test } from "@playwright/test";

test("renders the localized application shell", async ({ page }) => {
  await page.goto("/ca", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Centre de control" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navegacio principal" })).toBeVisible();
});

test("supports English routing", async ({ page }) => {
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Control center" })).toBeVisible();
});

for (const locale of ["ca", "es", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`@visual ${locale} ${theme} has no horizontal overflow`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => localStorage.setItem("theme", selectedTheme), theme);
      await page.goto(`/${locale}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
      await expect(page.locator("main")).toHaveScreenshot(`${locale}-${theme}.png`, { animations: "disabled", caret: "initial" });
    });
  }
}
