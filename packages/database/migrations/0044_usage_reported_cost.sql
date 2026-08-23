-- Phase 8 U3: retain provider-reported cost as immutable event evidence.
-- Specification: docs/specifications/communications-usage-costs.md

alter table usage_events
  add column reported_cost_minor bigint,
  add column reported_currency char(3),
  add check ((reported_cost_minor is null) = (reported_currency is null)),
  add check (reported_cost_minor is null or reported_cost_minor >= 0),
  add check (reported_currency is null or reported_currency = upper(reported_currency));

