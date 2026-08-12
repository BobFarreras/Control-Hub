import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { selectFieldOption, waitForHydration } from "./support/fixture";

/**
 * The integrations screen, driven the way an operator drives it.
 *
 * What this proves and unit tests cannot: that a refusal from the API arrives on screen as a
 * Catalan sentence rather than a code, that a configuration the connector does not accept names
 * the offending path without echoing what was typed, and that the state of an integration on the
 * screen is the state the API actually holds after the round trip.
 *
 * It runs against a deployment without a key ring, which is the default: the credential and
 * endpoint routes are not declared there, so the panels that would drive them are absent by
 * design and this test does not go looking for them.
 */
test.describe.configure({ timeout: 120_000 });

/** The Catalan labels the screen renders. Together, so a wording change is one edit. */
const t = {
  title: "Integracions",
  newIntegration: "Nova integracio",
  connectorType: "Tipus de connector",
  integrationName: "Nom de la integracio",
  configuration: "Configuracio (JSON)",
  create: "Crear",
  invalidJson: "La configuracio no es JSON valid.",
  refusedConfig: "La configuracio no la reconeix aquest connector.",
  enable: "Activar",
  disable: "Aturar",
  checkHealth: "Comprovar salut",
  enabled: "Activa",
  draft: "Esborrany",
  healthQueued: "Comprovacio demanada. El resultat apareixera a les execucions.",
  runs: "Execucions"
} as const;

test("creates an integration, refuses a configuration in words, and enables it", async ({ page }) => {
  const name = `Integracio E2E ${randomUUID().slice(0, 8)}`;

  await page.goto("/ca/integrations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: t.title, level: 1 })).toBeVisible();

  const open = page.getByRole("button", { name: t.newIntegration });
  await waitForHydration(open);
  await open.click();

  const dialog = page.getByRole("dialog");
  await selectFieldOption(dialog.getByLabel(t.connectorType, { exact: true }), { index: 0 });
  await dialog.getByLabel(t.integrationName, { exact: true }).fill(name);

  // Not JSON at all: refused in the browser, without spending a request on it.
  await dialog.getByLabel(t.configuration, { exact: true }).fill("{");
  await dialog.getByRole("button", { name: t.create }).click();
  await expect(dialog.getByRole("alert")).toHaveText(t.invalidJson);

  /**
   * JSON the connector refuses. The screen must say so in Catalan and name the path — never the
   * provider's own words, and never the value that was typed.
   */
  await dialog.getByLabel(t.configuration, { exact: true }).fill('{"healthUrl":"http://example.com/health"}');
  const refused = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/integrations") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: t.create }).click();
  expect((await refused).status()).toBe(422);
  await expect(dialog.getByRole("alert")).toHaveText(t.refusedConfig);
  // The path inside the configuration, which is all the API sends: never the URL that was typed.
  await expect(dialog.getByText("healthUrl")).toBeVisible();

  await dialog.getByLabel(t.configuration, { exact: true }).fill("{}");
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
  await expect(panel.getByRole("button", { name: t.checkHealth })).toBeDisabled();

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
