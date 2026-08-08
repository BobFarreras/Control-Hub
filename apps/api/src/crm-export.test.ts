import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createCrmLeadsWorkbook } from "./crm-export.js";

describe("CRM Excel export", () => {
  it("creates a filtered, readable workbook and neutralizes formulas", async () => {
    const generated = await createCrmLeadsWorkbook({
      locale: "ca",
      tenantId: "tenant-a",
      exportedAt: new Date("2026-08-08T10:00:00Z"),
      filters: { status: "lost" },
      leads: [
        {
          id: "lead-a",
          name: '=HYPERLINK("https://example.test")',
          companyName: "Avant",
          email: "sales@example.test",
          phone: null,
          source: "manual",
          status: "lost",
          priority: "normal",
          ownerMembershipId: null,
          convertedCustomerId: null,
          createdAt: new Date("2026-08-01T08:00:00Z"),
          updatedAt: new Date("2026-08-02T08:00:00Z")
        }
      ]
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(generated);
    const leads = workbook.getWorksheet("Leads")!;
    expect(leads.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(leads.autoFilter).toBe("A1:I1");
    expect(leads.getCell("A2").value).toBe('\'=HYPERLINK("https://example.test")');
    expect(workbook.getWorksheet("Informacio")!.getCell("B4").value).toBe("lost");
  });
});
