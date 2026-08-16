-- Product knowledge and operational catalogue. 0030 is reserved by the connector platform.
-- Specification: docs/specifications/commerce.md

alter table product_versions
  add column release_notes text check (release_notes is null or length(release_notes) <= 10000),
  add column features jsonb not null default '[]'::jsonb,
  add column contents jsonb not null default '[]'::jsonb,
  add column schema_document jsonb,
  add column updated_at timestamptz not null default now(),
  add constraint product_versions_features_array check (jsonb_typeof(features) = 'array'),
  add constraint product_versions_contents_array check (jsonb_typeof(contents) = 'array'),
  add constraint product_versions_schema_object check (
    schema_document is null or jsonb_typeof(schema_document) = 'object'
  );

create table product_resources (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null,
  product_version_id uuid,
  kind text not null check (kind in ('information', 'documentation', 'diagram', 'repository', 'demo')),
  label text not null check (length(label) between 1 and 160),
  url text not null check (length(url) between 1 and 2048 and url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, product_id, kind, url),
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_version_id) references product_versions(tenant_id, id) on delete restrict
);

create function enforce_product_resource_version() returns trigger language plpgsql as $$
begin
  if new.product_version_id is not null and not exists (
    select 1 from product_versions
    where tenant_id = new.tenant_id and id = new.product_version_id and product_id = new.product_id
  ) then
    raise exception 'Product resource version must belong to its product' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger product_resource_version_scope
before insert or update of product_id, product_version_id on product_resources
for each row execute function enforce_product_resource_version();

create index product_resources_product_idx
  on product_resources (tenant_id, product_id, product_version_id, kind, created_at);

alter table product_resources enable row level security;
alter table product_resources force row level security;
create policy product_resources_isolation on product_resources
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on product_resources to control_hub_app;
