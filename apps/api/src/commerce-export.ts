import type { CustomerContractRecord, CustomerServiceFilters } from "@control-hub/application";
import { sanitizeSpreadsheetText } from "@control-hub/contracts";
import ExcelJS from "exceljs";

type ExportLocale = "ca" | "es" | "en";

const labels = {
  ca: {
    services: "Serveis de clients",
    metadata: "Informacio",
    customer: "Client",
    product: "Producte",
    plan: "Pla",
    model: "Modalitat",
    status: "Estat",
    quantity: "Quantitat",
    contracted: "Contractat",
    starts: "Inici",
    renewalEnd: "Renovacio o fi",
    owner: "Responsable",
    project: "Projecte",
    autoRenew: "Renovacio automatica",
    unitNet: "Preu net unitari",
    totalNet: "Total net",
    tax: "Impost (%)",
    currency: "Moneda",
    field: "Camp",
    value: "Valor",
    exportedAt: "Exportat el",
    tenant: "Tenant",
    filters: "Filtres aplicats",
    rows: "Nombre de serveis",
    yes: "Si",
    no: "No"
  },
  es: {
    services: "Servicios de clientes",
    metadata: "Informacion",
    customer: "Cliente",
    product: "Producto",
    plan: "Plan",
    model: "Modalidad",
    status: "Estado",
    quantity: "Cantidad",
    contracted: "Contratado",
    starts: "Inicio",
    renewalEnd: "Renovacion o fin",
    owner: "Responsable",
    project: "Proyecto",
    autoRenew: "Renovacion automatica",
    unitNet: "Precio neto unitario",
    totalNet: "Total neto",
    tax: "Impuesto (%)",
    currency: "Moneda",
    field: "Campo",
    value: "Valor",
    exportedAt: "Exportado el",
    tenant: "Tenant",
    filters: "Filtros aplicados",
    rows: "Numero de servicios",
    yes: "Si",
    no: "No"
  },
  en: {
    services: "Customer services",
    metadata: "Information",
    customer: "Customer",
    product: "Product",
    plan: "Plan",
    model: "Model",
    status: "Status",
    quantity: "Quantity",
    contracted: "Contracted",
    starts: "Starts",
    renewalEnd: "Renewal or end",
    owner: "Owner",
    project: "Project",
    autoRenew: "Auto renewal",
    unitNet: "Unit net price",
    totalNet: "Net total",
    tax: "Tax (%)",
    currency: "Currency",
    field: "Field",
    value: "Value",
    exportedAt: "Exported at",
    tenant: "Tenant",
    filters: "Applied filters",
    rows: "Service count",
    yes: "Yes",
    no: "No"
  }
} as const;

export async function createCustomerServicesWorkbook(input: {
  services: readonly CustomerContractRecord[];
  locale: ExportLocale;
  tenantId: string;
  filters: CustomerServiceFilters;
  exportedAt: Date;
  includeFinancials: boolean;
}): Promise<ArrayBuffer> {
  const t = labels[input.locale];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Hub";
  workbook.created = input.exportedAt;
  workbook.modified = input.exportedAt;
  const sheet = workbook.addWorksheet(t.services, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: t.customer, key: "customer", width: 28 },
    { header: t.product, key: "product", width: 27 },
    { header: t.plan, key: "plan", width: 22 },
    { header: t.model, key: "model", width: 18 },
    { header: t.status, key: "status", width: 15 },
    { header: t.quantity, key: "quantity", width: 12 },
    { header: t.contracted, key: "contracted", width: 20 },
    { header: t.starts, key: "starts", width: 20 },
    { header: t.renewalEnd, key: "renewalEnd", width: 20 },
    { header: t.owner, key: "owner", width: 24 },
    { header: t.project, key: "project", width: 25 },
    { header: t.autoRenew, key: "autoRenew", width: 20 },
    ...(input.includeFinancials
      ? [
          { header: t.unitNet, key: "unitNet", width: 18 },
          { header: t.totalNet, key: "totalNet", width: 18 },
          { header: t.tax, key: "tax", width: 14 },
          { header: t.currency, key: "currency", width: 12 }
        ]
      : [])
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  header.alignment = { vertical: "middle" };
  header.height = 24;
  for (const [index, service] of input.services.entries()) {
    const row = sheet.addRow({
      customer: sanitizeSpreadsheetText(service.customerName),
      product: sanitizeSpreadsheetText(service.productName),
      plan: sanitizeSpreadsheetText(service.planName),
      model: service.commercialModel,
      status: service.status,
      quantity: service.quantity,
      contracted: service.contractedAt,
      starts: service.startsAt,
      renewalEnd: service.renewalAt ?? service.endsAt,
      owner: sanitizeSpreadsheetText(service.ownerName),
      project: sanitizeSpreadsheetText(service.projectName),
      autoRenew: service.autoRenew === null ? "—" : service.autoRenew ? t.yes : t.no,
      ...(input.includeFinancials
        ? {
            unitNet: service.amountMinor / 100,
            totalNet: (service.amountMinor * service.quantity) / 100,
            tax: service.taxBasisPoints / 100,
            currency: service.currency
          }
        : {})
    });
    for (const key of ["contracted", "starts", "renewalEnd"]) row.getCell(key).numFmt = "yyyy-mm-dd hh:mm";
    for (const key of ["unitNet", "totalNet"]) if (input.includeFinancials) row.getCell(key).numFmt = "#,##0.00";
    if (index % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F2EE" } };
  }
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
  const metadata = workbook.addWorksheet(t.metadata);
  metadata.columns = [
    { header: t.field, key: "field", width: 24 },
    { header: t.value, key: "value", width: 80 }
  ];
  metadata.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  metadata.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  metadata.addRows([
    { field: t.exportedAt, value: input.exportedAt },
    { field: t.tenant, value: input.tenantId },
    {
      field: t.filters,
      value:
        Object.entries(input.filters)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(" · ") || "—"
    },
    { field: t.rows, value: input.services.length }
  ]);
  metadata.getCell("B2").numFmt = "yyyy-mm-dd hh:mm";
  return workbook.xlsx.writeBuffer();
}
