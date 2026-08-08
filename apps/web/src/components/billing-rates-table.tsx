"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { InstantSearch } from "@/components/instant-search";
import { SmartDataTable, type SmartColumn } from "@/components/smart-data-table";
import type { BillingRate, BillingScope, TablePreference } from "@/lib/api-types";
import { formatMoney } from "@/lib/format";

type Labels = Record<string, string>;

type BillingRow = BillingRate & {
  scopeLabel: string;
  scopeName: string;
  status: "in_force" | "superseded" | "withdrawn";
};

const SCOPE_FILTER = "billingScope";
const STATUS_FILTER = "billingStatus";
const SORT_PARAM = "billingSort";
const PAGE_PARAM = "billingPage";
const PAGE_SIZE_PARAM = "billingPageSize";
const SEARCH_PARAM = "search";

const defaultPreference: TablePreference = {
  tableId: "rates.billing",
  columnOrder: ["scope", "scopeName", "amount", "currency", "effectiveFrom", "status"],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveStatus(rate: BillingRate): "in_force" | "superseded" | "withdrawn" {
  if (rate.annulledAt) return "withdrawn";
  if (rate.effectiveFrom > today()) return "superseded";
  return "in_force";
}

function resolveScopeLabel(scope: BillingScope, labels: Labels): string {
  const map: Record<BillingScope, string | undefined> = {
    customer: labels.scopeCustomer,
    project: labels.scopeProject,
    service_type: labels.scopeServiceType
  };
  return map[scope] ?? scope;
}

export function BillingRatesTable({
  rates,
  onAnnul,
  busy,
  labels: t,
  locale
}: {
  rates: BillingRate[];
  onAnnul: (id: string) => void;
  busy: boolean;
  labels: Labels;
  locale: string;
}) {
  const searchParams = useSearchParams();
  /**
   * Withdrawing a published rate cannot be undone: the row stays in the history for good and the
   * figure it used to price hours changes. So it takes two clicks, exactly as the cost table has
   * always done. Moving this table onto `SmartDataTable` dropped the second one and wired the
   * first straight to the request, which meant a misclick on `Anul·lar` retired a live rate with
   * no way back and no warning.
   */
  const [confirming, setConfirming] = useState("");

  const rows: BillingRow[] = useMemo(
    () =>
      rates.map((rate) => ({
        ...rate,
        scopeLabel: resolveScopeLabel(rate.scope, t),
        scopeName: rate.scopeName ?? rate.scopeId,
        status: resolveStatus(rate)
      })),
    [rates, t]
  );

  const sort = searchParams.get(SORT_PARAM) ?? "scope_asc";
  const page = Math.max(1, Number(searchParams.get(PAGE_PARAM) ?? "1") || 1);
  const pageSize = (Number(searchParams.get(PAGE_SIZE_PARAM) ?? "25") || 25) as 10 | 25 | 50 | 100;
  const scopeFilter = searchParams.get(SCOPE_FILTER) ?? undefined;
  const statusFilter = searchParams.get(STATUS_FILTER) ?? undefined;
  const search = (searchParams.get(SEARCH_PARAM) ?? "").toLowerCase();

  const filtered = useMemo(() => {
    let result = rows;
    if (scopeFilter) result = result.filter((r) => r.scope === scopeFilter);
    if (statusFilter) result = result.filter((r) => r.status === statusFilter);
    if (search) {
      result = result.filter(
        (r) =>
          r.scopeName.toLowerCase().includes(search) ||
          r.scopeLabel.toLowerCase().includes(search) ||
          r.effectiveFrom.includes(search)
      );
    }
    // Sort
    const [field, direction] = sort.split("_") as [string, "asc" | "desc"];
    const dir = direction === "desc" ? -1 : 1;
    result = [...result].sort((a, b) => {
      const aVal: string | number =
        field === "scopeName"
          ? a.scopeName
          : field === "amount"
            ? a.amountMinorPerHour
            : field === "effectiveFrom"
              ? a.effectiveFrom
              : a.scopeLabel;
      const bVal: string | number =
        field === "scopeName"
          ? b.scopeName
          : field === "amount"
            ? b.amountMinorPerHour
            : field === "effectiveFrom"
              ? b.effectiveFrom
              : b.scopeLabel;
      if (typeof aVal === "string" && typeof bVal === "string") return aVal.localeCompare(bVal) * dir;
      return ((aVal as number) - (bVal as number)) * dir;
    });
    return result;
  }, [rows, scopeFilter, statusFilter, search, sort]);

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const sortOptions = [
    { value: "scope_asc", label: `${t.scopeCustomer} A-Z` },
    { value: "scope_desc", label: `${t.scopeCustomer} Z-A` },
    { value: "amount_asc", label: `${t.amount} ↑` },
    { value: "amount_desc", label: `${t.amount} ↓` },
    { value: "effectiveFrom_asc", label: `${t.effectiveFrom} ↑` },
    { value: "effectiveFrom_desc", label: `${t.effectiveFrom} ↓` }
  ];

  const scopeOptions = [
    { value: "customer", label: t.scopeCustomer ?? "Customer" },
    { value: "project", label: t.scopeProject ?? "Project" },
    { value: "service_type", label: t.scopeServiceType ?? "Service type" }
  ];

  const columns: SmartColumn<BillingRow>[] = [
    {
      id: "scope",
      label: t.scope ?? "Scope",
      width: 140,
      render: (row) => row.scopeLabel,
      sort: { asc: "scope_asc", desc: "scope_desc" },
      filter: { parameter: SCOPE_FILTER, options: scopeOptions }
    },
    {
      id: "scopeName",
      label: t.scopeCustomer ?? "Name",
      width: 220,
      render: (row) => row.scopeName,
      sort: { asc: "scopeName_asc", desc: "scopeName_desc" }
    },
    {
      id: "amount",
      label: t.amount ?? "Amount",
      width: 140,
      render: (row) => (
        <span data-mono="true">
          {formatMoney(row.amountMinorPerHour, row.currency, locale)}
          <span className="rate-unit">{t.perHour}</span>
        </span>
      ),
      sort: { asc: "amount_asc", desc: "amount_desc" }
    },
    {
      id: "currency",
      label: t.currency ?? "Currency",
      width: 90,
      render: (row) => row.currency,
      locked: true
    },
    {
      id: "effectiveFrom",
      label: t.effectiveFrom ?? "In force from",
      width: 130,
      render: (row) => <time dateTime={row.effectiveFrom}>{row.effectiveFrom}</time>,
      sort: { asc: "effectiveFrom_asc", desc: "effectiveFrom_desc" }
    },
    {
      id: "status",
      label: t.history ?? "History",
      width: 200,
      ...(t.annulHelp ? { help: t.annulHelp } : {}),
      render: (row) => {
        if (row.status === "withdrawn") {
          return (
            <span className="rate-state annulled">
              {row.annulledByName ? `${t.withdrawn} · ${row.annulledByName}` : t.withdrawn}
            </span>
          );
        }
        return (
          <span className="rate-actions">
            <span className={row.status === "in_force" ? "rate-state current" : "rate-state"}>
              {row.status === "in_force" ? t.current : t.superseded}
            </span>
            {confirming === row.id ? (
              <>
                <button
                  type="button"
                  className="danger-link"
                  disabled={busy}
                  onClick={() => {
                    setConfirming("");
                    onAnnul(row.id);
                  }}
                >
                  {t.annulConfirm}
                </button>
                <button type="button" className="quiet-link" onClick={() => setConfirming("")}>
                  {t.annulCancel}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="quiet-link"
                disabled={busy}
                aria-label={`${t.annul} · ${row.scopeName} · ${row.effectiveFrom}`}
                onClick={() => setConfirming(row.id)}
              >
                {t.annul}
              </button>
            )}
          </span>
        );
      }
    }
  ];

  const labels = {
    sort: t.sort ?? "Sort",
    columns: t.columns ?? "Columns",
    visibility: t.visibility ?? "Visibility",
    narrower: t.narrower ?? "Narrower",
    wider: t.wider ?? "Wider",
    moveUp: t.moveUp ?? "Move up",
    moveDown: t.moveDown ?? "Move down",
    previous: t.previous ?? "Previous",
    nextPage: t.nextPage ?? "Next page",
    results: t.results ?? "results",
    rows: t.rows ?? "Rows",
    all: t.all ?? "All",
    filter: t.filterType ?? "Filter"
  };

  return (
    <SmartDataTable
      tableId={defaultPreference.tableId}
      rows={paginated}
      columns={columns}
      preference={defaultPreference}
      total={total}
      page={page}
      pageSize={pageSize}
      pageParam={PAGE_PARAM}
      pageSizeParam={PAGE_SIZE_PARAM}
      sortParam={SORT_PARAM}
      sort={sort}
      sortOptions={sortOptions}
      empty={t.emptyBilling ?? "No billing rates published."}
      labels={labels}
      primaryControls={
        <InstantSearch placeholder={t.searchBilling ?? "Search by name, amount or date"} resetParams={[PAGE_PARAM]} />
      }
    />
  );
}
