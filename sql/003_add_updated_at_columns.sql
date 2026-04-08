-- Adds missing `updated_at` columns referenced by the run-lifecycle RPCs
-- in 002_rpc_functions.sql (rpc_mark_run_started, rpc_fail_run,
-- rpc_complete_run). Without these columns the RPCs fail with:
--   column "updated_at" of relation "<table>" does not exist
--
-- Idempotent: safe to re-run.

alter table if exists test_runs_v2
  add column if not exists updated_at timestamptz not null default now();

alter table if exists execution_queue
  add column if not exists updated_at timestamptz not null default now();

-- test_flows and test_cases are pre-existing Lovable tables that likely
-- already have updated_at, but IF NOT EXISTS makes this a no-op when they do.
alter table if exists test_flows
  add column if not exists updated_at timestamptz not null default now();

alter table if exists test_cases
  add column if not exists updated_at timestamptz not null default now();
