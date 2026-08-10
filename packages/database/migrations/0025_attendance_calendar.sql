-- Increment 10: calendari laboral i gestio de vacances, absencies i bloquejos.
-- Especificacio: docs/specifications/attendance.md

-- Festius del tenant. Son dates que l'oficina tanca per festius publics o propis.
-- Els festius de suport (support_holidays) son conceptes diferents: afecten SLA, no jornada.
create table attendance_holidays (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  date date not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),

  unique (tenant_id, date)
);

alter table attendance_holidays enable row level security;
alter table attendance_holidays force row level security;
create policy attendance_holidays_isolation on attendance_holidays
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, delete on attendance_holidays to control_hub_app;

-- Dies no laborables habituals (per exemple, caps de setmana).
-- day_of_week: 0 = diumenge, 6 = dissabte.
create table attendance_non_working_days (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  day_of_week integer not null check (day_of_week between 0 and 6),
  created_at timestamptz not null default now(),

  unique (tenant_id, day_of_week)
);

alter table attendance_non_working_days enable row level security;
alter table attendance_non_working_days force row level security;
create policy attendance_non_working_days_isolation on attendance_non_working_days
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, delete on attendance_non_working_days to control_hub_app;

-- Vacances aprovades. Cada fila es un rang de dates.
create table attendance_vacations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by_membership_id uuid,
  approved_at timestamptz,
  notes text check (notes is null or length(btrim(notes)) between 1 and 1000),
  created_at timestamptz not null default now(),

  check (end_date >= start_date),
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, approved_by_membership_id) references memberships(tenant_id, id) on delete restrict
);

alter table attendance_vacations enable row level security;
alter table attendance_vacations force row level security;
create policy attendance_vacations_isolation on attendance_vacations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index attendance_vacations_member_idx on attendance_vacations (tenant_id, membership_id, start_date);

grant select, insert, update on attendance_vacations to control_hub_app;

-- Absencies (baixes mediques, permisos, etc.).
create table attendance_absences (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  start_date date not null,
  end_date date not null,
  type text not null check (type in ('sick_leave', 'personal_leave', 'other')),
  document_url text check (document_url is null or length(document_url) between 1 and 2000),
  notes text check (notes is null or length(btrim(notes)) between 1 and 1000),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),

  check (end_date >= start_date),
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id) on delete restrict,
  foreign key (tenant_id, created_by_membership_id) references memberships(tenant_id, id) on delete restrict
);

alter table attendance_absences enable row level security;
alter table attendance_absences force row level security;
create policy attendance_absences_isolation on attendance_absences
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index attendance_absences_member_idx on attendance_absences (tenant_id, membership_id, start_date);

grant select, insert on attendance_absences to control_hub_app;

-- Bloquejos personals (hores no disponibles d'un dia concret).
create table attendance_blocks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  membership_id uuid not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),

  check (end_time > start_time),
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id) on delete restrict
);

alter table attendance_blocks enable row level security;
alter table attendance_blocks force row level security;
create policy attendance_blocks_isolation on attendance_blocks
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create index attendance_blocks_member_idx on attendance_blocks (tenant_id, membership_id, date);

grant select, insert, delete on attendance_blocks to control_hub_app;