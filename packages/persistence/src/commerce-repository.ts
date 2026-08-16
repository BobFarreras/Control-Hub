import { randomUUID } from "node:crypto";
import {
  CommerceError,
  type Catalog,
  type CommerceRepository,
  type FinancialInput,
  type PlanRecord,
  type PriceRecord,
  type ProductOfferInput,
  type ProductOfferRecord,
  type ProductCatalogDetail,
  type ProductRecord,
  type ProductResourceRecord,
  type ProductResourceKind,
  type ProductVersionRecord,
  type RenewalAlert,
  type SubscriptionRecord
} from "@control-hub/application";
import { withTenant, type DatabaseClient } from "@control-hub/database";
import {
  nextRenewalAt,
  type BillingInterval,
  type CommercialModel,
  type SubscriptionStatus,
  type TenantContext
} from "@control-hub/domain";

type DatabaseError = { code?: string; constraint_name?: string };
type PriceRow = Omit<PriceRecord, "amountMinor" | "costMinor"> & {
  amountMinor: string | number;
  costMinor: string | number;
};
type FinancialRow = Omit<FinancialInput, "amountMinor" | "costMinor"> & {
  amountMinor: string | number;
  costMinor: string | number;
};

function duplicate(error: unknown): never {
  const databaseError = error as DatabaseError;
  if (databaseError.code === "23505") throw new CommerceError("DUPLICATE_CODE");
  if (databaseError.code === "23514") throw new CommerceError("INVALID_INPUT");
  throw error;
}
function price(row: PriceRow): PriceRecord {
  return { ...row, amountMinor: Number(row.amountMinor), costMinor: Number(row.costMinor) };
}
const subscriptionSelect = `select s.id, s.customer_id as "customerId", c.display_name as "customerName", s.plan_id as "planId", p.name as "planName", s.price_id as "priceId", s.status, s.quantity, s.started_at as "startedAt", s.current_period_start as "currentPeriodStart", s.renewal_at as "renewalAt", s.renewal_alert_days as "renewalAlertDays", s.paused_at as "pausedAt", s.canceled_at as "canceledAt", s.created_at as "createdAt", s.updated_at as "updatedAt" from subscriptions s join customers c on c.tenant_id = s.tenant_id and c.id = s.customer_id join plans p on p.tenant_id = s.tenant_id and p.id = s.plan_id`;

export class PostgresCommerceRepository implements CommerceRepository {
  constructor(private readonly database: DatabaseClient) {}

  catalog(context: TenantContext): Promise<Catalog> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const products = await tx<
        ProductRecord[]
      >`select id, code, name, description, status, created_at as "createdAt", updated_at as "updatedAt" from products where tenant_id = ${context.tenantId} order by name`;
      const versions = await tx<
        ProductVersionRecord[]
      >`select id, product_id as "productId", version, status, released_at as "releasedAt", release_notes as "releaseNotes", features, contents, schema_document as "schemaDocument", created_at as "createdAt", updated_at as "updatedAt" from product_versions where tenant_id = ${context.tenantId} order by created_at desc`;
      const plans = await tx<
        PlanRecord[]
      >`select id, product_version_id as "productVersionId", code, name, description, commercial_model as "commercialModel", status, created_at as "createdAt" from plans where tenant_id = ${context.tenantId} order by name`;
      const prices = await tx<
        PriceRow[]
      >`select id, plan_id as "planId", currency, amount_minor as "amountMinor", cost_minor as "costMinor", tax_basis_points as "taxBasisPoints", billing_interval as interval, effective_from as "effectiveFrom", created_at as "createdAt" from plan_prices where tenant_id = ${context.tenantId} order by effective_from desc, created_at desc`;
      return { products, versions, plans, prices: prices.map(price) };
    });
  }

  productDetail(context: TenantContext, productId: string): Promise<ProductCatalogDetail> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const products = await tx<
        ProductRecord[]
      >`select id, code, name, description, status, created_at as "createdAt", updated_at as "updatedAt" from products where tenant_id = ${context.tenantId} and id = ${productId}`;
      const product = products[0];
      if (!product) throw new CommerceError("PRODUCT_NOT_FOUND");
      const versions = await tx<
        ProductVersionRecord[]
      >`select id, product_id as "productId", version, status, released_at as "releasedAt", release_notes as "releaseNotes", features, contents, schema_document as "schemaDocument", created_at as "createdAt", updated_at as "updatedAt" from product_versions where tenant_id = ${context.tenantId} and product_id = ${productId} order by created_at desc`;
      const plans = await tx<
        PlanRecord[]
      >`select p.id, p.product_version_id as "productVersionId", p.code, p.name, p.description, p.commercial_model as "commercialModel", p.status, p.created_at as "createdAt" from plans p join product_versions v on v.tenant_id = p.tenant_id and v.id = p.product_version_id where p.tenant_id = ${context.tenantId} and v.product_id = ${productId} order by p.name`;
      const prices = await tx<
        PriceRow[]
      >`select pp.id, pp.plan_id as "planId", pp.currency, pp.amount_minor as "amountMinor", pp.cost_minor as "costMinor", pp.tax_basis_points as "taxBasisPoints", pp.billing_interval as interval, pp.effective_from as "effectiveFrom", pp.created_at as "createdAt" from plan_prices pp join plans p on p.tenant_id = pp.tenant_id and p.id = pp.plan_id join product_versions v on v.tenant_id = p.tenant_id and v.id = p.product_version_id where pp.tenant_id = ${context.tenantId} and v.product_id = ${productId} order by pp.effective_from desc, pp.created_at desc`;
      const resources = await tx<ProductResourceRecord[]>`
        select id, product_id as "productId", product_version_id as "productVersionId", kind, label, url,
          created_at as "createdAt", updated_at as "updatedAt"
        from product_resources
        where tenant_id = ${context.tenantId} and product_id = ${productId}
        order by kind, label`;
      const customers = await tx<ProductCatalogDetail["customers"]>`
        select cs.id as "serviceId", cs.customer_id as "customerId", c.display_name as "customerName",
          p.name as "planName", cs.commercial_model as "commercialModel", cs.status, cs.quantity,
          cs.starts_at as "startsAt", cs.ends_at as "endsAt"
        from customer_services cs
        join customers c on c.tenant_id = cs.tenant_id and c.id = cs.customer_id
        join plans p on p.tenant_id = cs.tenant_id and p.id = cs.plan_id
        join product_versions v on v.tenant_id = p.tenant_id and v.id = p.product_version_id
        where cs.tenant_id = ${context.tenantId} and v.product_id = ${productId}
        order by c.display_name, cs.starts_at desc`;
      return { product, products: [product], versions, plans, prices: prices.map(price), resources, customers };
    });
  }

  updateProduct(
    context: TenantContext,
    productId: string,
    input: { name: string; description?: string; status: "active" | "archived"; expectedUpdatedAt: Date }
  ): Promise<ProductRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<ProductRecord[]>`
        update products set name = ${input.name}, description = ${input.description ?? null}, status = ${input.status},
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${productId} and updated_at = ${input.expectedUpdatedAt}
        returning id, code, name, description, status, created_at as "createdAt", updated_at as "updatedAt"`;
      if (rows[0]) return rows[0];
      const exists = await tx<{ found: boolean }[]>`
        select exists(select 1 from products where tenant_id = ${context.tenantId} and id = ${productId}) as found`;
      throw new CommerceError(exists[0]?.found ? "CONCURRENT_MODIFICATION" : "PRODUCT_NOT_FOUND");
    });
  }

  updateVersionKnowledge(
    context: TenantContext,
    versionId: string,
    input: {
      releaseNotes?: string;
      features: string[];
      contents: string[];
      schemaDocument?: Record<string, unknown>;
      expectedUpdatedAt: Date;
    }
  ): Promise<ProductVersionRecord> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<ProductVersionRecord[]>`
        update product_versions set release_notes = ${input.releaseNotes ?? null}, features = ${tx.json(input.features)},
          contents = ${tx.json(input.contents)},
          schema_document = ${input.schemaDocument ? JSON.stringify(input.schemaDocument) : null}::jsonb,
          updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${versionId} and updated_at = ${input.expectedUpdatedAt}
        returning id, product_id as "productId", version, status, released_at as "releasedAt",
          release_notes as "releaseNotes", features, contents, schema_document as "schemaDocument",
          created_at as "createdAt", updated_at as "updatedAt"`;
      if (rows[0]) return rows[0];
      const exists = await tx<{ found: boolean }[]>`
        select exists(select 1 from product_versions where tenant_id = ${context.tenantId} and id = ${versionId}) as found`;
      throw new CommerceError(exists[0]?.found ? "CONCURRENT_MODIFICATION" : "VERSION_NOT_FOUND");
    });
  }

  replaceProductResources(
    context: TenantContext,
    productId: string,
    resources: Array<{ productVersionId?: string; kind: ProductResourceKind; label: string; url: string }>
  ): Promise<ProductResourceRecord[]> {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const product = await tx<{ found: boolean }[]>`
        select exists(select 1 from products where tenant_id = ${context.tenantId} and id = ${productId}) as found`;
      if (!product[0]?.found) throw new CommerceError("PRODUCT_NOT_FOUND");
      await tx`delete from product_resources where tenant_id = ${context.tenantId} and product_id = ${productId}`;
      for (const resource of resources) {
        await tx`
          insert into product_resources (id, tenant_id, product_id, product_version_id, kind, label, url)
          values (${randomUUID()}, ${context.tenantId}, ${productId}, ${resource.productVersionId ?? null},
            ${resource.kind}, ${resource.label}, ${resource.url})`;
      }
      return tx<ProductResourceRecord[]>`
        select id, product_id as "productId", product_version_id as "productVersionId", kind, label, url,
          created_at as "createdAt", updated_at as "updatedAt"
        from product_resources where tenant_id = ${context.tenantId} and product_id = ${productId}
        order by kind, label`;
    });
  }

  async createProduct(context: TenantContext, input: { code: string; name: string; description?: string }) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const rows = await tx<
          ProductRecord[]
        >`insert into products (id, tenant_id, code, name, description) values (${randomUUID()}, ${context.tenantId}, ${input.code}, ${input.name}, ${input.description ?? null}) returning id, code, name, description, status, created_at as "createdAt", updated_at as "updatedAt"`;
        return rows[0]!;
      });
    } catch (error) {
      return duplicate(error);
    }
  }

  async createProductOffer(
    context: TenantContext,
    input: ProductOfferInput & {
      version: ProductOfferInput["version"] & { releasedAt: Date };
      price: ProductOfferInput["price"] & { effectiveFrom: Date };
    }
  ): Promise<ProductOfferRecord> {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const productId = randomUUID();
        const versionId = randomUUID();
        const planId = randomUUID();
        const priceId = randomUUID();
        const products = await tx<
          ProductRecord[]
        >`insert into products (id, tenant_id, code, name, description) values (${productId}, ${context.tenantId}, ${input.product.code}, ${input.product.name}, ${input.product.description ?? null}) returning id, code, name, description, status, created_at as "createdAt", updated_at as "updatedAt"`;
        const versions = await tx<
          ProductVersionRecord[]
        >`insert into product_versions (id, tenant_id, product_id, version, status, released_at) values (${versionId}, ${context.tenantId}, ${productId}, ${input.version.version}, 'active', ${input.version.releasedAt}) returning id, product_id as "productId", version, status, released_at as "releasedAt", release_notes as "releaseNotes", features, contents, schema_document as "schemaDocument", created_at as "createdAt", updated_at as "updatedAt"`;
        const plans = await tx<
          PlanRecord[]
        >`insert into plans (id, tenant_id, product_version_id, code, name, description, commercial_model) values (${planId}, ${context.tenantId}, ${versionId}, ${input.plan.code}, ${input.plan.name}, ${input.plan.description ?? null}, ${input.plan.commercialModel}) returning id, product_version_id as "productVersionId", code, name, description, commercial_model as "commercialModel", status, created_at as "createdAt"`;
        const prices = await tx<
          PriceRow[]
        >`insert into plan_prices (id, tenant_id, plan_id, currency, amount_minor, cost_minor, tax_basis_points, billing_interval, effective_from) values (${priceId}, ${context.tenantId}, ${planId}, ${input.price.currency}, ${input.price.amountMinor}, ${input.price.costMinor}, ${input.price.taxBasisPoints}, ${input.price.interval}, ${input.price.effectiveFrom}) returning id, plan_id as "planId", currency, amount_minor as "amountMinor", cost_minor as "costMinor", tax_basis_points as "taxBasisPoints", billing_interval as interval, effective_from as "effectiveFrom", created_at as "createdAt"`;
        return { product: products[0]!, version: versions[0]!, plan: plans[0]!, price: price(prices[0]!) };
      });
    } catch (error) {
      return duplicate(error);
    }
  }

  async createVersion(
    context: TenantContext,
    productId: string,
    input: { version: string; status: "draft" | "active"; releasedAt?: Date }
  ) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const rows = await tx<
          ProductVersionRecord[]
        >`insert into product_versions (id, tenant_id, product_id, version, status, released_at) select ${randomUUID()}, ${context.tenantId}, id, ${input.version}, ${input.status}, ${input.releasedAt ?? null} from products where tenant_id = ${context.tenantId} and id = ${productId} returning id, product_id as "productId", version, status, released_at as "releasedAt", release_notes as "releaseNotes", features, contents, schema_document as "schemaDocument", created_at as "createdAt", updated_at as "updatedAt"`;
        if (!rows[0]) throw new CommerceError("PRODUCT_NOT_FOUND");
        return rows[0];
      });
    } catch (error) {
      return duplicate(error);
    }
  }

  async createPlan(
    context: TenantContext,
    productVersionId: string,
    input: { code: string; name: string; description?: string; commercialModel?: CommercialModel }
  ) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const rows = await tx<
          PlanRecord[]
        >`insert into plans (id, tenant_id, product_version_id, code, name, description, commercial_model) select ${randomUUID()}, ${context.tenantId}, id, ${input.code}, ${input.name}, ${input.description ?? null}, ${input.commercialModel ?? "subscription"} from product_versions where tenant_id = ${context.tenantId} and id = ${productVersionId} returning id, product_version_id as "productVersionId", code, name, description, commercial_model as "commercialModel", status, created_at as "createdAt"`;
        if (!rows[0]) throw new CommerceError("VERSION_NOT_FOUND");
        return rows[0];
      });
    } catch (error) {
      return duplicate(error);
    }
  }

  async createPrice(
    context: TenantContext,
    planId: string,
    input: {
      currency: string;
      amountMinor: number;
      costMinor: number;
      taxBasisPoints: number;
      interval: BillingInterval;
      effectiveFrom: Date;
    }
  ) {
    try {
      return await withTenant(this.database, context.tenantId, async (tx) => {
        const rows = await tx<
          PriceRow[]
        >`insert into plan_prices (id, tenant_id, plan_id, currency, amount_minor, cost_minor, tax_basis_points, billing_interval, effective_from) select ${randomUUID()}, ${context.tenantId}, id, ${input.currency}, ${input.amountMinor}, ${input.costMinor}, ${input.taxBasisPoints}, ${input.interval}, ${input.effectiveFrom} from plans where tenant_id = ${context.tenantId} and id = ${planId} returning id, plan_id as "planId", currency, amount_minor as "amountMinor", cost_minor as "costMinor", tax_basis_points as "taxBasisPoints", billing_interval as interval, effective_from as "effectiveFrom", created_at as "createdAt"`;
        if (!rows[0]) throw new CommerceError("PLAN_NOT_FOUND");
        return price(rows[0]);
      });
    } catch (error) {
      return duplicate(error);
    }
  }

  listSubscriptions(context: TenantContext) {
    return withTenant(this.database, context.tenantId, (tx) =>
      tx.unsafe<SubscriptionRecord[]>(`${subscriptionSelect} where s.tenant_id = $1 order by s.updated_at desc`, [
        context.tenantId
      ])
    );
  }

  createSubscription(
    context: TenantContext,
    input: {
      customerId: string;
      planId: string;
      priceId: string;
      quantity: number;
      startedAt: Date;
      renewalAt?: Date;
      renewalAlertDays: number;
    }
  ) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const valid =
        await tx`select 1 from customers c join plans p on p.tenant_id = c.tenant_id join plan_prices pp on pp.tenant_id = p.tenant_id and pp.plan_id = p.id where c.tenant_id = ${context.tenantId} and c.id = ${input.customerId} and p.id = ${input.planId} and pp.id = ${input.priceId} and pp.effective_from <= ${input.startedAt}`;
      if (!valid[0]) throw new CommerceError("INVALID_INPUT");
      const id = randomUUID();
      await tx`insert into subscriptions (id, tenant_id, customer_id, plan_id, price_id, quantity, started_at, current_period_start, renewal_at, renewal_alert_days) values (${id}, ${context.tenantId}, ${input.customerId}, ${input.planId}, ${input.priceId}, ${input.quantity}, ${input.startedAt}, ${input.startedAt}, ${input.renewalAt ?? null}, ${input.renewalAlertDays})`;
      await tx`insert into subscription_events (id, tenant_id, subscription_id, actor_user_id, type, effective_at, new_plan_id, new_price_id, metadata) values (${randomUUID()}, ${context.tenantId}, ${id}, ${context.userId}, 'created', ${input.startedAt}, ${input.planId}, ${input.priceId}, ${tx.json({ quantity: input.quantity })})`;
      const rows = await tx.unsafe<SubscriptionRecord[]>(`${subscriptionSelect} where s.tenant_id = $1 and s.id = $2`, [
        context.tenantId,
        id
      ]);
      return rows[0]!;
    });
  }

  transitionSubscription(
    context: TenantContext,
    subscriptionId: string,
    status: SubscriptionStatus,
    effectiveAt: Date
  ) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const current = await tx<
        { status: SubscriptionStatus }[]
      >`select status from subscriptions where tenant_id = ${context.tenantId} and id = ${subscriptionId} for update`;
      if (!current[0]) throw new CommerceError("SUBSCRIPTION_NOT_FOUND");
      const allowed =
        current[0].status === "active"
          ? ["paused", "canceled"]
          : current[0].status === "paused"
            ? ["active", "canceled"]
            : [];
      if (!allowed.includes(status)) throw new CommerceError("INVALID_SUBSCRIPTION_TRANSITION");
      const eventType = status === "active" ? "resumed" : status === "paused" ? "paused" : "canceled";
      await tx`update subscriptions set status = ${status}, paused_at = case when ${status} = 'paused' then ${effectiveAt} else null end, canceled_at = case when ${status} = 'canceled' then ${effectiveAt} else null end, updated_at = now() where tenant_id = ${context.tenantId} and id = ${subscriptionId}`;
      await tx`insert into subscription_events (id, tenant_id, subscription_id, actor_user_id, type, effective_at) values (${randomUUID()}, ${context.tenantId}, ${subscriptionId}, ${context.userId}, ${eventType}, ${effectiveAt})`;
      const rows = await tx.unsafe<SubscriptionRecord[]>(`${subscriptionSelect} where s.tenant_id = $1 and s.id = $2`, [
        context.tenantId,
        subscriptionId
      ]);
      return rows[0]!;
    });
  }

  changePlan(
    context: TenantContext,
    subscriptionId: string,
    input: { planId: string; priceId: string; effectiveAt: Date; renewalAt?: Date }
  ) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const subscriptions = await tx<
        { plan_id: string; price_id: string; status: SubscriptionStatus }[]
      >`select plan_id, price_id, status from subscriptions where tenant_id = ${context.tenantId} and id = ${subscriptionId} for update`;
      const current = subscriptions[0];
      if (!current) throw new CommerceError("SUBSCRIPTION_NOT_FOUND");
      if (current.status === "canceled") throw new CommerceError("INVALID_SUBSCRIPTION_TRANSITION");
      const valid =
        await tx`select 1 from plan_prices where tenant_id = ${context.tenantId} and id = ${input.priceId} and plan_id = ${input.planId}`;
      if (!valid[0]) throw new CommerceError("PRICE_NOT_FOUND");
      await tx`update subscriptions set plan_id = ${input.planId}, price_id = ${input.priceId}, current_period_start = ${input.effectiveAt}, renewal_at = ${input.renewalAt ?? null}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${subscriptionId}`;
      await tx`insert into subscription_events (id, tenant_id, subscription_id, actor_user_id, type, effective_at, previous_plan_id, new_plan_id, previous_price_id, new_price_id) values (${randomUUID()}, ${context.tenantId}, ${subscriptionId}, ${context.userId}, 'plan_changed', ${input.effectiveAt}, ${current.plan_id}, ${input.planId}, ${current.price_id}, ${input.priceId})`;
      const rows = await tx.unsafe<SubscriptionRecord[]>(`${subscriptionSelect} where s.tenant_id = $1 and s.id = $2`, [
        context.tenantId,
        subscriptionId
      ]);
      return rows[0]!;
    });
  }

  renewSubscription(context: TenantContext, subscriptionId: string, effectiveAt: Date) {
    return withTenant(this.database, context.tenantId, async (tx) => {
      const rows = await tx<
        { status: SubscriptionStatus; renewal_at: Date | null; billing_interval: BillingInterval }[]
      >`select s.status, s.renewal_at, pp.billing_interval from subscriptions s join plan_prices pp on pp.tenant_id = s.tenant_id and pp.id = s.price_id where s.tenant_id = ${context.tenantId} and s.id = ${subscriptionId} for update of s`;
      const current = rows[0];
      if (!current) throw new CommerceError("SUBSCRIPTION_NOT_FOUND");
      if (current.status !== "active" || !current.renewal_at)
        throw new CommerceError("INVALID_SUBSCRIPTION_TRANSITION");
      const renewalAt = nextRenewalAt(current.renewal_at, current.billing_interval);
      if (!renewalAt) throw new CommerceError("INVALID_SUBSCRIPTION_TRANSITION");
      await tx`update subscriptions set current_period_start = ${effectiveAt}, renewal_at = ${renewalAt}, updated_at = now() where tenant_id = ${context.tenantId} and id = ${subscriptionId}`;
      await tx`insert into subscription_events (id, tenant_id, subscription_id, actor_user_id, type, effective_at, metadata) values (${randomUUID()}, ${context.tenantId}, ${subscriptionId}, ${context.userId}, 'renewed', ${effectiveAt}, ${tx.json({ previousRenewalAt: current.renewal_at.toISOString(), renewalAt: renewalAt.toISOString() })})`;
      const subscriptions = await tx.unsafe<SubscriptionRecord[]>(
        `${subscriptionSelect} where s.tenant_id = $1 and s.id = $2`,
        [context.tenantId, subscriptionId]
      );
      return subscriptions[0]!;
    });
  }

  renewalAlerts(context: TenantContext, now: Date): Promise<RenewalAlert[]> {
    return withTenant(
      this.database,
      context.tenantId,
      (tx) =>
        tx<
          RenewalAlert[]
        >`select s.id as "subscriptionId", c.display_name as "customerName", p.name as "planName", s.renewal_at as "renewalAt", greatest(0, ceil(extract(epoch from (s.renewal_at - ${now})) / 86400))::int as "daysRemaining" from subscriptions s join customers c on c.tenant_id = s.tenant_id and c.id = s.customer_id join plans p on p.tenant_id = s.tenant_id and p.id = s.plan_id where s.tenant_id = ${context.tenantId} and s.status = 'active' and s.renewal_at is not null and s.renewal_at >= ${now} and s.renewal_at <= ${now} + make_interval(days => s.renewal_alert_days) order by s.renewal_at`
    );
  }

  async financialInputs(context: TenantContext): Promise<FinancialInput[]> {
    const rows = await withTenant(
      this.database,
      context.tenantId,
      (tx) =>
        tx<
          FinancialRow[]
        >`select pp.currency, pp.amount_minor as "amountMinor", pp.cost_minor as "costMinor", pp.billing_interval as interval, s.quantity from subscriptions s join plan_prices pp on pp.tenant_id = s.tenant_id and pp.id = s.price_id where s.tenant_id = ${context.tenantId} and s.status = 'active'`
    );
    return rows.map((row) => ({ ...row, amountMinor: Number(row.amountMinor), costMinor: Number(row.costMinor) }));
  }
}
