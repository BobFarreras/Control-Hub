-- Increment 7: operational ownership, contract dates and append-only history for company tools.
-- Specification: docs/specifications/commerce.md, decision COM-3.

alter table memberships
  add constraint memberships_tenant_id_id_key unique (tenant_id, id);

alter table company_subscriptions
  add column account_email text check (account_email is null or length(account_email) <= 320),
  add column owner_membership_id uuid,
  add column quantity integer not null default 1 check (quantity between 1 and 1000000),
  add column started_at timestamptz,
  add column trial_ends_at timestamptz,
  add column cancel_before_at timestamptz,
  add column canceled_at timestamptz,
  add column cost_center text check (cost_center is null or length(cost_center) <= 120),
  add column payment_method_label text check (payment_method_label is null or length(payment_method_label) <= 120),
  add column secret_manager_url text check (secret_manager_url is null or (length(secret_manager_url) <= 2048 and secret_manager_url ~* '^https://')),
  add foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id)
    on delete set null (owner_membership_id);

alter table company_subscriptions drop constraint company_subscriptions_status_check;
alter table company_subscriptions
  add constraint company_subscriptions_status_check check (status in ('active', 'trial', 'paused', 'canceled'));

update company_subscriptions
set canceled_at = updated_at
where status = 'canceled' and canceled_at is null;

alter table company_subscriptions
  add constraint company_subscriptions_canceled_at_check
  check ((status = 'canceled') = (canceled_at is not null));

alter table company_subscriptions
  drop constraint company_subscriptions_tenant_id_provider_service_name_key;

drop index company_subscriptions_renewal_idx;
create index company_subscriptions_renewal_idx on company_subscriptions (tenant_id, renewal_at)
  where status in ('active', 'trial', 'paused') and renewal_at is not null;

create table company_subscription_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  company_subscription_id uuid not null,
  actor_user_id text references "user"(id) on delete set null,
  type text not null check (
    type in ('created', 'updated', 'trial_started', 'activated', 'paused', 'resumed', 'canceled', 'renewal_changed')
  ),
  effective_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, company_subscription_id)
    references company_subscriptions(tenant_id, id) on delete restrict
);

create unique index company_subscription_events_initial_idx
  on company_subscription_events (tenant_id, company_subscription_id, type)
  where type = 'created';
create index company_subscription_events_history_idx
  on company_subscription_events (tenant_id, company_subscription_id, effective_at desc, created_at desc);
create index company_subscriptions_owner_status_idx
  on company_subscriptions (tenant_id, owner_membership_id, status);
create index company_subscriptions_duplicate_hint_idx
  on company_subscriptions (tenant_id, lower(provider), lower(service_name));
create index company_subscriptions_cancel_before_idx
  on company_subscriptions (tenant_id, cancel_before_at)
  where status in ('active', 'trial', 'paused') and cancel_before_at is not null;

create function enforce_company_subscription_status_transition() returns trigger language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if not (
    (old.status = 'trial' and new.status in ('active', 'canceled')) or
    (old.status = 'active' and new.status in ('paused', 'canceled')) or
    (old.status = 'paused' and new.status in ('active', 'canceled'))
  ) then
    raise exception 'invalid company subscription status transition' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger company_subscription_status_transition
before update of status on company_subscriptions
for each row execute function enforce_company_subscription_status_transition();

create function reject_company_subscription_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'company subscription events are append-only'; end;
$$;
create trigger company_subscription_events_append_only
before update or delete on company_subscription_events
for each row execute function reject_company_subscription_event_mutation();

alter table company_subscription_events enable row level security;
alter table company_subscription_events force row level security;
create policy company_subscription_events_isolation on company_subscription_events
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert on company_subscription_events to control_hub_app;

insert into company_subscription_events
  (id, tenant_id, company_subscription_id, actor_user_id, type, effective_at, metadata, created_at)
select gen_random_uuid(), tenant_id, id, null, 'created', created_at,
  jsonb_build_object('backfilled', true), created_at
from company_subscriptions
on conflict (tenant_id, company_subscription_id, type) where type = 'created' do nothing;
