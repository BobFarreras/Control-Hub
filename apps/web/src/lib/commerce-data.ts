import { cookies } from "next/headers";

const empty = { catalog: { products: [], versions: [], plans: [], prices: [] }, subscriptions: [], metrics: [], alerts: [], customers: [], loadError: true };
export async function getCommerceData() {
  const cookieStore = await cookies(); const cookie = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join("; "); const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"; const options = { headers: { cookie }, cache: "no-store" as const };
  try {
    const responses = await Promise.all([fetch(`${api}/api/v1/commerce/catalog`, options), fetch(`${api}/api/v1/commerce/subscriptions`, options), fetch(`${api}/api/v1/commerce/financial-summary`, options), fetch(`${api}/api/v1/commerce/renewal-alerts`, options), fetch(`${api}/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc`, options)]);
    if (responses.some((response) => !response.ok)) return empty;
    const [catalog, subscriptions, metrics, alerts, customers] = await Promise.all(responses.map((response) => response.json()));
    return { catalog, subscriptions: subscriptions.subscriptions, metrics: metrics.metrics, alerts: alerts.alerts, customers: customers.items, loadError: false };
  } catch { return empty; }
}
