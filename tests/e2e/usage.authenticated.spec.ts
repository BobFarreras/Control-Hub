import { expect, test } from "@playwright/test";
import { waitForHydration } from "./support/fixture";

test.describe.configure({ timeout: 120_000 });

test("navigates usage, costs and budgets without turning missing evidence into zero", async ({ page }) => {
  await page.goto("/ca/usage", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Consum i cobertura", level: 1 })).toBeVisible();
  await expect(page.getByText("Cap passada completada")).toBeVisible();
  await expect(page.getByText("Encara no hi ha consum observat.")).toBeVisible();

  const sources = await page.request.get("/api/v1/usage/sources");
  expect(sources.status()).toBe(200);
  expect(await sources.json()).toEqual({ sources: [] });

  const costsLink = page.getByRole("link", { name: "Costos", exact: true }).last();
  await waitForHydration(costsLink);
  await costsLink.click();
  await expect(page).toHaveURL(/\/ca\/usage\/costs$/);
  await expect(page.getByRole("heading", { name: "Costos de consum", level: 1 })).toBeVisible();
  await expect(page.getByText("Encara no hi ha valoracions.")).toBeVisible();

  const budgetsLink = page.getByRole("link", { name: "Pressupostos", exact: true }).last();
  await budgetsLink.click();
  await expect(page).toHaveURL(/\/ca\/usage\/budgets$/);
  await expect(page.getByRole("heading", { name: "Pressupostos", level: 1 })).toBeVisible();
  await expect(page.getByText("Encara no hi ha pressupostos.")).toBeVisible();
});
