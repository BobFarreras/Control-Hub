import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { readFixture, selectFieldOption, selectFieldValue, waitForHydration } from "./support/fixture";

const fixture = readFixture();

/** The Catalan support labels the screens render. Kept together so a wording change is one edit. */
const t = {
  inboxTitle: "Safata de tickets",
  due: "Objectiu",
  breached: "Incomplert",
  notMeasured: "Sense horari configurat",
  status: "Estat",
  assignee: "Responsable",
  unassigned: "Sense assignar",
  new: "Nou",
  open: "Obert",
  internalNote: "Nota interna",
  customerReply: "Visible per al client",
  newTicket: "Nou ticket",
  customer: "Client",
  subject: "Assumpte",
  ticketDescription: "Descripcio del ticket",
  create: "Crear",
  columnCreated: "Creat",
  columnSlaStatus: "Estat SLA",
  slaStatusOnTime: "A temps",
  slaStatusBreached: "Incomplert",
  slaDetailTitle: "Detall d'objectiu SLA"
} as const;

const row = (page: Page, subject: string) => page.getByRole("row").filter({ hasText: subject });
/**
 * The metadata sidebar of a ticket, and the scope every control on it is looked for in.
 *
 * The sidebar itself is labelled "Estat", exactly like the status control inside it, so an
 * unscoped `getByLabel` finds two elements and fails on strict mode rather than on the product.
 */
const meta = (page: Page) => page.locator("aside.ticket-meta");
const message = (page: Page, body: string) => page.locator("article.ticket-message").filter({ hasText: body });

/**
 * The inbox filtered down to one subject.
 *
 * Reading the first page instead only works while the database is nearly empty. The suite opens
 * tickets of its own on every run, they are the newest rows, and twenty five of them are enough to
 * push a seeded ticket out of sight; the test would then fail describing an inbox that is fine.
 */
const inboxSearch = (subject: string) => `/ca/support?search=${encodeURIComponent(subject)}`;

/**
 * A ticket of this test's own, opened through the dialog an administrator actually uses.
 *
 * The tests below move a ticket somewhere it cannot come back from: `new` to `open` is a one way
 * transition, and an assignee cannot be unset from the screen. A seeded row therefore passes only
 * on the first attempt — Playwright's own retry, and every later run against the same database,
 * would find the ticket already in the state the test means to move it to, which is exactly how a
 * green suite turned red on a retry without any product change behind it.
 */
async function createTicket(page: Page): Promise<{ id: string; subject: string }> {
  const subject = `E2E ticket propi ${randomUUID().slice(0, 8)}`;

  await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: t.newTicket });
  await waitForHydration(open);
  await open.click();

  /**
   * Located by accessible name, and not as a `combobox`.
   *
   * These fields stopped being native `<select>` elements: a themed select is a trigger button
   * with `aria-haspopup="listbox"` beside a hidden `<select>` that carries the form value. The
   * hidden one is `aria-hidden`, so nothing in this form answers to the `combobox` role any more
   * and a locator asking for one waits fifteen seconds on a dialog that is plainly on screen.
   *
   * `getByLabel` with an exact name reaches the trigger through its `aria-label`, and not the
   * `<label>` wrapped around the pair: for a wrapped select the label text Playwright matches on
   * includes every option — "ClientFar Harbour LogisticsTramuntana Foods…" — which no exact match
   * for "Client" can hit.
   */
  const dialog = page.getByRole("dialog");
  // Whichever customer the seed created first; the point is that a ticket needs one.
  await selectFieldOption(dialog.getByLabel(t.customer, { exact: true }), { index: 0 });
  await dialog.getByRole("textbox", { name: t.subject, exact: true }).fill(subject);
  await dialog.getByRole("textbox", { name: t.ticketDescription, exact: true }).fill("Obert per la prova end-to-end.");

  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/support/tickets") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: t.create }).click();
  const response = await created;
  expect(response.status()).toBe(201);

  const { ticket } = (await response.json()) as { ticket: { id: string } };
  return { id: ticket.id, subject };
}

test.describe("support inbox", () => {
  test("lists the seeded tickets with their commitment", async ({ page }) => {
    await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: t.inboxTitle })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: new RegExp(t.due) })).toBeVisible();

    // A schedule is configured, so nothing may report itself as unmeasured. That state exists
    // to stop an absent configuration from reading as compliance, and here it would be a lie.
    await expect(page.getByText(t.notMeasured)).toHaveCount(0);

    for (const subject of Object.values(fixture.subjects)) {
      await page.goto(inboxSearch(subject), { waitUntil: "domcontentloaded" });
      await expect(row(page, subject)).toBeVisible({ timeout: 15_000 });
    }

    /**
     * Both branches of the column, on tickets seeded so the answer cannot depend on when the
     * run happens: one opened a quarter ago against a fifteen minute target is past it under
     * any calendar, and one opened moments ago against an eight hour target is inside it.
     */
    await page.goto(inboxSearch(fixture.subjects.breached), { waitUntil: "domcontentloaded" });
    await expect(row(page, fixture.subjects.breached)).toContainText(t.breached);

    await page.goto(inboxSearch(fixture.subjects.within), { waitUntil: "domcontentloaded" });
    await expect(row(page, fixture.subjects.within)).toContainText(t.slaStatusOnTime);
  });

  test("shows the new columns: creation date and SLA status badge", async ({ page }) => {
    await page.goto("/ca/support", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: t.inboxTitle })).toBeVisible();

    // New column headers are present.
    await expect(page.getByRole("columnheader", { name: t.columnCreated })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: t.columnSlaStatus })).toBeVisible();

    // The breached ticket shows the "Incomplert" SLA badge.
    await page.goto(inboxSearch(fixture.subjects.breached), { waitUntil: "domcontentloaded" });
    await expect(row(page, fixture.subjects.breached).locator(".sla-badge")).toContainText(t.slaStatusBreached);

    // The within-target ticket shows the "A temps" SLA badge.
    await page.goto(inboxSearch(fixture.subjects.within), { waitUntil: "domcontentloaded" });
    await expect(row(page, fixture.subjects.within).locator(".sla-badge")).toContainText(t.slaStatusOnTime);
  });

  test("opens the SLA detail dialog when clicking the badge", async ({ page }) => {
    await page.goto(inboxSearch(fixture.subjects.breached), { waitUntil: "domcontentloaded" });
    const badge = row(page, fixture.subjects.breached).locator(".sla-badge");
    await waitForHydration(badge);
    await badge.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The dialog explains the target and the breach.
    await expect(dialog).toContainText(t.slaStatusBreached);
    await expect(dialog).toContainText(/objectiu/i);
  });

  test("opens a ticket from the inbox", async ({ page }) => {
    await page.goto(inboxSearch(fixture.subjects.conversation), { waitUntil: "domcontentloaded" });
    await row(page, fixture.subjects.conversation).getByRole("link").click();

    await expect(page).toHaveURL(new RegExp(`/ca/support/${fixture.tickets.conversation}$`));
    await expect(page.getByRole("heading", { level: 2, name: fixture.subjects.conversation })).toBeVisible();
  });
});

test.describe("ticket detail", () => {
  /**
   * Longer than the default thirty seconds because the two mutating tests open a ticket of their
   * own first, and against a development server the first visit to each route also pays for
   * compiling it. The read only test above never noticed because it drives one screen.
   */
  test.describe.configure({ timeout: 120_000 });

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
    const ticket = await createTicket(page);
    await page.goto(`/ca/support/${ticket.id}`, { waitUntil: "domcontentloaded" });

    const status = meta(page).getByLabel(t.status, { exact: true });
    await waitForHydration(status);
    // A ticket is born new, which is the state this test means to move it out of.
    await expect(selectFieldValue(status)).toHaveValue("new");

    const saved = page.waitForResponse(
      (response) => response.url().includes(`/${ticket.id}/status`) && response.request().method() === "PATCH"
    );
    await selectFieldOption(status, "open");
    expect((await saved).status()).toBe(200);

    /**
     * Reloaded rather than trusted. The dropdown is a controlled component, so its value
     * changes the instant it is clicked whether or not anything was written; only a fresh
     * render from the server says the transition actually happened.
     */
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = meta(page).getByLabel(t.status, { exact: true });
    // Waited for, not asserted straight away: a reload re-renders on the server and rehydrates,
    // and the five seconds an assertion waits by itself are not always enough for both.
    await waitForHydration(reloaded);
    await expect(selectFieldValue(reloaded)).toHaveValue("open");

    await page.goto(inboxSearch(ticket.subject), { waitUntil: "domcontentloaded" });
    await expect(row(page, ticket.subject)).toContainText(t.open, { timeout: 15_000 });
  });

  test("assigns the ticket from the ticket", async ({ page }) => {
    const ticket = await createTicket(page);
    await page.goto(`/ca/support/${ticket.id}`, { waitUntil: "domcontentloaded" });

    const assignee = meta(page).getByLabel(t.assignee, { exact: true });
    await waitForHydration(assignee);
    await expect(selectFieldValue(assignee)).toHaveValue("");

    const saved = page.waitForResponse(
      (response) => response.url().includes(`/${ticket.id}/assignment`) && response.request().method() === "PATCH"
    );
    await selectFieldOption(assignee, { label: fixture.ownerName });
    expect((await saved).status()).toBe(200);

    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = meta(page).getByLabel(t.assignee, { exact: true });
    await waitForHydration(reloaded);
    await expect(selectFieldValue(reloaded)).toHaveValue(fixture.membershipId);

    // And the inbox agrees, which is the column an administrator distributes work by.
    await page.goto(inboxSearch(ticket.subject), { waitUntil: "domcontentloaded" });
    await expect(row(page, ticket.subject)).toContainText(fixture.ownerName, { timeout: 15_000 });
    await expect(row(page, ticket.subject)).not.toContainText(t.unassigned);
  });
});
