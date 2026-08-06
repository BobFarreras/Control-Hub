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
  await dialog.getByLabel("Codi del projecte").fill(code);
  await dialog.getByLabel("Nom del projecte").fill(`Barems ${code}`);
  await dialog.getByLabel("Client").selectOption({ index: 0 });
  await dialog.getByRole("button", { name: "Crear" }).click();

  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/ca\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  // Two hours exactly, so the arithmetic below has no rounding to argue about.
  const quickLog = page.getByRole("region", { name: "Registre rapid" });
  const duration = quickLog.getByLabel(t.duration);
  await waitForHydration(duration);
  await duration.fill("2h");
  await quickLog.getByLabel(t.spentOn).fill(workedOn);
  const logged = page.waitForResponse((r) => r.url().endsWith("/api/v1/time-entries") && r.request().method() === "POST");
  await duration.press("Enter");
  expect((await logged).status()).toBe(201);

  // ------------------------------------------------------------------ publish the two rates
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const cost = page.getByRole("region", { name: t.costTitle });
  const amount = cost.getByLabel(t.amount);
  await waitForHydration(amount);

  // 30.00 an hour of cost, in force from the day the work was done.
  await cost.getByLabel(t.member).selectOption({ index: 0 });
  await amount.fill("30,00");
  await cost.getByLabel(t.effectiveFrom).fill(workedOn);
  const costSaved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/cost") && r.request().method() === "POST");
  await cost.getByRole("button", { name: t.publish }).click();
  expect((await costSaved).status()).toBe(201);

  // 90.00 an hour of sale, on this project.
  const billing = page.getByRole("region", { name: t.billingTitle });
  await billing.getByLabel(t.applies).selectOption("project");
  await billing.getByLabel(t.project).selectOption({ label: `${code} · Barems ${code}` });
  await billing.getByLabel(t.amount).fill("90,00");
  await billing.getByLabel(t.effectiveFrom).fill(workedOn);
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
  await dialog.getByLabel("Codi del projecte").fill(code);
  await dialog.getByLabel("Nom del projecte").fill(`Historic ${code}`);
  await dialog.getByLabel("Client").selectOption({ index: 0 });
  await dialog.getByRole("button", { name: "Crear" }).click();

  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("link").click();
  const projectUrl = page.url();

  // An hour worked a month ago.
  const workedOn = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const quickLog = page.getByRole("region", { name: "Registre rapid" });
  const duration = quickLog.getByLabel(t.duration);
  await waitForHydration(duration);
  await duration.fill("1h");
  await quickLog.getByLabel(t.spentOn).fill(workedOn);
  const logged = page.waitForResponse((r) => r.url().endsWith("/api/v1/time-entries") && r.request().method() === "POST");
  await duration.press("Enter");
  expect((await logged).status()).toBe(201);

  // A sale rate of 50.00 that was already in force then.
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const billing = page.getByRole("region", { name: t.billingTitle });
  await waitForHydration(billing.getByLabel(t.amount));
  await billing.getByLabel(t.applies).selectOption("project");
  await billing.getByLabel(t.project).selectOption({ label: `${code} · Historic ${code}` });
  await billing.getByLabel(t.amount).fill("50,00");
  await billing.getByLabel(t.effectiveFrom).fill("2020-01-01");
  let saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await billing.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: t.overview })).toContainText("50,00");

  // Now a much higher rate starting today. The hour worked a month ago must not move.
  await page.goto("/ca/projects/rates", { waitUntil: "domcontentloaded" });
  const again = page.getByRole("region", { name: t.billingTitle });
  await waitForHydration(again.getByLabel(t.amount));
  await again.getByLabel(t.applies).selectOption("project");
  await again.getByLabel(t.project).selectOption({ label: `${code} · Historic ${code}` });
  await again.getByLabel(t.amount).fill("500,00");
  await again.getByLabel(t.effectiveFrom).fill(today);
  saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/rates/billing") && r.request().method() === "POST");
  await again.getByRole("button", { name: t.publish }).click();
  expect((await saved).status()).toBe(201);

  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  const overview = page.getByRole("region", { name: t.overview });
  // Still fifty: the hour is valued with the rate of the day it was worked, not today's.
  await expect(overview).toContainText("50,00");
  await expect(overview).not.toContainText("500,00");
});
