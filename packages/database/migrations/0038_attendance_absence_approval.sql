-- 0037 is reserved for the infrastructure host inventory described in current-state.md.
-- Existing absences were effective immediately, so preserve that meaning during the expansion.
alter table attendance_absences
  add column status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  add column approved_by_membership_id uuid,
  add column approved_at timestamptz,
  add constraint attendance_absences_approved_by_fk
    foreign key (tenant_id, approved_by_membership_id)
    references memberships(tenant_id, id) on delete restrict;

update attendance_absences
set approved_at = created_at
where status = 'approved';

alter table attendance_absences
  add constraint attendance_absences_approval_pair check (
    (status = 'pending' and approved_by_membership_id is null and approved_at is null)
    or (status in ('approved', 'rejected') and approved_at is not null)
  );

alter table attendance_absences alter column status set default 'pending';

create index attendance_absences_pending_idx
  on attendance_absences (tenant_id, start_date)
  where status = 'pending';
