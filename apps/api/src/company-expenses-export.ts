import type { CompanySubscriptionFilters, CompanySubscriptionRecord } from "@control-hub/application";
import { sanitizeSpreadsheetText } from "@control-hub/contracts";
import ExcelJS from "exceljs";

type ExportLocale = "ca" | "es" | "en";
const labels = {
  ca: {
    sheet: "Eines i despeses",
    info: "Informacio",
    provider: "Proveidor",
    service: "Servei",
    category: "Categoria",
    status: "Estat",
    account: "Compte",
    owner: "Responsable",
    quantity: "Llicencies",
    started: "Inici",
    trialEnd: "Fi de prova",
    renewal: "Renovacio",
    cancelBefore: "Limit de cancel·lacio",
    autoRenew: "Renovacio automatica",
    costCenter: "Centre de cost",
    payment: "Metode de pagament",
    website: "URL de gestio",
    amount: "Cost",
    currency: "Moneda",
    interval: "Periodicitat",
    field: "Camp",
    value: "Valor",
    exportedAt: "Exportat el",
    tenant: "Tenant",
    filters: "Filtres aplicats",
    rows: "Nombre de registres",
    yes: "Si",
    no: "No"
  },
  es: {
    sheet: "Herramientas y gastos",
    info: "Informacion",
    provider: "Proveedor",
    service: "Servicio",
    category: "Categoria",
    status: "Estado",
    account: "Cuenta",
    owner: "Responsable",
    quantity: "Licencias",
    started: "Inicio",
    trialEnd: "Fin de prueba",
    renewal: "Renovacion",
    cancelBefore: "Limite de cancelacion",
    autoRenew: "Renovacion automatica",
    costCenter: "Centro de coste",
    payment: "Metodo de pago",
    website: "URL de gestion",
    amount: "Coste",
    currency: "Moneda",
    interval: "Periodicidad",
    field: "Campo",
    value: "Valor",
    exportedAt: "Exportado el",
    tenant: "Tenant",
    filters: "Filtros aplicados",
    rows: "Numero de registros",
    yes: "Si",
    no: "No"
  },
  en: {
    sheet: "Tools and expenses",
    info: "Information",
    provider: "Provider",
    service: "Service",
    category: "Category",
    status: "Status",
    account: "Account",
    owner: "Owner",
    quantity: "Licenses",
    started: "Started",
    trialEnd: "Trial end",
    renewal: "Renewal",
    cancelBefore: "Cancellation deadline",
    autoRenew: "Auto renewal",
    costCenter: "Cost center",
    payment: "Payment method",
    website: "Management URL",
    amount: "Cost",
    currency: "Currency",
    interval: "Interval",
    field: "Field",
    value: "Value",
    exportedAt: "Exported at",
    tenant: "Tenant",
    filters: "Applied filters",
    rows: "Record count",
    yes: "Yes",
    no: "No"
  }
} as const;

export async function createCompanyExpensesWorkbook(input: {
  subscriptions: readonly CompanySubscriptionRecord[];
  locale: ExportLocale;
  tenantId: string;
  filters: CompanySubscriptionFilters;
  exportedAt: Date;
  includeFinancials: boolean;
}): Promise<ArrayBuffer> {
  const t = labels[input.locale];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Control Hub";
  workbook.created = input.exportedAt;
  workbook.modified = input.exportedAt;
  const sheet = workbook.addWorksheet(t.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: t.provider, key: "provider", width: 24 },
    { header: t.service, key: "service", width: 28 },
    { header: t.category, key: "category", width: 17 },
    { header: t.status, key: "status", width: 15 },
    { header: t.account, key: "account", width: 30 },
    { header: t.owner, key: "owner", width: 24 },
    { header: t.quantity, key: "quantity", width: 12 },
    { header: t.started, key: "started", width: 20 },
    { header: t.trialEnd, key: "trialEnd", width: 20 },
    { header: t.renewal, key: "renewal", width: 20 },
    { header: t.cancelBefore, key: "cancelBefore", width: 22 },
    { header: t.autoRenew, key: "autoRenew", width: 20 },
    { header: t.costCenter, key: "costCenter", width: 18 },
    { header: t.payment, key: "payment", width: 22 },
    { header: t.website, key: "website", width: 34 },
    ...(input.includeFinancials
      ? [
          { header: t.amount, key: "amount", width: 16 },
          { header: t.currency, key: "currency", width: 12 },
          { header: t.interval, key: "interval", width: 16 }
        ]
      : [])
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  header.height = 24;
  for (const [index, item] of input.subscriptions.entries()) {
    const row = sheet.addRow({
      provider: sanitizeSpreadsheetText(item.provider),
      service: sanitizeSpreadsheetText(item.serviceName),
      category: item.category,
      status: item.status,
      account: sanitizeSpreadsheetText(item.accountEmail),
      owner: sanitizeSpreadsheetText(item.ownerName),
      quantity: item.quantity,
      started: item.startedAt,
      trialEnd: item.trialEndsAt,
      renewal: item.renewalAt,
      cancelBefore: item.cancelBeforeAt,
      autoRenew: item.autoRenew ? t.yes : t.no,
      costCenter: sanitizeSpreadsheetText(item.costCenter),
      payment: sanitizeSpreadsheetText(item.paymentMethodLabel),
      website: sanitizeSpreadsheetText(item.websiteUrl),
      ...(input.includeFinancials
        ? { amount: item.amountMinor / 100, currency: item.currency, interval: item.interval }
        : {})
    });
    for (const key of ["started", "trialEnd", "renewal", "cancelBefore"]) row.getCell(key).numFmt = "yyyy-mm-dd hh:mm";
    if (input.includeFinancials) row.getCell("amount").numFmt = "#,##0.00";
    if (index % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F2EE" } };
  }
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
  const info = workbook.addWorksheet(t.info);
  info.columns = [
    { header: t.field, key: "field", width: 24 },
    { header: t.value, key: "value", width: 80 }
  ];
  info.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  info.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5A7A6B" } };
  info.addRows([
    { field: t.exportedAt, value: input.exportedAt },
    { field: t.tenant, value: input.tenantId },
    {
      field: t.filters,
      value:
        Object.entries(input.filters)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(" · ") || "—"
    },
    { field: t.rows, value: input.subscriptions.length }
  ]);
  info.getCell("B2").numFmt = "yyyy-mm-dd hh:mm";
  return workbook.xlsx.writeBuffer();
}
