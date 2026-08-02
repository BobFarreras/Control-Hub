do $$ begin execute format('grant connect on database %I to control_hub_app', current_database()); end $$;
grant usage on schema public to control_hub_app;
grant select, insert, update, delete on "user", "session", "account", "verification", "twoFactor", "passkey" to control_hub_app;
grant select on tenants, permissions, roles, role_permissions, memberships, membership_roles to control_hub_app;
grant select, insert, update, delete on tenant_settings to control_hub_app;
grant select, insert on audit_log to control_hub_app;
