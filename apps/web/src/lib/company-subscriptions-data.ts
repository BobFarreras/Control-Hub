import { apiFetch, readJson } from "@/lib/api";
import type {
  CompanySubscription,
  CompanySubscriptionsResponse,
  TablePreference,
  TablePreferenceResponse
} from "@/lib/api-types";

export type CompanySubscriptionQuery = {
  status?: string;
  category?: string;
  renewalState?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
};

export type CompanySubscriptionsData = {
  subscriptions: CompanySubscription[];
  preference: TablePreference;
  total: number;
  page: number;
  pageSize: TablePreference["pageSize"];
  sort: string;
  loadError: boolean;
  renderedAt: number;
};

const defaultPreference: TablePreference = {
  tableId: "company-subscriptions",
  columnOrder: ["service", "category", "account", "owner", "quantity", "renewal", "cost", "status", "actions"],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
};

export async function loadCompanySubscriptions(query: CompanySubscriptionQuery): Promise<CompanySubscriptionsData> {
  const renderedAt = Date.now();
  const filters = new URLSearchParams();
  if (query.status) filters.set("status", query.status);
  if (query.category) filters.set("category", query.category);
  if (query.renewalState) filters.set("renewalState", query.renewalState);
  try {
    const [subscriptionsResponse, preferenceResponse] = await Promise.all([
      apiFetch(`/api/v1/company-subscriptions?${filters.toString()}`),
      apiFetch("/api/v1/table-preferences/company-subscriptions")
    ]);
    if (!subscriptionsResponse.ok) throw new Error("COMPANY_SUBSCRIPTIONS_UNAVAILABLE");
    const payload = await readJson<CompanySubscriptionsResponse>(subscriptionsResponse);
    const preference = preferenceResponse.ok
      ? (await readJson<TablePreferenceResponse>(preferenceResponse)).preference
      : defaultPreference;
    const requestedPageSize = Number(query.pageSize ?? preference.pageSize);
    const pageSize = [10, 25, 50, 100].includes(requestedPageSize)
      ? (requestedPageSize as TablePreference["pageSize"])
      : preference.pageSize;
    const sort = query.sort ?? "renewalAsc";
    const sorted = [...payload.subscriptions].sort((left, right) => {
      if (sort === "serviceAsc") return left.serviceName.localeCompare(right.serviceName);
      if (sort === "serviceDesc") return right.serviceName.localeCompare(left.serviceName);
      if (sort === "costDesc") return (right.financials?.amountMinor ?? -1) - (left.financials?.amountMinor ?? -1);
      const leftRenewal = left.renewalAt ? new Date(left.renewalAt).getTime() : Number.MAX_SAFE_INTEGER;
      const rightRenewal = right.renewalAt ? new Date(right.renewalAt).getTime() : Number.MAX_SAFE_INTEGER;
      return sort === "renewalDesc" ? rightRenewal - leftRenewal : leftRenewal - rightRenewal;
    });
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, Number(query.page ?? 1) || 1), pages);
    return {
      subscriptions: sorted.slice((page - 1) * pageSize, page * pageSize),
      preference,
      total: sorted.length,
      page,
      pageSize,
      sort,
      loadError: false,
      renderedAt
    };
  } catch {
    return {
      subscriptions: [],
      preference: defaultPreference,
      total: 0,
      page: 1,
      pageSize: defaultPreference.pageSize,
      sort: "renewalAsc",
      loadError: true,
      renderedAt
    };
  }
}
