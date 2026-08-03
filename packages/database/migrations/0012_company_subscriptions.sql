create table company_subscriptions (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null check (length(provider) between 1 and 160),
  service_name text not null check (length(service_name) between 1 and 160),
  category text not null check (category in ('saas', 'api', 'infrastructure', 'domain', 'license', 'other')),
  status text not null default 'active' check (status in ('active', 'trial', 'canceled')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor between 0 and 9007199254740991),
  billing_interval text not null check (billing_interval in ('monthly', 'quarterly', 'semiannual', 'annual')),
  renewal_at timestamptz,
  renewal_alert_days integer not null default 14 check (renewal_alert_days between 0 and 365),
  auto_renew boolean not null default true,
  website_url text check (website_url is null or length(website_url) <= 2048),
  notes text check (notes is null or length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider, service_name)
);

create index company_subscriptions_renewal_idx on company_subscriptions (tenant_id, renewal_at)
  where status in ('active', 'trial') and renewal_at is not null;

alter table company_subscriptions enable row level security;
alter table company_subscriptions force row level security;
create policy company_subscriptions_isolation on company_subscriptions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on company_subscriptions to control_hub_app;
