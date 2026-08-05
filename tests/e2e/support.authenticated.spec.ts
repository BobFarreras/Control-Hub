import { expect, test, type Page } from "@playwright/test";
import { readFixture, waitForHydration } from "./support/fixture";

const fixture = readFixture();

/** The Catalan support labels the screens render. Kept together so a wording change is one edit. */
const t = {
  inboxTitle: "Safata de tickets",
  due: "Compromis",
  breached: "Incomplert",
  remaining: "Queden",
  notMeasured: "Sense horari configurat",
  status: "Estat",
  assignee: "Responsable",
  unassigned: "Sense assignar",
  new: "Nou",
  open: "Obert",
  internalNote: "Nota interna",
  customerReply: "Visible per al client"
} as const;

const row = (page: Page, subject: string) => page.getByRole("row").filter({ hasText: subject });
const message = (page: Page, body: string) => page.locator("article.ticket-message").filter({ hasText: body });

test.describe("support inbox", () => {
  test("lists the seeded tickets with their commitment", async ({ page }) => {
    await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: t.inboxTitle })).toBeVisible();

    for (const subject of Object.values(fixture.subjects))
      await expect(row(page, subject)).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("columnheader", { name: new RegExp(t.due) })).toBeVisible();

    /**
     * Both branches of the column, on tickets seeded so the answer cannot depend on when the
     * run happens: one opened a quarter ago against a fifteen minute target is past it under
     * any calendar, and one opened moments ago against an eight hour target is inside it.
     */
    await expect(row(page, fixture.subjects.breached)).toContainText(t.breached);
    await expect(row(page, fixture.subjects.within)).toContainText(t.remaining);

    // A schedule is configured, so nothing may report itself as unmeasured. That state exists
    // to stop an absent configuration from reading as compliance, and here it would be a lie.
    await expect(page.getByText(t.notMeasured)).toHaveCount(0);
  });

  test("opens a ticket from the inbox", async ({ page }) => {
    await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
    await row(page, fixture.subjects.conversation).getByRole("link").click();

    await expect(page).toHaveURL(new RegExp(`/ca/support/${fixture.tickets.conversation}$`));
    await expect(page.getByRole("heading", { level: 2, name: fixture.subjects.conversation })).toBeVisible();
  });
});

test.describe("ticket detail", () => {
  test("shows the conversation and marks the internal note in the DOM", async ({ page }) => {
    await page.goto(`/ca/support/${fixture.tickets.conversation}`, { waitUntil: "domcontentloaded" });

    const internal = message(page, fixture.internalNote);
    const customer = message(page, fixture.customerReply);
    await expect(internal).toBeVisible();
    await expect(customer).toBeVisible();

    /**
     * The principal threat of the phase, per `docs/specifications/support.md`: a note the
     * customer must never see has to be distinguishable by something other than colour.
     *
     * Both carriers are asserted. The accessible name is what a screen reader announces, and
     * the visible text is what survives high contrast, a greyscale display, or a printout.
     */
    await expect(internal).toHaveAttribute("aria-label", t.internalNote);
    await expect(internal).toContainText(t.internalNote);

    await expect(customer).toHaveAttribute("aria-label", t.customerReply);
    await expect(customer).toContainText(t.customerReply);

    // And within the thread the two are not interchangeable: exactly one message answers to
    // each label, and it is the one carrying the matching body. Scoped to the thread because
    // the reply form below offers both words as options in its visibility dropdown.
    const thread = page.locator("section.ticket-thread");
    await expect(thread.getByLabel(t.internalNote)).toHaveCount(1);
    await expect(thread.getByLabel(t.customerReply)).toHaveCount(1);
    await expect(thread.getByLabel(t.internalNote)).toContainText(fixture.internalNote);
    await expect(thread.getByLabel(t.customerReply)).toContainText(fixture.customerReply);
  });

  test("changes the status from the ticket", async ({ page }) => {
    await page.goto(`/ca/support/${fixture.tickets.transition}`, { waitUntil: "domcontentloaded" });

    const status = page.getByLabel(t.status);
    await waitForHydration(status);
    await expect(status).toHaveValue("new");

    const saved = page.waitForResponse(
      (response) =>
        response.url().includes(`/${fixture.tickets.transition}/status`) && response.request().method() === "PATCH"
    );
    await status.selectOption("open");
    expect((await saved).status()).toBe(200);

    /**
     * Reloaded rather than trusted. The dropdown is a controlled component, so its value
     * changes the instant it is clicked whether or not anything was written; only a fresh
     * render from the server says the transition actually happened.
     */
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(t.status)).toHaveValue("open");

    await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
    await expect(row(page, fixture.subjects.transition)).toContainText(t.open);
  });

  test("assigns the ticket from the ticket", async ({ page }) => {
    await page.goto(`/ca/support/${fixture.tickets.assignment}`, { waitUntil: "domcontentloaded" });

    const assignee = page.getByLabel(t.assignee);
    await waitForHydration(assignee);
    await expect(assignee).toHaveValue("");

    const saved = page.waitForResponse(
      (response) =>
        response.url().includes(`/${fixture.tickets.assignment}/assignment`) && response.request().method() === "PATCH"
    );
    await assignee.selectOption({ label: fixture.ownerName });
    expect((await saved).status()).toBe(200);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(t.assignee)).toHaveValue(fixture.membershipId);

    // And the inbox agrees, which is the column an administrator distributes work by.
    await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
    await expect(row(page, fixture.subjects.assignment)).toContainText(fixture.ownerName);
    await expect(row(page, fixture.subjects.assignment)).not.toContainText(t.unassigned);
  });
});
