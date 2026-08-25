-- Refresh needs the grant behind the token, not only whether the token is still good.
--
-- `lookup_mcp_refresh_token` of migration 0049 answered the second question and not the first.
-- Minting the next access token needs the scopes of the grant, and refusing a token presented by a
-- client it was not issued to needs that client. Both are read in the same statement as the token,
-- for the same reason the original function was written that way: three reads at three moments can
-- observe a revocation landing between them and produce an answer that was never true of any
-- instant.
--
-- The shape of the result changes, so the function is dropped and created rather than replaced.
-- Nothing else moves: this migration adds no table, no column, no row and no policy, and the
-- execute grant is restated because dropping the function took the old one with it.

drop function lookup_mcp_refresh_token(text);

create function lookup_mcp_refresh_token(p_token_hash text)
returns table (
  token_id uuid, tenant_id uuid, grant_id uuid, client_id uuid, family_id uuid,
  scopes text[], used_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  grant_status text
)
language sql security definer set search_path = public, pg_temp as $$
  select r.id, r.tenant_id, r.grant_id, g.client_id, r.family_id, g.scopes,
         r.used_at, r.expires_at, r.revoked_at, g.status
  from mcp_refresh_tokens r
  join mcp_grants g on g.tenant_id = r.tenant_id and g.id = r.grant_id
  where r.token_hash = p_token_hash;
$$;

grant execute on function lookup_mcp_refresh_token(text) to control_hub_app;
