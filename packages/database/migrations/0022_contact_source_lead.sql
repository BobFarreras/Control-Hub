alter table contacts add column source_lead_id uuid;

alter table contacts add constraint contacts_source_lead_fk
  foreign key (tenant_id, source_lead_id) references leads (tenant_id, id) on delete restrict;

create unique index contacts_tenant_source_lead_unique
  on contacts (tenant_id, source_lead_id)
  where source_lead_id is not null;
