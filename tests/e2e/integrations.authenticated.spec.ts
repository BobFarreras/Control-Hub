import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { selectFieldOption, waitForHydration } from "./support/fixture";

/**
 * The integrations screen, driven the way an operator drives it.
 *
 * What this proves and unit tests cannot: that the form an operator fills in is **drawn from what
 * the connector declares** rather than typed as JSON — pick n8n and the fields it asks for appear,
 * and there is no free-text field left to get wrong — that a configuration the connector refuses
 * complains **on the field that caused it**, in Catalan, without echoing what was typed, and that
 * the state of an integration on the screen is the state the API actually holds after the round
 * trip.
 *
 * It runs against a deployment without a key ring, which is what CI provides: the credential and
 * endpoint routes are not declared there, so the panels that would drive them are absent by
 * design. The last assertion is that they really are absent, because "the vault is unavailable"
 * has to look like a missing section rather than a form that fails on submit.
 */
test.describe.configure({ timeout: 120_000 });

/** The Catalan labels the screen renders. Together, so a wording change is one edit. */
const t = {
  title: "Integracions",
  newIntegration: "Nova integracio",
  connectorType: "Tipus de connector",
  integrationName: "Nom de la integracio",
  baseUrl: "Adreca de la instancia",
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
  runs: "Execucions"
} as const;

test("draws the form a connector asks for, refuses a value on its own field, and enables it", async ({ page }) => {
  const name = `Integracio E2E ${randomUUID().slice(0, 8)}`;

  await page.goto("/ca/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: t.title, level: 1 })).toBeVisible();

  const open = page.getByRole("button", { name: t.newIntegration });
  await waitForHydration(open);
  await open.click();

  const dialog = page.getByRole("dialog");
  await selectFieldOption(dialog.getByLabel(t.connectorType, { exact: true }), { label: "n8n" });

  /**
   * The point of the whole mechanism: choosing a connector produced its own fields, and left
   * nothing to type raw. A textarea here would mean the catalogue was not consulted.
   */
  await expect(dialog.getByLabel(t.baseUrl, { exact: true })).toBeVisible();
  await expect(dialog.locator("textarea")).toHaveCount(0);

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

  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText(t.draft)).toBeVisible();

  await row.getByRole("link", { name }).click();

  const panel = page.getByRole("region", { name });
  await expect(panel.getByRole("heading", { name })).toBeVisible();
  // The stored configuration comes back into the same fields it was written in, not as a document.
  await expect(panel.getByLabel(t.baseUrl, { exact: true })).toHaveValue("https://n8n.exemple.test");
  await expect(panel.getByRole("button", { name: t.checkHealth })).toBeDisabled();

  // No key ring in this deployment: the section that would hold a secret is not there at all.
  await expect(panel.getByRole("heading", { name: t.credentials })).toHaveCount(0);

  const enable = panel.getByRole("button", { name: t.enable });
  await waitForHydration(enable);
  await enable.click();
  await expect(panel.getByRole("button", { name: t.disable })).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText(t.enabled).first()).toBeVisible();

  // A health check is queued, never performed by the API: 202, and the answer arrives as a run.
  const queued = page.waitForResponse((response) => response.url().includes("/health-checks"));
  await panel.getByRole("button", { name: t.checkHealth }).click();
  expect((await queued).status()).toBe(202);
  await expect(page.getByText(t.healthQueued)).toBeVisible();
  await expect(panel.getByRole("heading", { name: t.runs })).toBeVisible();
});
