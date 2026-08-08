import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  canonicalLeadCsv,
  leadImportReportCsv,
  readLeadImportFile,
  suggestLeadColumnMapping,
  type ParsedLeadImport
} from "./lead-import-file.js";

describe("lead import files", () => {
  it("suggests mappings for localized column names and produces the canonical contract", () => {
    const parsed: ParsedLeadImport = {
      headers: ["Nom", "Correu", "Origen", "Prioritat"],
      rows: [["Avant", "sales@example.test", "web", "high"]],
      templateVersion: null
    };
    const mapping = suggestLeadColumnMapping(parsed.headers);
    expect(mapping).toMatchObject({ name: "Nom", email: "Correu", source: "Origen", priority: "Prioritat" });
    expect(canonicalLeadCsv(parsed, mapping)).toContain("Avant,,sales@example.test,,web,high");
  });

  it("creates a downloadable report tied to the idempotent batch", () => {
    expect(
      leadImportReportCsv("batch-a", [
        { row: 2, status: "imported" },
        { row: 3, status: "error", code: "DUPLICATE_EMAIL" }
      ])
    ).toBe("batch_id,row,status,code\r\nbatch-a,2,imported,\r\nbatch-a,3,error,DUPLICATE_EMAIL\r\n");
  });

  it("reads a versioned Excel template and rejects formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.subject = "crm-leads-v1";
    const sheet = workbook.addWorksheet("Leads");
    sheet.addRow(["name", "source", "priority"]);
    sheet.addRow(["Avant", "manual", "normal"]);
    const bytes = await workbook.xlsx.writeBuffer();
    const parsed = await readLeadImportFile(new File([bytes], "leads.xlsx"));
    expect(parsed.templateVersion).toBe("crm-leads-v1");
    expect(parsed.rows).toEqual([["Avant", "manual", "normal"]]);

    sheet.getCell("A2").value = { formula: "1+1", result: 2 };
    const unsafe = await workbook.xlsx.writeBuffer();
    await expect(readLeadImportFile(new File([unsafe], "unsafe.xlsx"))).rejects.toThrow("IMPORT_FORMULA_NOT_ALLOWED");
  });
});
