alter table customers add column preferred_locale text
  check (preferred_locale is null or preferred_locale in ('ca', 'es', 'en'));
alter table customers add column timezone text
  check (timezone is null or length(timezone) between 1 and 100);
alter table customers add constraint customers_tax_id_length
  check (tax_id is null or length(tax_id) <= 40);

create table customer_addresses (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  type text not null check (type in ('billing','shipping','office','other')),
  label text check (label is null or length(label) <= 120),
  line1 text not null check (length(line1) between 1 and 200),
  line2 text check (line2 is null or length(line2) <= 200),
  postal_code text check (postal_code is null or length(postal_code) <= 32),
  city text not null check (length(city) between 1 and 120),
  region text check (region is null or length(region) <= 120),
  country_code char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete cascade
);

create unique index customer_addresses_primary_type_unique
  on customer_addresses (tenant_id, customer_id, type) where is_primary;
create index customer_addresses_customer_idx
  on customer_addresses (tenant_id, customer_id, type, created_at);

alter table customer_addresses enable row level security;
alter table customer_addresses force row level security;
create policy customer_addresses_isolation on customer_addresses
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on customer_addresses to control_hub_app;
