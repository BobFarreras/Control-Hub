import { expect, test } from "@playwright/test";
import { readFixture, waitForHydration } from "./support/fixture";

/**
 * The infrastructure screen, driven the way an operator drives it.
 *
 * What this proves and unit tests cannot: that the link to a workflow is one **we** composed out
 * of the configured base -- the address is asserted, never followed, because whether an n8n
 * answers on this machine is not what is under test -- that a reading arrives with its age and
 * says so when it is old, that acknowledging a live alert survives the round trip to the API and
 * back onto the screen, and that a machine reads as three different things depending on what we
 * can actually see of it: answering, stopped, and out of sight.
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
  stale: "Dada antiga",
  hosts: "Maquines",
  up: "Respon",
  down: "No respon",
  unknown: "Sense lectura",
  discovery: "Que veu cada recollidor",
  discoveryRun: "Mira que veu",
  collector: "Recollidor",
  declare: "Declarar-la",
  undeclared: "Sense declarar",
  hostname: "Etiqueta",
  name: "Nom",
  create: "Crear"
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

test("says of every machine what is currently known of it, and no more", async ({ page }) => {
  const { host, services } = readFixture().infrastructure;

  await page.goto("/ca/infrastructure", { waitUntil: "domcontentloaded" });

  const machines = page.getByRole("region", { name: t.hosts });
  const machine = machines.getByRole("listitem").filter({ hasText: host.name });
  await expect(machine).toBeVisible();
  // The host answers, and it says so with the figures a person came to read.
  await expect(machine.getByText(t.up, { exact: true }).first()).toBeVisible();
  await expect(machine.getByText("CPU", { exact: true })).toBeVisible();

  /**
   * The three answers, side by side on one machine.
   *
   * A container whose reading stopped moving is **down**; a probe of an operation that never
   * passed is **unknown** and not down. Blurring the two is the failure this screen exists to
   * avoid: one sends somebody to a machine that never stopped, and there is no unit test that can
   * prove the difference survives the API, the page and the browser.
   */
  const row = (name: string) => machine.getByRole("row").filter({ hasText: name });
  await expect(row(services.up.name).getByText(t.up, { exact: true })).toBeVisible();
  await expect(row(services.down.name).getByText(t.down, { exact: true })).toBeVisible();
  await expect(row(services.unknown.name).getByText(t.unknown, { exact: true })).toBeVisible();
  await expect(row(services.unknown.name).getByText(t.down, { exact: true })).toHaveCount(0);

  // No address of a provider reaches this screen, from the inventory any more than from anywhere
  // else: what the page holds of Prometheus is what somebody declared, never where it lives.
  expect(await page.content()).not.toContain("127.0.0.1:9090");
});

/**
 * The path from "the collector sees something nobody declared" to a declared machine.
 *
 * What this proves and no unit test can: that the label the API answers with is the label that
 * lands in the field of the dialog, through the panel, the button and the form -- which is the
 * one field that was typed wrongly the first time, and the reason this increment exists.
 *
 * Declaring is one way, like acknowledging above, and a Playwright retry happens inside a run
 * long after the seed took the leftover away. So the declaring is driven only while there is
 * still something to declare, and the assertion that closes the test is the one that holds
 * either way: that label belongs to a machine now.
 *
 * Acceptance criteria 8 and 9 of `docs/specifications/connector-onboarding.md`.
 */
test("declares a machine the collector can see and nobody had declared", async ({ page }) => {
  const { collector, undeclaredHostname, host } = readFixture().infrastructure;
  const name = `E2E VPS descobert ${Date.now()}`;

  await page.goto("/ca/infrastructure", { waitUntil: "domcontentloaded" });

  const discovery = page.getByRole("region", { name: t.discovery });
  const look = discovery.getByRole("button", { name: t.discoveryRun });
  await waitForHydration(look);
  await discovery.getByLabel(t.collector).selectOption({ label: collector });

  /**
   * Nothing goes out to Prometheus to draw this. The panel reads records that are already stored,
   * and the one request the click may make is to our own API.
   */
  const answered = page.waitForResponse((response) => response.url().includes("/discovery"));
  await look.click();
  expect((await answered).status()).toBe(200);

  // Exact text, because `e2e-vps` is the beginning of `e2e-vps-nou`: the two rows this test is
  // about would otherwise be one locator matching both.
  const rowFor = (label: string) => discovery.getByRole("listitem").filter({ hasText: new RegExp(`^${label}`) });

  // The declared one says which machine it is, and offers nothing to declare.
  const declared = rowFor(host.hostname);
  await expect(declared.getByRole("link", { name: new RegExp(host.name) })).toBeVisible();
  await expect(declared.getByRole("button", { name: t.declare })).toHaveCount(0);

  const undeclared = rowFor(undeclaredHostname);
  const declare = undeclared.getByRole("button", { name: t.declare });
  if ((await declare.count()) > 0) {
    await expect(undeclared.getByText(t.undeclared)).toBeVisible();
    await declare.click();

    // The dialog opens already carrying the label. That is criterion 8, whole.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(t.hostname)).toHaveValue(undeclaredHostname);

    await dialog.getByLabel(t.name).fill(name);
    const created = page.waitForResponse(
      (response) => response.url().includes("/infrastructure/hosts") && response.request().method() === "POST"
    );
    await dialog.getByRole("button", { name: t.create }).click();
    expect((await created).status()).toBe(201);
  }

  // And it is a machine now: on the fleet, under the label the collector was already reading.
  await expect(page.getByRole("region", { name: t.hosts }).getByText(undeclaredHostname)).toBeVisible({
    timeout: 15_000
  });
});
