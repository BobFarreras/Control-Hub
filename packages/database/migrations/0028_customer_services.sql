-- Increment 6: unified customer contracts, purchases and project services.
-- Specification: docs/specifications/commerce.md

create table customer_services (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  plan_id uuid not null,
  price_id uuid not null,
  commercial_model text not null check (
    commercial_model in ('subscription', 'maintenance', 'one_time', 'project_service')
  ),
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'canceled')),
  quantity integer not null default 1 check (quantity between 1 and 1000000),
  contracted_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  owner_membership_id uuid,
  project_id uuid,
  canceled_at timestamptz,
  source_subscription_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  check ((status = 'canceled') = (canceled_at is not null)),
  check (commercial_model in ('subscription', 'maintenance') or status <> 'paused'),
  unique (tenant_id, id),
  unique (tenant_id, source_subscription_id),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict,
  foreign key (tenant_id, plan_id) references plans(tenant_id, id) on delete restrict,
  foreign key (tenant_id, plan_id, price_id) references plan_prices(tenant_id, plan_id, id) on delete restrict,
  foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id)
    on delete set null (owner_membership_id),
  foreign key (tenant_id, project_id, customer_id) references projects(tenant_id, id, customer_id)
    on delete set null (project_id)
);

create table customer_service_recurrence (
  customer_service_id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  current_period_start timestamptz not null,
  renewal_at timestamptz,
  auto_renew boolean not null default false,
  renewal_alert_days integer not null default 14 check (renewal_alert_days between 0 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_service_id),
  foreign key (tenant_id, customer_service_id) references customer_services(tenant_id, id) on delete cascade
);

create table customer_service_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  customer_service_id uuid not null,
  actor_user_id text references "user"(id) on delete set null,
  type text not null check (
    type in ('created', 'paused', 'resumed', 'completed', 'canceled', 'plan_changed', 'renewed', 'project_linked')
  ),
  effective_at timestamptz not null,
  previous_plan_id uuid,
  new_plan_id uuid,
  previous_price_id uuid,
  new_price_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  source_subscription_event_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source_subscription_event_id),
  foreign key (tenant_id, customer_service_id) references customer_services(tenant_id, id) on delete restrict
);

create index customer_services_customer_idx
  on customer_services (tenant_id, customer_id, status, contracted_at desc);
create index customer_services_plan_idx
  on customer_services (tenant_id, plan_id, status);
create index customer_services_model_idx
  on customer_services (tenant_id, commercial_model, status);
create index customer_services_owner_idx
  on customer_services (tenant_id, owner_membership_id, status)
  where owner_membership_id is not null;
create index customer_service_renewal_idx
  on customer_service_recurrence (tenant_id, renewal_at)
  where renewal_at is not null;
create index customer_service_events_history_idx
  on customer_service_events (tenant_id, customer_service_id, effective_at desc, created_at desc);

create function enforce_customer_service_catalog_model() returns trigger language plpgsql as $$
declare catalog_model text;
begin
  select commercial_model into catalog_model from plans
  where tenant_id = new.tenant_id and id = new.plan_id;
  if catalog_model is null or catalog_model <> new.commercial_model then
    raise exception 'Customer service commercial model must match its plan' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_customer_service_catalog_model
before insert or update of plan_id, commercial_model on customer_services
for each row execute function enforce_customer_service_catalog_model();

create function enforce_customer_service_recurrence() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from customer_services
    where tenant_id = new.tenant_id
      and id = new.customer_service_id
      and commercial_model in ('subscription', 'maintenance')
  ) then
    raise exception 'Only subscriptions and maintenance can recur' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_customer_service_recurrence
before insert or update on customer_service_recurrence
for each row execute function enforce_customer_service_recurrence();

create function reject_customer_service_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'customer service events are append-only'; end;
$$;
create trigger customer_service_events_append_only
before update or delete on customer_service_events
for each row execute function reject_customer_service_event_mutation();

alter table customer_services enable row level security;
alter table customer_services force row level security;
create policy customer_services_isolation on customer_services
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table customer_service_recurrence enable row level security;
alter table customer_service_recurrence force row level security;
create policy customer_service_recurrence_isolation on customer_service_recurrence
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

alter table customer_service_events enable row level security;
alter table customer_service_events force row level security;
create policy customer_service_events_isolation on customer_service_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select, insert, update on customer_services to control_hub_app;
grant select, insert, update on customer_service_recurrence to control_hub_app;
grant select, insert on customer_service_events to control_hub_app;

-- Existing subscriptions keep their UUID, making references and rollback comparison explicit.
insert into customer_services (
  id, tenant_id, customer_id, plan_id, price_id, commercial_model, status, quantity,
  contracted_at, starts_at, ends_at, canceled_at, source_subscription_id, created_at, updated_at
)
select
  s.id, s.tenant_id, s.customer_id, s.plan_id, s.price_id, p.commercial_model, s.status, s.quantity,
  s.created_at, s.started_at, s.canceled_at, s.canceled_at, s.id, s.created_at, s.updated_at
from subscriptions s
join plans p on p.tenant_id = s.tenant_id and p.id = s.plan_id
on conflict (tenant_id, source_subscription_id) do nothing;

insert into customer_service_recurrence (
  customer_service_id, tenant_id, current_period_start, renewal_at, auto_renew,
  renewal_alert_days, created_at, updated_at
)
select s.id, s.tenant_id, s.current_period_start, s.renewal_at, s.renewal_at is not null,
  s.renewal_alert_days, s.created_at, s.updated_at
from subscriptions s
join customer_services cs on cs.tenant_id = s.tenant_id and cs.id = s.id
where cs.commercial_model in ('subscription', 'maintenance')
on conflict (tenant_id, customer_service_id) do nothing;

insert into customer_service_events (
  id, tenant_id, customer_service_id, actor_user_id, type, effective_at,
  previous_plan_id, new_plan_id, previous_price_id, new_price_id, metadata,
  source_subscription_event_id, created_at
)
select id, tenant_id, subscription_id, actor_user_id, type, effective_at,
  previous_plan_id, new_plan_id, previous_price_id, new_price_id, metadata, id, created_at
from subscription_events
on conflict (tenant_id, source_subscription_event_id) do nothing;
