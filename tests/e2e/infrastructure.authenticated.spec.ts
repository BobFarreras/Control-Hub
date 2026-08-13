import { expect, test } from "@playwright/test";
import { readFixture, waitForHydration } from "./support/fixture";

/**
 * The infrastructure screen, driven the way an operator drives it.
 *
 * What this proves and unit tests cannot: that the link to a workflow is one **we** composed out
 * of the configured base -- the address is asserted, never followed, because whether an n8n
 * answers on this machine is not what is under test -- that a reading arrives with its age and
 * says so when it is old, and that acknowledging a live alert survives the round trip to the API
 * and back onto the screen.
 *
 * The rows come from `apps/api/src/seed-e2e.ts`. They cannot be created through this screen: an
 * automation exists because a connector pulled it, and there is no provider here to pull from.
 *
 * **The fixture ages.** The fresh reading is seeded two minutes old and turns stale after
 * forty-five, so a run against a database seeded hours ago fails on the assertion below that the
 * fresh row carries no age warning -- correctly, because by then it does. CI seeds immediately
 * before running and never sees it; locally, re-run `pnpm db:seed:verify` first.
 *
 * Acceptance criteria 1, 3 and 4 of `docs/specifications/infrastructure.md`.
 */
test.describe.configure({ timeout: 120_000 });

/** The Catalan labels the screen renders, together, so a wording change is one edit. */
const t = {
  title: "Infraestructura",
  automations: "Automatitzacions",
  alerts: "Alertes",
  acknowledge: "Reconeixer",
  acknowledged: "Reconeguda",
  stale: "Dada antiga"
} as const;

test("shows what runs with the age of its reading, and acknowledges a live alert", async ({ page }) => {
  const fixture = readFixture();
  const { fresh, stale, baseUrl, rule, customer } = fixture.infrastructure;

  await page.goto("/ca/infrastructure", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: t.title, level: 1 })).toBeVisible();

  const automations = page.getByRole("region", { name: t.automations });
  const freshRow = automations.getByRole("row").filter({ hasText: fresh.name });
  await expect(freshRow).toBeVisible();

  /**
   * The link, composed here and never received. `workflow:e2e-fresh` is an external identifier
   * and `.../workflow/e2e-fresh` is the address we built from it and the configured base.
   */
  await expect(freshRow.getByRole("link", { name: fresh.name })).toHaveAttribute(
    "href",
    `${baseUrl}/workflow/${fresh.externalId.replace("workflow:", "")}`
  );
  // A link to somewhere else opens somewhere else: never in this tab, never with a handle back.
  await expect(freshRow.getByRole("link", { name: fresh.name })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(freshRow.getByText(customer)).toBeVisible();

  // The reading that was seeded five hours old has to say so on its own row, and the fresh one
  // must not: an age nobody can see is the same as no age at all.
  const staleRow = automations.getByRole("row").filter({ hasText: stale.name });
  await expect(staleRow.getByText(t.stale)).toBeVisible();
  await expect(freshRow.getByText(t.stale)).toHaveCount(0);

  const alerts = page.getByRole("region", { name: t.alerts });
  const alertRow = alerts.getByRole("row").filter({ hasText: rule });
  await expect(alertRow).toBeVisible();

  /**
   * Acknowledging is one way, and a Playwright retry happens inside a run, long after the seed
   * reset the alert. So the click is driven when there is still something to click and the
   * assertion below is what holds either way: a second attempt finds the alert already taken,
   * which is the state this test is about, rather than a missing button and a misleading message.
   */
  const acknowledge = alertRow.getByRole("button", { name: t.acknowledge });
  if ((await acknowledge.count()) > 0) {
    await waitForHydration(acknowledge);
    const answered = page.waitForResponse((response) => response.url().includes("/acknowledge"));
    await acknowledge.click();
    expect((await answered).status()).toBe(200);
  }

  // Acknowledged is a state of its own: the alert stays on the list, and stops asking.
  await expect(alerts.getByRole("row").filter({ hasText: rule }).getByText(t.acknowledged)).toBeVisible({
    timeout: 15_000
  });
});
