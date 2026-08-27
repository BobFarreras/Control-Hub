-- Phase 12 S8: tenant-scoped catalog for human credentials held by Bitwarden.
-- Specification: docs/specifications/credential-catalog.md
-- No password, TOTP, recovery code, master password or plaintext external reference belongs here.

insert into permissions (code, description) values
  ('credentials:read', 'Read assigned human credential catalog metadata'),
  ('credentials:open', 'Open assigned human credentials in the external password manager'),
  ('credentials:manage', 'Manage human credential catalog entries'),
  ('vault:manage', 'Configure external password manager installations')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
cross join permissions p
where
  (r.code = 'owner' and p.code in ('credentials:read', 'credentials:open', 'credentials:manage', 'vault:manage'))
  or (r.code = 'administrator' and p.code in ('credentials:read', 'credentials:open', 'credentials:manage'))
  or (r.code = 'technical' and p.code in ('credentials:read', 'credentials:open'))
on conflict do nothing;

create table password_manager_installations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null default 'bitwarden' check (provider = 'bitwarden'),
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  base_url text not null check (
    length(base_url) between 12 and 2048
    and base_url ~ '^https://[^/?#]+$'
    and base_url !~ '@'
  ),
  deployment_mode text not null check (
    deployment_mode in ('cloud', 'self_hosted_shared_vps', 'self_hosted_dedicated_vps')
  ),
  status text not null default 'active' check (status in ('active', 'degraded', 'disabled')),
  last_reviewed_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, display_name),
  foreign key (tenant_id, created_by_membership_id) references memberships(tenant_id, id) on delete restrict
);

create table credential_catalog_entries (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  installation_id uuid not null,
  client_id uuid,
  company_subscription_id uuid,
  application_name text not null check (length(trim(application_name)) between 2 and 160),
  category text not null check (
    category in ('hosting', 'email', 'domain', 'website_admin', 'billing', 'social', 'infrastructure', 'other')
  ),
  environment text not null check (environment in ('production', 'staging', 'development', 'other')),
  account_label text check (account_label is null or length(account_label) between 1 and 320),
  owner_membership_id uuid not null,
  status text not null default 'active' check (status in ('active', 'review_due', 'revoked', 'archived')),
  reference_key_id text not null check (length(reference_key_id) between 1 and 64),
  reference_nonce bytea not null check (octet_length(reference_nonce) = 12),
  reference_ciphertext bytea not null check (octet_length(reference_ciphertext) between 17 and 8192),
  review_due_at timestamptz,
  last_reviewed_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, installation_id) references password_manager_installations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, client_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, company_subscription_id) references company_subscriptions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_membership_id) references memberships(tenant_id, id) on delete restrict
);

create table credential_catalog_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  entry_id uuid not null,
  actor_membership_id uuid not null,
  event_type text not null check (
    event_type in ('created', 'updated', 'reviewed', 'marked_review_due', 'revoked', 'archived', 'restored', 'open_attempted')
  ),
  outcome text not null default 'success' check (outcome in ('success', 'denied', 'failed')),
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  occurred_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, entry_id) references credential_catalog_entries(tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_membership_id) references memberships(tenant_id, id) on delete restrict
);

create index credential_catalog_entries_status_idx
  on credential_catalog_entries (tenant_id, status, application_name, id);
create index credential_catalog_entries_owner_idx
  on credential_catalog_entries (tenant_id, owner_membership_id, status, application_name, id);
create index credential_catalog_entries_review_idx
  on credential_catalog_entries (tenant_id, review_due_at, id)
  where status in ('active', 'review_due') and review_due_at is not null;
create index credential_catalog_events_history_idx
  on credential_catalog_events (tenant_id, entry_id, occurred_at desc, id);

create function reject_credential_catalog_event_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'credential catalog events are append-only';
end;
$$;
create trigger credential_catalog_events_immutable
before update or delete on credential_catalog_events
for each row execute function reject_credential_catalog_event_mutation();

alter table password_manager_installations enable row level security;
alter table password_manager_installations force row level security;
create policy password_manager_installations_isolation on password_manager_installations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table credential_catalog_entries enable row level security;
alter table credential_catalog_entries force row level security;
create policy credential_catalog_entries_isolation on credential_catalog_entries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table credential_catalog_events enable row level security;
alter table credential_catalog_events force row level security;
create policy credential_catalog_events_isolation on credential_catalog_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update on password_manager_installations to control_hub_app;
grant select, insert, update on credential_catalog_entries to control_hub_app;
grant select, insert on credential_catalog_events to control_hub_app;
