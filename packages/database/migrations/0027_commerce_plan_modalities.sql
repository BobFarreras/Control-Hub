alter table plans
  add column commercial_model text not null default 'subscription'
  check (commercial_model in ('subscription', 'maintenance', 'one_time', 'project_service'));

alter table plan_prices drop constraint plan_prices_billing_interval_check;
alter table plan_prices add constraint plan_prices_billing_interval_check
  check (billing_interval in ('free', 'one_time', 'monthly', 'quarterly', 'semiannual', 'annual'));

create function enforce_plan_price_commercial_model() returns trigger
language plpgsql as $$
declare
  model text;
begin
  select commercial_model into model
  from plans
  where tenant_id = new.tenant_id and id = new.plan_id;

  if model in ('one_time', 'project_service') and new.billing_interval <> 'one_time' then
    raise exception 'One-time and project services require a one-time price' using errcode = '23514';
  end if;
  if model in ('subscription', 'maintenance') and new.billing_interval = 'one_time' then
    raise exception 'Recurring plans cannot use a one-time price' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_plan_price_commercial_model
before insert on plan_prices
for each row execute function enforce_plan_price_commercial_model();

create function enforce_plan_commercial_model_change() returns trigger
language plpgsql as $$
begin
  if new.commercial_model in ('one_time', 'project_service') and exists (
    select 1 from plan_prices where tenant_id = new.tenant_id and plan_id = new.id and billing_interval <> 'one_time'
  ) then
    raise exception 'One-time and project services cannot keep recurring prices' using errcode = '23514';
  end if;
  if new.commercial_model in ('subscription', 'maintenance') and exists (
    select 1 from plan_prices where tenant_id = new.tenant_id and plan_id = new.id and billing_interval = 'one_time'
  ) then
    raise exception 'Recurring plans cannot keep one-time prices' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_plan_commercial_model_change
before update of commercial_model on plans
for each row when (old.commercial_model is distinct from new.commercial_model)
execute function enforce_plan_commercial_model_change();
