-- Phase 7.1, increment A2: where what a connector pulled actually lands.
-- Specification: docs/specifications/infrastructure.md (gap G1)
--
-- Until now the runtime counted the records an operation returned and threw them away, and the
-- cursor with them. Nothing was wrong with that while the only connector received webhooks, but
-- the API makes no outbound call by design, so anything a screen shows has to have been stored
-- first. This is that store.
--
-- It is deliberately shapeless. A table per module, filled by a projector chosen by connector
-- type, would put a `switch (connectorType)` back in the worker -- the thing ADR-0004 removed.
-- The module that cares reads these rows; the worker never hears about the module.

create table connector_records (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  operation text not null check (length(operation) between 1 and 64),
  -- The provider's own identifier for the thing. It is what makes a redelivery harmless, so it
  -- is bounded rather than trusted: a provider that sends a megabyte here does not get a row.
  external_id text not null check (length(external_id) between 1 and 200),
  -- Mirrors the connector's manifest. Kept on the row and not looked up at purge time because a
  -- release can change a manifest, and rows written under the old one still have to expire the
  -- way they were written.
  shape text not null check (shape in ('state', 'event')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- The idempotency of a pull, enforced here rather than by a read the second worker can miss.
  -- Two passes of the same operation leave one row per thing observed.
  unique (tenant_id, instance_id, operation, external_id),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade
);

-- Serves the listing and the purge with the same index: both walk one operation of one instance
-- in `last_seen_at` order.
create index connector_records_operation_idx
  on connector_records (tenant_id, instance_id, operation, last_seen_at desc);

-- Purge reaches across tenants, so it needs an ordering that does not start with `tenant_id`.
create index connector_records_retention_idx on connector_records (shape, last_seen_at);

-- Where an operation left off, and when it last worked.
--
-- Separate from `connector_sync_runs` because a run is one attempt and this is the standing
-- answer: the run history says what happened at 03:12, this says what the next pass should ask
-- for. `last_success_at` is the age a screen shows and the freshness an alert is measured
-- against -- a rule must not fire because we stopped looking.
create table connector_operation_state (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  operation text not null check (length(operation) between 1 and 64),
  cursor text check (length(cursor) <= 4096),
  last_run_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, instance_id, operation),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade
);

alter table connector_records enable row level security;
alter table connector_records force row level security;
create policy connector_records_isolation on connector_records
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table connector_operation_state enable row level security;
alter table connector_operation_state force row level security;
create policy connector_operation_state_isolation on connector_operation_state
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Still no delete for the application role, exactly as 0030 established. A pulled record differs
-- from a run or an inbox entry -- it is a copy of what the provider currently says, not evidence
-- of anything we did, so it may legitimately be removed. That is why deletion exists at all here,
-- and why it exists only as the function below: the predicate is fixed in the schema where a
-- later edit is reviewable, and no request can reach a delete of its own.
grant select, insert, update on connector_records to control_hub_app;
grant select, insert, update on connector_operation_state to control_hub_app;

-- Retention, in one bounded statement across every tenant.
--
-- The windows are arguments and not constants baked in here: they were chosen before anybody had
-- a month of real traffic, and revising them has to cost a release rather than a migration.
-- `security definer` so the caller needs no delete privilege; it runs as the owner, which is also
-- what lets one call cover every tenant instead of walking them.
--
-- Two rules, because the two shapes expire for different reasons: a `state` row expires when the
-- provider stops naming the thing, an `event` row when it is simply old. The third deletion is
-- the ceiling -- a provider we misread must make noise, not fill the table quietly.
create function purge_connector_records(
  p_state_before timestamptz,
  p_event_before timestamptz,
  p_max_per_operation integer,
  p_batch_limit integer
) returns table (purged bigint, trimmed bigint)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_purged bigint;
  v_trimmed bigint;
begin
  if p_batch_limit is null or p_batch_limit <= 0 then
    raise exception 'purge batch limit must be positive';
  end if;

  with expired as (
    select id from connector_records
    where (shape = 'state' and last_seen_at < p_state_before)
       or (shape = 'event' and last_seen_at < p_event_before)
    order by last_seen_at
    limit p_batch_limit
  )
  delete from connector_records where id in (select id from expired);
  get diagnostics v_purged = row_count;

  -- Rank within each operation and drop everything past the ceiling, newest kept. Bounded by the
  -- same batch limit so one runaway instance cannot make this statement unbounded.
  with ranked as (
    select id, row_number() over (
      partition by tenant_id, instance_id, operation order by last_seen_at desc, id
    ) as position
    from connector_records
  ),
  excess as (
    select id from ranked where position > p_max_per_operation order by id limit p_batch_limit
  )
  delete from connector_records where id in (select id from excess);
  get diagnostics v_trimmed = row_count;

  return query select v_purged, v_trimmed;
end;
$$;

revoke all on function purge_connector_records(timestamptz, timestamptz, integer, integer) from public;
grant execute on function purge_connector_records(timestamptz, timestamptz, integer, integer) to control_hub_app;
