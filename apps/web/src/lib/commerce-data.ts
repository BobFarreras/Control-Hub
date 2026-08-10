import { apiFetch, readJson } from "./api";
import type {
  Catalog,
  CustomerOption,
  CustomerSubscription,
  CustomerSubscriptionsResponse,
  FinancialMetric,
  FinancialSummaryResponse,
  Page,
  ProductCatalogDetail,
  RenewalAlert,
  RenewalAlertsResponse
} from "./api-types";

export type CommerceData = {
  catalog: Catalog;
  subscriptions: CustomerSubscription[];
  metrics: FinancialMetric[];
  alerts: RenewalAlert[];
  customers: CustomerOption[];
  loadError: boolean;
  /** Captured with the data rather than while rendering, so the server markup and the first
   *  client render compare against the same instant instead of two different clocks. */
  renderedAt: number;
};

const emptyData = {
  catalog: { products: [], versions: [], plans: [], prices: [] },
  subscriptions: [],
  metrics: [],
  alerts: [],
  customers: [],
  loadError: true
} satisfies Omit<CommerceData, "renderedAt">;

export async function getCommerceData(): Promise<CommerceData> {
  const empty: CommerceData = { ...emptyData, renderedAt: Date.now() };
  try {
    const [catalogResponse, subscriptionsResponse, metricsResponse, alertsResponse, customersResponse] =
      await Promise.all([
        apiFetch("/api/v1/commerce/catalog"),
        apiFetch("/api/v1/commerce/subscriptions"),
        apiFetch("/api/v1/commerce/financial-summary"),
        apiFetch("/api/v1/commerce/renewal-alerts"),
        apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc")
      ]);
    const responses = [catalogResponse, subscriptionsResponse, metricsResponse, alertsResponse, customersResponse];
    if (responses.some((response) => !response.ok)) return empty;
    const [catalog, subscriptions, metrics, alerts, customers] = await Promise.all([
      readJson<Catalog>(catalogResponse),
      readJson<CustomerSubscriptionsResponse>(subscriptionsResponse),
      readJson<FinancialSummaryResponse>(metricsResponse),
      readJson<RenewalAlertsResponse>(alertsResponse),
      readJson<Page<CustomerOption>>(customersResponse)
    ]);
    return {
      catalog,
      subscriptions: subscriptions.subscriptions,
      metrics: metrics.metrics,
      alerts: alerts.alerts,
      customers: customers.items,
      loadError: false,
      renderedAt: empty.renderedAt
    };
  } catch {
    return empty;
  }
}

export async function getProductCatalogDetail(productId: string): Promise<ProductCatalogDetail | null> {
  const response = await apiFetch(`/api/v1/commerce/products/${encodeURIComponent(productId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("PRODUCT_DETAIL_UNAVAILABLE");
  return readJson<ProductCatalogDetail>(response);
}
