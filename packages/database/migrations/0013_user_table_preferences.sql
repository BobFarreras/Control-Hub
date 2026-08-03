create table user_table_preferences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  table_id text not null check (table_id ~ '^[a-z][a-z0-9.-]{2,79}$'),
  column_order jsonb not null default '[]'::jsonb check (jsonb_typeof(column_order) = 'array'),
  hidden_columns jsonb not null default '[]'::jsonb check (jsonb_typeof(hidden_columns) = 'array'),
  column_widths jsonb not null default '{}'::jsonb check (jsonb_typeof(column_widths) = 'object'),
  page_size integer not null default 25 check (page_size in (10, 25, 50, 100)),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id, table_id)
);

alter table user_table_preferences enable row level security;
alter table user_table_preferences force row level security;
create policy user_table_preferences_isolation on user_table_preferences
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on user_table_preferences to control_hub_app;
