import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "./support/fixture";

/**
 * The integrations screen, driven the way an operator drives it.
 *
 * What this proves and unit tests cannot: that connecting something is **pick a platform, answer
 * what that platform asks, done** — the catalogue is a set of cards, choosing one draws the fields
 * that connector declares and no others, and the fields it already answers for itself are folded
 * away rather than put in front of somebody. That a configuration the connector refuses complains
 * **on the field that caused it**, in Catalan, without echoing what was typed. And that the state
 * of an integration on screen is the state the API actually holds after the round trip.
 *
 * One assertion here is a regression rather than a feature: the card for `generic-webhook` has to
 * show its translated name. A connector type is kebab-case and a translation key cannot be, so a
 * lookup built straight from the type misses and silently falls back to the raw type — which is
 * how `generic-webhook` reached an operator in a screen that was otherwise translated.
 *
 * It runs against a deployment without a key ring, which is what CI provides: nothing here can
 * hold a secret, so the field that would take one is absent by design, in the dialog and on the
 * integration's own page both. Those assertions matter because "the vault is unavailable" has to
 * look like a missing section rather than a form that fails on submit.
 *
 * The second test is deleting, which is the one gesture here that cannot be undone: the dialog
 * must not act on a name that was not typed exactly, and once it does act the integration has to
 * be gone from the listing rather than merely stopped. It also leaves the run clean, which is why
 * the integration it deletes is one it created.
 */
test.describe.configure({ timeout: 120_000 });

/** The Catalan labels the screen renders. Together, so a wording change is one edit. */
const t = {
  title: "Integracions",
  newIntegration: "Nova integracio",
  pickConnector: "Amb que et vols connectar?",
  webhookCard: "Webhook generic",
  integrationName: "Nom de la integracio",
  baseUrl: "Adreca de la instancia",
  advancedOptions: "Opcions avancades",
  windowHours: "Hores d'historic a la primera lectura",
  apiToken: "Token de l'API",
  create: "Crear",
  valueRefused: "Aquest valor no s'accepta.",
  refusedConfig: "La configuracio no la reconeix aquest connector.",
  credentials: "Credencials",
  enable: "Activar",
  disable: "Aturar",
  checkHealth: "Comprovar salut",
  enabled: "Activa",
  draft: "Esborrany",
  healthQueued: "Comprovacio demanada. El resultat apareixera a les execucions.",
  runs: "Execucions",
  deleteIntegration: "Esborrar",
  deleteConfirm: "Esborrar per sempre",
  confirmLabel: (name: string) => `Escriu ${name} per confirmar`,
  deleted: (name: string) => `${name} esborrada.`
} as const;

/** Connecting one, up to the point where its own page is open. Both tests start here. */
async function connect(page: import("@playwright/test").Page, name: string) {
  await page.goto("/ca/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: t.title, level: 1 })).toBeVisible();

  const open = page.getByRole("button", { name: t.newIntegration });
  await waitForHydration(open);
  await open.click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "n8n" }).click();
  await dialog.getByLabel(t.integrationName, { exact: true }).fill(name);
  await dialog.getByLabel(t.baseUrl, { exact: true }).fill("https://n8n.exemple.test");

  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/integrations") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: t.create }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 15_000 });
}

test("draws the form a connector asks for, refuses a value on its own field, and enables it", async ({ page }) => {
  const name = `Integracio E2E ${randomUUID().slice(0, 8)}`;

  await page.goto("/ca/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: t.title, level: 1 })).toBeVisible();

  const open = page.getByRole("button", { name: t.newIntegration });
  await waitForHydration(open);
  await open.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(t.pickConnector)).toBeVisible();

  /**
   * Every connector this build ships is offered by name, in the reader's language. A card reading
   * `generic-webhook` here is the untranslated fallback, and the whole catalogue is suspect.
   */
  await expect(dialog.getByRole("button", { name: t.webhookCard })).toBeVisible();
  await expect(dialog.getByText("generic-webhook")).toHaveCount(0);

  // Not `exact`: a card's accessible name is its whole text, mark plus name plus the line under it.
  await dialog.getByRole("button", { name: "n8n" }).click();

  /**
   * The point of the whole mechanism: choosing a connector produced its own fields, left nothing
   * to type raw, and did not put the two settings it already answers for itself in the way. They
   * exist — behind the disclosure — but a form that opens with them is a form somebody has to
   * research before they can submit it.
   */
  await expect(dialog.getByLabel(t.baseUrl, { exact: true })).toBeVisible();
  await expect(dialog.locator("textarea")).toHaveCount(0);
  await expect(dialog.getByLabel(t.windowHours, { exact: true })).toBeHidden();

  const advanced = dialog.getByText(t.advancedOptions);
  await expect(advanced).toBeVisible();
  await advanced.click();
  // Folded away, not omitted: opening the disclosure shows the connector's own default, so what
  // it is about to do is readable rather than something to be discovered later.
  await expect(dialog.getByLabel(t.windowHours, { exact: true })).toHaveValue("24");

  // Nothing in this deployment can hold a secret, so nothing offers to take one.
  await expect(dialog.getByLabel(t.apiToken, { exact: true })).toHaveCount(0);

  await dialog.getByLabel(t.integrationName, { exact: true }).fill(name);

  /**
   * A URL the browser is happy with and the connector is not: credentials in the base would be a
   * second, unsealed way to authenticate. The refusal has to arrive on the field, and the value
   * must not come back with it — what the API sends is a path and a code, never what was typed.
   */
  await dialog.getByLabel(t.baseUrl, { exact: true }).fill("https://intrus:secret@n8n.exemple.test");
  const refused = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/integrations") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: t.create }).click();
  expect((await refused).status()).toBe(422);
  await expect(dialog.getByRole("alert").filter({ hasText: t.valueRefused })).toBeVisible();
  await expect(dialog.getByRole("alert").filter({ hasText: t.refusedConfig })).toBeVisible();
  await expect(dialog.getByText("intrus")).toHaveCount(0);
  await expect(dialog.getByText("secret")).toHaveCount(0);

  await dialog.getByLabel(t.baseUrl, { exact: true }).fill("https://n8n.exemple.test");
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/integrations") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: t.create }).click();
  expect((await created).status()).toBe(201);

  /**
   * Creating opens what was created, and it is a route now rather than a panel beside the table:
   * the address is the integration's, so this is a screen somebody can send to somebody else.
   */
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/ca\/integrations\/[0-9a-f-]{36}$/);
  await expect(page.getByText(t.draft).first()).toBeVisible();

  // The stored configuration comes back into the same fields it was written in, not as a document.
  await expect(page.getByLabel(t.baseUrl, { exact: true })).toHaveValue("https://n8n.exemple.test");
  await expect(page.getByRole("button", { name: t.checkHealth })).toBeDisabled();

  // No key ring in this deployment: the section that would hold a secret is not there at all.
  await expect(page.getByRole("heading", { name: t.credentials })).toHaveCount(0);

  const enable = page.getByRole("button", { name: t.enable });
  await waitForHydration(enable);
  await enable.click();
  await expect(page.getByRole("button", { name: t.disable })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(t.enabled).first()).toBeVisible();

  // A health check is queued, never performed by the API: 202, and the answer arrives as a run.
  const queued = page.waitForResponse((response) => response.url().includes("/health-checks"));
  await page.getByRole("button", { name: t.checkHealth }).click();
  expect((await queued).status()).toBe(202);
  await expect(page.getByText(t.healthQueued)).toBeVisible();
  await expect(page.getByRole("heading", { name: t.runs })).toBeVisible();

  // And the listing knows about it without being opened.
  await page.goto("/ca/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
});

test("refuses to delete until the name is typed, and then the integration is gone", async ({ page }) => {
  const name = `Integracio E2E ${randomUUID().slice(0, 8)}`;
  await connect(page, name);

  const remove = page.getByRole("button", { name: t.deleteIntegration, exact: true });
  await waitForHydration(remove);
  await remove.click();

  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: t.deleteConfirm });

  /**
   * The dialog reads out what goes before it lets anything go, and the button stays shut until
   * the name matches exactly. Not a security control — the API's permission is that — but the
   * difference between stopping an integration and deleting it is the whole point of this screen,
   * and a button one stray click away would erase it.
   */
  await expect(confirm).toBeDisabled();
  const field = dialog.getByLabel(t.confirmLabel(name), { exact: true });
  await field.fill(name.toLowerCase());
  await expect(confirm).toBeDisabled();
  await field.fill(name);
  await expect(confirm).toBeEnabled();

  const deleted = page.waitForResponse(
    (response) => /\/api\/v1\/integrations\/[0-9a-f-]{36}$/.test(response.url()) && response.request().method() === "DELETE"
  );
  await confirm.click();
  expect((await deleted).status()).toBe(200);

  // Deleted, not stopped: back on the listing, with no row for it in any state.
  await expect(page).toHaveURL(/\/ca\/integrations$/, { timeout: 15_000 });
  await expect(page.getByText(t.deleted(name))).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
});
