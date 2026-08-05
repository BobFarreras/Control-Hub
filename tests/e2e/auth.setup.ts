import { expect, test as setup } from "@playwright/test";
import { labels, readFixture, storageStatePath, submitCredentials, submitSecondFactor } from "./support/fixture";

/**
 * The gate the rest of the authenticated suite depends on.
 *
 * It is a real sign-in: address, password and the mandatory second factor, against an account
 * whose MFA is genuinely enabled. The assertion in the middle is the one that matters. If
 * enforcement ever regressed and a password alone were enough, this would fail here rather
 * than letting every screen test pass against a session that never met the control.
 */
setup("signs in with credentials and the second factor", async ({ page }) => {
  const fixture = readFixture();

  await submitCredentials(page, fixture);
  await expect(page.getByLabel(labels.otp)).toBeVisible();
  await expect(page).toHaveURL(/\/ca\/login$/);

  await submitSecondFactor(page, fixture);
  await expect(page).toHaveURL(/\/ca(\?.*)?$/, { timeout: 20_000 });

  await page.context().storageState({ path: storageStatePath });
});
