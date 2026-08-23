-- Phase 7.3: the length that kept a whole module from ever storing a reading.
-- Specification: docs/specifications/connector-onboarding.md
--
-- `0030` capped `job_id` at 120 characters. That was a guess, and the value is not ours to guess
-- about: BullMQ composes it, and for a repeatable job it is
-- `repeat:<scheduler id>:<timestamp>`, where our own scheduler id is already
-- `connector:<tenant uuid>:<instance uuid>:<operation>`. Two UUIDs, four prefixes and a
-- millisecond stamp come to 104 characters before the operation name is added, so the cap was in
-- practice a limit on how long an operation may be called -- and nothing said so anywhere.
--
-- It came due with the infrastructure connector. `pull_workflows` (119) and `pull_executions`
-- (120) fit; `pull_probe_state` (121), `pull_host_metrics` (122) and `pull_container_state` (125)
-- do not. Every Prometheus pass failed the insert in `startRun` with a check violation, which
-- `mapConstraint` reports as INVALID_INPUT -- and it failed *before* the run row existed, so
-- there was no run to finish, no health to record and no operation state to write. The screen
-- showed "never checked, never run" on a connector that had been trying every five minutes for
-- days. A module that cannot store a reading, failing in the one way that leaves no trace.
--
-- 200 rather than a slightly larger guess: it is the length the record store already allows for
-- an `external_id`, so a value that arrives from outside is capped the same way everywhere, and
-- it leaves 96 characters for an operation name that today needs 20.
--
-- Widening a check constraint accepts every row that was already valid, so this applies to a
-- running deployment with nothing to back out and nothing to rewrite.

alter table connector_sync_runs drop constraint connector_sync_runs_job_id_check;

alter table connector_sync_runs
  add constraint connector_sync_runs_job_id_check
  check (length(job_id) between 1 and 200);
