import { parseCsv, stringifyCsv } from "@control-hub/contracts";
import ExcelJS from "exceljs";

export const MAX_IMPORT_BYTES = 5_000_000;
export const MAX_IMPORT_ROWS = 500;
export const SUPPORTED_TEMPLATE_VERSION = "crm-leads-v1";

export const leadImportFields = ["name", "company", "email", "phone", "source", "priority"] as const;
export type LeadImportField = (typeof leadImportFields)[number];
export type LeadColumnMapping = Record<LeadImportField, string>;
export type ParsedLeadImport = { headers: string[]; rows: string[][]; templateVersion: string | null };

const aliases: Record<LeadImportField, readonly string[]> = {
  name: ["name", "nom", "nombre", "lead", "contact"],
  company: ["company", "empresa", "company_name", "organization", "organitzacio", "organizacion"],
  email: ["email", "e-mail", "correu", "correo"],
  phone: ["phone", "telefon", "telefono", "mobile", "mobil", "movil"],
  source: ["source", "origen", "origin"],
  priority: ["priority", "prioritat", "prioridad"]
};

function normalizedHeader(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "_");
}

function nonEmptyRows(rows: string[][]): string[][] {
  return rows.filter((row) => row.some((cell) => cell.trim() !== ""));
}

function validate(parsed: ParsedLeadImport): ParsedLeadImport {
  if (parsed.headers.length === 0 || parsed.headers.every((header) => !header)) throw new Error("IMPORT_EMPTY");
  if (parsed.rows.length === 0) throw new Error("IMPORT_EMPTY");
  if (parsed.rows.length > MAX_IMPORT_ROWS) throw new Error("IMPORT_TOO_MANY_ROWS");
  return parsed;
}

function excelCell(cell: ExcelJS.Cell): string {
  if (cell.type === ExcelJS.ValueType.Formula) throw new Error("IMPORT_FORMULA_NOT_ALLOWED");
  return cell.text.trim();
}

async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedLeadImport> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Leads") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("IMPORT_EMPTY");
  const headers = (sheet.getRow(1).values as ExcelJS.CellValue[])
    .slice(1)
    .map((_, index) => excelCell(sheet.getCell(1, index + 1)));
  const rows: string[][] = [];
  for (let row = 2; row <= sheet.rowCount; row++) {
    rows.push(headers.map((_, index) => excelCell(sheet.getCell(row, index + 1))));
  }
  return validate({ headers, rows: nonEmptyRows(rows), templateVersion: workbook.subject || null });
}

export async function readLeadImportFile(file: File): Promise<ParsedLeadImport> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("IMPORT_FILE_TOO_LARGE");
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US");
  if (extension === "xlsx") return parseXlsx(await file.arrayBuffer());
  if (extension !== "csv") throw new Error("IMPORT_FILE_TYPE");
  const [headers = [], ...rows] = parseCsv(await file.text());
  return validate({ headers: headers.map((header) => header.trim()), rows: nonEmptyRows(rows), templateVersion: null });
}

export function suggestLeadColumnMapping(headers: readonly string[]): LeadColumnMapping {
  return Object.fromEntries(
    leadImportFields.map((field) => {
      const match = headers.find((header) => aliases[field].includes(normalizedHeader(header)));
      return [field, match ?? ""];
    })
  ) as LeadColumnMapping;
}

export function canonicalLeadCsv(parsed: ParsedLeadImport, mapping: LeadColumnMapping): string {
  if (!mapping.name || !mapping.source || !mapping.priority) throw new Error("IMPORT_REQUIRED_MAPPING");
  const indexes = Object.fromEntries(
    leadImportFields.map((field) => [field, mapping[field] ? parsed.headers.indexOf(mapping[field]) : -1])
  ) as Record<LeadImportField, number>;
  if (indexes.name < 0 || indexes.source < 0 || indexes.priority < 0) throw new Error("IMPORT_REQUIRED_MAPPING");
  return stringifyCsv([
    leadImportFields,
    ...parsed.rows.map((row) => leadImportFields.map((field) => (indexes[field] >= 0 ? row[indexes[field]] : "")))
  ]);
}

export function leadImportReportCsv(
  batchId: string,
  results: readonly { row: number; status: string; code?: string }[]
): string {
  return stringifyCsv([
    ["batch_id", "row", "status", "code"],
    ...results.map((result) => [batchId, String(result.row), result.status, result.code ?? ""])
  ]);
}
