-- Phase 7B/M3: confirmed connector actions and outbound support mail.
-- Message bodies remain in ticket_messages; queue and outbox rows carry identifiers only.

create table connector_action_confirmations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  membership_id uuid not null,
  action text not null check (length(action) between 1 and 64),
  nonce_hash text not null check (length(nonce_hash) = 64),
  input_digest text not null check (length(input_digest) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, nonce_hash),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id)
);

create table connector_action_requests (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  membership_id uuid not null,
  action text not null check (length(action) between 1 and 64),
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  input_digest text not null check (length(input_digest) = 64),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','unknown','canceled')),
  external_id text check (external_id is null or length(external_id) <= 512),
  error_code text check (error_code is null or length(error_code) <= 120),
  correlation_id uuid not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, instance_id, action, idempotency_key),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade,
  foreign key (tenant_id, membership_id) references memberships(tenant_id, id)
);

create table mail_deliveries (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  ticket_id uuid not null,
  ticket_message_id uuid not null,
  action_request_id uuid not null,
  instance_id uuid not null,
  recipient_address text not null check (length(recipient_address) between 3 and 320),
  subject text not null check (length(subject) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, action_request_id),
  unique (tenant_id, ticket_message_id),
  foreign key (tenant_id, ticket_id) references tickets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, ticket_message_id) references ticket_messages(tenant_id, id) on delete cascade,
  foreign key (tenant_id, action_request_id) references connector_action_requests(tenant_id, id) on delete cascade,
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id)
);

create table connector_action_outbox (
  request_id uuid primary key,
  tenant_id uuid not null,
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 100),
  published_at timestamptz,
  foreign key (tenant_id, request_id) references connector_action_requests(tenant_id, id) on delete cascade
);

create index connector_action_confirmations_expiry_idx on connector_action_confirmations (expires_at)
  where consumed_at is null;
create index connector_action_requests_status_idx on connector_action_requests (tenant_id, status, created_at desc);
create index mail_deliveries_ticket_idx on mail_deliveries (tenant_id, ticket_id, created_at desc);
create index connector_action_outbox_pending_idx on connector_action_outbox (tenant_id, available_at, request_id)
  where published_at is null;

alter table connector_action_confirmations enable row level security;
alter table connector_action_confirmations force row level security;
create policy connector_action_confirmations_isolation on connector_action_confirmations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
alter table connector_action_requests enable row level security;
alter table connector_action_requests force row level security;
create policy connector_action_requests_isolation on connector_action_requests
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
alter table mail_deliveries enable row level security;
alter table mail_deliveries force row level security;
create policy mail_deliveries_isolation on mail_deliveries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
alter table connector_action_outbox enable row level security;
alter table connector_action_outbox force row level security;
create policy connector_action_outbox_isolation on connector_action_outbox
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on connector_action_confirmations to control_hub_app;
grant select, insert, update on connector_action_requests, mail_deliveries, connector_action_outbox to control_hub_app;
