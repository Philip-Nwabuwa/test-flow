-- ============================================================================
-- RPC Functions for Supabase PostgREST access
-- Run this in the Lovable SQL Editor after 001_automation_foundation.sql
-- ============================================================================

-- 1. Resolve auth context (replaces the multi-join in auth.ts)
create or replace function rpc_resolve_auth_context(p_user_id uuid)
returns table (
  user_id uuid,
  email text,
  space_ids uuid[],
  project_ids uuid[],
  roles text[]
)
language sql
security definer
stable
as $$
  select
    p.id as user_id,
    p.email,
    array_remove(array_agg(distinct sm.space_id), null) as space_ids,
    array_remove(array_agg(distinct pr.id), null) as project_ids,
    array_remove(array_agg(distinct ur.role), null) as roles
  from profiles p
  left join space_members sm on sm.user_id = p.id
  left join projects pr on pr.space_id = sm.space_id
  left join user_roles ur on ur.user_id = p.id
  where p.id = p_user_id
  group by p.id, p.email;
$$;

-- 2. Create flow atomically (test_flows + test_cases + test_steps)
create or replace function rpc_create_flow(
  p_flow_id uuid,
  p_project_id uuid,
  p_name text,
  p_target_url text,
  p_flow_type text,
  p_test_case_id uuid,
  p_intent text,
  p_draft_payload jsonb,
  p_steps jsonb
)
returns void
language plpgsql
security definer
as $$
declare
  step jsonb;
begin
  insert into test_flows (id, project_id, name, status, target_url, flow_type)
  values (p_flow_id, p_project_id, p_name, 'draft', p_target_url, coalesce(p_flow_type, 'user'));

  insert into test_cases (
    id, flow_id, project_id, title, intent, execution_mode,
    health_status, total_runs, target_url, draft_payload
  )
  values (
    p_test_case_id, p_flow_id, p_project_id, p_name, p_intent, 'playwright',
    'untested', 0, p_target_url, p_draft_payload
  );

  for step in select * from jsonb_array_elements(p_steps)
  loop
    insert into test_steps (
      id, test_case_id, sort_order, action_type, semantic_label,
      selector, value, expected_outcome, timeout_ms
    )
    values (
      gen_random_uuid(),
      p_test_case_id,
      (step->>'sortOrder')::int,
      step->>'actionType',
      step->>'semanticLabel',
      step->>'selector',
      step->>'value',
      step->>'expectedOutcome',
      (step->>'timeoutMs')::int
    );
  end loop;
end;
$$;

-- 3. Publish flow atomically (flow_versions + update test_cases + test_flows)
create or replace function rpc_publish_flow(
  p_flow_id uuid,
  p_test_case_id uuid,
  p_version_id uuid,
  p_version_number int,
  p_definition jsonb,
  p_created_by uuid
)
returns void
language plpgsql
security definer
as $$
begin
  insert into flow_versions (id, flow_id, test_case_id, version_number, definition, created_by)
  values (p_version_id, p_flow_id, p_test_case_id, p_version_number, p_definition, p_created_by);

  update test_cases
  set published_version_id = p_version_id, updated_at = now()
  where id = p_test_case_id;

  update test_flows
  set status = 'active', updated_at = now()
  where id = p_flow_id;
end;
$$;

-- 4. Dashboard summary
create or replace function rpc_dashboard_summary(p_project_ids uuid[])
returns table (
  "all" int,
  failed int,
  passed int,
  "notRun" int,
  "totalRuns" int,
  "recentRuns" int
)
language sql
security definer
stable
as $$
  with flow_counts as (
    select
      count(*)::int as all_count,
      count(*) filter (where status = 'failed')::int as failed_count,
      count(*) filter (where status = 'passed')::int as passed_count,
      count(*) filter (where coalesce(run_count, 0) = 0)::int as not_run_count
    from test_flows
    where project_id = any(p_project_ids)
  ),
  run_counts as (
    select
      count(*)::int as total_runs,
      count(*) filter (where created_at >= now() - interval '7 days')::int as recent_runs
    from test_runs_v2
    where project_id = any(p_project_ids)
  )
  select
    flow_counts.all_count as "all",
    flow_counts.failed_count as failed,
    flow_counts.passed_count as passed,
    flow_counts.not_run_count as "notRun",
    run_counts.total_runs as "totalRuns",
    run_counts.recent_runs as "recentRuns"
  from flow_counts, run_counts;
$$;

-- 5. Dashboard problems
create or replace function rpc_dashboard_problems(p_project_ids uuid[])
returns table (
  "flowId" uuid,
  "testCaseId" uuid,
  "flowName" text,
  "failureCount" int,
  "latestError" text,
  "latestFailedAt" text
)
language sql
security definer
stable
as $$
  select
    tr.flow_id as "flowId",
    tr.test_case_id as "testCaseId",
    tf.name as "flowName",
    count(*)::int as "failureCount",
    max(coalesce(tr.error_message, 'Run failed')) as "latestError",
    max(tr.created_at)::text as "latestFailedAt"
  from test_runs_v2 tr
  join test_flows tf on tf.id = tr.flow_id
  where tr.project_id = any(p_project_ids) and tr.status = 'failed'
  group by tr.flow_id, tr.test_case_id, tf.name
  order by max(tr.created_at) desc
  limit 10;
$$;

-- 6. Complete run (success path - updates 4 tables + replaces step results)
create or replace function rpc_complete_run(
  p_run_id uuid,
  p_flow_id uuid,
  p_test_case_id uuid,
  p_status text,
  p_error_message text,
  p_step_results jsonb,
  p_screenshot_path text,
  p_hydrated_steps jsonb
)
returns void
language plpgsql
security definer
as $$
declare
  step jsonb;
begin
  update test_runs_v2
  set
    status = p_status,
    error_message = p_error_message,
    finished_at = now(),
    duration_ms = extract(epoch from (now() - started_at)) * 1000,
    step_results = p_step_results,
    screenshot_path = p_screenshot_path,
    updated_at = now()
  where id = p_run_id;

  update execution_queue
  set
    status = p_status,
    completed_at = now(),
    error_message = p_error_message,
    updated_at = now()
  where run_id = p_run_id;

  update test_flows
  set
    run_count = coalesce(run_count, 0) + 1,
    status = case when p_status = 'passed' then 'passed' else 'failed' end,
    last_run_at = now(),
    last_passed_at = case when p_status = 'passed' then now() else last_passed_at end,
    last_failed_at = case when p_status = 'failed' then now() else last_failed_at end,
    updated_at = now()
  where id = p_flow_id;

  update test_cases
  set
    total_runs = coalesce(total_runs, 0) + 1,
    health_status = case when p_status = 'passed' then 'healthy' else 'failing' end,
    updated_at = now()
  where id = p_test_case_id;

  delete from run_step_results where run_id = p_run_id;

  if p_hydrated_steps is not null then
    for step in select * from jsonb_array_elements(p_hydrated_steps)
    loop
      insert into run_step_results (
        id, run_id, step_order, action_type, semantic_label,
        status, duration_ms, error_message, screenshot_path, output
      )
      values (
        gen_random_uuid(),
        p_run_id,
        (step->>'stepOrder')::int,
        step->>'actionType',
        step->>'semanticLabel',
        step->>'status',
        coalesce((step->>'durationMs')::int, 0),
        step->>'errorMessage',
        step->>'screenshotPath',
        (step->'output')::jsonb
      );
    end loop;
  end if;
end;
$$;

-- 7. Fail run (error path - updates 3 tables)
create or replace function rpc_fail_run(
  p_run_id uuid,
  p_flow_id uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
as $$
begin
  update test_runs_v2
  set
    status = 'failed',
    error_message = p_error_message,
    finished_at = now(),
    duration_ms = extract(epoch from (now() - started_at)) * 1000,
    updated_at = now()
  where id = p_run_id;

  update execution_queue
  set
    status = 'failed',
    completed_at = now(),
    error_message = p_error_message,
    retry_count = retry_count + 1,
    updated_at = now()
  where run_id = p_run_id;

  update test_flows
  set
    status = 'failed',
    run_count = case when last_run_at is null then coalesce(run_count, 0) + 1 else run_count end,
    last_run_at = coalesce(last_run_at, now()),
    last_failed_at = now(),
    updated_at = now()
  where id = p_flow_id;
end;
$$;

-- 8. Create scheduled run atomically (test_runs_v2 + execution_queue)
create or replace function rpc_create_scheduled_run(
  p_run_id uuid,
  p_flow_id uuid,
  p_test_case_id uuid,
  p_project_id uuid,
  p_environment text,
  p_version_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  insert into test_runs_v2 (
    id, flow_id, test_case_id, project_id, status,
    trigger_type, environment, version_id, step_results
  )
  values (
    p_run_id, p_flow_id, p_test_case_id, p_project_id, 'queued',
    'scheduled', p_environment, p_version_id, '[]'::jsonb
  );

  insert into execution_queue (
    id, run_id, flow_id, test_case_id, project_id, status,
    trigger_type, environment, retry_count, max_retries, payload
  )
  values (
    gen_random_uuid(), p_run_id, p_flow_id, p_test_case_id, p_project_id, 'pending',
    'scheduled', p_environment, 0, 1, p_payload
  );
end;
$$;

-- 9. Mark run started (updates 2 tables)
create or replace function rpc_mark_run_started(p_run_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update test_runs_v2
  set status = 'running', started_at = now(), updated_at = now()
  where id = p_run_id;

  update execution_queue
  set status = 'running', started_at = now(), updated_at = now()
  where run_id = p_run_id;
end;
$$;

-- 10. Load execution context (used by worker edge function)
create or replace function rpc_load_execution_context(
  p_flow_id uuid,
  p_test_case_id uuid
)
returns table (
  flow_id uuid,
  test_case_id uuid,
  project_id uuid,
  published_version_id uuid,
  draft_payload jsonb,
  intent text,
  target_url text,
  execution_mode text,
  project_base_url text
)
language sql
security definer
stable
as $$
  select
    tf.id as flow_id,
    tc.id as test_case_id,
    tf.project_id,
    tc.published_version_id,
    tc.draft_payload,
    tc.intent,
    tc.target_url,
    tc.execution_mode,
    p.base_url as project_base_url
  from test_flows tf
  join test_cases tc on tc.flow_id = tf.id
  join projects p on p.id = tf.project_id
  where tf.id = p_flow_id and tc.id = p_test_case_id;
$$;

-- 11. Get flow schedules with project_id (for reconciliation)
create or replace function rpc_get_schedules_with_project()
returns table (
  id uuid,
  "flowId" uuid,
  "testCaseId" uuid,
  frequency text,
  timezone text,
  minute int,
  hour int,
  "everyHours" int,
  enabled boolean,
  "retryPolicy" jsonb,
  environment text,
  "nextRunAt" timestamptz,
  "createdAt" timestamptz,
  "updatedAt" timestamptz,
  project_id uuid
)
language sql
security definer
stable
as $$
  select
    fs.id,
    fs.flow_id as "flowId",
    fs.test_case_id as "testCaseId",
    fs.frequency,
    fs.timezone,
    fs.minute,
    fs.hour,
    fs.every_hours as "everyHours",
    fs.enabled,
    fs.retry_policy as "retryPolicy",
    fs.environment,
    fs.next_run_at as "nextRunAt",
    fs.created_at as "createdAt",
    fs.updated_at as "updatedAt",
    tf.project_id
  from flow_schedules fs
  join test_flows tf on tf.id = fs.flow_id;
$$;

-- 12. Check for overlapping runs (used by scheduled run creation)
create or replace function rpc_check_overlapping_runs(
  p_flow_id uuid,
  p_test_case_id uuid
)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from test_runs_v2
    where flow_id = p_flow_id
      and test_case_id = p_test_case_id
      and status in ('queued', 'pending', 'running')
    limit 1
  );
$$;

-- 13. Resolve flow variables (used by worker)
create or replace function rpc_resolve_variables(p_project_id uuid, p_flow_id uuid)
returns table (name text, cipher_text text)
language sql
security definer
stable
as $$
  select name, cipher_text
  from flow_variables
  where project_id = p_project_id and (flow_id = p_flow_id or flow_id is null);
$$;
