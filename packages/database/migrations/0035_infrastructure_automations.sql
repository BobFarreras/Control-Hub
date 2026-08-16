-- Phase 7.1, increment A5: the module that reads what the connectors stored.
-- Specification: docs/specifications/infrastructure.md
--
-- Three tables, and the boundary between them and `connector_records` is the point. A record is
-- a copy of what a provider currently says, owned by the platform and purged on a schedule. What
-- is here is ours: which client an automation belongs to, what we decided is worth alerting on,
-- and what has fired. None of it may be lost when a record expires, so none of it is a column on
-- a record.

-- Which client an automation belongs to.
--
-- Keyed by `(instance_id, external_id)` rather than by a foreign key to `connector_records`,
-- deliberately: a record is deleted when the provider stops naming it and re-created if it comes
-- back, and a business association must not disappear because a workflow was archived for a
-- fortnight. The link outlives the record it describes.
create table infra_automation_links (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  external_id text not null check (length(external_id) between 1 and 200),
  customer_id uuid,
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, instance_id, external_id),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete set null (customer_id)
);

create index infra_automation_links_customer_idx on infra_automation_links (tenant_id, customer_id);

-- What somebody decided is worth being told about.
--
-- `kind` is constrained rather than free text: a rule of a kind no code evaluates would sit in
-- the table looking like coverage and never fire. Phase 7.2 adds its three kinds by altering
-- this check, which is a reviewable line in a migration instead of a value somebody typed.
create table infra_alert_rules (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(name) between 3 and 120),
  kind text not null check (kind in ('workflow_failed')),
  -- Whose data feeds the rule. A rule reads one instance; it never spans two, so the freshness
  -- of one provider cannot be mistaken for the freshness of another.
  instance_id uuid not null,
  target_type text not null check (target_type in ('instance', 'automation')),
  -- The provider's own id of the one automation being watched. Text, not a uuid: it is an
  -- `external_id`, and n8n names its workflows.
  target_id text check (length(target_id) between 1 and 200),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 4096),
  severity text not null check (severity in ('critical', 'high', 'normal', 'low')),
  -- How old the data may be before the rule reports that it cannot see rather than that all is
  -- well. Bounded at both ends: under a minute is noise, over a day is not a budget.
  freshness_seconds integer not null check (freshness_seconds between 60 and 86400),
  opens_incident boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name),
  -- A target of `automation` with nothing to point at would silently watch everything.
  check ((target_type = 'automation') = (target_id is not null)),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade
);

create index infra_alert_rules_instance_idx on infra_alert_rules (tenant_id, instance_id) where enabled;

-- What has fired, and what fired and stopped.
create table infra_alert_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  rule_id uuid not null,
  -- What makes two firings the same alert. One per workflow for `workflow_failed`.
  dedup_key text not null check (length(dedup_key) between 1 and 200),
  status text not null check (status in ('firing', 'resolved')),
  severity text not null check (severity in ('critical', 'high', 'normal', 'low')),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 4096),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences integer not null default 1 check (occurrences > 0),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by_membership_id uuid,
  incident_id uuid,
  unique (tenant_id, id),
  check ((status = 'resolved') = (resolved_at is not null)),
  check ((acknowledged_at is null) = (acknowledged_by_membership_id is null)),
  foreign key (tenant_id, rule_id) references infra_alert_rules(tenant_id, id) on delete cascade,
  foreign key (tenant_id, incident_id) references incidents(tenant_id, id) on delete set null (incident_id),
  foreign key (tenant_id, acknowledged_by_membership_id) references memberships(tenant_id, id)
    on delete set null (acknowledged_by_membership_id)
);

-- The deduplication itself, and the reason no code reads before it writes.
--
-- Two workers evaluating at the same moment, or a webhook arriving while the sweep runs, would
-- both find no live alert and both be right. The constraint makes the second one an update of
-- the first. It also caps incidents at one per live alert, because the incident hangs off the
-- row this index keeps unique.
create unique index infra_alert_events_live_idx
  on infra_alert_events (tenant_id, rule_id, dedup_key)
  where status = 'firing';

create index infra_alert_events_recent_idx on infra_alert_events (tenant_id, status, last_seen_at desc);
-- Resolved alerts are evidence and are kept 180 days; the purge walks them by age across tenants.
create index infra_alert_events_retention_idx on infra_alert_events (status, resolved_at);

alter table infra_automation_links enable row level security;
alter table infra_automation_links force row level security;
create policy infra_automation_links_isolation on infra_automation_links
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table infra_alert_rules enable row level security;
alter table infra_alert_rules force row level security;
create policy infra_alert_rules_isolation on infra_alert_rules
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table infra_alert_events enable row level security;
alter table infra_alert_events force row level security;
create policy infra_alert_events_isolation on infra_alert_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- A link and a rule are ours to withdraw: unlinking a workflow and deleting a rule are both
-- ordinary, audited acts. An alert event is not -- it is the record that something happened, and
-- the only thing that removes one is the retention sweep below.
grant select, insert, update, delete on infra_automation_links to control_hub_app;
grant select, insert, update, delete on infra_alert_rules to control_hub_app;
grant select, insert, update on infra_alert_events to control_hub_app;

-- Retention for resolved alerts, in one bounded statement across every tenant.
--
-- Same shape and the same reasoning as `purge_connector_records`: the window is an argument so
-- that revising it costs a release rather than a migration, and `security definer` so the caller
-- needs no delete privilege of its own. Only resolved rows: a firing alert has no age at which
-- it stops mattering.
create function purge_alert_events(p_resolved_before timestamptz, p_batch_limit integer)
returns bigint
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_purged bigint;
begin
  if p_batch_limit is null or p_batch_limit <= 0 then
    raise exception 'purge batch limit must be positive';
  end if;

  with expired as (
    select id from infra_alert_events
    where status = 'resolved' and resolved_at < p_resolved_before
    order by resolved_at
    limit p_batch_limit
  )
  delete from infra_alert_events where id in (select id from expired);
  get diagnostics v_purged = row_count;

  return v_purged;
end;
$$;

revoke all on function purge_alert_events(timestamptz, integer) from public;
grant execute on function purge_alert_events(timestamptz, integer) to control_hub_app;
