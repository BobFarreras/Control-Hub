create table tenants (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  name text not null check (length(name) between 2 and 120),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table permissions (
  code text primary key check (code ~ '^[a-z]+:[a-z]+$'),
  description text not null
);

create table roles (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null check (code in ('owner', 'administrator', 'technical')),
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_code text not null references permissions(code) on delete restrict,
  primary key (role_id, permission_code)
);

create table memberships (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index memberships_user_idx on memberships(user_id) where status = 'active';

create table membership_roles (
  membership_id uuid not null references memberships(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (membership_id, role_id)
);

create table tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  brand_name text not null,
  default_locale text not null default 'ca' check (default_locale in ('ca', 'es', 'en')),
  timezone text not null default 'Europe/Madrid',
  updated_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  actor_user_id text references "user"(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  outcome text not null check (outcome in ('success', 'denied', 'failure')),
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_tenant_created_idx on audit_log(tenant_id, created_at desc);

create function reject_audit_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_append_only before update or delete on audit_log
for each row execute function reject_audit_mutation();

alter table tenant_settings enable row level security;
alter table tenant_settings force row level security;
create policy tenant_settings_isolation on tenant_settings
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy audit_log_isolation on audit_log
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

insert into permissions (code, description) values
  ('tenant:manage', 'Manage tenant settings'),
  ('members:manage', 'Manage tenant members'),
  ('roles:manage', 'Manage role assignments'),
  ('audit:read', 'Read audit events'),
  ('customers:manage', 'Manage customers'),
  ('leads:manage', 'Manage leads'),
  ('projects:manage', 'Manage projects'),
  ('products:manage', 'Manage products'),
  ('subscriptions:manage', 'Manage subscriptions'),
  ('financials:read', 'Read financial information'),
  ('tickets:manage', 'Manage tickets'),
  ('infrastructure:read', 'Read infrastructure status'),
  ('infrastructure:operate', 'Operate infrastructure'),
  ('integrations:read', 'Read integration status'),
  ('integrations:manage', 'Manage integrations'),
  ('credentials:rotate', 'Rotate connector credentials'),
  ('usage:read', 'Read usage data'),
  ('security:manage', 'Manage security settings');
