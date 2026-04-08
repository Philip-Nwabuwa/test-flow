create extension if not exists pgcrypto;

alter table if exists test_flows
  add column if not exists last_run_at timestamptz,
  add column if not exists last_passed_at timestamptz,
  add column if not exists last_failed_at timestamptz,
  add column if not exists run_count integer not null default 0,
  add column if not exists target_url text,
  add column if not exists flow_type text default 'user';

alter table if exists test_cases
  add column if not exists flow_id uuid,
  add column if not exists draft_payload jsonb,
  add column if not exists published_version_id uuid,
  add column if not exists project_id uuid,
  add column if not exists execution_mode text,
  add column if not exists health_status text default 'untested',
  add column if not exists total_runs integer not null default 0;

update test_cases tc
set flow_id = tf.id
from test_flows tf
where tc.flow_id is null
  and tf.name = tc.title;

create index if not exists idx_test_cases_flow_id on test_cases(flow_id);
create index if not exists idx_test_flows_project_id on test_flows(project_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'test_cases_flow_id_fkey'
  ) then
    alter table test_cases
      add constraint test_cases_flow_id_fkey
      foreign key (flow_id) references test_flows(id) on delete cascade;
  end if;
end $$;

create table if not exists flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references test_flows(id) on delete cascade,
  test_case_id uuid not null references test_cases(id) on delete cascade,
  version_number integer not null,
  definition jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(flow_id, version_number)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'test_cases_published_version_id_fkey'
  ) then
    alter table test_cases
      add constraint test_cases_published_version_id_fkey
      foreign key (published_version_id) references flow_versions(id) on delete set null;
  end if;
end $$;

create table if not exists flow_schedules (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references test_flows(id) on delete cascade,
  test_case_id uuid not null references test_cases(id) on delete cascade,
  frequency text not null check (frequency in ('hourly', 'daily')),
  timezone text not null,
  minute integer not null check (minute between 0 and 59),
  hour integer check (hour between 0 and 23),
  every_hours integer check (every_hours between 1 and 24),
  enabled boolean not null default true,
  retry_policy jsonb not null default '{"attempts":1,"backoffType":"fixed","backoffMs":0}'::jsonb,
  environment text,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_flow_schedules_flow_id on flow_schedules(flow_id);

create table if not exists flow_variables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  flow_id uuid references test_flows(id) on delete cascade,
  name text not null,
  cipher_text text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, flow_id, name)
);

create table if not exists run_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references test_runs_v2(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('screenshot', 'trace', 'result_json')),
  storage_path text not null,
  content_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists run_step_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references test_runs_v2(id) on delete cascade,
  step_order integer not null,
  action_type text not null,
  semantic_label text not null,
  status text not null,
  duration_ms integer not null default 0,
  error_message text,
  screenshot_path text,
  output jsonb,
  created_at timestamptz not null default now()
);

alter table if exists test_runs_v2
  add column if not exists flow_id uuid,
  add column if not exists project_id uuid,
  add column if not exists trigger_type text default 'manual',
  add column if not exists environment text,
  add column if not exists version_id uuid,
  add column if not exists retry_of_run_id uuid,
  add column if not exists error_message text,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists duration_ms integer,
  add column if not exists step_results jsonb not null default '[]'::jsonb,
  add column if not exists screenshot_path text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_test_runs_v2_flow_id on test_runs_v2(flow_id);
create index if not exists idx_test_runs_v2_project_id on test_runs_v2(project_id);
create index if not exists idx_test_runs_v2_status_created_at on test_runs_v2(status, created_at desc);

alter table if exists execution_queue
  add column if not exists run_id uuid,
  add column if not exists flow_id uuid,
  add column if not exists project_id uuid,
  add column if not exists trigger_type text default 'manual',
  add column if not exists environment text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists max_retries integer not null default 1,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists error_message text,
  add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists idx_execution_queue_run_id on execution_queue(run_id);
create index if not exists idx_execution_queue_status on execution_queue(status);
