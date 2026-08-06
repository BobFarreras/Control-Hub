import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./support/fixture";

/**
 * The Catalan labels the projects screens render. Kept together so a wording change is one edit.
 */
const t = {
  listTitle: "Projectes",
  newProject: "Nou projecte",
  customer: "Client",
  projectCode: "Codi del projecte",
  projectName: "Nom del projecte",
  create: "Crear",
  statusOf: "Estat del projecte",
  logTime: "Imputar hores",
  duration: "Durada",
  spentOn: "Dia treballat",
  save: "Desar",
  entries: "Imputacions",
  overview: "Resum",
  entriesUnpriced: "imputacions sense valorar",
  projectClosed: "El projecte esta tancat i no accepta hores noves.",
  closed: "Tancat",
  totalHours: "Hores totals",
  quickLog: "Registre rapid"
} as const;

const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });

/**
 * A project of its own per run rather than a seeded one.
 *
 * The suite creates what it asserts on, so it exercises the dialog that an administrator
 * actually uses, and two runs against the same database cannot collide on the project code,
 * which is unique per tenant.
 */
async function createProject(page: Page): Promise<{ code: string; name: string }> {
  const code = `e2e-${randomUUID().slice(0, 8)}`;
  const name = `Projecte E2E ${code}`;

  await page.goto("/ca/projects", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: t.newProject });
  await waitForHydration(open);
  await open.click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(t.projectCode, { exact: true }).fill(code);
  await dialog.getByLabel(t.projectName, { exact: true }).fill(name);
  // Whichever customer the seed created first; the point is that a project needs one.
  await dialog.getByLabel(t.customer, { exact: true }).selectOption({ index: 0 });

  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/projects") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: t.create }).click();
  expect((await created).status()).toBe(201);

  await expect(row(page, name)).toBeVisible({ timeout: 15_000 });
  return { code, name };
}

/**
 * Longer than the default thirty seconds because each of these drives several screens: create a
 * project, open it, write to it and read it back. Against a development server the first visit
 * to each route also pays for compiling it, and the support specs never noticed because they
 * each exercise one screen.
 */
test.describe("projects", () => {
  test.describe.configure({ timeout: 120_000 });

  test("opens a project, logs time against it and prices what it can", async ({ page }) => {
    const { name } = await createProject(page);

    await row(page, name).getByRole("link").click();
    await expect(page).toHaveURL(/\/ca\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();

    // ---------------------------------------------------------------- logging time
    const duration = page.getByLabel(t.duration, { exact: true });
    await waitForHydration(duration);
    // Written rather than in minutes, because that is the form people will actually type into.
    await duration.fill("1h 30m");

    const logged = page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/time-entries") && response.request().method() === "POST"
    );
    /**
     * Submitted from the field rather than by clicking the button. It is the faster path a
     * person logging hours every day will take anyway, and it does not have to compete with the
     * Next.js dev tools overlay, which floats over that corner of the page in development and
     * intercepts the click.
     */
    await duration.press("Enter");
    expect((await logged).status()).toBe(201);

    await page.reload({ waitUntil: "domcontentloaded" });
    const entries = page.getByRole("region", { name: t.entries });
    await expect(entries).toContainText("1 h 30 min");
    // And the header agrees with the table: the same hours, counted once.
    await expect(page.getByRole("region", { name: t.overview })).toContainText("1 h 30 min");

    // ---------------------------------------------------------------- what it is worth
    /**
     * The account is an Owner, so it has `financials:read` and the figures are rendered. This
     * project has no billing rate, so the margin has to report that an entry could not be priced
     * rather than quietly counting those hours as free: a margin of a hundred per cent is the most
     * flattering possible way to be wrong.
     *
     * Asserted on the unpriced count, not on "no rate published at all". Once the rates suite has
     * run, a cost rate for the only member exists in this database and applies to every project, so
     * "nothing is priced" holds only where nobody has ever published a rate. What stays true is
     * that this project's hours could not be given a price.
     */
    const overview = page.getByRole("region", { name: t.overview });
    await expect(overview).toContainText(t.entriesUnpriced);
  });

  test("refuses new hours once the project is closed", async ({ page }) => {
    const { name } = await createProject(page);
    await row(page, name).getByRole("link").click();

    const status = page.getByLabel(t.statusOf, { exact: true });
    await waitForHydration(status);

    // draft does not close directly; it goes through active, which is the path the domain allows.
    for (const next of ["active", "closed"]) {
      const saved = page.waitForResponse(
        (response) => response.url().includes("/status") && response.request().method() === "PATCH"
      );
      await status.selectOption(next);
      expect((await saved).status()).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    await expect(page.getByLabel(t.statusOf, { exact: true })).toHaveValue("closed");
    // The form is closed too, and says why rather than failing on submit.
    await expect(page.getByLabel(t.duration, { exact: true })).toBeDisabled();
    await expect(page.getByText(t.projectClosed)).toBeVisible();
  });
});
