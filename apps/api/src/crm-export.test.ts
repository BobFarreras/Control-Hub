import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { CRM_IMPORT_TEMPLATE_VERSION, createCrmImportTemplate, createCrmLeadsWorkbook } from "./crm-export.js";

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

describe("CRM import template", () => {
  it("publishes a versioned template with a separate, non-imported example", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createCrmImportTemplate("ca"));
    expect(workbook.subject).toBe(CRM_IMPORT_TEMPLATE_VERSION);
    expect(workbook.getWorksheet("Leads")!.getRow(1).values).toEqual([
      undefined,
      "name",
      "company",
      "email",
      "phone",
      "source",
      "priority"
    ]);
    expect(workbook.getWorksheet("Leads")!.getCell("F2").dataValidation.type).toBe("list");
    expect(workbook.getWorksheet("Informacio")!.getCell("B2").value).toBe(CRM_IMPORT_TEMPLATE_VERSION);
    expect(workbook.getWorksheet("Leads")!.getCell("A2").value).toBeNull();
    expect(workbook.getWorksheet("Exemple")!.getCell("A2").value).toBe("Maria Garcia");
    expect(workbook.getWorksheet("Exemple")!.getCell("F2").value).toBe("normal");
  });
});
