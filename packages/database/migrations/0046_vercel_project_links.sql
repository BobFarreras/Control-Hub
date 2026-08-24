-- Which client a Vercel project belongs to.
--
-- A project is neither a machine nor a service -- a service carries a mandatory `host_id`, and no
-- machine of ours runs a Vercel project -- so it gets its own band on the screen, exactly like an
-- n8n automation, and this is the only thing about it that is ours to keep. Everything else is a
-- copy of what the provider currently says, owned by the platform in `connector_records` and
-- purged on a schedule.
--
-- Deliberately a second table and not a `kind` column on `infra_automation_links`, which has the
-- same shape today. A shared table needs a discriminator that every query has to remember to
-- filter, and the day somebody forgets, a Vercel project appears in the automations table. Twenty
-- lines of duplication buys a defect that cannot be written.
--
-- Specification: `docs/specifications/connector-vercel.md`, increment V2.
create table infra_project_links (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  -- The provider's own identifier, prefix included: `project:<id>`. Capped where the record store
  -- caps an `external_id`, so a link can never name a key a record could not hold.
  external_id text not null check (length(external_id) between 1 and 200),
  customer_id uuid,
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- One link per project, which is what makes writing it an upsert rather than a read and a race.
  unique (tenant_id, instance_id, external_id),
  -- Keyed by `(instance_id, external_id)` and not by a foreign key to `connector_records`, for the
  -- reason the automation links are: a record is deleted when the provider stops naming it and
  -- created again when it comes back, and an association with a client must not disappear because
  -- a project spent a fortnight paused.
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete set null (customer_id)
);

-- "What is this client's, and what is it on" is the other direction this gets read from.
create index infra_project_links_customer_idx on infra_project_links (tenant_id, customer_id);

alter table infra_project_links enable row level security;
alter table infra_project_links force row level security;
create policy infra_project_links_isolation on infra_project_links
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Update, because the association and the note are one row that gets rewritten. No delete: an
-- association is withdrawn by nulling the client, and the row survives it -- somebody wrote those
-- notes, and losing them as a side effect of unlinking would be a surprise.
grant select, insert, update on infra_project_links to control_hub_app;
