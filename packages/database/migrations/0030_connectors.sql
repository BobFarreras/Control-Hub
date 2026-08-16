-- Phase 6, increment 4: the connector platform's storage.
-- Specification: docs/specifications/connectors.md
--
-- Two properties are enforced here rather than in application code, because application code is
-- what two workers can run at the same time: tenant isolation (RLS enable + force on every
-- table, composite foreign keys so a child can never point at another tenant's parent) and
-- ingress idempotency (a unique constraint, not a read-then-write the database would happily let
-- both sides win).
--
-- No column holds a credential in plain text. `connector_credentials` stores only what the
-- envelope encryption of ADR-0008 produces.

-- `connector_type` carries no check constraint on purpose: the set of types lives in the
-- build-time registry of `packages/connectors`, and encoding it here would mean a migration
-- every time one ships. The application refuses an unknown type before it reaches this table.
create table connector_instances (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  connector_type text not null check (length(connector_type) between 1 and 64),
  name text not null check (length(trim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'enabled', 'disabled', 'error')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  -- Bumped on every accepted configuration change. A run records the version it read, so a
  -- failure can be attributed to the configuration that actually produced it.
  config_version integer not null default 1 check (config_version >= 1),
  health_status text not null default 'unknown'
    check (health_status in ('unknown', 'healthy', 'degraded', 'failing', 'disabled')),
  health_checked_at timestamptz,
  last_error_code text check (length(last_error_code) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Health is a claim about evidence. Claiming one without recording when it was gathered is how
  -- a screen ends up showing a green dot nobody can date. `unknown` and `disabled` are not claims
  -- about a provider — one is the absence of evidence, the other a decision somebody made here.
  check (health_status in ('unknown', 'disabled') or health_checked_at is not null),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

-- What the vault writes: a key identifier, a nonce and a ciphertext. The tag AES-256-GCM produces
-- travels appended to the ciphertext, so opening an envelope sealed under a retired key fails as
-- authentication rather than as a decode of plausible-looking bytes.
create table connector_credentials (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  kind text not null check (length(kind) between 1 and 64),
  slot text not null check (slot in ('primary', 'secondary')),
  key_id text not null check (length(key_id) between 1 and 64),
  nonce bytea not null check (octet_length(nonce) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 16384),
  rotated_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade
);

-- At most two live credentials of a kind, which is exactly the rotation window: the new one
-- arrives as `secondary`, both verify while the provider catches up, and promoting it revokes the
-- old. A revoked row stays for the audit trail and no longer occupies a slot.
create unique index connector_credentials_live_slot_idx
  on connector_credentials (tenant_id, instance_id, kind, slot)
  where revoked_at is null;
create index connector_credentials_instance_idx
  on connector_credentials (tenant_id, instance_id, kind)
  where revoked_at is null;

-- The evidence that survives a restart: what ran, when, how it ended. `dead_letter` is a status
-- and not a deletion, because a run that exhausted its retry budget is the one somebody needs to
-- see.
create table connector_sync_runs (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  operation text not null check (length(operation) between 1 and 64),
  -- The queue job this run belongs to. At-least-once delivery means the same job can arrive
  -- twice; the unique constraint below is what makes the second arrival find its own row instead
  -- of writing a duplicate, which no application-level check could guarantee across two workers.
  job_id text not null check (length(job_id) between 1 and 120),
  attempt integer not null default 1 check (attempt between 1 and 100),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'dead_letter')),
  config_version integer not null check (config_version >= 1),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text check (length(error_code) between 1 and 80),
  items_processed integer not null default 0 check (items_processed >= 0),
  check ((status = 'running') = (finished_at is null)),
  check (finished_at is null or finished_at >= started_at),
  -- A run that succeeded carries no error code, and one that failed says why. Otherwise the
  -- history answers "what went wrong" with a shrug.
  check ((status in ('failed', 'dead_letter')) = (error_code is not null)),
  unique (tenant_id, id),
  unique (tenant_id, job_id, attempt),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade
);

create index connector_sync_runs_history_idx
  on connector_sync_runs (tenant_id, instance_id, started_at desc, id);

-- `public_id` is globally unique rather than unique per tenant: the inbound URL carries no tenant,
-- so the identifier is what resolves one. It is 32 random bytes rendered base64url, which is why
-- an unknown one is answered exactly like an invalid signature — see the ingress route.
create table connector_webhook_endpoints (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  public_id text not null unique check (public_id ~ '^[A-Za-z0-9_-]{43}$'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade
);

create index connector_webhook_endpoints_instance_idx
  on connector_webhook_endpoints (tenant_id, instance_id, created_at desc);

-- Received, verified, not yet processed. The API writes here and answers; the worker reads.
--
-- `provider_event_id` is never null: when a provider sends no identifier of its own the API
-- stores the sha256 of the raw body, so the unique constraint below covers both cases. A nullable
-- column would silently stop deduplicating exactly the providers that need it most, because in
-- PostgreSQL two nulls do not collide.
create table connector_inbox (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  endpoint_id uuid not null,
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  -- The raw body, bounded by the same 1 MiB the route accepts. Kept because the worker runs in
  -- another process and cannot ask the provider again; retained per docs/specifications/data-governance.md,
  -- not indefinitely.
  payload text not null check (octet_length(payload) <= 1048576),
  received_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'failed', 'discarded')),
  attempts integer not null default 0 check (attempts between 0 and 100),
  processed_at timestamptz,
  -- Pending means nothing has finished with it yet. `failed` is terminal — a retry leaves the row
  -- pending and raises `attempts`; only an exhausted budget writes the failure down.
  check ((status = 'pending') = (processed_at is null)),
  unique (tenant_id, id),
  unique (tenant_id, endpoint_id, provider_event_id),
  foreign key (tenant_id, endpoint_id) references connector_webhook_endpoints(tenant_id, id) on delete cascade
);

create index connector_inbox_pending_idx
  on connector_inbox (tenant_id, received_at, id)
  where status = 'pending';

alter table connector_instances enable row level security;
alter table connector_instances force row level security;
create policy connector_instances_isolation on connector_instances
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table connector_credentials enable row level security;
alter table connector_credentials force row level security;
create policy connector_credentials_isolation on connector_credentials
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table connector_sync_runs enable row level security;
alter table connector_sync_runs force row level security;
create policy connector_sync_runs_isolation on connector_sync_runs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table connector_webhook_endpoints enable row level security;
alter table connector_webhook_endpoints force row level security;
create policy connector_webhook_endpoints_isolation on connector_webhook_endpoints
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table connector_inbox enable row level security;
alter table connector_inbox force row level security;
create policy connector_inbox_isolation on connector_inbox
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- No delete anywhere. An instance is disabled, a credential is revoked, a run and an inbox entry
-- are the record of what happened; the runtime role cannot remove any of them. Retention is a
-- maintenance job with its own privileges, not something a request can reach.
grant select, insert, update on connector_instances to control_hub_app;
grant select, insert, update on connector_credentials to control_hub_app;
grant select, insert, update on connector_sync_runs to control_hub_app;
grant select, insert, update on connector_webhook_endpoints to control_hub_app;
grant select, insert, update on connector_inbox to control_hub_app;

-- The one query that runs outside a tenant context, because at that moment there is no tenant to
-- run inside: an inbound webhook arrives with a public identifier and nothing else.
--
-- It is a `security definer` function rather than a policy exception so the shape of the answer
-- is fixed here, in the schema, where a later edit is reviewable: five columns, no configuration,
-- no credential, no endpoint listing. Everything after this call runs inside the tenant it
-- resolved. A revoked endpoint and a disabled instance return nothing, which is what lets the
-- route answer an unknown identifier and a revoked one identically.
create function resolve_connector_webhook_endpoint(p_public_id text)
returns table (id uuid, tenant_id uuid, instance_id uuid, connector_type text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.tenant_id, e.instance_id, i.connector_type, i.status
  from connector_webhook_endpoints e
  join connector_instances i on i.tenant_id = e.tenant_id and i.id = e.instance_id
  where e.public_id = p_public_id and e.revoked_at is null;
$$;

revoke all on function resolve_connector_webhook_endpoint(text) from public;
grant execute on function resolve_connector_webhook_endpoint(text) to control_hub_app;
