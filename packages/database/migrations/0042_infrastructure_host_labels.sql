-- The other names one machine answers to.
--
-- A Prometheus aggregates by `instance`, and `instance` is the scrape target that reported a
-- figure -- not the computer it came from. One ordinary VPS is three of them: `node-exporter:9100`
-- for the machine, `cadvisor:8080` for its containers, `127.0.0.1:9090` for Prometheus itself.
-- The machine gets declared with one of them and its containers arrive with another, so nothing
-- joins them and the machine's page says it runs nothing while twenty containers are stored.
--
-- Inferring it would be false the day there are two machines, so it is declared. `infra_hosts`
-- keeps `hostname` as the label the machine is matched by; these are the additional ones.
--
-- Specification: `docs/specifications/connector-onboarding.md`, increment C8.
create table infra_host_labels (
  tenant_id uuid not null references tenants(id) on delete cascade,
  host_id uuid not null,
  -- Capped where every other collector label is capped, so that a label which validates here can
  -- never produce an `external_id` the record store would refuse.
  label text not null check (length(label) between 1 and 190),
  created_at timestamptz not null default now(),
  -- A label belongs to one machine and no more. Two machines claiming the same one would both
  -- match every reading of one of them, and a single outage would arrive as two alerts about two
  -- things that are the same thing -- the reason `infra_hosts.hostname` is unique too.
  primary key (tenant_id, label),
  -- Composite, so a label cannot be attached to a host of another tenant even by naming its id.
  foreign key (tenant_id, host_id) references infra_hosts (tenant_id, id) on delete cascade
);

-- Reading goes by machine: "what else is this one called" is the question the page asks.
create index infra_host_labels_by_host on infra_host_labels (tenant_id, host_id);

alter table infra_host_labels enable row level security;
alter table infra_host_labels force row level security;
create policy infra_host_labels_isolation on infra_host_labels
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Delete is granted here and is not on `infra_hosts`: withdrawing a label is saying the machine
-- was never that thing, which loses nothing. No alert, no service and no history hangs off a
-- label -- the readings it matched stay exactly where they were.
grant select, insert, delete on infra_host_labels to control_hub_app;
