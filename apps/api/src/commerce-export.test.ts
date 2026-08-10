import type { CustomerContractRecord } from "@control-hub/application";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createCustomerServicesWorkbook } from "./commerce-export.js";

const service = {
  id: "service",
  customerName: '=HYPERLINK("bad")',
  productName: "Voice agent",
  planName: "Business",
  commercialModel: "subscription",
  status: "active",
  quantity: 2,
  contractedAt: new Date("2026-08-01T09:00:00Z"),
  startsAt: new Date("2026-08-02T09:00:00Z"),
  renewalAt: new Date("2026-09-02T09:00:00Z"),
  endsAt: null,
  ownerName: "Owner",
  projectName: null,
  autoRenew: true,
  amountMinor: 4900,
  costMinor: 1200,
  taxBasisPoints: 2100,
  currency: "EUR"
} as CustomerContractRecord;

describe("customer services workbook", () => {
  it("creates a readable workbook, preserves filters and neutralizes formulas", async () => {
    const buffer = await createCustomerServicesWorkbook({
      services: [service],
      locale: "ca",
      tenantId: "tenant",
      filters: { status: "active" },
      exportedAt: new Date("2026-08-10T08:00:00Z"),
      includeFinancials: true
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet("Serveis de clients")!;
    expect(sheet.getCell("A2").value).toBe('\'=HYPERLINK("bad")');
    expect(sheet.getRow(1).values).toContain("Total net");
    expect(sheet.getCell("N2").value).toBe(98);
    expect(workbook.getWorksheet("Informacio")!.getCell("B4").value).toBe("status: active");
  });

  it("omits all financial columns without financial permission", async () => {
    const buffer = await createCustomerServicesWorkbook({
      services: [service],
      locale: "en",
      tenantId: "tenant",
      filters: {},
      exportedAt: new Date(),
      includeFinancials: false
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet("Customer services")!.getRow(1).values).not.toContain("Unit net price");
  });
});
