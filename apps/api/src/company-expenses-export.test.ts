import type { CompanySubscriptionRecord } from "@control-hub/application";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createCompanyExpensesWorkbook } from "./company-expenses-export.js";

const subscription = {
  id: "expense",
  provider: '=HYPERLINK("bad")',
  serviceName: "API",
  category: "api",
  status: "active",
  currency: "EUR",
  amountMinor: 2500,
  interval: "monthly",
  renewalAt: new Date("2026-09-01T08:00:00Z"),
  renewalAlertDays: 14,
  autoRenew: true,
  websiteUrl: "https://example.test",
  notes: null,
  accountEmail: "admin@example.test",
  ownerMembershipId: null,
  ownerName: "Owner",
  quantity: 2,
  startedAt: new Date("2026-08-01T08:00:00Z"),
  trialEndsAt: null,
  cancelBeforeAt: null,
  canceledAt: null,
  costCenter: "OPS",
  paymentMethodLabel: "Visa ···· 4242",
  secretManagerUrl: "https://vault.example.test",
  createdAt: new Date(),
  updatedAt: new Date()
} as CompanySubscriptionRecord;

describe("company expenses workbook", () => {
  it("creates a filtered workbook and neutralizes spreadsheet formulas", async () => {
    const buffer = await createCompanyExpensesWorkbook({
      subscriptions: [subscription],
      locale: "ca",
      tenantId: "tenant",
      filters: { status: "active" },
      exportedAt: new Date("2026-08-10T08:00:00Z"),
      includeFinancials: true
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Eines i despeses")!;
    expect(sheet.getCell("A2").value).toBe('\'=HYPERLINK("bad")');
    expect(sheet.getRow(1).values).toContain("Cost");
    expect(workbook.getWorksheet("Informacio")!.getCell("B4").value).toBe("status: active");
  });

  it("omits financial columns without financial permission", async () => {
    const buffer = await createCompanyExpensesWorkbook({
      subscriptions: [subscription],
      locale: "en",
      tenantId: "tenant",
      filters: {},
      exportedAt: new Date(),
      includeFinancials: false
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet("Tools and expenses")!.getRow(1).values).not.toContain("Cost");
  });
});
