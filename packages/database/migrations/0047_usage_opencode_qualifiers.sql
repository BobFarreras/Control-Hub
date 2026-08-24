-- OpenCode reports reasoning and cache writes separately. Keeping those categories distinct is
-- what lets a later valuation choose the right tariff instead of silently pricing them as normal
-- output or uncached input. This only broadens values accepted by the published Phase 8 tables.
alter table usage_event_quantities
  drop constraint usage_event_quantities_qualifier_check,
  add constraint usage_event_quantities_qualifier_check
    check (qualifier in ('total', 'input', 'output', 'cached', 'uncached', 'reasoning', 'cache_read', 'cache_write'));

alter table usage_adjustment_quantities
  drop constraint usage_adjustment_quantities_qualifier_check,
  add constraint usage_adjustment_quantities_qualifier_check
    check (qualifier in ('total', 'input', 'output', 'cached', 'uncached', 'reasoning', 'cache_read', 'cache_write'));

alter table usage_valuation_lines
  drop constraint usage_valuation_lines_qualifier_check,
  add constraint usage_valuation_lines_qualifier_check
    check (qualifier in ('total', 'input', 'output', 'cached', 'uncached', 'reasoning', 'cache_read', 'cache_write'));
