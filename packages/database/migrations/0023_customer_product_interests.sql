create table customer_product_interests (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  product_id uuid not null,
  stage text not null default 'detected'
    check (stage in ('detected','qualified','proposal','negotiation','won','lost')),
  probability smallint check (probability is null or probability between 0 and 100),
  estimated_amount_minor bigint check (estimated_amount_minor is null or estimated_amount_minor between 0 and 9007199254740991),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  next_step text check (next_step is null or length(next_step) <= 500),
  owner_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, product_id) references products(tenant_id, id) on delete restrict,
  foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id) on delete set null,
  check ((estimated_amount_minor is null) = (currency is null))
);

create unique index customer_product_interests_open_unique
  on customer_product_interests (tenant_id, customer_id, product_id)
  where stage not in ('won', 'lost');
create index customer_product_interests_customer_idx
  on customer_product_interests (tenant_id, customer_id, updated_at desc);

create table customer_product_interest_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  interest_id uuid not null,
  actor_user_id text references "user"(id) on delete set null,
  from_stage text,
  to_stage text not null check (to_stage in ('detected','qualified','proposal','negotiation','won','lost')),
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, interest_id) references customer_product_interests(tenant_id, id) on delete restrict
);

create index customer_product_interest_events_history_idx
  on customer_product_interest_events (tenant_id, interest_id, occurred_at desc);

create function reject_customer_interest_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'customer product interest history is append-only'; end;
$$;
create trigger customer_product_interest_events_append_only
  before update or delete on customer_product_interest_events
  for each row execute function reject_customer_interest_event_mutation();

do $$ declare table_name text; begin
  foreach table_name in array array['customer_product_interests','customer_product_interest_events'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('create policy %I on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_isolation', table_name);
    execute format('grant select, insert, update, delete on %I to control_hub_app', table_name);
  end loop;
end $$;
revoke update, delete on customer_product_interest_events from control_hub_app;
