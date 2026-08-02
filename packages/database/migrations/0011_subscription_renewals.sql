alter table subscription_events drop constraint subscription_events_type_check;
alter table subscription_events add constraint subscription_events_type_check
  check (type in ('created', 'paused', 'resumed', 'canceled', 'plan_changed', 'renewed'));
