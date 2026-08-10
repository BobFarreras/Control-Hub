-- Fase 5: suport, tickets, SLA i incidencies.
-- Especificacio: docs/specifications/support.md

-- L'horari es dada, no constant: diverses finestres per dia permeten torns partits, i un dia
-- sense cap fila es un dia no laborable. La zona horaria surt de tenant_settings.
create table support_schedule (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, weekday, opens_at),
  check (closes_at > opens_at)
);

create table support_holidays (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  holiday_on date not null,
  label text check (label is null or length(label) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, holiday_on)
);

-- Append-only amb data d'efecte, com plan_prices: canviar els objectius avui no pot convertir
-- en compliments els incompliments del mes passat.
create table sla_targets (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  priority text not null check (priority in ('low', 'normal', 'high', 'urgent')),
  first_response_minutes integer not null check (first_response_minutes between 1 and 525600),
  resolution_minutes integer not null check (resolution_minutes between 1 and 525600),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, priority, effective_from),
  check (resolution_minutes >= first_response_minutes)
);

-- Qui desperta a qui fora d'horari es configuracio del tenant, no una regla del producte.
create table support_notification_policy (
  tenant_id uuid not null references tenants(id) on delete cascade,
  severity text not null check (severity in ('critical', 'high', 'normal', 'low')),
  notifies_out_of_hours boolean not null default false,
  acknowledge_deadline_minutes integer check (acknowledge_deadline_minutes between 1 and 1440),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, severity)
);

-- Serie llegible per tenant. El comptador viu en una fila propia perque assignar-lo amb un
-- max()+1 corre el risc de donar el mateix numero a dos tickets creats alhora.
create table ticket_counters (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  next_number bigint not null default 1 check (next_number > 0)
);

create table tickets (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  ticket_number bigint not null check (ticket_number > 0),
  customer_id uuid not null,
  -- La clau forana cap a projects arriba amb la Fase 5B, quan la taula existeix. La columna
  -- neix aqui perque afegir-la despres obligaria a migrar files ja escrites.
  project_id uuid,
  subject text not null check (length(subject) between 3 and 200),
  description text not null check (length(description) between 1 and 20000),
  status text not null default 'new' check (
    status in ('new', 'open', 'waiting_customer', 'waiting_third_party', 'resolved', 'closed')
  ),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  category text not null default 'general' check (length(category) between 1 and 60),
  assignee_membership_id uuid,
  opened_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  -- Copia dels objectius vigents en obrir, no una referencia: el compliment d'un ticket antic
  -- ha de ser justificable sense reconstruir quina configuracio hi havia aquell dia.
  first_response_target_minutes integer not null check (first_response_target_minutes between 1 and 525600),
  resolution_target_minutes integer not null check (resolution_target_minutes between 1 and 525600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, ticket_number),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, assignee_membership_id) references memberships(tenant_id, id) on delete set null (assignee_membership_id)
);

create table ticket_messages (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  ticket_id uuid not null,
  -- Nul quan el missatge arribi d'un canal entrant en comptes d'un membre.
  author_membership_id uuid,
  body text not null check (length(body) between 1 and 20000),
  visibility text not null check (visibility in ('internal', 'customer')),
  -- Es aixo el que fa idempotent un missatge entrant: la unicitat la garanteix la base de
  -- dades, no una comprovacio a l'aplicacio que dos processos poden creuar.
  external_reference text check (external_reference is null or length(external_reference) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, external_reference),
  foreign key (tenant_id, ticket_id) references tickets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, author_membership_id) references memberships(tenant_id, id) on delete set null (author_membership_id)
);

create table ticket_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  ticket_id uuid not null,
  actor_membership_id uuid,
  type text not null check (type in ('created', 'status_changed', 'assigned', 'priority_changed', 'sla_breached')),
  from_value text check (from_value is null or length(from_value) <= 60),
  to_value text check (to_value is null or length(to_value) <= 60),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, ticket_id) references tickets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_membership_id) references memberships(tenant_id, id) on delete set null (actor_membership_id)
);

-- Una incidencia no te SLA de client: te gravetat. Per aixo no comparteix taula amb tickets.
create table incidents (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null check (length(title) between 3 and 200),
  severity text not null check (severity in ('critical', 'high', 'normal', 'low')),
  status text not null default 'open' check (status in ('open', 'monitoring', 'resolved')),
  customer_id uuid,
  started_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by_membership_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((acknowledged_at is null) = (acknowledged_by_membership_id is null)),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete set null (customer_id),
  foreign key (tenant_id, acknowledged_by_membership_id) references memberships(tenant_id, id) on delete set null (acknowledged_by_membership_id)
);

create table incident_tickets (
  tenant_id uuid not null references tenants(id) on delete cascade,
  incident_id uuid not null,
  ticket_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, incident_id, ticket_id),
  foreign key (tenant_id, incident_id) references incidents(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ticket_id) references tickets(tenant_id, id) on delete cascade
);

create index tickets_queue_idx on tickets (tenant_id, status, priority, opened_at desc);
create index tickets_customer_idx on tickets (tenant_id, customer_id, opened_at desc);
create index tickets_assignee_idx on tickets (tenant_id, assignee_membership_id) where status not in ('resolved', 'closed');
create index tickets_project_idx on tickets (tenant_id, project_id) where project_id is not null;
create index ticket_messages_thread_idx on ticket_messages (tenant_id, ticket_id, created_at);
create index ticket_events_history_idx on ticket_events (tenant_id, ticket_id, created_at desc);
create index sla_targets_current_idx on sla_targets (tenant_id, priority, effective_from desc);
create index incidents_open_idx on incidents (tenant_id, severity, started_at desc) where status <> 'resolved';

create function reject_support_history_mutation() returns trigger language plpgsql as $$
begin raise exception 'support history is append-only'; end;
$$;
create trigger ticket_messages_append_only before update or delete on ticket_messages for each row execute function reject_support_history_mutation();
create trigger ticket_events_append_only before update or delete on ticket_events for each row execute function reject_support_history_mutation();
create trigger sla_targets_append_only before update or delete on sla_targets for each row execute function reject_support_history_mutation();

do $$ declare table_name text; begin
  foreach table_name in array array['support_schedule','support_holidays','sla_targets','support_notification_policy','ticket_counters','tickets','ticket_messages','ticket_events','incidents','incident_tickets'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('create policy %I on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_isolation', table_name);
    execute format('grant select, insert, update, delete on %I to control_hub_app', table_name);
  end loop;
end $$;
revoke update, delete on ticket_messages, ticket_events, sla_targets from control_hub_app;
