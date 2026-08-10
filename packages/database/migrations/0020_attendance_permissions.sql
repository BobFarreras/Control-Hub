-- Els permisos es resolen des de la base de dades en cada peticio, no des de la constant del
-- domini, aixi que declarar-los a `rolePermissions` no basta: han d'existir aqui.
-- Especificacio: docs/specifications/attendance.md

insert into permissions (code, description) values
  ('attendance:record', 'Clock in and out, and read and correct own working time record'),
  ('attendance:manage', 'Read, correct and export the working time record of any member')
on conflict (code) do nothing;

-- Les instal·lacions que ja existeixen tenen els rols creats al bootstrap i no els tornarien a
-- sembrar mai, de manera que sense aquest backfill es quedarien sense els permisos nous i les
-- rutes de jornada respondrien 403 a tothom.
--
-- Fitxar i llegir el propi registre el te tothom, i no per generositat: no poder accedir al
-- propi registre es, en si mateix, un incompliment. Corregir-lo tambe hi entra, perque un
-- registre que depen de la disponibilitat d'algu altre perjudica precisament qui la norma
-- protegeix; tota correccio exigeix motiu, conserva l'original i queda auditada.
insert into role_permissions (role_id, permission_code)
select id, 'attendance:record' from roles where code in ('owner', 'administrator', 'technical')
on conflict do nothing;

-- Llegir quan entra i surt una altra persona revela patrons de presencia, que son dada personal.
-- Per aixo `technical` no el te, tot i tenir permisos operatius amplis.
insert into role_permissions (role_id, permission_code)
select id, 'attendance:manage' from roles where code in ('owner', 'administrator')
on conflict do nothing;
