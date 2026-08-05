import { expect, test } from "@playwright/test";
import { labels, readFixture, submitCredentials, submitSecondFactor } from "./support/fixture";

/**
 * Signing in from nothing, so the banked session the rest of the suite uses is never what is
 * under test here.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const fixture = readFixture();

/**
 * One test rather than three, and deliberately so: credential routes are throttled to ten
 * requests a minute per address, which is the brute force defence and not something a test
 * suite gets to relax. A full run spends five of them, two in the setup project and three
 * here, which leaves room for a retry. Splitting this into a sign-in per assertion would put
 * the suite over the budget and turn its own protection into a flake.
 */
test("the sign-in demands the second factor, refuses a wrong code and accepts the right one", async ({ page }) => {
  await submitCredentials(page, fixture);

  // A password alone has not opened a session. Still on the login route, now being asked for
  // the factor: reaching the workspace at this point would mean enforcement had regressed.
  await expect(page).toHaveURL(/\/ca\/login$/);
  await expect(page.getByLabel(labels.otp)).toBeVisible();

  await submitSecondFactor(page, fixture, "000000");
  // The form's own alert, not `getByRole("alert")`: Next.js keeps a route announcer with the
  // same role on every page, so the bare role matches two elements.
  await expect(page.locator("p.form-error[role=alert]")).toHaveText(labels.error);
  await expect(page).toHaveURL(/\/ca\/login$/);

  // Straight after the refusal, on the same challenge. This is what tells a rejected attempt
  // apart from an account the attempt locked out.
  await submitSecondFactor(page, fixture);
  await expect(page).toHaveURL(/\/ca(\?.*)?$/, { timeout: 20_000 });

  // And the session it produced actually opens a protected screen.
  await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Safata de tickets" })).toBeVisible();
});
