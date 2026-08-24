import { apiFetch, readJson } from "@/lib/api";
import type {
  TablePreference,
  TablePreferenceResponse,
  UsageBudget,
  UsageBudgetsResponse,
  UsageCost,
  UsageCostsResponse,
  UsageEvent,
  UsageEventsResponse,
  UsageSource,
  UsageSourcesResponse
} from "@/lib/api-types";
const fallback: TablePreference = {
  tableId: "usage.events",
  columnOrder: [],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
};
export async function loadUsage(tableId: string): Promise<{
  events: UsageEvent[];
  costs: UsageCost[];
  budgets: UsageBudget[];
  canSeeCosts: boolean;
  canManageBudgets: boolean;
  preference: TablePreference;
  sources: UsageSource[];
}> {
  const me = await apiFetch("/api/v1/me");
  const permissions = me.ok ? (await readJson<{ context: { permissions: string[] } }>(me)).context.permissions : [];
  const canSeeCosts = permissions.includes("financials:read");
  const [eventsResponse, sourcesResponse, costsResponse, budgetsResponse, preferenceResponse] = await Promise.all([
    apiFetch("/api/v1/usage/events?limit=500"),
    apiFetch("/api/v1/usage/sources"),
    canSeeCosts ? apiFetch("/api/v1/usage/costs?limit=500") : Promise.resolve(null),
    canSeeCosts ? apiFetch("/api/v1/usage/budgets") : Promise.resolve(null),
    apiFetch(`/api/v1/table-preferences/${tableId}`)
  ]);
  return {
    events: eventsResponse.ok ? (await readJson<UsageEventsResponse>(eventsResponse)).events : [],
    sources: sourcesResponse.ok ? (await readJson<UsageSourcesResponse>(sourcesResponse)).sources : [],
    costs: costsResponse?.ok ? (await readJson<UsageCostsResponse>(costsResponse)).costs : [],
    budgets: budgetsResponse?.ok ? (await readJson<UsageBudgetsResponse>(budgetsResponse)).budgets : [],
    canSeeCosts,
    canManageBudgets: permissions.includes("budgets:manage"),
    preference: preferenceResponse.ok
      ? (await readJson<TablePreferenceResponse>(preferenceResponse)).preference
      : { ...fallback, tableId }
  };
}
