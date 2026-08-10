import { expect, test } from "@playwright/test";
import { waitForHydration } from "./support/fixture";

test.describe("company tools and recurring expenses", () => {
  test("creates, edits, filters, exports and completes the lifecycle", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/ca/expenses/subscriptions", { waitUntil: "domcontentloaded" });
    const add = page.getByRole("button", { name: "Afegir subscripcio" });
    await waitForHydration(add);
    await add.click();
    let dialog = page.getByRole("dialog");
    const unique = `E2E ${Date.now()}`;
    await dialog.getByLabel("Proveidor").fill("Control Hub Test");
    await dialog.getByLabel("Servei").fill(unique);
    await dialog.getByRole("spinbutton", { name: "Cost", exact: true }).fill("19.95");
    const createdResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/v1/company-subscriptions") && response.request().method() === "POST"
    );
    await dialog.getByRole("button", { name: "Desar" }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const body = (await created.json()) as { subscription: { id: string } };
    const row = page.locator(`tr[data-row-id="${body.subscription.id}"]`);
    await expect(row).toContainText(unique);

    await row.getByRole("button", { name: "Editar" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Servei").fill(`${unique} Pro`);
    const accountIdentifier = `workspace-${Date.now()}`;
    await dialog.getByLabel("Compte o correu").fill(accountIdentifier);
    const editedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/company-subscriptions/${body.subscription.id}`) &&
        response.request().method() === "PATCH"
    );
    await dialog.getByRole("button", { name: "Desar canvis" }).click();
    const edited = await editedResponse;
    expect(edited.status(), `${await edited.text()}\n${edited.request().postData() ?? ""}`).toBe(200);
    await expect(row).toContainText(`${unique} Pro`);
    await expect(row).toContainText(accountIdentifier);
    await expect(page.getByRole("alert").filter({ hasText: "Canvis desats" })).toBeVisible();

    for (const [action, expected] of [
      ["Pausar", "Pausada"],
      ["Reprendre", "Activa"]
    ] as const) {
      const response = page.waitForResponse(
        (item) => item.url().endsWith(`/${body.subscription.id}/status`) && item.request().method() === "PATCH"
      );
      await row.getByRole("button", { name: action }).click();
      expect((await response).status()).toBe(200);
      await expect(row).toContainText(expected);
    }

    await row.getByRole("button", { name: "Cancel·lar" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Motiu de cancel·lacio").fill("Cancel·lacio creada per la prova E2E");
    await dialog.getByRole("button", { name: "Confirmar cancel·lacio" }).click();
    await expect(row).toContainText("Cancel·lada");

    await page.getByLabel("Filtrar: Estat").click();
    await page.getByRole("button", { name: "Cancel·lada", exact: true }).click();
    await expect(page).toHaveURL(/status=canceled/);
    await expect(row).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Exportar Excel" }).click();
    expect((await download).suggestedFilename()).toMatch(/^control-hub-company-expenses-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
