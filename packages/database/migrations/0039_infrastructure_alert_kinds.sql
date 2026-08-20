-- Phase 7.2, increment B3: the three infrastructure rules.
-- Specification: docs/specifications/infrastructure.md
--
-- `0035` constrained `kind` to `workflow_failed` and said in the same breath why the list is a
-- constraint at all: a rule of a kind no code evaluates sits in the table looking like coverage
-- and never fires. It also said phase 7.2 would add its three by altering this check, and this is
-- that alteration. The engine gained the three cases in the same commit, so the list here and the
-- switch in `packages/domain/src/infrastructure.ts` say the same thing at the same time.

alter table infra_alert_rules drop constraint infra_alert_rules_kind_check;

alter table infra_alert_rules
  add constraint infra_alert_rules_kind_check
  check (kind in ('workflow_failed', 'service_down', 'certificate_expiring', 'backup_stale'));

-- What a target may name, now that not every kind can be pointed at one thing.
--
-- The three new kinds read one instance's whole declared inventory and produce a verdict per
-- service, per probed certificate or per backup job. There is nothing left for `target_id` to
-- name, and a rule that named one would look narrower than it is on the screen that draws it.
--
-- It is a constraint and not only a check in the service because a patch never carries the kind:
-- `UpdateAlertRuleInput` omits it deliberately, so the only thing that knows what a rule is when
-- somebody changes its target is the row itself. The service refuses the same combination at
-- creation, where it can answer with a code instead of a violation.
--
-- Watching one service is a change of one line here the day somebody wants it, not a redesign.
alter table infra_alert_rules
  add constraint infra_alert_rules_target_kind_check
  check (kind = 'workflow_failed' or target_type = 'instance');
