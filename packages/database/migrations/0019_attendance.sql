-- Fase 5C: registre de jornada.
-- Especificacio: docs/specifications/attendance.md

-- Configuracio de la instal·lacio, no del log. Canviar qualsevol de les dues no pot moure ni una
-- hora ja registrada: decideixen que es pot escriure a partir d'ara i durant quant es conserva.
-- El `4` es el valor de la primera instal·lacio (article 34.9 de l'Estatut dels Treballadors),
-- no una constant del producte: una instal·lacio a un altre pais el canvia sense tocar codi.
alter table tenant_settings
  add column attendance_pauses_enabled boolean not null default false,
  add column attendance_retention_years integer not null default 4
    check (attendance_retention_years between 1 and 30);

-- Un unic log d'events; les sessions i els totals es deriven al domini.
--
-- Modelar-ho com una fila per sessio amb `ended_at` obligaria a fer `update` per tancar el dia,
-- que es exactament el que no ha de poder passar: un registre que l'empresa pot reescriure en
-- silenci no prova res davant d'una inspeccio.
create table attendance_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  kind text not null check (kind in ('clock_in', 'clock_out', 'pause_start', 'pause_end')),

  -- Els dos rellotges. Per a un fitxatge normal cap dels dos s'escriu des de l'aplicacio i
  -- tots dos agafen el `now()` de la transaccio, aixi que surten **exactament iguals**. Aixo no
  -- es una comoditat: es el que fa que la restriccio de sota pugui distingir un fitxatge d'una
  -- declaracio sense cap marge de tolerancia inventat. Enviar l'hora des de l'aplicacio
  -- reintroduiria una diferencia de milisegons i faria que tot fitxatge demanes un motiu.
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  source text not null default 'web' check (source in ('web', 'api')),
  -- Qui ho va escriure, que no sempre es de qui es el registre: una correccio la pot fer la
  -- persona mateixa o algu amb `attendance:manage`, i quina de les dues coses va passar ha de
  -- constar a la fila i no nomes a l'auditoria.
  recorded_by_membership_id uuid not null,

  corrects_event_id uuid,
  reason text check (reason is null or length(btrim(reason)) between 1 and 500),
  -- Fitxar es naturalment repetible per un error de xarxa; un reintent no ha de generar dues
  -- entrades.
  client_reference text check (client_reference is null or length(client_reference) between 1 and 200),
  created_at timestamptz not null default now(),

  unique (tenant_id, id),
  -- Permet que una correccio apunti a l'original amb una clau forana que ja porta la persona a
  -- dins: ningu pot "corregir" un event d'una altra persona cap al seu propi registre.
  unique (tenant_id, id, membership_id),

  -- No es pot fitxar en el futur.
  check (occurred_at <= recorded_at),
  -- Tot el que no s'ha fitxat en el moment ha de dir per que: tant una esmena d'un event que
  -- existeix com un event que faltava i s'escriu tard. La diferencia entre els dos rellotges es
  -- el que li diu a qui llegeix el registre que allo es va declarar i no es va premer un boto.
  check (
    (corrects_event_id is null and occurred_at = recorded_at)
    or (reason is not null and length(btrim(reason)) > 0)
  ),
  check (corrects_event_id is null or corrects_event_id <> id),

  foreign key (tenant_id, membership_id) references memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, recorded_by_membership_id) references memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, corrects_event_id, membership_id)
    references attendance_events(tenant_id, id, membership_id) on delete restrict
);

-- Un event es pot corregir **un sol cop**. Sense aixo, dues correccions sobre el mateix original
-- el retirarien una vegada i comptarien dues, i el dia sortiria doblat. Una cadena continua sent
-- possible -- B corregeix A i C corregeix B -- que es com es rectifica una correccio.
create unique index attendance_events_corrects_idx
  on attendance_events (tenant_id, corrects_event_id) where corrects_event_id is not null;

create unique index attendance_events_client_reference_idx
  on attendance_events (tenant_id, membership_id, client_reference) where client_reference is not null;

-- L'ordre de lectura de tot el modul: el registre d'una persona en un interval de dies.
create index attendance_events_member_idx on attendance_events (tenant_id, membership_id, occurred_at);

create function reject_attendance_mutation() returns trigger language plpgsql as $$
begin raise exception 'attendance_events is append-only'; end;
$$;
create trigger attendance_events_append_only before update or delete on attendance_events
for each row execute function reject_attendance_mutation();

alter table attendance_events enable row level security;
alter table attendance_events force row level security;
create policy attendance_events_isolation on attendance_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Nomes lectura i escriptura. `update` i `delete` no els te ni el rol de l'aplicacio, aixi que el
-- trigger no es l'unica porta: rebotarien igual amb SQL directe.
--
-- Aixo vol dir que avui **res no pot esborrar un fitxatge**, ni tan sols passat el termini de
-- retencio. Es deliberat mentre no hi hagi una purga escrita, revisada i auditada: el risc de no
-- poder esborrar a temps es una conversa amb la gestoria, i el d'esborrar de mes es irreversible.
grant select, insert on attendance_events to control_hub_app;
