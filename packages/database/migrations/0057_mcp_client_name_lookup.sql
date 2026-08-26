-- The consent screen has to name the client, and the lookup did not return its name.
--
-- `lookup_mcp_client` was written for the token endpoint, which authenticates a client and never
-- describes one: an id, a kind, a secret hash and the addresses it may use are everything that
-- decision needs. The consent screen asks a different question -- "who is asking, and for what" --
-- and a screen that showed an opaque `client_id` where a person expects "Claude Desktop" is a
-- screen that teaches people to approve things they have not read.
--
-- The name comes from the same row as the rest, so it is the registered one rather than anything a
-- caller sent in the request. That is the property that matters: the query string reaching the
-- screen is a carrier, and every fact rendered from it is re-read here.
--
-- A table-returning function cannot change its signature in place, so it is dropped and recreated.
-- Nothing else moves: same argument, same security definer, same pinned search path, same grant.
drop function lookup_mcp_client(text);

create function lookup_mcp_client(p_client_id text)
returns table (
  id uuid, tenant_id uuid, name text, kind text, secret_hash text,
  redirect_uris text[], max_scopes text[], status text
)
language sql security definer set search_path = public, pg_temp as $$
  select c.id, c.tenant_id, c.name, c.kind, c.secret_hash, c.redirect_uris, c.max_scopes, c.status
  from mcp_clients c
  where c.client_id = p_client_id;
$$;

grant execute on function lookup_mcp_client(text) to control_hub_app;
