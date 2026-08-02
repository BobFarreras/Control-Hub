create or replace function accept_member_invitation(p_token_hash text, p_user_id text, p_email text)
returns table (membership_id uuid, tenant_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  selected_invitation member_invitations%rowtype;
  created_membership_id uuid := gen_random_uuid();
  selected_role_id uuid;
begin
  select i.* into selected_invitation from member_invitations i
    where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    for update;
  if not found or selected_invitation.email <> lower(p_email) then raise exception 'INVITATION_INVALID'; end if;
  select r.id into selected_role_id from roles r where r.tenant_id = selected_invitation.tenant_id and r.code = selected_invitation.role_code;
  if selected_role_id is null then raise exception 'INVITATION_ROLE_INVALID'; end if;
  insert into memberships (id, tenant_id, user_id) values (created_membership_id, selected_invitation.tenant_id, p_user_id);
  insert into membership_roles (membership_id, role_id) values (created_membership_id, selected_role_id);
  update member_invitations i set accepted_at = now() where i.id = selected_invitation.id;
  insert into audit_log (id, tenant_id, actor_user_id, action, target_type, target_id, outcome, metadata)
    values (gen_random_uuid(), selected_invitation.tenant_id, p_user_id, 'membership.invitation.accepted', 'membership', created_membership_id, 'success', jsonb_build_object('role', selected_invitation.role_code));
  return query select created_membership_id, selected_invitation.tenant_id;
end;
$$;
