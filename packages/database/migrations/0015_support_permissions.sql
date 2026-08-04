-- Els permisos es resolen des de la base de dades en cada peticio, no des de la constant del
-- domini, aixi que declarar-los a `rolePermissions` no basta: han d'existir aqui.
-- Especificacio: docs/specifications/permissions.md

insert into permissions (code, description) values
  ('tickets:read', 'Read tickets and their service level state'),
  ('support:configure', 'Configure support hours, holidays and service level targets')
on conflict (code) do nothing;

-- Les instal·lacions que ja existeixen tenen els rols creats al bootstrap i no els tornarien a
-- sembrar mai, de manera que sense aquest backfill es quedarien sense els permisos nous i les
-- rutes de suport respondrien 403 a tothom.
insert into role_permissions (role_id, permission_code)
select id, 'tickets:read' from roles where code in ('owner', 'administrator', 'technical')
on conflict do nothing;

-- `support:configure` canvia que compta com a incompliment de SLA, i per tant no toca a qui
-- nomes resol tickets.
insert into role_permissions (role_id, permission_code)
select id, 'support:configure' from roles where code in ('owner', 'administrator')
on conflict do nothing;
