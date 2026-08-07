-- Fase 5B, revisio del propietari: preu de venda per tipus de feina, i anul·lacio d'un barem
-- publicat per error.
-- Especificacio: docs/specifications/projects-and-time.md

-- Els tipus de feina que ven l'empresa: agent d'IA, pagina web, software a mida, automatitzacio.
-- Son dades del tenant i no una constant del producte, perque cada instal·lacio ven coses seves.
create table service_types (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Dos caracters com a minim, no tres: el codi es deriva del nom, i un servei que es diu "IA" ha
  -- de poder existir sense que el formulari es queixi d'una regla que ell mateix no pot complir.
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$'),
  name text not null check (length(name) between 2 and 120),
  -- El nom comparable, com a `customers` i `leads`: sense accents, en minuscules i amb els signes
  -- convertits en espais. Serveix per impedir que "Pagina web", "Pàgina Web" i "pagina  web"
  -- convisquin com a tres serveis diferents, que es la manera com un cataleg deixa de servir.
  normalized_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  unique (tenant_id, normalized_name)
);

-- De quin tipus es la feina d'aquest projecte. Nullable: els projectes que ja existeixen no en
-- tenen, i un projecte sense tipus simplement no resol preu per tipus.
alter table projects add column service_type_id uuid;
alter table projects add constraint projects_service_type_fk
  foreign key (tenant_id, service_type_id) references service_types(tenant_id, id) on delete restrict;

-- El tercer abast del preu de venda. El xor passa de dues columnes a tres.
alter table billing_rates add column service_type_id uuid;
alter table billing_rates add constraint billing_rates_service_type_fk
  foreign key (tenant_id, service_type_id) references service_types(tenant_id, id) on delete restrict;
alter table billing_rates drop constraint if exists billing_rates_check;
alter table billing_rates add constraint billing_rates_scope_check
  check (num_nonnulls(customer_id, project_id, service_type_id) = 1);

-- Anul·lacio. Un barem mal publicat no s'esborra: es marca, amb qui i quan, i la resolucio
-- l'ignora. Es el mateix criteri que una factura rectificativa, i deixa l'historial complet.
alter table member_cost_rates add column annulled_at timestamptz;
alter table member_cost_rates add column annulled_by_membership_id uuid;
alter table member_cost_rates add constraint member_cost_rates_annulled_check
  check ((annulled_at is null) = (annulled_by_membership_id is null));
alter table member_cost_rates add constraint member_cost_rates_annulled_by_fk
  foreign key (tenant_id, annulled_by_membership_id) references memberships(tenant_id, id) on delete restrict;

alter table billing_rates add column annulled_at timestamptz;
alter table billing_rates add column annulled_by_membership_id uuid;
alter table billing_rates add constraint billing_rates_annulled_check
  check ((annulled_at is null) = (annulled_by_membership_id is null));
alter table billing_rates add constraint billing_rates_annulled_by_fk
  foreign key (tenant_id, annulled_by_membership_id) references memberships(tenant_id, id) on delete restrict;

-- La unicitat passa a ignorar les files anul·lades, i aixi un import mal escrit es pot corregir el
-- mateix dia: s'anul·la el dolent i es publica el bo. Sense aixo calia esperar a l'endema, cosa que
-- convertia una errada de teclat en un problema de calendari.
-- Buscada pel seu contingut i no pel seu nom: PostgreSQL trunca els noms generats a 63 caracters, i
-- endevinar on cau el tall es una manera de fer fallar una migracio en una instal·lacio i no en una
-- altra.
do $$ declare constraint_name text; begin
  select conname into constraint_name from pg_constraint
  where conrelid = 'member_cost_rates'::regclass and contype = 'u'
    and conkey = (
      select array_agg(attnum order by attnum) from pg_attribute
      where attrelid = 'member_cost_rates'::regclass
        and attname in ('tenant_id', 'membership_id', 'currency', 'effective_from')
    );
  if constraint_name is not null then
    execute format('alter table member_cost_rates drop constraint %I', constraint_name);
  end if;
end $$;
drop index if exists member_cost_rates_live_idx;
create unique index member_cost_rates_live_idx
  on member_cost_rates (tenant_id, membership_id, currency, effective_from) where annulled_at is null;

drop index if exists billing_rates_customer_effective_idx;
drop index if exists billing_rates_project_effective_idx;
create unique index billing_rates_customer_live_idx
  on billing_rates (tenant_id, customer_id, currency, effective_from)
  where customer_id is not null and annulled_at is null;
create unique index billing_rates_project_live_idx
  on billing_rates (tenant_id, project_id, currency, effective_from)
  where project_id is not null and annulled_at is null;
create unique index billing_rates_service_live_idx
  on billing_rates (tenant_id, service_type_id, currency, effective_from)
  where service_type_id is not null and annulled_at is null;

create index projects_service_type_idx on projects (tenant_id, service_type_id) where service_type_id is not null;

-- El trigger append-only rebutjava qualsevol UPDATE, i ara hi ha exactament un canvi legitim:
-- anul·lar una fila que no ho estava. Tota la resta continua prohibida, i un DELETE tambe.
create function reject_rate_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'rates are append-only'; end if;
  if old.annulled_at is not null then raise exception 'rate is already annulled'; end if;
  if new.annulled_at is null then raise exception 'rates are append-only'; end if;
  if (new.id, new.tenant_id, new.currency, new.effective_from, new.created_at)
     is distinct from (old.id, old.tenant_id, old.currency, old.effective_from, old.created_at) then
    raise exception 'rates are append-only';
  end if;
  return new;
end;
$$;

drop trigger if exists member_cost_rates_append_only on member_cost_rates;
drop trigger if exists billing_rates_append_only on billing_rates;
create trigger member_cost_rates_append_only before update or delete on member_cost_rates
  for each row execute function reject_rate_mutation();
create trigger billing_rates_append_only before update or delete on billing_rates
  for each row execute function reject_rate_mutation();

do $$ begin
  execute 'alter table service_types enable row level security';
  execute 'alter table service_types force row level security';
  execute 'create policy service_types_isolation on service_types using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)';
  execute 'grant select, insert, update, delete on service_types to control_hub_app';
end $$;

-- Permis a nivell de columna: el rol de l'aplicacio no pot escriure cap altra columna d'un barem,
-- ni equivocant-se ni volent. El trigger diu quan es valid anul·lar; aixo diu que no hi ha res mes
-- que es pugui tocar.
grant update (annulled_at, annulled_by_membership_id) on member_cost_rates to control_hub_app;
grant update (annulled_at, annulled_by_membership_id) on billing_rates to control_hub_app;
