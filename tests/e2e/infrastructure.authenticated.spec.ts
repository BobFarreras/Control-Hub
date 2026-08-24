import { expect, test } from "@playwright/test";
import { readFixture, selectFieldOption, waitForHydration } from "./support/fixture";

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
  discovery: "Que llegeix aquest recollidor",
  collector: "Recollidor",
  declare: "Declarar-la",
  hostname: "Etiqueta",
  name: "Nom",
  create: "Crear",
  scope: "Que estas mirant",
  everything: "Tota la infraestructura",
  selector: "Serveis que el recollidor veu",
  projects: "Projectes desplegats",
  serving: "Serveix",
  neverDeployed: "Mai desplegada",
  noFailure: "Cap",
  supabaseProjects: "Projectes Supabase",
  supabaseHealthy: "Activa",
  supabaseTransitioning: "En transicio",
  selectorRun: "Mira que hi ha",
  services: "Serveis",
  backup: "Copia de seguretat"
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

  /**
   * The collector is chosen once, at the top, for the whole screen. Narrowing to one is not what
   * makes the panel appear -- every collector draws one, and the whole of the infrastructure
   * shows the lot -- it is what leaves a single panel to assert against here.
   *
   * There is no request to wait for: the panel asks on its own as soon as it is mounted, so by
   * the time the choice is made the first answers may already be in. What is waited on is the
   * content, which is the thing the test is actually about.
   */
  const scope = page.getByLabel(t.scope);
  await waitForHydration(scope);
  await selectFieldOption(scope, { label: collector });

  const discovery = page.getByRole("region", { name: t.discovery });

  /**
   * The label whole, and not as a prefix of the row.
   *
   * `e2e-vps` is the beginning of `e2e-vps-nou`, and `hasText` matches a substring of the row --
   * an anchored regexp included, because it is anchored to the row's text and not to the label.
   * So one locator answered for both rows and the declared one appeared to be offering a button
   * that belonged to the other. Filtering on an element whose text *is* the label picks one.
   */
  const rowFor = (label: string) =>
    discovery.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) });

  // The declared one says which machine it is, and offers nothing to declare.
  const declared = rowFor(host.hostname);
  await expect(declared.getByRole("link", { name: new RegExp(host.name) })).toBeVisible({ timeout: 15_000 });
  await expect(declared.getByRole("button", { name: t.declare })).toHaveCount(0);

  const undeclared = rowFor(undeclaredHostname);
  const declare = undeclared.getByRole("button", { name: t.declare });
  if ((await declare.count()) > 0) {
    await declare.click();

    // The dialog opens already carrying the label. That is criterion 8, whole.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(t.hostname)).toHaveValue(undeclaredHostname);

    // By role and exact, not by label: the hint beside the label field carries an `aria-label`
    // that contains the word "nom", and a substring match answers with two elements.
    await dialog.getByRole("textbox", { name: t.name, exact: true }).fill(name);
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

/**
 * From "the collector reads a container" to "that container is a declared service".
 *
 * The counterpart of the discovery above, one level down, and the same argument for testing it
 * end to end: what breaks here is never the arithmetic, it is a key that arrives on the screen
 * and leaves it changed. Declaring used to mean typing `container:e2e-cua` into a free field, and
 * a single wrong character produced a service that never lit up with nothing anywhere to say why.
 * So what is asserted is that the key the collector reads is the key that ends up stored: the box
 * is ticked by its key, and the machine's page is read back for the name that key proposed.
 *
 * Two services and not one, of two different kinds, because `backup` is a kind this increment
 * added to the database and a migration that did not run fails here and nowhere else in this
 * suite.
 *
 * Declaring is one way, like acknowledging and declaring a machine above, so the clicking happens
 * only while there is still something to tick, and the closing assertion is the one that holds on
 * a retry too.
 *
 * Acceptance criteria 12 to 15 of `docs/specifications/connector-onboarding.md`.
 */
test("declares services the collector sees, by ticking them", async ({ page }) => {
  const { collector, host, offered } = readFixture().infrastructure;

  await page.goto("/ca/infrastructure", { waitUntil: "domcontentloaded" });
  await page.getByRole("region", { name: t.hosts }).getByRole("link", { name: host.name, exact: true }).click();
  await expect(page.getByRole("heading", { name: host.name, level: 1 })).toBeVisible();

  const selector = page.getByRole("region", { name: t.selector });
  const look = selector.getByRole("button", { name: t.selectorRun });
  await waitForHydration(look);
  await selectFieldOption(selector.getByLabel(t.collector), { label: collector });

  // Nothing leaves for Prometheus to draw this either: the list is read out of records already
  // stored, and the only request the click makes is to our own API.
  const answered = page.waitForResponse((response) => response.url().includes("/services"));
  await look.click();
  expect((await answered).status()).toBe(200);

  // By key, not by name: the key is what the matching is done on, and a box that ticks the right
  // name under the wrong key is the exact failure this screen was built to stop.
  const box = (matchKey: string) => selector.getByRole("checkbox", { name: new RegExp(matchKey) });

  if ((await box(offered.container.matchKey).count()) > 0) {
    await box(offered.container.matchKey).check();
    await box(offered.backup.matchKey).check();

    const declared = page.waitForResponse(
      (response) => response.url().includes("/services") && response.request().method() === "POST"
    );
    await selector.getByRole("button", { name: /Declarar els marcats/ }).click();
    expect((await declared).status()).toBe(201);
  }

  // And they are services of this machine now, under the names the collector's own labels
  // proposed -- the backup among them, which is what says the new kind survived the round trip.
  const services = page.getByRole("region", { name: t.services, exact: true });
  const row = (matchKey: string) => services.getByRole("listitem").filter({ hasText: matchKey });
  await expect(row(offered.container.matchKey)).toBeVisible({ timeout: 15_000 });
  await expect(row(offered.container.matchKey).getByText(offered.container.name, { exact: true })).toBeVisible();
  await expect(row(offered.backup.matchKey).getByText(t.backup)).toBeVisible();
});

/**
 * One screen, and one choice that decides what is on it.
 *
 * The complaint this answers was concrete: looking at the machines meant scrolling past a table
 * of automations that had nothing to do with them, and past a row of counters reading zero. So
 * what is asserted is subtraction, which is the part that cannot be proved without a browser --
 * that a section which holds nothing of the chosen collector is **not on the page at all**,
 * rather than present and empty. Two collectors are seeded and each owns a different table, so
 * choosing one has to remove the other's, both ways round.
 *
 * The address bar is asserted too: the choice decides which sections the screen has, which makes
 * it a different screen, and a screen somebody cannot send to somebody else is half a screen.
 *
 * Acceptance criteria 16 to 20 of `docs/specifications/connector-onboarding.md`.
 */
/**
 * The two truths a project row holds at once.
 *
 * A site serving perfectly whose last build failed is the ordinary Friday afternoon, and it is
 * the case a single column would have to lie about. The other row is the other answer that is
 * not an outage: a project nobody has deployed, whose production is neither up nor down.
 */
test("says a project is serving and that its last build failed, and neither of a project never deployed", async ({
  page
}) => {
  const { projects } = readFixture().infrastructure;

  await page.goto("/ca/infrastructure", { waitUntil: "domcontentloaded" });

  const band = page.getByRole("region", { name: t.projects, exact: true });
  const serving = band.getByRole("row").filter({ hasText: projects.serving.name });

  await expect(serving).toContainText(t.serving);
  await expect(serving).toContainText(projects.serving.domain);
  // The build that broke, named by the branch it broke on, beside a production that is up.
  await expect(serving).toContainText(projects.serving.failureRef);
  // When the project was made, as a date rather than as an age: the fixture is created in 2026
  // and a row that answered "fa 234 d" would be true and useless.
  await expect(serving).toContainText("2026");

  const never = band.getByRole("row").filter({ hasText: projects.never.name });
  await expect(never).toContainText(t.neverDeployed);
  await expect(never).toContainText(t.noFailure);
});

/**
 * A database provider's project, in a band of its own next to the hosting one: no domain, no
 * failed build, and a third answer -- mid-transition -- that a serving/down pair cannot hold.
 */
test("says a Supabase project is healthy, and that another is mid-transition", async ({ page }) => {
  const { supabaseProjects } = readFixture().infrastructure;

  await page.goto("/ca/infrastructure", { waitUntil: "domcontentloaded" });

  const band = page.getByRole("region", { name: t.supabaseProjects, exact: true });
  const healthy = band.getByRole("row").filter({ hasText: supabaseProjects.healthy.name });
  await expect(healthy).toContainText(t.supabaseHealthy);
  await expect(healthy).toContainText("eu-west-2");
  await expect(healthy).toContainText("2026");

  const restoring = band.getByRole("row").filter({ hasText: supabaseProjects.restoring.name });
  await expect(restoring).toContainText(t.supabaseTransitioning);
});

test("shows only what the chosen collector accounts for", async ({ page }) => {
  const { collector, instance } = readFixture().infrastructure;

  await page.goto("/ca/infrastructure", { waitUntil: "domcontentloaded" });

  const machines = page.getByRole("region", { name: t.hosts, exact: true });
  const automations = page.getByRole("region", { name: t.automations, exact: true });
  const projects = page.getByRole("region", { name: t.projects, exact: true });
  const supabaseProjects = page.getByRole("region", { name: t.supabaseProjects, exact: true });
  const scope = page.getByLabel(t.scope);

  // With nothing chosen the screen is the whole of it, and every collector is on it.
  await waitForHydration(scope);
  await expect(machines).toBeVisible();
  await expect(automations).toBeVisible();
  await expect(projects).toBeVisible();
  await expect(supabaseProjects).toBeVisible();

  // The collector that reads machines. The automations of the other one are not narrowed to
  // none: the table is gone, and so are the projects tables of the other two.
  await selectFieldOption(scope, { label: collector });
  await expect(automations).toHaveCount(0);
  await expect(projects).toHaveCount(0);
  await expect(supabaseProjects).toHaveCount(0);
  await expect(machines).toBeVisible();
  await expect(page).toHaveURL(/[?&]collector=/);

  // And the other way round, which is what proves the rule is the collector and not the table.
  await selectFieldOption(scope, { label: instance });
  await expect(machines).toHaveCount(0);
  await expect(automations).toBeVisible();

  // Back to everything, and the address stops asking for a collector.
  await selectFieldOption(scope, { label: t.everything });
  await expect(machines).toBeVisible();
  await expect(automations).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]collector=/);
});
