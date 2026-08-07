import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "./support/fixture";

/**
 * The owner review gate of phase 5B, written down as a test.
 *
 * `IMPLEMENTATION_PLAN.md` asks for the computed margin of a real project to be compared against a
 * known manual calculation. Doing it once by hand proves it once; doing it here proves it stays
 * true, and the arithmetic is written out in the assertions so a reader can check the expectation
 * without trusting the code that produced it.
 */
test.describe.configure({ timeout: 180_000 });

/** The Catalan labels the rates and project screens render. */
const t = {
  rates: "Barems",
  newProject: "Nou projecte",
  member: "Persona",
  amount: "Import per hora",
  currency: "Moneda",
  effectiveFrom: "Vigent des de",
  publish: "Publicar",
  applies: "Aplica a",
  project: "Projecte",
  current: "Vigent",
  superseded: "Substituit",
  costTitle: "Cost per hora",
  billingTitle: "Preu de venda per hora",
  duration: "Durada",
  spentOn: "Dia treballat",
  overview: "Resum",
  margin: "Marge",
  serviceTitle: "Tipus de servei",
  serviceName: "Nom",
  serviceCode: "Codi",
  serviceAdd: "Afegir",
  scopeServiceType: "Tipus de servei",
  annul: "Anul·lar",
  annulConfirm: "Confirmar",
  annulled: "Anul·lat",
  removeService: "Treure",
  deactivateService: "Desactivar",
  reactivateService: "Reactivar",
  duplicate: "Ja hi ha un barem per a aquesta combinacio i aquest dia."
} as const;

test("publishes rates and prices the hours with the one in force on the day worked", async ({ page }) => {
  const code = `rt-${randomUUID().slice(0, 6)}`;
  /**
   * A day of its own for this run, used both for the work and for the rates.
   *
   * A rate is unique per person, currency and effective day, so a fixed date publishes once and
   * answers 409 on every run after that. Picking the day per run also pins the arithmetic: the rate
   * in force on that day is the one this test just published, because any rate from another run
   * either starts later and is excluded, or starts earlier and is superseded by this one.
   */
  const workedOn = new Date(Date.now() - (60 + Math.floor(Math.random() * 800)) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // ------------------------------------------------------------------ a project with known hours
  await page.goto("/ca/projects", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: t.newProject });
  await waitForHydration(open);
  await open.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Codi del projecte", { exact: true }).fill(code);
  await dialog.getByLabel("Nom del projecte", { exact: true }).fill(`Barems ${code}`);
  await dialog.getByLabel("Client", { exact: true }).selectOption({ index: 0 });
  await dialog.getByRole("button", { name: "Crear" }).click();

  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/ca\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  // Two hours exactly, so the arithmetic below has no rounding to argue about.
  const quickLog = page.getByRole("region", { name: "Registre rapid" });
  const duration = quickLog.getByLabel(t.duration, { exact: true });
  await waitForHydration(duration);
  await duration.fill("2h");
  await quickLog.getByLabel(t.spentOn, { exact: true }).fill(workedOn);
  const logged = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/time-entries") && r.request().method() === "POST"
  );
  await duration.press("Enter");
  expect((await logged).status()).toBe(201);

  // ------------------------------------------------------------------ publish the two rates
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const cost = page.getByRole("region", { name: t.costTitle });
  const amount = cost.getByLabel(t.amount, { exact: true });
  await waitForHydration(amount);

  // 30.00 an hour of cost, in force from the day the work was done.
  await cost.getByLabel(t.member, { exact: true }).selectOption({ index: 0 });
  await amount.fill("30,00");
  await cost.getByLabel(t.effectiveFrom, { exact: true }).fill(workedOn);
  const costSaved = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/rates/cost") && r.request().method() === "POST"
  );
  await cost.getByRole("button", { name: t.publish }).click();
  expect((await costSaved).status()).toBe(201);

  // 90.00 an hour of sale, on this project.
  const billing = page.getByRole("region", { name: t.billingTitle });
  await billing.getByLabel(t.applies, { exact: true }).selectOption("project");
  await billing.getByLabel(t.project, { exact: true }).selectOption({ label: `${code} · Barems ${code}` });
  await billing.getByLabel(t.amount, { exact: true }).fill("90,00");
  await billing.getByLabel(t.effectiveFrom, { exact: true }).fill(workedOn);
  const billingSaved = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST"
  );
  await billing.getByRole("button", { name: t.publish }).click();
  expect((await billingSaved).status()).toBe(201);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: t.costTitle })).toContainText(t.current);

  // ------------------------------------------------------------------ the margin, checked by hand
  /**
   * Two hours at 90.00 an hour is 180.00 of revenue.
   * Two hours at 30.00 an hour is 60.00 of cost.
   * The margin is 120.00, and the currency is the one the rates were published in.
   */
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  const overview = page.getByRole("region", { name: t.overview });
  await expect(overview).toContainText("180,00");
  await expect(overview).toContainText("60,00");
  await expect(overview).toContainText("120,00");
  // And no warning about an unpriced entry, because both rates resolved.
  await expect(overview).not.toContainText("Cal publicar un barem");
});

test("a rate published today does not change what earlier work was worth", async ({ page }) => {
  const code = `rt-${randomUUID().slice(0, 6)}`;
  const today = new Date().toISOString().slice(0, 10);

  await page.goto("/ca/projects", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: t.newProject });
  await waitForHydration(open);
  await open.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Codi del projecte", { exact: true }).fill(code);
  await dialog.getByLabel("Nom del projecte", { exact: true }).fill(`Historic ${code}`);
  await dialog.getByLabel("Client", { exact: true }).selectOption({ index: 0 });
  await dialog.getByRole("button", { name: "Crear" }).click();

  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("link").click();
  const projectUrl = page.url();

  // An hour worked a month ago.
  const workedOn = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const quickLog = page.getByRole("region", { name: "Registre rapid" });
  const duration = quickLog.getByLabel(t.duration, { exact: true });
  await waitForHydration(duration);
  await duration.fill("1h");
  await quickLog.getByLabel(t.spentOn, { exact: true }).fill(workedOn);
  const logged = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/time-entries") && r.request().method() === "POST"
  );
  await duration.press("Enter");
  expect((await logged).status()).toBe(201);

  // A sale rate of 50.00 that was already in force then.
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const billing = page.getByRole("region", { name: t.billingTitle });
  await waitForHydration(billing.getByLabel(t.amount, { exact: true }));
  await billing.getByLabel(t.applies, { exact: true }).selectOption("project");
  await billing.getByLabel(t.project, { exact: true }).selectOption({ label: `${code} · Historic ${code}` });
  await billing.getByLabel(t.amount, { exact: true }).fill("50,00");
  await billing.getByLabel(t.effectiveFrom, { exact: true }).fill("2020-01-01");
  let saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await billing.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: t.overview })).toContainText("50,00");

  // Now a much higher rate starting today. The hour worked a month ago must not move.
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const again = page.getByRole("region", { name: t.billingTitle });
  await waitForHydration(again.getByLabel(t.amount, { exact: true }));
  await again.getByLabel(t.applies, { exact: true }).selectOption("project");
  await again.getByLabel(t.project, { exact: true }).selectOption({ label: `${code} · Historic ${code}` });
  await again.getByLabel(t.amount, { exact: true }).fill("500,00");
  await again.getByLabel(t.effectiveFrom, { exact: true }).fill(today);
  saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await again.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  const overview = page.getByRole("region", { name: t.overview });
  // Still fifty: the hour is valued with the rate of the day it was worked, not today's.
  await expect(overview).toContainText("50,00");
  await expect(overview).not.toContainText("500,00");
});

test("prices a project by its kind of work, and a project rate still wins", async ({ page }) => {
  const suffix = randomUUID().slice(0, 6);
  const typeCode = `svc-${suffix}`;
  const typeName = `Servei ${suffix}`;
  const workedOn = new Date(Date.now() - (60 + Math.floor(Math.random() * 800)) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // ---------------------------------------------------------------- a kind of work, with a price
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const services = page.getByRole("region", { name: t.serviceTitle });
  const serviceName = services.getByLabel(t.serviceName, { exact: true });
  await waitForHydration(serviceName);
  await serviceName.fill(typeName);
  await services.getByLabel(t.serviceCode, { exact: true }).fill(typeCode);
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/service-types") && r.request().method() === "POST"
  );
  await services.getByRole("button", { name: t.serviceAdd }).click();
  expect((await created).status()).toBe(201);

  const billing = page.getByRole("region", { name: t.billingTitle });
  await billing.getByLabel(t.applies, { exact: true }).selectOption("service_type");
  await billing.getByLabel(t.scopeServiceType, { exact: true }).selectOption({ label: typeName });
  await billing.getByLabel(t.amount, { exact: true }).fill("70,00");
  await billing.getByLabel(t.effectiveFrom, { exact: true }).fill(workedOn);
  let saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await billing.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  // ---------------------------------------------------------------- a project of that kind
  const code = `st-${suffix}`;
  await page.goto("/ca/projects", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: t.newProject });
  await waitForHydration(open);
  await open.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Codi del projecte", { exact: true }).fill(code);
  await dialog.getByLabel("Nom del projecte", { exact: true }).fill(`Tipus ${code}`);
  await dialog.getByLabel("Client", { exact: true }).selectOption({ index: 0 });
  await dialog.getByLabel(t.serviceTitle, { exact: true }).selectOption({ label: typeName });
  await dialog.getByRole("button", { name: "Crear" }).click();

  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("link").click();
  const projectUrl = page.url();

  const quickLog = page.getByRole("region", { name: "Registre rapid" });
  const duration = quickLog.getByLabel(t.duration, { exact: true });
  await waitForHydration(duration);
  await duration.fill("1h");
  await quickLog.getByLabel(t.spentOn, { exact: true }).fill(workedOn);
  const logged = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/time-entries") && r.request().method() === "POST"
  );
  await duration.press("Enter");
  expect((await logged).status()).toBe(201);

  // One hour at 70.00 for this kind of work, because nothing more specific exists. The seeded
  // customers carry no rate of their own, so this is the only price that can resolve.
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: t.overview })).toContainText("70,00");

  // ---------------------------------------------------------------- and the project's own wins
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const own = page.getByRole("region", { name: t.billingTitle });
  await waitForHydration(own.getByLabel(t.amount, { exact: true }));
  await own.getByLabel(t.applies, { exact: true }).selectOption("project");
  await own.getByLabel(t.project, { exact: true }).selectOption({ label: `${code} · Tipus ${code}` });
  await own.getByLabel(t.amount, { exact: true }).fill("110,00");
  await own.getByLabel(t.effectiveFrom, { exact: true }).fill(workedOn);
  saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await own.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  const overview = page.getByRole("region", { name: t.overview });
  await expect(overview).toContainText("110,00");
  await expect(overview).not.toContainText("70,00");
});

test("withdraws a rate typed wrong and publishes the right one the same day", async ({ page }) => {
  const code = `an-${randomUUID().slice(0, 6)}`;
  const workedOn = new Date(Date.now() - (60 + Math.floor(Math.random() * 800)) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  await page.goto("/ca/projects", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: t.newProject });
  await waitForHydration(open);
  await open.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Codi del projecte", { exact: true }).fill(code);
  await dialog.getByLabel("Nom del projecte", { exact: true }).fill(`Correccio ${code}`);
  await dialog.getByLabel("Client", { exact: true }).selectOption({ index: 0 });
  await dialog.getByRole("button", { name: "Crear" }).click();

  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("link").click();
  const projectUrl = page.url();

  const quickLog = page.getByRole("region", { name: "Registre rapid" });
  const duration = quickLog.getByLabel(t.duration, { exact: true });
  await waitForHydration(duration);
  await duration.fill("1h");
  await quickLog.getByLabel(t.spentOn, { exact: true }).fill(workedOn);
  const logged = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/time-entries") && r.request().method() === "POST"
  );
  await duration.press("Enter");
  expect((await logged).status()).toBe(201);

  // 900,00 an hour instead of 90,00: a decimal point in the wrong place.
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const billing = page.getByRole("region", { name: t.billingTitle });
  await waitForHydration(billing.getByLabel(t.amount, { exact: true }));
  await billing.getByLabel(t.applies, { exact: true }).selectOption("project");
  await billing.getByLabel(t.project, { exact: true }).selectOption({ label: `${code} · Correccio ${code}` });
  await billing.getByLabel(t.amount, { exact: true }).fill("900,00");
  await billing.getByLabel(t.effectiveFrom, { exact: true }).fill(workedOn);
  let saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await billing.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: t.overview })).toContainText("900,00");

  // Withdraw it: two clicks, because it cannot be undone.
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const table = page.getByRole("region", { name: t.billingTitle });
  /**
   * Located by the project, not by the amount.
   *
   * Filtering on `900,00` found the row a previous run of this test had already withdrawn -- which
   * has no withdraw button -- because the fixture database keeps what earlier runs published. The
   * project code is generated per run, so it names exactly one row and stays true however many
   * times this has run before.
   */
  const wrongRow = table.getByRole("row").filter({ hasText: code });
  const withdraw = wrongRow.getByRole("button", { name: new RegExp(`^${t.annul}`) });
  await waitForHydration(withdraw);
  await withdraw.click();
  const annulled = page.waitForResponse((r) => /\/annul$/.test(r.url()) && r.request().method() === "POST");
  await wrongRow.getByRole("button", { name: t.annulConfirm }).click();
  expect((await annulled).status()).toBe(200);
  await expect(table).toContainText(t.annulled);

  // The same project, the same currency and the same day: only possible because the wrong row was
  // withdrawn rather than left in force.
  const again = page.getByRole("region", { name: t.billingTitle });
  await again.getByLabel(t.applies, { exact: true }).selectOption("project");
  await again.getByLabel(t.project, { exact: true }).selectOption({ label: `${code} · Correccio ${code}` });
  await again.getByLabel(t.amount, { exact: true }).fill("90,00");
  await again.getByLabel(t.effectiveFrom, { exact: true }).fill(workedOn);
  saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await again.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  const overview = page.getByRole("region", { name: t.overview });
  await expect(overview).toContainText("90,00");
  await expect(overview).not.toContainText("900,00");
});

test("writes the code from the name and lets a service type be taken away again", async ({ page }) => {
  const suffix = randomUUID().slice(0, 6);

  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const services = page.getByRole("region", { name: t.serviceTitle });
  const name = services.getByLabel(t.serviceName, { exact: true });
  const code = services.getByLabel(t.serviceCode, { exact: true });
  await waitForHydration(name);

  // ---------------------------------------------------------------- the code writes itself
  // Accents dropped, capitals lowered, the space turned into the dash nobody had to type.
  const typeName = `Pàgina Web ${suffix}`;
  await name.fill(typeName);
  await expect(code).toHaveValue(`pagina-web-${suffix}`);

  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/service-types") && r.request().method() === "POST"
  );
  await services.getByRole("button", { name: t.serviceAdd }).click();
  expect((await created).status()).toBe(201);
  await expect(services).toContainText(typeName);
  // And the form is empty again, code included, ready for the next one.
  await expect(code).toHaveValue("");

  // ---------------------------------------------------------------- taken away when unused
  const chip = page.getByRole("listitem").filter({ hasText: typeName });
  await chip.getByRole("button", { name: new RegExp(`^${t.removeService}`) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Cap projecte ni cap barem");
  const removed = page.waitForResponse(
    (r) => /\/service-types\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === "DELETE"
  );
  await dialog.getByRole("button", { name: t.removeService, exact: true }).click();
  expect((await removed).status()).toBe(200);
  await expect(page.getByRole("region", { name: t.serviceTitle })).not.toContainText(typeName);
});

test("refuses to delete a service type with a published rate and deactivates it instead", async ({ page }) => {
  const suffix = randomUUID().slice(0, 6);
  const typeName = `Servei ${suffix}`;

  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const services = page.getByRole("region", { name: t.serviceTitle });
  const name = services.getByLabel(t.serviceName, { exact: true });
  await waitForHydration(name);
  await name.fill(typeName);
  let response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/service-types") && r.request().method() === "POST"
  );
  await services.getByRole("button", { name: t.serviceAdd }).click();
  expect((await response).status()).toBe(201);

  // A rate under it, which is what makes deleting it impossible.
  const billing = page.getByRole("region", { name: t.billingTitle });
  await billing.getByLabel(t.applies, { exact: true }).selectOption("service_type");
  await billing.getByLabel(t.scopeServiceType, { exact: true }).selectOption({ label: typeName });
  await billing.getByLabel(t.amount, { exact: true }).fill("65,00");
  await billing.getByLabel(t.effectiveFrom, { exact: true }).fill("2026-01-09");
  response = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await billing.getByRole("button", { name: t.publish }).click();
  expect((await response).status()).toBe(201);

  // The x offers deactivation, not deletion, and says why.
  await page.reload({ waitUntil: "domcontentloaded" });
  const chip = page.getByRole("listitem").filter({ hasText: typeName });
  const remove = chip.getByRole("button", { name: new RegExp(`^${t.removeService}`) });
  await waitForHydration(remove);
  await remove.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("No es pot treure");
  const deactivate = page.waitForResponse(
    (r) => /\/service-types\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === "PATCH"
  );
  await dialog.getByRole("button", { name: t.deactivateService, exact: true }).click();
  expect((await deactivate).status()).toBe(200);

  // It is still listed, because its rate is, and it is no longer on offer for new work.
  const listed = page.getByRole("region", { name: t.serviceTitle });
  await expect(listed).toContainText(typeName);
  await expect(listed.getByRole("button", { name: new RegExp(`^${t.reactivateService}`) }).first()).toBeVisible();

  const picker = page.getByRole("region", { name: t.billingTitle });
  await picker.getByLabel(t.applies, { exact: true }).selectOption("service_type");
  await expect(picker.getByLabel(t.scopeServiceType, { exact: true })).not.toContainText(typeName);
});
