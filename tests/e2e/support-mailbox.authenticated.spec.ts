import { expect, test } from "@playwright/test";

test("the authenticated support mailbox exposes the manual classification surface", async ({ page }) => {
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/v1/support/mailbox?status=pending")
  );
  await page.goto("/ca/support/mail", { waitUntil: "domcontentloaded" });
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Correu pendent" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Correu pendent" }).getByRole("link")).toHaveCount(3);
  await expect(page.getByText(/Token OAuth|secret|client_secret/i)).toHaveCount(0);
});
