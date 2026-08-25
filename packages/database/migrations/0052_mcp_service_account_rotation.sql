-- A rotation an agent can survive: two live keys, for a while.
--
-- Migration 0049 gave a service account one secret, so rotating it broke every caller at the exact
-- instant of the rotation and left them broken until somebody redeployed. For an agent nobody is
-- watching that is an outage, and an outage is what makes people stop rotating.
--
-- So the previous secret stays valid for a window after the new one is issued: rotate, deploy, and
-- the old key falls away on its own. The window is not optional and not open ended -- a column with
-- an expiry is the difference between two keys and two permanent keys -- and a compromise is a
-- different operation, which retires the previous secret at once instead of waiting for it.
--
-- Additive: two nullable columns and a function whose result shape grows. No row is rewritten, and
-- an account that never rotates is unaffected by every line of this file.

alter table mcp_service_accounts
  add column previous_secret_hash text
    check (previous_secret_hash is null or previous_secret_hash ~ '^[a-f0-9]{64}$');

alter table mcp_service_accounts
  add column previous_secret_expires_at timestamptz;

-- Neither half means anything alone: a hash with no expiry is a second permanent key, and an expiry
-- with no hash is a window onto nothing.
alter table mcp_service_accounts
  add constraint mcp_service_accounts_previous_secret_paired
  check ((previous_secret_hash is null) = (previous_secret_expires_at is null));

-- A rotated-away secret must not be reusable as somebody else's current one.
create unique index mcp_service_accounts_previous_secret_hash_key
  on mcp_service_accounts (previous_secret_hash)
  where previous_secret_hash is not null;

drop function lookup_mcp_service_account(text);

create function lookup_mcp_service_account(p_secret_hash text)
returns table (
  id uuid, tenant_id uuid, scopes text[], permissions text[],
  expires_at timestamptz, disabled_at timestamptz, matched_previous boolean
)
language sql security definer set search_path = public, pg_temp as $$
  select s.id, s.tenant_id, s.scopes, s.permissions, s.expires_at, s.disabled_at,
         s.secret_hash <> p_secret_hash
  from mcp_service_accounts s
  where s.secret_hash = p_secret_hash
     or (s.previous_secret_hash = p_secret_hash and s.previous_secret_expires_at > now());
$$;

grant execute on function lookup_mcp_service_account(text) to control_hub_app;
