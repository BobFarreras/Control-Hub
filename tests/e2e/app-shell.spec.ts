import { expect, test } from "@playwright/test";

const headings = { ca: "Accedeix a Control Hub", es: "Accede a Control Hub", en: "Access Control Hub" } as const;

test("redirects unauthenticated users to the localized login", async ({ page }) => {
  await page.goto("/ca", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/ca\/login$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: headings.ca })).toBeVisible();
});

for (const locale of ["ca", "es", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`@visual login ${locale} ${theme} has no horizontal overflow`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => localStorage.setItem("theme", selectedTheme), theme);
      await page.goto(`/${locale}/login`, { waitUntil: "domcontentloaded" });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await expect(page.getByRole("heading", { name: headings[locale] })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth
      }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
      await expect(page.locator("main")).toHaveScreenshot(`login-${locale}-${theme}.png`, {
        animations: "disabled",
        caret: "initial"
      });
    });
  }
}
