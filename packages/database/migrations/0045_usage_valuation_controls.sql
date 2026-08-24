-- Phase 8 U4: reproducible valuation lines, FX annulment and database RBAC.
-- Specification: docs/specifications/communications-usage-costs.md

insert into permissions (code, description) values
  ('usage:manage', 'Publish usage rates and exchange rates'),
  ('budgets:manage', 'Manage usage budgets')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_code)
select id, 'usage:manage' from roles where code = 'owner'
on conflict do nothing;
insert into role_permissions (role_id, permission_code)
select id, 'budgets:manage' from roles where code in ('owner', 'administrator')
on conflict do nothing;

-- A header describes one valuation pass. Lines retain every rate and FX decision when an event
-- has several units, which a single rate_id on the header cannot represent.
create table usage_valuation_lines (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  valuation_id uuid not null,
  quantity_id uuid,
  adjustment_quantity_id uuid,
  unit text not null check (unit in ('input_token', 'output_token', 'cached_input_token', 'request', 'image', 'audio_second', 'compute_millisecond', 'byte', 'provider_unit')),
  qualifier text not null check (qualifier in ('total', 'input', 'output', 'cached', 'uncached')),
  quantity bigint not null,
  original_cost_minor bigint,
  original_currency char(3),
  report_cost_minor bigint,
  report_currency char(3) not null check (report_currency = upper(report_currency)),
  rate_id uuid,
  exchange_rate_id uuid,
  state text not null check (state in ('priced', 'unpriced', 'partial')),
  missing text check (missing in ('rate', 'exchange_rate')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (num_nonnulls(quantity_id, adjustment_quantity_id) = 1),
  check ((original_cost_minor is null) = (original_currency is null)),
  check (state <> 'priced' or report_cost_minor is not null),
  check (state <> 'unpriced' or original_cost_minor is null),
  foreign key (tenant_id, valuation_id) references usage_valuations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, quantity_id) references usage_event_quantities(tenant_id, id) on delete restrict,
  foreign key (tenant_id, adjustment_quantity_id) references usage_adjustment_quantities(tenant_id, id) on delete restrict,
  foreign key (tenant_id, rate_id) references usage_rates(tenant_id, id) on delete restrict,
  foreign key (tenant_id, exchange_rate_id) references exchange_rates(tenant_id, id) on delete restrict
);
create index usage_valuation_lines_valuation_idx on usage_valuation_lines (tenant_id, valuation_id);
create index usage_valuation_lines_quantity_idx on usage_valuation_lines (tenant_id, quantity_id)
  where quantity_id is not null;
create index usage_valuation_lines_adjustment_quantity_idx on usage_valuation_lines (tenant_id, adjustment_quantity_id)
  where adjustment_quantity_id is not null;
create index usage_valuation_lines_rate_idx on usage_valuation_lines (tenant_id, rate_id)
  where rate_id is not null;
create index usage_valuation_lines_exchange_rate_idx on usage_valuation_lines (tenant_id, exchange_rate_id)
  where exchange_rate_id is not null;

create trigger usage_valuation_lines_append_only before update or delete on usage_valuation_lines
for each row execute function reject_usage_evidence_mutation();
alter table usage_valuation_lines enable row level security;
alter table usage_valuation_lines force row level security;
create policy usage_valuation_lines_isolation on usage_valuation_lines
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert on usage_valuation_lines to control_hub_app;

-- The original check accidentally forced partial FX valuations to invent a report amount.
do $$
declare constraint_name text;
begin
  select conname into constraint_name from pg_constraint
  where conrelid = 'usage_valuations'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%state = ''unpriced''%report_cost_minor%';
  if constraint_name is not null then
    execute format('alter table usage_valuations drop constraint %I', constraint_name);
  end if;
end;
$$;
alter table usage_valuations
  add check (state <> 'priced' or report_cost_minor is not null),
  add check (state <> 'unpriced' or report_cost_minor is null);

alter table exchange_rates
  add column annulled_at timestamptz,
  add column annulled_by_membership_id uuid,
  add check ((annulled_at is null) = (annulled_by_membership_id is null)),
  add foreign key (tenant_id, annulled_by_membership_id) references memberships(tenant_id, id) on delete restrict;
create index exchange_rates_annulled_by_idx on exchange_rates (tenant_id, annulled_by_membership_id)
  where annulled_by_membership_id is not null;

drop trigger exchange_rates_append_only on exchange_rates;
create function enforce_exchange_rate_annulment() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE'
    or old.annulled_at is not null
    or new.annulled_at is null
    or new.annulled_by_membership_id is null
    or row(new.id, new.tenant_id, new.base_currency, new.quote_currency, new.rate_day,
      new.numerator, new.denominator, new.source, new.created_at)
      is distinct from
      row(old.id, old.tenant_id, old.base_currency, old.quote_currency, old.rate_day,
        old.numerator, old.denominator, old.source, old.created_at)
  then
    raise exception 'exchange rates may only be annulled once';
  end if;
  return new;
end;
$$;
create trigger exchange_rates_annul_only before update or delete on exchange_rates
for each row execute function enforce_exchange_rate_annulment();
grant update (annulled_at, annulled_by_membership_id) on exchange_rates to control_hub_app;
