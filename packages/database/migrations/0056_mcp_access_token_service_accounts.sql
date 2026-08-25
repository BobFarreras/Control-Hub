-- A service account's token had become unresolvable, and nothing said so.
--
-- `0053` made `mcp_grants.client_id` nullable, because a grant a service account opens names no
-- client: there is no registered client involved, only a secret. But `lookup_mcp_access_token` was
-- written when every grant had one, and it joins `mcp_clients` inline. With a null `client_id` that
-- join matches nothing, so the lookup returned no row at all -- and a token that resolves to no row
-- is answered exactly like a token that was never issued. Every agent logging in with its secret
-- received a token the resource server then refused, with the same message it gives a stranger.
--
-- The join becomes a left join, and `client_status` comes back null for a grant that has no client.
-- Null is deliberate rather than a convenient 'active': the caller has to decide what "there is no
-- client to suspend" means, and a value that reads as a live client would hide the difference the
-- day somebody suspends one.
--
-- Nothing else changes: the signature is identical, so no caller needs updating, and no table, no
-- column and no row is touched.
create or replace function lookup_mcp_access_token(p_token_hash text)
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
  left join mcp_clients c on c.tenant_id = g.tenant_id and c.id = g.client_id
  where t.token_hash = p_token_hash;
$$;
