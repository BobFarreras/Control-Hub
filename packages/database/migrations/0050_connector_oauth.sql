-- Phase 7B / M2: delegated OAuth grants used by outbound connector calls.
-- Codes, PKCE verifiers and provider tokens are encrypted envelopes; jobs carry identifiers only.

create table connector_oauth_attempts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  provider text not null check (provider in ('google', 'microsoft')),
  state_hash text not null unique check (state_hash ~ '^[a-f0-9]{64}$'),
  actor_membership_id uuid not null,
  redirect_path text not null check (redirect_path ~ '^/[A-Za-z0-9/_?=&.-]{1,500}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 20),
  verifier_key_id text not null,
  verifier_nonce bytea not null check (octet_length(verifier_nonce) = 12),
  verifier_ciphertext bytea not null check (octet_length(verifier_ciphertext) between 17 and 16384),
  code_key_id text,
  code_nonce bytea check (code_nonce is null or octet_length(code_nonce) = 12),
  code_ciphertext bytea check (code_ciphertext is null or octet_length(code_ciphertext) between 17 and 16384),
  status text not null default 'pending' check (status in ('pending','received','canceled','failed','exchanged')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_membership_id) references memberships(tenant_id, id),
  check ((code_key_id is null) = (code_nonce is null) and (code_nonce is null) = (code_ciphertext is null)),
  check ((status = 'pending') = (consumed_at is null)),
  check (status <> 'received' or code_ciphertext is not null)
);

create table connector_oauth_grants (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  provider text not null check (provider in ('google', 'microsoft')),
  scopes text[] not null check (cardinality(scopes) between 1 and 20),
  status text not null check (status in ('active','reauthorization_required','revoked')),
  access_credential_id uuid,
  refresh_credential_id uuid,
  expires_at timestamptz,
  last_refreshed_at timestamptz,
  version integer not null default 1 check (version > 0),
  refresh_lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, instance_id),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, access_credential_id) references connector_credentials(tenant_id, id),
  foreign key (tenant_id, refresh_credential_id) references connector_credentials(tenant_id, id)
);

create table connector_oauth_outbox (
  attempt_id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 100),
  created_at timestamptz not null default now(),
  unique (tenant_id, attempt_id),
  foreign key (tenant_id, attempt_id) references connector_oauth_attempts(tenant_id, id) on delete cascade
);

create index connector_oauth_outbox_pending_idx on connector_oauth_outbox (tenant_id, available_at, attempt_id) where published_at is null;
create index connector_oauth_attempt_expiry_idx on connector_oauth_attempts (tenant_id, expires_at) where status in ('pending','received');

alter table connector_oauth_attempts enable row level security;
alter table connector_oauth_attempts force row level security;
create policy connector_oauth_attempts_isolation on connector_oauth_attempts using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
alter table connector_oauth_grants enable row level security;
alter table connector_oauth_grants force row level security;
create policy connector_oauth_grants_isolation on connector_oauth_grants using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
alter table connector_oauth_outbox enable row level security;
alter table connector_oauth_outbox force row level security;
create policy connector_oauth_outbox_isolation on connector_oauth_outbox using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update on connector_oauth_attempts, connector_oauth_grants, connector_oauth_outbox to control_hub_app;

-- The callback has no tenant context. This function resolves and consumes state in one statement,
-- exposes no code or verifier and returns the minimum authority required to seal the code.
create function claim_connector_oauth_state(p_state_hash text, p_provider text, p_now timestamptz)
returns table (id uuid, tenant_id uuid, instance_id uuid, redirect_path text)
language sql security definer set search_path = public, pg_temp as $$
  update connector_oauth_attempts a set status = 'failed', consumed_at = p_now, updated_at = p_now
  where a.state_hash = p_state_hash and a.provider = p_provider and a.status = 'pending' and a.expires_at > p_now
  returning a.id, a.tenant_id, a.instance_id, a.redirect_path
$$;
revoke all on function claim_connector_oauth_state(text, text, timestamptz) from public;
grant execute on function claim_connector_oauth_state(text, text, timestamptz) to control_hub_app;
