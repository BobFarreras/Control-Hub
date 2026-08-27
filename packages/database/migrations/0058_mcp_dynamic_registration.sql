-- Dynamic client registration (RFC 7591), and the one thing it collides with: tenancy.
--
-- Every assistant that speaks MCP -- Claude Code, Claude, OpenAI, OpenCode -- begins by registering
-- itself. None of them offers a field to paste a client_id into, so "registration is manual" meant,
-- in practice, that none of them could connect at all. Decision D3 is reopened by this migration.
--
-- The collision: a client row belongs to a tenant, and a registration arrives before anybody has
-- signed in. There is no tenant to write. Inventing one -- a designated tenant, a tenant in the
-- URL -- would make the address tenant-specific and hand a stranger a way to name somebody else's
-- tenant, which is worse than the problem.
--
-- So a self-registration is written with no tenant at all, and the first person who authorizes it
-- claims it for theirs. Until then the row is nobody's, and that is enforced rather than promised:
-- the isolation policy compares `tenant_id` to the session's tenant, and a null compares to
-- nothing, so an unclaimed row is invisible to every tenant-scoped query in the installation --
-- the management listing included. It cannot be consented to, either: a grant references
-- `(tenant_id, id)`, which no unclaimed row can satisfy.
alter table mcp_clients alter column tenant_id drop not null;

-- An unclaimed row is public and holds no secret, and this is the check that keeps it so. A
-- confidential client is handed a secret at registration, and handing one to an unauthenticated
-- caller is handing it to whoever asked. A self-registered client proves itself with PKCE instead,
-- which is what PKCE is for.
alter table mcp_clients
  add constraint mcp_clients_unclaimed_is_public
  check (tenant_id is not null or (kind = 'public' and secret_hash is null));

-- Written through a definer function for the same reason the lookup is: the row has no tenant, so
-- the isolation policy would refuse the insert, and the caller has no session to be isolated by.
--
-- The sweep at the top is the whole garbage collection story for this endpoint. Registration is
-- open by definition, so unclaimed rows accumulate; rather than a scheduled job that has to be
-- remembered and monitored, each registration removes the ones nobody claimed within a day. A
-- registration nobody has authorized in 24 hours is one nobody is going to.
create function register_mcp_client(
  p_id uuid,
  p_client_id text,
  p_name text,
  p_redirect_uris text[],
  p_max_scopes text[]
) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from mcp_clients where tenant_id is null and created_at < now() - interval '24 hours';
  insert into mcp_clients (id, client_id, name, kind, redirect_uris, max_scopes)
  values (p_id, p_client_id, p_name, 'public', p_redirect_uris, p_max_scopes);
$$;

-- The claim, run when somebody authorizes an unclaimed client. `tenant_id is null` in the where
-- clause is what makes it a claim rather than a move: a client already belonging to a tenant is
-- never reassigned, so a second tenant authorizing the same client_id is refused by the ordinary
-- lookup instead of quietly taking it over.
create function claim_mcp_client(p_client_id text, p_tenant_id uuid) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with claimed as (
    update mcp_clients
    set tenant_id = p_tenant_id, updated_at = now()
    where client_id = p_client_id and tenant_id is null
    returning 1
  )
  select exists (select 1 from claimed);
$$;

grant execute on function register_mcp_client(uuid, text, text, text[], text[]) to control_hub_app;
grant execute on function claim_mcp_client(text, uuid) to control_hub_app;
