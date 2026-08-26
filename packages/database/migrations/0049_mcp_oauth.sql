-- Phase 10.1 C: the OAuth 2.1 store behind the MCP resource server.
-- Specification: docs/specifications/mcp-and-client-portal.md
--
-- Nothing in here is a connector credential. The grants of phase 7B let Control Hub act on a
-- provider's API on a tenant's behalf; these let a client act on Control Hub. The two vocabularies
-- are the same and the two stores are not: no row below can hold a provider token, and no provider
-- token can authorise a tool call. That separation is the point, and it is why these tables carry
-- an `mcp_` prefix rather than joining the connector ones.
--
-- Every secret is stored as the hexadecimal of its SHA-256 and never as itself. The tokens are
-- opaque references precisely so that reading this database gives an attacker nothing to present.

create table mcp_clients (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Unique across the installation, not within the tenant: `/authorize` is handed a client_id and
  -- nothing else, so the tenant is a conclusion of this lookup rather than an input to it. A
  -- client_id that meant a different client in each tenant would make that first step ambiguous.
  client_id text not null unique check (client_id ~ '^[a-z0-9-]{12,64}$'),
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('public', 'confidential')),
  secret_hash text check (secret_hash ~ '^[a-f0-9]{64}$'),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  max_scopes text[] not null check (cardinality(max_scopes) between 1 and 16),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- A public client proves itself with PKCE and holds no secret; a confidential one must hold one.
  -- Storing a secret for a public client would be storing a secret that is not secret.
  check ((kind = 'confidential') = (secret_hash is not null)),
  foreign key (tenant_id, created_by_membership_id) references memberships(tenant_id, id) on delete restrict
);

create table mcp_service_accounts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  -- A service account is somebody's responsibility. The owner is who gets asked when it is still
  -- calling six months after the person who wanted it has left.
  owner_membership_id uuid not null,
  scopes text[] not null check (cardinality(scopes) between 1 and 16),
  permissions text[] not null check (cardinality(permissions) between 1 and 64),
  secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
  secret_rotated_at timestamptz,
  -- Not nullable. An account that never expires is an account nobody ever reviews.
  expires_at timestamptz not null,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  check (expires_at > created_at),
  foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id) on delete restrict
);

create table mcp_authorization_requests (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid not null,
  membership_id uuid not null,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 16),
  code_challenge text not null check (length(code_challenge) between 43 and 128),
  -- S256 and nothing else. OAuth 2.1 removed `plain`, and a column that can hold it is a column
  -- somebody will one day be talked into using.
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  redirect_uri text not null check (length(redirect_uri) between 1 and 2000),
  audience text not null check (length(audience) between 1 and 500),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (expires_at > created_at),
  foreign key (tenant_id, client_id) references mcp_clients(tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id) on delete cascade
);

create table mcp_grants (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id uuid not null,
  actor_type text not null check (actor_type in ('user', 'service_account')),
  actor_membership_id uuid,
  actor_service_account_id uuid,
  scopes text[] not null check (cardinality(scopes) between 1 and 16),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'suspended')),
  consented_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_membership_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- Exactly one actor, and it is the one the type says. Both columns filled would leave the
  -- question "who did this" with two answers, which for an audit trail is the same as none.
  check (num_nonnulls(actor_membership_id, actor_service_account_id) = 1),
  check ((actor_type = 'user') = (actor_membership_id is not null)),
  check (revoked_at is null or status = 'revoked'),
  foreign key (tenant_id, client_id) references mcp_clients(tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_membership_id) references memberships(tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_service_account_id) references mcp_service_accounts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, revoked_by_membership_id) references memberships(tenant_id, id) on delete set null
);
create index mcp_grants_actor_idx on mcp_grants (tenant_id, actor_membership_id, status);

create table mcp_access_tokens (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  grant_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  -- Stored, not assumed. A token minted for one resource must be refused by another even if both
  -- run the same code, and comparing against a column is how that stays true after a rename.
  audience text not null check (length(audience) between 1 and 500),
  scopes text[] not null check (cardinality(scopes) between 1 and 16),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  unique (tenant_id, id),
  check (expires_at > issued_at),
  foreign key (tenant_id, grant_id) references mcp_grants(tenant_id, id) on delete cascade
);
create index mcp_access_tokens_grant_idx on mcp_access_tokens (tenant_id, grant_id, expires_at desc);

create table mcp_refresh_tokens (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  grant_id uuid not null,
  -- The family is what makes reuse detectable: every rotation keeps it, so presenting a refresh
  -- token that has already been used identifies a whole lineage to revoke rather than one row.
  family_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  replaced_by_id uuid,
  used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (expires_at > created_at),
  check (replaced_by_id is null or used_at is not null),
  foreign key (tenant_id, grant_id) references mcp_grants(tenant_id, id) on delete cascade,
  foreign key (tenant_id, replaced_by_id) references mcp_refresh_tokens(tenant_id, id) on delete set null
);
create index mcp_refresh_tokens_family_idx on mcp_refresh_tokens (tenant_id, family_id);

-- Written out one table at a time rather than in a loop over a name array. The loop is shorter and
-- it hides the one line that matters: a table that never reaches `force` is isolated from every
-- role except the one that runs the migrations, which is the role that owns the data.
alter table mcp_clients enable row level security;
alter table mcp_clients force row level security;
create policy mcp_clients_isolation on mcp_clients
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table mcp_service_accounts enable row level security;
alter table mcp_service_accounts force row level security;
create policy mcp_service_accounts_isolation on mcp_service_accounts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table mcp_authorization_requests enable row level security;
alter table mcp_authorization_requests force row level security;
create policy mcp_authorization_requests_isolation on mcp_authorization_requests
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table mcp_grants enable row level security;
alter table mcp_grants force row level security;
create policy mcp_grants_isolation on mcp_grants
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table mcp_access_tokens enable row level security;
alter table mcp_access_tokens force row level security;
create policy mcp_access_tokens_isolation on mcp_access_tokens
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table mcp_refresh_tokens enable row level security;
alter table mcp_refresh_tokens force row level security;
create policy mcp_refresh_tokens_isolation on mcp_refresh_tokens
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- The lookups that run before a tenant is known.
--
-- An opaque bearer arrives with nothing but itself: the row that says which tenant it belongs to
-- has to be found by a query that is not yet inside one, and RLS -- correctly -- returns nothing to
-- such a query. These functions are the narrow, audited exception, in the same shape the invitation
-- lookup of `0007` already uses. Each is found by a hash of something unguessable, each pins its
-- search path, and each returns the few columns the decision needs. The decision itself is not made
-- here: the domain still judges issuer, audience, expiry, revocation, tenant, scope and permission.

create function lookup_mcp_client(p_client_id text)
returns table (
  id uuid, tenant_id uuid, kind text, secret_hash text,
  redirect_uris text[], max_scopes text[], status text
)
language sql security definer set search_path = public, pg_temp as $$
  select c.id, c.tenant_id, c.kind, c.secret_hash, c.redirect_uris, c.max_scopes, c.status
  from mcp_clients c
  where c.client_id = p_client_id;
$$;

create function lookup_mcp_access_token(p_token_hash text)
returns table (
  token_id uuid, tenant_id uuid, grant_id uuid, audience text, scopes text[],
  expires_at timestamptz, revoked_at timestamptz,
  grant_status text, grant_expires_at timestamptz, grant_revoked_at timestamptz,
  actor_type text, actor_membership_id uuid, actor_service_account_id uuid, client_status text
)
language sql security definer set search_path = public, pg_temp as $$
  select t.id, t.tenant_id, t.grant_id, t.audience, t.scopes, t.expires_at, t.revoked_at,
         g.status, g.expires_at, g.revoked_at,
         g.actor_type, g.actor_membership_id, g.actor_service_account_id, c.status
  from mcp_access_tokens t
  join mcp_grants g on g.tenant_id = t.tenant_id and g.id = t.grant_id
  join mcp_clients c on c.tenant_id = g.tenant_id and c.id = g.client_id
  where t.token_hash = p_token_hash;
$$;

create function lookup_mcp_refresh_token(p_token_hash text)
returns table (
  token_id uuid, tenant_id uuid, grant_id uuid, family_id uuid,
  used_at timestamptz, expires_at timestamptz, revoked_at timestamptz, grant_status text
)
language sql security definer set search_path = public, pg_temp as $$
  select r.id, r.tenant_id, r.grant_id, r.family_id, r.used_at, r.expires_at, r.revoked_at, g.status
  from mcp_refresh_tokens r
  join mcp_grants g on g.tenant_id = r.tenant_id and g.id = r.grant_id
  where r.token_hash = p_token_hash;
$$;

create function lookup_mcp_service_account(p_secret_hash text)
returns table (
  id uuid, tenant_id uuid, scopes text[], permissions text[],
  expires_at timestamptz, disabled_at timestamptz
)
language sql security definer set search_path = public, pg_temp as $$
  select s.id, s.tenant_id, s.scopes, s.permissions, s.expires_at, s.disabled_at
  from mcp_service_accounts s
  where s.secret_hash = p_secret_hash;
$$;

create function consume_mcp_authorization_code(p_code_hash text, p_redirect_uri text)
returns table (
  request_id uuid, tenant_id uuid, client_id uuid, membership_id uuid,
  scopes text[], code_challenge text, audience text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  claimed mcp_authorization_requests%rowtype;
begin
  -- The update is the claim, and it is the whole point of doing this in one statement: a second
  -- exchange of the same code finds `consumed_at` already set, matches no row and returns nothing.
  -- Reading first and updating after would leave a window two requests can both pass through.
  update mcp_authorization_requests
  set consumed_at = now()
  where code_hash = p_code_hash
    and consumed_at is null
    and expires_at > now()
    and redirect_uri = p_redirect_uri
  returning * into claimed;
  if not found then
    return;
  end if;
  return query select claimed.id, claimed.tenant_id, claimed.client_id, claimed.membership_id,
                      claimed.scopes, claimed.code_challenge, claimed.audience;
end;
$$;

grant select, insert, update on mcp_clients, mcp_service_accounts, mcp_authorization_requests,
  mcp_grants, mcp_access_tokens, mcp_refresh_tokens to control_hub_app;
-- Deleting a grant or a token would erase the evidence that it existed; they are revoked instead.
-- A client or a service account can be removed outright, because removing it is the withdrawal.
grant delete on mcp_clients, mcp_service_accounts to control_hub_app;

grant execute on function lookup_mcp_client(text) to control_hub_app;
grant execute on function lookup_mcp_access_token(text) to control_hub_app;
grant execute on function lookup_mcp_refresh_token(text) to control_hub_app;
grant execute on function lookup_mcp_service_account(text) to control_hub_app;
grant execute on function consume_mcp_authorization_code(text, text) to control_hub_app;

-- The audit trail learns who and from where, additively.
--
-- Every column has a default that describes what the existing rows already were, so nothing is
-- rewritten and no code that writes an audit row today has to change to keep working. `audit_log`
-- is append-only: a column added `not null` without a default would fail on the first existing row
-- and there would be no backfill able to rescue it.
alter table audit_log add column actor_type text not null default 'user' check (actor_type in ('user', 'service_account'));
alter table audit_log add column actor_id text check (actor_id is null or length(actor_id) between 1 and 200);
alter table audit_log add column source text not null default 'app' check (source in ('app', 'mcp', 'worker'));
