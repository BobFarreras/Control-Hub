import type { CrmListQuery, LeadRecord } from "@control-hub/application";
import { sanitizeSpreadsheetText } from "@control-hub/contracts";
import ExcelJS from "exceljs";

type ExportLocale = "ca" | "es" | "en";
export const CRM_IMPORT_TEMPLATE_VERSION = "crm-leads-v1";

const labels = {
  ca: {
    leads: "Leads",
    metadata: "Informacio",
    example: "Exemple",
    name: "Nom",
    company: "Empresa",
    email: "Correu",
    phone: "Telefon",
    source: "Origen",
    priority: "Prioritat",
    status: "Estat",
    created: "Data de creacio",
    updated: "Ultima actualitzacio",
    field: "Camp",
    value: "Valor",
    exportedAt: "Exportat el",
    tenant: "Tenant",
    filters: "Filtres aplicats",
    rows: "Nombre de leads"
  },
  es: {
    leads: "Leads",
    metadata: "Informacion",
    example: "Ejemplo",
    name: "Nombre",
    company: "Empresa",
    email: "Correo",
    phone: "Telefono",
    source: "Origen",
    priority: "Prioridad",
    status: "Estado",
    created: "Fecha de creacion",
    updated: "Ultima actualizacion",
    field: "Campo",
    value: "Valor",
    exportedAt: "Exportado el",
    tenant: "Tenant",
    filters: "Filtros aplicados",
    rows: "Numero de leads"
  },
  en: {
    leads: "Leads",
    metadata: "Information",
    example: "Example",
    name: "Name",
    company: "Company",
    email: "Email",
    phone: "Phone",
    source: "Source",
    priority: "Priority",
    status: "Status",
    created: "Created at",
    updated: "Last updated",
    field: "Field",
    value: "Value",
    exportedAt: "Exported at",
    tenant: "Tenant",
    filters: "Applied filters",
    rows: "Lead count"
  }
} as const;

export async function createCrmLeadsWorkbook(input: {
  leads: readonly LeadRecord[];
  locale: ExportLocale;
  tenantId: string;
  filters: Pick<CrmListQuery, "search" | "status" | "priority">;
  exportedAt: Date;
}): Promise<ArrayBuffer> {
  const t = labels[input.locale];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Hub";
  workbook.created = input.exportedAt;
  workbook.modified = input.exportedAt;

  const sheet = workbook.addWorksheet(t.leads, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: t.name, key: "name", width: 28 },
    { header: t.company, key: "company", width: 28 },
    { header: t.email, key: "email", width: 32 },
    { header: t.phone, key: "phone", width: 19 },
    { header: t.source, key: "source", width: 18 },
    { header: t.priority, key: "priority", width: 14 },
    { header: t.status, key: "status", width: 14 },
    { header: t.created, key: "created", width: 20 },
    { header: t.updated, key: "updated", width: 20 }
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  header.alignment = { vertical: "middle" };
  header.height = 24;

  for (const [index, lead] of input.leads.entries()) {
    const row = sheet.addRow({
      name: sanitizeSpreadsheetText(lead.name),
      company: sanitizeSpreadsheetText(lead.companyName),
      email: sanitizeSpreadsheetText(lead.email),
      phone: sanitizeSpreadsheetText(lead.phone),
      source: sanitizeSpreadsheetText(lead.source),
      priority: lead.priority,
      status: lead.status,
      created: lead.createdAt,
      updated: lead.updatedAt
    });
    row.getCell("created").numFmt = "yyyy-mm-dd hh:mm";
    row.getCell("updated").numFmt = "yyyy-mm-dd hh:mm";
    if (index % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F2EE" } };
  }
  sheet.autoFilter = { from: "A1", to: "I1" };

  const metadata = workbook.addWorksheet(t.metadata);
  metadata.columns = [
    { header: t.field, key: "field", width: 24 },
    { header: t.value, key: "value", width: 70 }
  ];
  metadata.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  metadata.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  metadata.addRows([
    { field: t.exportedAt, value: input.exportedAt },
    { field: t.tenant, value: input.tenantId },
    {
      field: t.filters,
      value: [input.filters.search, input.filters.status, input.filters.priority].filter(Boolean).join(" · ") || "—"
    },
    { field: t.rows, value: input.leads.length }
  ]);
  metadata.getCell("B2").numFmt = "yyyy-mm-dd hh:mm";

  return workbook.xlsx.writeBuffer();
}

export async function createCrmImportTemplate(locale: ExportLocale): Promise<ArrayBuffer> {
  const t = labels[locale];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Hub";
  workbook.subject = CRM_IMPORT_TEMPLATE_VERSION;
  const sheet = workbook.addWorksheet(t.leads, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "name", key: "name", width: 28 },
    { header: "company", key: "company", width: 28 },
    { header: "email", key: "email", width: 32 },
    { header: "phone", key: "phone", width: 19 },
    { header: "source", key: "source", width: 18 },
    { header: "priority", key: "priority", width: 14 }
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  header.height = 24;
  for (let row = 2; row <= 501; row++) {
    sheet.getCell(`F${row}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"low,normal,high,urgent"']
    };
  }
  sheet.autoFilter = "A1:F1";
  const instructions = workbook.addWorksheet(t.metadata);
  instructions.columns = [
    { header: t.field, key: "field", width: 24 },
    { header: t.value, key: "value", width: 85 }
  ];
  instructions.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  instructions.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  instructions.addRows([
    { field: "template_version", value: CRM_IMPORT_TEMPLATE_VERSION },
    { field: "required", value: "name, source, priority" },
    { field: "optional", value: "company, email, phone" },
    { field: "priority", value: "low, normal, high, urgent" },
    { field: "limits", value: "500 rows · 5 MB" }
  ]);
  await instructions.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  const example = workbook.addWorksheet(t.example);
  example.columns = [
    { header: "name", key: "name", width: 28 },
    { header: "company", key: "company", width: 28 },
    { header: "email", key: "email", width: 32 },
    { header: "phone", key: "phone", width: 19 },
    { header: "source", key: "source", width: 18 },
    { header: "priority", key: "priority", width: 14 }
  ];
  example.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  example.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  example.addRow({
    name: "Maria Garcia",
    company: "Empresa Exemple SL",
    email: "maria@example.com",
    phone: "+34 600 123 123",
    source: "website",
    priority: "normal"
  });
  example.getCell("A3").value =
    locale === "ca"
      ? "Copia el format a la pestanya Leads; aquesta fila no s'importa."
      : locale === "es"
        ? "Copia el formato en la pestana Leads; esta fila no se importa."
        : "Copy this format into the Leads sheet; this row is not imported.";
  example.mergeCells("A3:F3");
  example.getCell("A3").font = { italic: true, color: { argb: "FF5A7A6B" } };
  return workbook.xlsx.writeBuffer();
}
