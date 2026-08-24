-- Phase 8 U2: provider usage, reproducible costs and informative budgets.
-- Specification: docs/specifications/communications-usage-costs.md

create table usage_sources (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('connector', 'manual')),
  connector_instance_id uuid,
  operation text,
  manual_code text,
  last_complete_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (
    (kind = 'connector' and connector_instance_id is not null and operation is not null and manual_code is null)
    or (kind = 'manual' and connector_instance_id is null and operation is null and manual_code is not null)
  ),
  check (operation is null or length(operation) between 1 and 100),
  check (manual_code is null or length(manual_code) between 1 and 100),
  foreign key (tenant_id, connector_instance_id) references connector_instances(tenant_id, id) on delete restrict
);
create unique index usage_sources_connector_key on usage_sources (tenant_id, connector_instance_id, operation)
  where kind = 'connector';
create unique index usage_sources_manual_key on usage_sources (tenant_id, manual_code) where kind = 'manual';

create table usage_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  source_id uuid not null,
  external_id text not null check (length(external_id) between 1 and 240),
  occurred_at timestamptz not null,
  operation text not null check (length(operation) between 1 and 100),
  sku text not null check (length(sku) between 1 and 160),
  provider_status text not null check (provider_status in ('observed', 'estimated', 'void')),
  customer_id uuid,
  product_id uuid,
  customer_service_id uuid,
  project_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source_id, external_id),
  check (num_nonnulls(customer_id, product_id, customer_service_id, project_id) <= 1),
  foreign key (tenant_id, source_id) references usage_sources(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_service_id) references customer_services(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict
);
create index usage_events_period_idx on usage_events (tenant_id, occurred_at desc, id);
create index usage_events_source_period_idx on usage_events (tenant_id, source_id, occurred_at desc);

create table usage_event_quantities (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  event_id uuid not null,
  unit text not null check (unit in ('input_token', 'output_token', 'cached_input_token', 'request', 'image', 'audio_second', 'compute_millisecond', 'byte', 'provider_unit')),
  quantity bigint not null check (quantity >= 0),
  qualifier text not null default 'total' check (qualifier in ('total', 'input', 'output', 'cached', 'uncached')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, event_id, unit, qualifier),
  foreign key (tenant_id, event_id) references usage_events(tenant_id, id) on delete restrict
);

create table usage_adjustments (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  event_id uuid not null,
  reason text not null check (length(reason) between 3 and 500),
  actor_membership_id uuid,
  source_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (num_nonnulls(actor_membership_id, source_id) = 1),
  foreign key (tenant_id, event_id) references usage_events(tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_membership_id) references memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_id) references usage_sources(tenant_id, id) on delete restrict
);

create table usage_adjustment_quantities (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  adjustment_id uuid not null,
  unit text not null check (unit in ('input_token', 'output_token', 'cached_input_token', 'request', 'image', 'audio_second', 'compute_millisecond', 'byte', 'provider_unit')),
  quantity_delta bigint not null check (quantity_delta <> 0),
  qualifier text not null default 'total' check (qualifier in ('total', 'input', 'output', 'cached', 'uncached')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, adjustment_id, unit, qualifier),
  foreign key (tenant_id, adjustment_id) references usage_adjustments(tenant_id, id) on delete restrict
);

create table usage_rates (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  provider text not null check (length(provider) between 1 and 100),
  sku text not null check (length(sku) between 1 and 160),
  unit text not null check (unit in ('input_token', 'output_token', 'cached_input_token', 'request', 'image', 'audio_second', 'compute_millisecond', 'byte', 'provider_unit')),
  unit_size bigint not null check (unit_size > 0),
  currency char(3) not null check (currency = upper(currency)),
  effective_from timestamptz not null,
  source text not null check (length(source) between 1 and 200),
  annulled_at timestamptz,
  annulled_by_membership_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, sku, unit, effective_from),
  check ((annulled_at is null) = (annulled_by_membership_id is null)),
  foreign key (tenant_id, annulled_by_membership_id) references memberships(tenant_id, id) on delete restrict
);
create index usage_rates_lookup_idx on usage_rates (tenant_id, provider, sku, unit, effective_from desc)
  where annulled_at is null;

create table usage_rate_tiers (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  rate_id uuid not null,
  starts_at bigint not null check (starts_at >= 0),
  price_minor bigint not null check (price_minor >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, rate_id, starts_at),
  foreign key (tenant_id, rate_id) references usage_rates(tenant_id, id) on delete restrict
);

create table exchange_rates (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  base_currency char(3) not null check (base_currency = upper(base_currency)),
  quote_currency char(3) not null check (quote_currency = upper(quote_currency)),
  rate_day date not null,
  numerator bigint not null check (numerator > 0),
  denominator bigint not null check (denominator > 0),
  source text not null check (length(source) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, base_currency, quote_currency, rate_day),
  check (base_currency <> quote_currency)
);

create table usage_valuations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  event_id uuid,
  adjustment_id uuid,
  version integer not null check (version > 0),
  state text not null check (state in ('priced', 'unpriced', 'partial')),
  original_cost_minor bigint,
  original_currency char(3),
  report_cost_minor bigint,
  report_currency char(3) not null check (report_currency = upper(report_currency)),
  rate_id uuid,
  exchange_rate_id uuid,
  missing jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array' and pg_column_size(missing) <= 4096),
  valued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (num_nonnulls(event_id, adjustment_id) = 1),
  check ((original_cost_minor is null) = (original_currency is null)),
  check ((state = 'unpriced') = (report_cost_minor is null)),
  unique nulls not distinct (tenant_id, event_id, adjustment_id, version),
  foreign key (tenant_id, event_id) references usage_events(tenant_id, id) on delete restrict,
  foreign key (tenant_id, adjustment_id) references usage_adjustments(tenant_id, id) on delete restrict,
  foreign key (tenant_id, rate_id) references usage_rates(tenant_id, id) on delete restrict,
  foreign key (tenant_id, exchange_rate_id) references exchange_rates(tenant_id, id) on delete restrict
);
create index usage_valuations_event_idx on usage_valuations (tenant_id, event_id, version desc);

create table usage_attribution_rules (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  metadata_key text not null check (metadata_key in ('project', 'customer', 'service', 'product', 'environment')),
  metadata_value text not null check (length(metadata_value) between 1 and 240),
  customer_id uuid,
  product_id uuid,
  customer_service_id uuid,
  project_id uuid,
  priority integer not null default 100 check (priority between 0 and 10000),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (num_nonnulls(customer_id, product_id, customer_service_id, project_id) = 1),
  check (effective_to is null or effective_to > effective_from),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_service_id) references customer_services(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict
);
create index usage_attribution_rules_lookup_idx on usage_attribution_rules
  (tenant_id, metadata_key, metadata_value, priority, effective_from desc);

create table usage_budgets (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  customer_id uuid,
  product_id uuid,
  customer_service_id uuid,
  project_id uuid,
  period text not null check (period in ('monthly', 'quarterly', 'annual')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency = upper(currency)),
  warning_basis_points integer not null check (warning_basis_points between 1 and 9999),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (num_nonnulls(customer_id, product_id, customer_service_id, project_id) <= 1),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_service_id) references customer_services(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict
);

create table usage_budget_sources (
  budget_id uuid not null,
  source_id uuid not null,
  tenant_id uuid not null references tenants(id) on delete cascade,
  required boolean not null default true,
  max_age_seconds integer not null check (max_age_seconds between 60 and 2592000),
  created_at timestamptz not null default now(),
  primary key (tenant_id, budget_id, source_id),
  foreign key (tenant_id, budget_id) references usage_budgets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_id) references usage_sources(tenant_id, id) on delete restrict
);

create table usage_budget_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  budget_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  previous_state text,
  state text not null check (state in ('healthy', 'warning', 'exceeded', 'partial', 'stale')),
  observed_through timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, budget_id, idempotency_key),
  check (previous_state is null or previous_state in ('healthy', 'warning', 'exceeded', 'partial', 'stale')),
  foreign key (tenant_id, budget_id) references usage_budgets(tenant_id, id) on delete restrict
);

create table usage_monthly_snapshots (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  month date not null check (month = date_trunc('month', month)::date),
  revision integer not null check (revision > 0),
  source_id uuid not null,
  sku text not null,
  customer_id uuid,
  product_id uuid,
  customer_service_id uuid,
  project_id uuid,
  original_currency char(3),
  report_currency char(3) not null,
  quantities jsonb not null check (jsonb_typeof(quantities) = 'object' and pg_column_size(quantities) <= 8192),
  original_cost_minor bigint,
  report_cost_minor bigint,
  attributed_basis_points integer not null check (attributed_basis_points between 0 and 10000),
  observed_through timestamptz not null,
  missing jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),
  finalized_at timestamptz,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique nulls not distinct (tenant_id, month, revision, source_id, sku, customer_id, product_id, customer_service_id, project_id, original_currency, report_currency),
  check (num_nonnulls(customer_id, product_id, customer_service_id, project_id) <= 1),
  foreign key (tenant_id, source_id) references usage_sources(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_service_id) references customer_services(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict
);
create index usage_monthly_snapshots_period_idx on usage_monthly_snapshots (tenant_id, month desc, revision desc);

create function reject_usage_evidence_mutation() returns trigger language plpgsql as $$
begin raise exception 'usage evidence is append-only'; end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'usage_events', 'usage_event_quantities', 'usage_adjustments', 'usage_adjustment_quantities',
    'usage_rate_tiers', 'exchange_rates', 'usage_valuations',
    'usage_budget_events', 'usage_monthly_snapshots'
  ] loop
    execute format('create trigger %I_append_only before update or delete on %I for each row execute function reject_usage_evidence_mutation()', table_name, table_name);
  end loop;
end;
$$;

create function enforce_usage_rate_annulment() returns trigger language plpgsql as $$
begin
  if old.annulled_at is not null
    or new.annulled_at is null
    or new.annulled_by_membership_id is null
    or row(new.id, new.tenant_id, new.provider, new.sku, new.unit, new.unit_size, new.currency,
      new.effective_from, new.source, new.created_at)
      is distinct from
      row(old.id, old.tenant_id, old.provider, old.sku, old.unit, old.unit_size, old.currency,
        old.effective_from, old.source, old.created_at)
  then
    raise exception 'usage rates may only be annulled once';
  end if;
  return new;
end;
$$;
create trigger usage_rates_annul_only before update or delete on usage_rates
for each row execute function enforce_usage_rate_annulment();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'usage_sources', 'usage_events', 'usage_event_quantities', 'usage_adjustments',
    'usage_adjustment_quantities', 'usage_rates', 'usage_rate_tiers', 'exchange_rates',
    'usage_valuations', 'usage_attribution_rules', 'usage_budgets', 'usage_budget_sources',
    'usage_budget_events', 'usage_monthly_snapshots'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format(
      'create policy %I_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      table_name, table_name
    );
  end loop;
end;
$$;

grant select, insert, update on usage_sources, usage_attribution_rules, usage_budgets, usage_budget_sources to control_hub_app;
grant delete on usage_attribution_rules, usage_budgets, usage_budget_sources to control_hub_app;
grant select, insert on usage_events, usage_event_quantities, usage_adjustments, usage_adjustment_quantities,
  usage_rates, usage_rate_tiers, exchange_rates, usage_valuations, usage_budget_events,
  usage_monthly_snapshots to control_hub_app;
grant update (annulled_at, annulled_by_membership_id) on usage_rates to control_hub_app;
