alter table leads
  add column import_reference text
  check (import_reference is null or length(import_reference) between 1 and 120);

create unique index leads_tenant_import_reference_unique
  on leads (tenant_id, import_reference)
  where import_reference is not null;
