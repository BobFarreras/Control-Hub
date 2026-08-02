create table products (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text not null check (length(name) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table product_versions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null,
  version text not null check (length(version) between 1 and 80),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, product_id, version),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete restrict
);

create table plans (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_version_id uuid not null,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text not null check (length(name) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  foreign key (tenant_id, product_version_id) references product_versions(tenant_id, id) on delete restrict
);

create table plan_prices (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor between 0 and 9007199254740991),
  cost_minor bigint not null check (cost_minor between 0 and 9007199254740991),
  tax_basis_points integer not null default 0 check (tax_basis_points between 0 and 10000),
  billing_interval text not null check (billing_interval in ('free', 'monthly', 'quarterly', 'semiannual', 'annual')),
  effective_from timestamptz not null,
  created_at timestamptz not null default now(),
  check (billing_interval <> 'free' or amount_minor = 0),
  unique (tenant_id, id),
  unique (tenant_id, plan_id, id),
  unique (tenant_id, plan_id, currency, effective_from),
  foreign key (tenant_id, plan_id) references plans(tenant_id, id) on delete restrict
);

create table subscriptions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  plan_id uuid not null,
  price_id uuid not null,
  status text not null default 'active' check (status in ('active', 'paused', 'canceled')),
  quantity integer not null default 1 check (quantity between 1 and 1000000),
  started_at timestamptz not null,
  current_period_start timestamptz not null,
  renewal_at timestamptz,
  renewal_alert_days integer not null default 14 check (renewal_alert_days between 0 and 365),
  paused_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, plan_id) references plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, plan_id, price_id) references plan_prices(tenant_id, plan_id, id) on delete restrict
);

create table subscription_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  subscription_id uuid not null,
  actor_user_id text references "user"(id) on delete set null,
  type text not null check (type in ('created', 'paused', 'resumed', 'canceled', 'plan_changed')),
  effective_at timestamptz not null,
  previous_plan_id uuid,
  new_plan_id uuid,
  previous_price_id uuid,
  new_price_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, subscription_id) references subscriptions(tenant_id, id) on delete restrict
);

create index product_versions_product_idx on product_versions (tenant_id, product_id, created_at desc);
create index plans_version_idx on plans (tenant_id, product_version_id, created_at desc);
create index plan_prices_current_idx on plan_prices (tenant_id, plan_id, currency, effective_from desc);
create index subscriptions_customer_idx on subscriptions (tenant_id, customer_id, status);
create index subscriptions_renewal_idx on subscriptions (tenant_id, renewal_at) where status = 'active' and renewal_at is not null;
create index subscription_events_history_idx on subscription_events (tenant_id, subscription_id, effective_at desc, created_at desc);

create function reject_commerce_history_mutation() returns trigger language plpgsql as $$
begin raise exception 'commerce history is append-only'; end;
$$;
create trigger plan_prices_append_only before update or delete on plan_prices for each row execute function reject_commerce_history_mutation();
create trigger subscription_events_append_only before update or delete on subscription_events for each row execute function reject_commerce_history_mutation();

do $$ declare table_name text; begin
  foreach table_name in array array['products','product_versions','plans','plan_prices','subscriptions','subscription_events'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('create policy %I on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_isolation', table_name);
    execute format('grant select, insert, update, delete on %I to control_hub_app', table_name);
  end loop;
end $$;
revoke update, delete on plan_prices, subscription_events from control_hub_app;
