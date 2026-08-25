-- Phase M1: a support inbox for messages observed by mailbox connectors.
-- Raw MIME, attachments and credentials never enter these tables.

create table support_mailbox_channels (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, instance_id),
  foreign key (tenant_id, instance_id) references connector_instances(tenant_id, id) on delete cascade
);

create table support_inbound_messages (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel_id uuid not null,
  external_id text not null check (length(external_id) between 1 and 512),
  thread_key text not null check (length(thread_key) between 1 and 512),
  sender_address text not null check (length(sender_address) between 3 and 320),
  sender_name text check (length(sender_name) between 1 and 200),
  subject text check (length(subject) between 1 and 500),
  preview text check (length(preview) between 1 and 4000),
  received_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'classified', 'discarded')),
  customer_id uuid,
  ticket_id uuid,
  classified_by_membership_id uuid,
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, channel_id, external_id),
  foreign key (tenant_id, channel_id) references support_mailbox_channels(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id),
  foreign key (tenant_id, ticket_id) references tickets(tenant_id, id),
  foreign key (tenant_id, classified_by_membership_id) references memberships(tenant_id, id),
  check (
    (status = 'pending' and customer_id is null and ticket_id is null and classified_by_membership_id is null and classified_at is null)
    or (status = 'classified' and customer_id is not null and ticket_id is not null and classified_by_membership_id is not null and classified_at is not null)
    or (status = 'discarded' and ticket_id is null and classified_by_membership_id is not null and classified_at is not null)
  )
);

create index support_inbound_messages_pending_idx
  on support_inbound_messages (tenant_id, received_at asc, id)
  where status = 'pending';
create index support_inbound_messages_thread_idx
  on support_inbound_messages (tenant_id, channel_id, thread_key, received_at asc);

alter table support_mailbox_channels enable row level security;
alter table support_mailbox_channels force row level security;
create policy support_mailbox_channels_isolation on support_mailbox_channels
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table support_inbound_messages enable row level security;
alter table support_inbound_messages force row level security;
create policy support_inbound_messages_isolation on support_inbound_messages
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update, delete on support_mailbox_channels to control_hub_app;
grant select, insert, update on support_inbound_messages to control_hub_app;
