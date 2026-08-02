insert into permissions (code, description) values
  ('customers:read', 'Read customers and customer activity'),
  ('leads:read', 'Read leads and lead activity')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code from roles r
join permissions p on p.code in ('customers:read', 'leads:read')
where r.code in ('owner', 'administrator', 'technical')
on conflict do nothing;

alter table memberships add constraint memberships_tenant_id_id_unique unique (tenant_id, id);

create table leads (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(name) between 2 and 160),
  normalized_name text not null,
  company_name text check (company_name is null or length(company_name) <= 160),
  email text,
  normalized_email text,
  phone text,
  normalized_phone text,
  source text not null default 'manual' check (length(source) between 1 and 80),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  owner_membership_id uuid,
  converted_customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, normalized_email),
  unique (tenant_id, normalized_phone),
  foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id) on delete set null (owner_membership_id)
);

create table customers (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  display_name text not null check (length(display_name) between 2 and 160),
  normalized_name text not null,
  legal_name text check (legal_name is null or length(legal_name) <= 200),
  tax_id text,
  billing_email text,
  normalized_billing_email text,
  phone text,
  normalized_phone text,
  website text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  owner_membership_id uuid,
  created_from_lead_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, normalized_billing_email),
  unique (tenant_id, normalized_phone),
  unique (tenant_id, created_from_lead_id),
  foreign key (tenant_id, owner_membership_id) references memberships(tenant_id, id) on delete set null (owner_membership_id),
  foreign key (tenant_id, created_from_lead_id) references leads(tenant_id, id) on delete restrict
);

alter table leads add foreign key (tenant_id, converted_customer_id) references customers(tenant_id, id) on delete restrict;

create table contacts (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  name text not null check (length(name) between 2 and 160),
  role text,
  email text,
  normalized_email text,
  phone text,
  normalized_phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, normalized_email),
  unique (tenant_id, normalized_phone),
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete cascade
);

create table crm_notes (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid,
  customer_id uuid,
  body text not null check (length(body) between 1 and 10000),
  author_user_id text references "user"(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((lead_id is not null)::int + (customer_id is not null)::int = 1),
  foreign key (tenant_id, lead_id) references leads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete cascade
);

create table crm_tasks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid,
  customer_id uuid,
  title text not null check (length(title) between 1 and 240),
  due_at timestamptz,
  completed_at timestamptz,
  assignee_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lead_id is not null)::int + (customer_id is not null)::int = 1),
  foreign key (tenant_id, lead_id) references leads(tenant_id, id) on delete cascade,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignee_membership_id) references memberships(tenant_id, id) on delete set null (assignee_membership_id)
);

create table crm_activity (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  lead_id uuid,
  customer_id uuid,
  actor_user_id text references "user"(id) on delete set null,
  type text not null check (length(type) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check ((lead_id is not null)::int + (customer_id is not null)::int = 1),
  foreign key (tenant_id, lead_id) references leads(tenant_id, id) on delete restrict,
  foreign key (tenant_id, customer_id) references customers(tenant_id, id) on delete restrict
);

create index leads_tenant_status_updated_idx on leads (tenant_id, status, updated_at desc, id);
create index leads_tenant_name_idx on leads (tenant_id, normalized_name);
create index customers_tenant_status_updated_idx on customers (tenant_id, status, updated_at desc, id);
create index customers_tenant_name_idx on customers (tenant_id, normalized_name);
create index contacts_customer_idx on contacts (tenant_id, customer_id, created_at);
create index crm_notes_entity_idx on crm_notes (tenant_id, customer_id, lead_id, created_at desc);
create index crm_tasks_due_idx on crm_tasks (tenant_id, completed_at, due_at);
create index crm_activity_entity_idx on crm_activity (tenant_id, customer_id, lead_id, occurred_at desc);

create function reject_crm_activity_mutation() returns trigger language plpgsql as $$
begin raise exception 'crm_activity is append-only'; end;
$$;
create trigger crm_activity_append_only before update or delete on crm_activity
for each row execute function reject_crm_activity_mutation();

do $$ declare table_name text; begin
  foreach table_name in array array['leads','customers','contacts','crm_notes','crm_tasks','crm_activity'] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('alter table %I force row level security', table_name);
    execute format('create policy %I on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_isolation', table_name);
    execute format('grant select, insert, update, delete on %I to control_hub_app', table_name);
  end loop;
end $$;
revoke update, delete on crm_activity from control_hub_app;
