create table member_invitations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254),
  role_code text not null check (role_code in ('administrator', 'technical')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by_user_id text references "user"(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create unique index member_invitations_pending_email_idx
  on member_invitations (tenant_id, email)
  where accepted_at is null and revoked_at is null;
create index member_invitations_tenant_created_idx on member_invitations (tenant_id, created_at desc);

alter table member_invitations enable row level security;
alter table member_invitations force row level security;
create policy member_invitations_isolation on member_invitations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update on member_invitations to control_hub_app;

create function lookup_member_invitation(p_token_hash text)
returns table (id uuid, tenant_id uuid, tenant_name text, email text, role_code text, expires_at timestamptz)
language sql security definer set search_path = public, pg_temp as $$
  select i.id, i.tenant_id, t.name, i.email, i.role_code, i.expires_at
  from member_invitations i join tenants t on t.id = i.tenant_id
  where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now();
$$;

create function accept_member_invitation(p_token_hash text, p_user_id text, p_email text)
returns table (membership_id uuid, tenant_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  selected_invitation member_invitations%rowtype;
  created_membership_id uuid := gen_random_uuid();
  selected_role_id uuid;
begin
  select * into selected_invitation from member_invitations
    where token_hash = p_token_hash and accepted_at is null and revoked_at is null and expires_at > now()
    for update;
  if not found or selected_invitation.email <> lower(p_email) then raise exception 'INVITATION_INVALID'; end if;
  select id into selected_role_id from roles where tenant_id = selected_invitation.tenant_id and code = selected_invitation.role_code;
  if selected_role_id is null then raise exception 'INVITATION_ROLE_INVALID'; end if;
  insert into memberships (id, tenant_id, user_id) values (created_membership_id, selected_invitation.tenant_id, p_user_id);
  insert into membership_roles (membership_id, role_id) values (created_membership_id, selected_role_id);
  update member_invitations set accepted_at = now() where id = selected_invitation.id;
  return query select created_membership_id, selected_invitation.tenant_id;
end;
$$;

revoke all on function lookup_member_invitation(text) from public;
revoke all on function accept_member_invitation(text, text, text) from public;
grant execute on function lookup_member_invitation(text) to control_hub_app;
grant execute on function accept_member_invitation(text, text, text) to control_hub_app;
