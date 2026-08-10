-- Increment 10: permisos per a festius i vacances.
-- Especificacio: docs/specifications/attendance.md

-- Afegir permisos nous al sistema RBAC.
insert into permissions (code, description) values
  ('attendance:holidays', 'Create, read and remove tenant holidays and non-working days'),
  ('attendance:vacations', 'Create, read, approve and reject vacation requests')
on conflict (code) do nothing;

-- Assignar permisos als rols existents.
-- Owner i Administrator gestionen festius i vacances; Technical no.
insert into role_permissions (role_id, permission_code)
select id, permission_code
from roles
cross join (values ('attendance:holidays'), ('attendance:vacations')) as requested(permission_code)
where roles.code in ('owner', 'administrator')
on conflict do nothing;
