-- Els permisos es resolen des de la base de dades en cada peticio, no des de la constant del
-- domini, aixi que declarar-los a `rolePermissions` no basta: han d'existir aqui.
-- Especificacio: docs/specifications/projects-and-time.md

-- `projects:manage` ja hi es des de 0003; aquesta feature nomes l'estrena.
insert into permissions (code, description) values
  ('projects:read', 'Read projects and their history'),
  ('time:log', 'Log and edit own time entries'),
  ('time:manage', 'Edit and delete time entries of other members'),
  ('rates:manage', 'Publish hourly cost and billing rates')
on conflict (code) do nothing;

-- Les instal·lacions que ja existeixen tenen els rols creats al bootstrap i no els tornarien a
-- sembrar mai, de manera que sense aquest backfill es quedarien sense els permisos nous i les
-- rutes de projectes respondrien 403 a tothom.
insert into role_permissions (role_id, permission_code)
select id, 'projects:read' from roles where code in ('owner', 'administrator', 'technical')
on conflict do nothing;

-- Tothom imputa les seves hores; nomes qui coordina toca les d'una altra persona.
insert into role_permissions (role_id, permission_code)
select id, 'time:log' from roles where code in ('owner', 'administrator', 'technical')
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select id, 'time:manage' from roles where code in ('owner', 'administrator')
on conflict do nothing;

-- Un cost per hora es informacio adjacent al sou, i per aixo no surt del rol propietari.
insert into role_permissions (role_id, permission_code)
select id, 'rates:manage' from roles where code = 'owner'
on conflict do nothing;
