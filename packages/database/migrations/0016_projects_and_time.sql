-- Fase 5B: projectes, imputacio de temps i barems versionats.
-- Especificacio: docs/specifications/projects-and-time.md

-- `unique (tenant_id, id, customer_id)` no es redundant amb la clau primaria: es el que permet
-- que un ticket i una imputacio apuntin al projecte amb una clau forana composta que ja porta
-- el client a dins, en comptes de comprovar-ho amb una lectura a l'aplicacio que dos processos
-- poden creuar.
create table projects (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text not null check (length(name) between 3 and 200),
  description text check (description is null or length(description) <= 2000),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'on_hold', 'delivered', 'closed', 'canceled')
  ),
  owner_membership_id uuid,
  started_at timestamptz,
  due_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code),
  unique (tenant_id, id, customer_id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id) on delete set null (owner_membership_id)
);

create table project_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null,
  actor_membership_id uuid,
  type text not null check (type in ('created', 'status_changed')),
  from_value text check (from_value is null or length(from_value) <= 60),
  to_value text check (to_value is null or length(to_value) <= 60),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_membership_id) references memberships(tenant_id, id) on delete set null (actor_membership_id)
);

-- Append-only amb data d'efecte, com plan_prices. La data es `date` i no `timestamptz` perque
-- es compara amb el dia treballat d'una imputacio, no amb un instant: un barem publicat el dia 1
-- val per a tota la feina del dia 1, visqui qui la imputa a la zona horaria que visqui.
create table member_cost_rates (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  cost_minor_per_hour bigint not null check (cost_minor_per_hour between 0 and 9007199254740991),
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, membership_id, currency, effective_from),
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id) on delete restrict
);

-- L'especificacio descriu aquesta taula com `scope` mes `scope_id`. Aqui l'abast son dues
-- columnes amb clau forana composta cadascuna, perque un identificador polimorfic no es pot
-- protegir amb cap clau forana i era precisament la referencia creuada entre tenants el que el
-- threat model demanava impedir a la base de dades. `scope` es deriva de quina de les dues
-- porta valor, i el contracte de l'API no canvia.
create table billing_rates (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid,
  project_id uuid,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor_per_hour bigint not null check (amount_minor_per_hour between 0 and 9007199254740991),
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (num_nonnulls(customer_id, project_id) = 1),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict
);

create table time_entries (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  project_id uuid,
  ticket_id uuid,
  spent_on date not null,
  minutes integer not null check (minutes between 1 and 1440),
  billable boolean not null default true,
  note text check (note is null or length(note) between 1 and 500),
  -- Unic per persona: un reintent de xarxa no ha de duplicar hores, i la garantia es de la base
  -- de dades i no d'una comprovacio previa a l'insert.
  client_reference text check (client_reference is null or length(client_reference) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, membership_id, client_reference),
  -- Exactament un dels dos. Contra tots dos comptaria les hores dues vegades; contra cap no hi
  -- hauria manera d'atribuir-les a un client.
  check (num_nonnulls(project_id, ticket_id) = 1),
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  foreign key (tenant_id, ticket_id) references tickets(tenant_id, id) on delete restrict
);

-- El projecte d'un ticket ha de ser del mateix client que el ticket. Amb project_id nul la clau
-- no s'avalua, que es exactament el que ha de passar mentre el vincle sigui opcional.
alter table tickets add constraint tickets_project_customer_fk
  foreign key (tenant_id, project_id, customer_id) references projects(tenant_id, id, customer_id) on delete restrict;

create index projects_customer_idx on projects (tenant_id, customer_id, created_at desc);
create index projects_open_idx on projects (tenant_id, status, due_at) where status not in ('closed', 'canceled');
create index project_events_history_idx on project_events (tenant_id, project_id, created_at desc);
create index member_cost_rates_current_idx on member_cost_rates (tenant_id, membership_id, currency, effective_from desc);
create unique index billing_rates_customer_effective_idx
  on billing_rates (tenant_id, customer_id, currency, effective_from) where customer_id is not null;
create unique index billing_rates_project_effective_idx
  on billing_rates (tenant_id, project_id, currency, effective_from) where project_id is not null;
create index time_entries_project_idx on time_entries (tenant_id, project_id, spent_on) where project_id is not null;
create index time_entries_ticket_idx on time_entries (tenant_id, ticket_id, spent_on) where ticket_id is not null;
create index time_entries_member_idx on time_entries (tenant_id, membership_id, spent_on desc);

create function reject_project_history_mutation() returns trigger language plpgsql as $$
begin raise exception 'project history is append-only'; end;
$$;
create trigger project_events_append_only before update or delete on project_events for each row execute function reject_project_history_mutation();
create trigger member_cost_rates_append_only before update or delete on member_cost_rates for each row execute function reject_project_history_mutation();
create trigger billing_rates_append_only before update or delete on billing_rates for each row execute function reject_project_history_mutation();

-- Un projecte tancat no accepta hores. Comprovar-ho nomes al servei deixaria la finestra entre
-- llegir l'estat i escriure la fila; aqui la porta es tanca de debo. El SQLSTATE es propi
-- perque l'adaptador el pugui distingir d'una violacio de check qualsevol.
create function reject_time_on_closed_project() returns trigger language plpgsql as $$
declare project_status text;
begin
  if new.project_id is null then return new; end if;
  select status into project_status from projects where tenant_id = new.tenant_id and id = new.project_id;
  if project_status in ('closed', 'canceled') then
    raise exception 'project % is %', new.project_id, project_status using errcode = 'CH001';
  end if;
  return new;
end;
$$;
create trigger time_entries_project_open before insert or update on time_entries for each row execute function reject_time_on_closed_project();

do $$ declare table_name text; begin
  foreach table_name in array array['projects','project_events','member_cost_rates','billing_rates','time_entries'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('create policy %I on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_isolation', table_name);
    execute format('grant select, insert, update, delete on %I to control_hub_app', table_name);
  end loop;
end $$;
revoke update, delete on project_events, member_cost_rates, billing_rates from control_hub_app;
