import { apiFetch } from "./api";

const empty = { catalog: { products: [], versions: [], plans: [], prices: [] }, subscriptions: [], metrics: [], alerts: [], customers: [], loadError: true };
export async function getCommerceData() {
  try {
    const responses = await Promise.all([
      apiFetch("/api/v1/commerce/catalog"),
      apiFetch("/api/v1/commerce/subscriptions"),
      apiFetch("/api/v1/commerce/financial-summary"),
      apiFetch("/api/v1/commerce/renewal-alerts"),
      apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc")
    ]);
    if (responses.some((response) => !response.ok)) return empty;
    const [catalog, subscriptions, metrics, alerts, customers] = await Promise.all(responses.map((response) => response.json()));
    return { catalog, subscriptions: subscriptions.subscriptions, metrics: metrics.metrics, alerts: alerts.alerts, customers: customers.items, loadError: false };
  } catch { return empty; }
}
