import { expect, test, type Page } from "@playwright/test";
import { readFixture, waitForHydration } from "./support/fixture";

const fixture = readFixture();
const t = {
  title: "Serveis de clients",
  add: "Nou servei de client",
  selectCustomer: "Selecciona un client",
  selectOffer: "Selecciona una oferta",
  save: "Desar",
  active: "Activa",
  paused: "Pausada",
  pause: "Pausar",
  resume: "Reprendre",
  cancel: "Cancel·lar",
  cancelReason: "Motiu de la cancel·lacio",
  confirmCancel: "Confirmar cancel·lacio",
  canceled: "Cancel·lada",
  filterStatus: "Filtrar: Estat",
  export: "Exportar Excel"
} as const;

async function createRecurringService(page: Page): Promise<string> {
  await page.goto("/ca/products/customer-subscriptions", { waitUntil: "domcontentloaded" });
  const open = page.getByRole("button", { name: t.add });
  await waitForHydration(open);
  await open.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: t.selectCustomer }).click();
  await dialog.getByRole("option", { name: fixture.commerce.customer }).click();
  await dialog.getByRole("button", { name: t.selectOffer }).click();
  await dialog.getByRole("option", { name: new RegExp(fixture.commerce.product) }).click();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/commerce/customer-services") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: t.save }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { service: { id: string } };
  return body.service.id;
}

test.describe("customer services", () => {
  test("creates a service, drives its lifecycle and filters it from the table header", async ({ page }) => {
    test.setTimeout(120_000);
    const serviceId = await createRecurringService(page);
    const row = page.locator(`tr[data-row-id="${serviceId}"]`);
    await expect(row).toContainText(t.active);

    const pause = row.getByRole("button", { name: t.pause });
    await waitForHydration(pause);
    const paused = page.waitForResponse(
      (response) => response.url().endsWith(`/${serviceId}/status`) && response.request().method() === "PATCH"
    );
    await pause.click();
    expect((await paused).status()).toBe(200);
    await expect(row).toContainText(t.paused);

    const resume = row.getByRole("button", { name: t.resume });
    const resumed = page.waitForResponse(
      (response) => response.url().endsWith(`/${serviceId}/status`) && response.request().method() === "PATCH"
    );
    await resume.click();
    expect((await resumed).status()).toBe(200);
    await expect(row).toContainText(t.active);

    await row.getByRole("button", { name: t.cancel }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(t.cancelReason).fill("Cancel·lacio creada per la prova E2E");
    const canceled = page.waitForResponse(
      (response) => response.url().endsWith(`/${serviceId}/status`) && response.request().method() === "PATCH"
    );
    await dialog.getByRole("button", { name: t.confirmCancel }).click();
    expect((await canceled).status()).toBe(200);
    await expect(row).toContainText(t.canceled);

    await page.getByLabel(t.filterStatus).click();
    await page.getByRole("button", { name: t.canceled, exact: true }).click();
    await expect(page).toHaveURL(/status=canceled/);
    await expect(row).toBeVisible();
  });

  test("downloads the professional filtered workbook", async ({ page }) => {
    await page.goto("/ca/products/customer-subscriptions?status=canceled", { waitUntil: "domcontentloaded" });
    const link = page.getByRole("link", { name: t.export });
    const download = page.waitForEvent("download");
    await link.click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^control-hub-customer-services-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
