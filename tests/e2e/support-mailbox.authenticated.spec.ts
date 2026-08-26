import { expect, test } from "@playwright/test";

/**
 * This asserts on what the screen draws, and not on a request, because the request never leaves
 * the browser.
 *
 * `/ca/support/mail` is a server component: it awaits `/api/v1/support/mailbox` from inside the
 * Next server and renders the answer into the HTML that arrives. A `page.waitForResponse` on that
 * URL therefore waited for something that could not happen, and timed out on every run since the
 * commit that introduced it -- with the `mail` flag on and with it off alike, so the flag was
 * never the reason it failed.
 *
 * What dropping the wait costs is the status code, and it is worth naming rather than glossing:
 * the page falls back to an empty mailbox when the API answers badly, so a broken API and an
 * empty inbox render the same. Telling those apart needs a seeded message to look for, which
 * belongs with whoever owns the module rather than with a spec that only had to stop asserting
 * on traffic that does not exist.
 */
test("the authenticated support mailbox exposes the manual classification surface", async ({ page }) => {
  await page.goto("/ca/support/mail", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Correu pendent" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Correu pendent" }).getByRole("link")).toHaveCount(3);
  await expect(page.getByText(/Token OAuth|secret|client_secret/i)).toHaveCount(0);
});
