-- Phase 7.2, increment B2: the inventory somebody declares, next to the readings a connector takes.
-- Specification: docs/specifications/infrastructure.md
--
-- Two tables, and the same boundary as the `0035`: what a connector stores is a copy of what a
-- provider currently says, owned by the platform and purged on a schedule. What is here is a
-- decision -- this machine exists, this service on it matters, this is the client it serves --
-- and none of it may be lost when a reading expires. So none of it is a column on a record.
--
-- The join between the two sides is `match_key`, and it is the whole point of this migration.
-- Without it the inventory would be a list of names nobody could compare with reality, and the
-- three rules of increment B3 would have nothing to evaluate.

-- A machine somebody has decided we look after.
create table infra_hosts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(name) between 3 and 120),
  -- The label Prometheus knows it by, and the reason a host can be compared with a reading at
  -- all. Required, not optional: a host in the inventory that no observation can be matched to
  -- looks like coverage on a screen and is never once contradicted by the data. Capped at 190
  -- because the connector caps its host labels there, so that `host:<label>` still fits the 200
  -- characters an `external_id` is allowed.
  hostname text not null check (length(hostname) between 1 and 190),
  -- Constrained rather than free text, for the same reason `kind` is on an alert rule: a value
  -- nobody filters by is not a filter, it is a typo waiting to split one environment into two.
  environment text not null check (environment in ('production', 'staging', 'development')),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  -- Two hosts claiming the same label would both match every reading of one machine, and one
  -- outage would arrive as two alerts about two things that are the same thing.
  unique (tenant_id, hostname)
);

-- Something running on a host that somebody wants to know about.
--
-- `kind` says what the service *is*; `match_key` says how it is *observed*. Keeping the two
-- apart is deliberate: the Postgres of a self-hosted Supabase is a database, and it is seen by
-- cAdvisor as a container. Deriving the observation from the kind would leave `database` with
-- no source of data in this phase, which is the "looks like coverage" failure again.
create table infra_services (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  host_id uuid not null,
  name text not null check (length(name) between 3 and 120),
  kind text not null check (kind in ('container', 'http', 'database', 'automation')),
  -- The complete `external_id` of the record this service is recognised by, prefix included:
  -- `container:<name>`, `probe:<target>`, `host:<label>`, or an automation's own id. Text and
  -- not a uuid, because a provider names its own things.
  match_key text not null check (length(match_key) between 1 and 200),
  -- What the evaluation of increment B3 should conclude, and the only three answers it can act
  -- on. `up` is the ordinary case. `stopped` is a service that must stay down and about which we
  -- want to hear if it comes back -- a removed admin panel is the case that earned this value.
  -- `ignored` is declared but deliberately not alerted on. A fourth value nobody evaluates would
  -- be coverage that never fires.
  expected_state text not null default 'up' check (expected_state in ('up', 'stopped', 'ignored')),
  customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, host_id, name),
  -- Two services pointing at the same observed object are two alerts about one outage. The kind
  -- is not part of the key: what makes them the same is what is being watched, not how it was
  -- classified.
  unique (tenant_id, match_key),
  foreign key (tenant_id, host_id) references infra_hosts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete set null (customer_id)
);

create index infra_services_host_idx on infra_services (tenant_id, host_id);
create index infra_services_customer_idx on infra_services (tenant_id, customer_id);
-- How increment B3 will read them: every service worth judging, in one pass, without the ones
-- somebody has asked us to leave alone.
create index infra_services_evaluated_idx on infra_services (tenant_id, match_key)
  where expected_state <> 'ignored';

alter table infra_hosts enable row level security;
alter table infra_hosts force row level security;
create policy infra_hosts_isolation on infra_hosts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table infra_services enable row level security;
alter table infra_services force row level security;
create policy infra_services_isolation on infra_services
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- A service is ours to withdraw: deciding something no longer matters is an ordinary, audited
-- act. A host is not, and the privilege is what says so rather than the absence of a route.
-- History hangs off a host -- its services, and through them every alert that ever fired about
-- it -- and a machine that was decommissioned is a machine that existed. Retiring one is an
-- `environment` somebody sets, or a migration somebody reviews.
grant select, insert, update on infra_hosts to control_hub_app;
grant select, insert, update, delete on infra_services to control_hub_app;
