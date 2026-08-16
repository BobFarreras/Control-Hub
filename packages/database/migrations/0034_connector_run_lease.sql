-- Phase 7.1, increment A3: one run at a time per operation.
-- Specification: docs/specifications/infrastructure.md (gap G2)
--
-- Until now nothing stopped a second pass of the same operation starting while the first was
-- still going. That was invisible while the only scheduled work was a health check that answers
-- in milliseconds. It stops being invisible the moment an operation polls a provider every five
-- minutes and that provider starts taking twenty: the overlapping runs accumulate, and four of
-- them are the whole concurrency of the connectors queue. One slow instance would then be
-- starving every other tenant, which is exactly what the separate queue exists to prevent.
--
-- The ceiling is enforced here and not by a read followed by a write. Two workers would both
-- read no running row, both insert, and both be right about what they saw.

-- Any row still marked `running` belongs to a process that is being replaced by this deploy, so
-- the newest one per operation is presumed genuinely in flight and the rest are abandoned. Doing
-- this the other way round -- abandoning all of them -- would relabel a run that is about to
-- finish, and `finishRun` only writes over a row that is still `running`, so the real outcome
-- would be lost.
with survivors as (
  select distinct on (tenant_id, instance_id, operation) id
  from connector_sync_runs
  where status = 'running'
  order by tenant_id, instance_id, operation, started_at desc, id
)
update connector_sync_runs
set status = 'dead_letter', finished_at = now(), error_code = 'RUN_ABANDONED'
where status = 'running' and id not in (select id from survivors);

create unique index connector_sync_runs_one_running_idx
  on connector_sync_runs (tenant_id, instance_id, operation)
  where status = 'running';
