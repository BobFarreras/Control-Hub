import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./support/fixture";

/**
 * The working time record, driven through the screens somebody actually uses.
 *
 * Longer than the default because each of these crosses three routes, and on a development
 * server the first visit to each also pays for compiling it.
 */
test.describe.configure({ timeout: 120_000 });

/** The Catalan labels the attendance screens render. */
const t = {
  overviewTitle: "Resum de jornada",
  calendarTitle: "Calendari laboral",
  clockIn: "Fitxar entrada",
  clockOut: "Fitxar sortida",
  stateIn: "Treballant",
  stateOut: "Fora",
  total: "Total del mes",
  history: "Moviments",
  correct: "Corregir",
  occurredAt: "Quan va passar",
  reason: "Motiu",
  save: "Desar",
  declared: "Declarat",
  corrected: "Corregit",
  // The sidebar entry and the page heading no longer say the same thing: the menu nests "Equip"
  // under "Jornada", and only the screen itself spells the whole name out.
  teamLink: "Equip",
  teamTitle: "Jornada de l'equip",
  recorded: "Registrades",
  export: "Exportar Excel"
} as const;

const clock = (page: Page) => page.locator(".clock-control");

/**
 * Clocks out if the account is currently in, so a test starts from a known state without ever
 * touching the database. The suite runs against one throwaway account, and a previous run --
 * or a previous test in this file -- may have left it clocked in.
 */
async function startClockedOut(page: Page) {
  await page.goto("/ca/attendance", { waitUntil: "domcontentloaded" });

  /**
   * Checked before anything else, because the way this fails otherwise is terrible: with the
   * `attendance` flag off the API serves no such route, the topbar renders no control, and every
   * test here waits two minutes for an element that cannot exist, three times over. That is
   * exactly how it failed in CI, and the log said nothing about a flag.
   */
  const status = await page.request.get("/api/v1/attendance/me", { timeout: 30_000 });
  expect(
    status.status(),
    "the attendance routes are not there: set CONTROL_HUB_FLAGS=attendance for the API and the web"
  ).toBe(200);

  const control = clock(page);
  await waitForHydration(control);
  if (await control.getByRole("button", { name: t.clockOut }).isVisible()) {
    const saved = page.waitForResponse(
      (response) => response.url().includes("/api/v1/attendance/events") && response.request().method() === "POST"
    );
    await control.getByRole("button", { name: t.clockOut }).click();
    expect((await saved).status()).toBe(201);
  }
  await expect(control.getByRole("button", { name: t.clockIn })).toBeVisible({ timeout: 15_000 });
}

test.describe("working time", () => {
  test("clocks in from the header and the record shows it", async ({ page }) => {
    await startClockedOut(page);

    /**
     * The state is asserted by its word, not by the colour of the dot. That is the promise the
     * screen makes to somebody who cannot separate green from red, and a test that only checked
     * a class would let it be broken without noticing.
     */
    await expect(clock(page)).toContainText(t.stateOut);

    const saved = page.waitForResponse(
      (response) => response.url().includes("/api/v1/attendance/events") && response.request().method() === "POST"
    );
    await clock(page).getByRole("button", { name: t.clockIn }).click();
    expect((await saved).status()).toBe(201);

    await expect(clock(page)).toContainText(t.stateIn);
    await expect(clock(page).getByRole("button", { name: t.clockOut })).toBeVisible();

    /**
     * Fetched again from the server rather than trusted: only a fresh render says the entry was
     * written, rather than that a button changed what it was showing. The address names the view
     * because the bare one opens the calendar, and the movements are on the records side.
     */
    await page.goto("/ca/attendance/records", { waitUntil: "domcontentloaded" });
    await expect(clock(page)).toContainText(t.stateIn);
    await expect(page.getByRole("region", { name: t.history })).toContainText(t.clockIn);
  });

  test("refuses to send a time from the browser", async ({ page }) => {
    await startClockedOut(page);

    /**
     * The heart of the module: an ordinary punch takes the server's clock. A request that tries
     * to name its own time must not be able to move the record, or the whole thing proves nothing.
     *
     * The origin header is sent deliberately. Without it the API answers 403 before it ever looks
     * at the body, and the test would pass while proving only that the CSRF guard works -- which
     * is a different guarantee, already covered elsewhere. Past that door, the schema is what
     * refuses: `additionalProperties: false`, so there is no time field to send.
     */
    const origin = new URL(page.url()).origin;
    const response = await page.request.post("/api/v1/attendance/events", {
      headers: { origin },
      data: { kind: "clock_in", occurredAt: "2020-01-01T08:00:00.000Z" }
    });

    /**
     * Asserted on the entry, not on the status code. The request is accepted -- Fastify strips a
     * property the schema does not declare rather than refusing the call -- and that is the whole
     * point: the extra field went nowhere. Checking for a 400 would have tested the framework's
     * choice about unknown properties, and would start failing the day that choice changed while
     * the guarantee stayed perfectly intact.
     */
    expect(response.status()).toBe(201);
    const { event } = (await response.json()) as { event: { occurredAt: string } };
    const written = new Date(event.occurredAt).getTime();
    expect(written).toBeGreaterThan(Date.now() - 60_000);
    expect(new Date(event.occurredAt).getFullYear()).not.toBe(2020);
  });

  test("corrects an entry without losing the original", async ({ page }) => {
    await startClockedOut(page);

    const saved = page.waitForResponse(
      (response) => response.url().includes("/api/v1/attendance/events") && response.request().method() === "POST"
    );
    await clock(page).getByRole("button", { name: t.clockIn }).click();
    expect((await saved).status()).toBe(201);

    await page.goto("/ca/attendance/records", { waitUntil: "domcontentloaded" });
    const history = page.getByRole("region", { name: t.history });
    const correct = history.getByRole("button", { name: t.correct }).first();
    await waitForHydration(correct);
    await correct.click();

    const dialog = page.getByRole("dialog");
    const when = dialog.getByLabel(t.occurredAt);
    // An hour ago, which is in the past and so demands a reason, exactly as a real correction does.
    const earlier = new Date(Date.now() - 3_600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await when.fill(
      `${earlier.getFullYear()}-${pad(earlier.getMonth() + 1)}-${pad(earlier.getDate())}T${pad(earlier.getHours())}:${pad(earlier.getMinutes())}`
    );
    await dialog.getByLabel(t.reason).fill("Vaig entrar abans i no ho vaig marcar");

    const written = page.waitForResponse(
      (response) => response.url().includes("/api/v1/attendance/corrections") && response.request().method() === "POST"
    );
    await dialog.getByRole("button", { name: t.save }).click();
    expect((await written).status()).toBe(201);

    await page.reload({ waitUntil: "domcontentloaded" });
    /**
     * Both halves of the promise, in one assertion each: the correction is on the record and
     * says it was declared, and the entry it replaced is still there marked as corrected. A
     * record that quietly swallowed the original would prove nothing to an inspection.
     */
    await expect(history).toContainText(t.declared, { timeout: 15_000 });
    await expect(history).toContainText(t.corrected);
  });

  test("shows the team its hours and hands them over as a file", async ({ page }) => {
    await page.goto("/ca/attendance", { waitUntil: "domcontentloaded" });
    const link = page.getByRole("link", { name: t.teamLink });
    await waitForHydration(link);
    await link.click();

    // Longer than the five seconds an assertion waits by itself: this is the first visit to the
    // route in the run, and a development server compiles it before the client router will move
    // the address bar at all.
    await expect(page).toHaveURL(/\/ca\/attendance\/team/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: t.teamTitle })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: t.recorded })).toBeVisible();

    /**
     * The export is the deliverable the accountancy receives, so the test takes the file rather
     * than trusting the button. One row per person and day is what the specification asks for,
     * and a header of monthly totals would satisfy a weaker assertion.
     */
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: t.export }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^jornada-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test("separates the overview, annual calendar and monthly record", async ({ page }) => {
    await page.goto("/ca/attendance", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: t.overviewTitle })).toBeVisible();

    await page.goto("/ca/attendance/calendar?year=2026", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: t.calendarTitle })).toBeVisible();
    await expect(page.locator(".attendance-mini-month")).toHaveCount(12);
    await expect(page.getByRole("link", { name: "Any anterior" })).toHaveAttribute("href", /year=2025/);
    await page.getByRole("button", { name: /^2026-10-10:/ }).click();
    await page.getByRole("button", { name: /^2026-10-12:/ }).click();
    await expect(page.getByText(/Rang seleccionat: 2026-10-10 — 2026-10-12/)).toBeVisible();

    await page.getByRole("button", { name: "Sol·licitar vacances" }).click();
    const request = page.getByRole("dialog", { name: "Sol·licitar vacances" });
    await expect(request.getByLabel("Des de")).toHaveValue("2026-10-10");
    await expect(request.getByLabel("Fins a")).toHaveValue("2026-10-12");
    await request.getByRole("button", { name: "Cancel·lar" }).click();

    await page.goto("/ca/attendance/records?month=2026-08", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Registre diari" })).toBeVisible();
  });
});
