-- Phase 7.3 (C4): somewhere to put a backup.
-- Specification: docs/specifications/connector-onboarding.md, "C4 -- El selector de serveis"
--
-- `infra_services.kind` accepted container, http, database and automation. A backup is none of
-- the four, and the Prometheus connector has been storing `backup:<job>` readings since the
-- module shipped: the textfile collector publishes `control_hub_backup_last_success_seconds`,
-- the domain maps the `backup:` prefix to an operation, and `backup_stale` is one of the alert
-- rules. The only thing missing was a kind to declare it under.
--
-- Reusing `automation` was the alternative. It would have worked -- the matching is on
-- `match_key`, not on the kind -- and it would have left every screen calling the nightly copy
-- of a database an automation. The kind exists to be read by a person; a kind that lies is worth
-- less than no kind at all.
--
-- Widening a check constraint accepts every row that was already valid, so this applies to a
-- running deployment with nothing to back out and nothing to rewrite.

alter table infra_services drop constraint infra_services_kind_check;

alter table infra_services
  add constraint infra_services_kind_check
  check (kind in ('container', 'http', 'database', 'automation', 'backup'));
