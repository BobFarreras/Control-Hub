import { apiFetch, readJson } from "./api";
import type {
  Catalog,
  CustomerOption,
  CustomerServicesResponse,
  Member,
  MembersResponse,
  Page,
  ProjectRow,
  ProjectsPage,
  TablePreference,
  TablePreferenceResponse
} from "./api-types";

export type CustomerServicesData = {
  services: CustomerServicesResponse["services"];
  catalog: Catalog;
  customers: CustomerOption[];
  members: Member[];
  projects: ProjectRow[];
  preference: TablePreference;
  total: number;
  page: number;
  pageSize: TablePreference["pageSize"];
  sort: string;
  loadError: boolean;
  renderedAt: number;
};

export type CustomerServiceSearch = {
  customerId?: string;
  productId?: string;
  commercialModel?: string;
  status?: string;
  currency?: string;
  servicePage?: string;
  servicePageSize?: string;
  serviceSort?: string;
  renewalState?: "due_soon" | "missing";
};

const defaultPreference: TablePreference = {
  tableId: "commerce.customer-services",
  columnOrder: [],
  hiddenColumns: [],
  columnWidths: {},
  pageSize: 25
};

export async function getCustomerServicesData(filters: CustomerServiceSearch): Promise<CustomerServicesData> {
  const renderedAt = Date.now();
  const requestedPage = Math.max(1, Number(filters.servicePage) || 1);
  const requestedPageSize = Number(filters.servicePageSize);
  const requestedSort = filters.serviceSort ?? "updated_desc";
  const empty = {
    services: [],
    catalog: { products: [], versions: [], plans: [], prices: [] },
    customers: [],
    members: [],
    projects: [],
    preference: defaultPreference,
    total: 0,
    page: 1,
    pageSize: defaultPreference.pageSize,
    sort: requestedSort,
    loadError: true,
    renderedAt
  } satisfies CustomerServicesData;
  try {
    const query = new URLSearchParams();
    for (const key of ["customerId", "productId", "commercialModel", "status", "currency", "renewalState"] as const) {
      const value = filters[key];
      if (value) query.set(key, value);
    }
    const [
      servicesResponse,
      catalogResponse,
      customersResponse,
      membersResponse,
      projectsResponse,
      preferenceResponse
    ] = await Promise.all([
      apiFetch(`/api/v1/commerce/customer-services${query.size ? `?${query}` : ""}`),
      apiFetch("/api/v1/commerce/catalog"),
      apiFetch("/api/v1/crm/customers?page=1&pageSize=100&sort=name_asc"),
      apiFetch("/api/v1/members"),
      apiFetch("/api/v1/projects?page=1&pageSize=100&sort=name_asc"),
      apiFetch("/api/v1/table-preferences/commerce.customer-services")
    ]);
    if (!servicesResponse.ok || !catalogResponse.ok || !customersResponse.ok || !membersResponse.ok) return empty;
    const [services, catalog, customers, members] = await Promise.all([
      readJson<CustomerServicesResponse>(servicesResponse),
      readJson<Catalog>(catalogResponse),
      readJson<Page<CustomerOption>>(customersResponse),
      readJson<MembersResponse>(membersResponse)
    ]);
    const projects = projectsResponse.ok ? (await readJson<ProjectsPage>(projectsResponse)).items : [];
    const preference = preferenceResponse.ok
      ? (await readJson<TablePreferenceResponse>(preferenceResponse)).preference
      : defaultPreference;
    const pageSize = ([10, 25, 50, 100] as const).includes(requestedPageSize as 10 | 25 | 50 | 100)
      ? (requestedPageSize as TablePreference["pageSize"])
      : preference.pageSize;
    const sorted = [...services.services].sort((left, right) => {
      if (requestedSort === "customer_asc") return left.customerName.localeCompare(right.customerName);
      if (requestedSort === "product_asc") return left.productName.localeCompare(right.productName);
      if (requestedSort === "contracted_asc") return left.contractedAt.localeCompare(right.contractedAt);
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(requestedPage, pages);
    return {
      services: sorted.slice((page - 1) * pageSize, page * pageSize),
      catalog,
      customers: customers.items,
      members: members.members,
      projects,
      preference,
      total: sorted.length,
      page,
      pageSize,
      sort: requestedSort,
      loadError: false,
      renderedAt
    };
  } catch {
    return empty;
  }
}
