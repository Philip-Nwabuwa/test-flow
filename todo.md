# TODO: Website Automation Backend

## Completed
- Initialize workspace structure for `api`, `worker`, and shared packages
- Set up Bun, TypeScript, Express, BullMQ, Redis, Docker, Playwright, and env validation
- Configure Supabase JWT validation, Postgres access, and Storage client scaffolding
- Add structured logging and base error handling
- Add additive migration for `test_cases.flow_id` backfill plus `flow_versions`, `flow_schedules`, `run_artifacts`, and `flow_variables`
- Implement Supabase JWT middleware
- Implement workspace/project authorization middleware
- Implement flow listing, detail, create, update, duplicate, draft save, publish, and version listing endpoints
- Add validation for structured step definitions
- Implement manual run creation, queue row insertion, BullMQ enqueueing, run detail, step listing, artifact listing, retry, cancel, and live event endpoints
- Build BullMQ worker process
- Fetch flow version and variables securely
- Launch Playwright Docker container per run
- Execute supported step types in order
- Capture screenshots and result JSON
- Persist step results and final run status
- Upload artifacts to Supabase Storage
- Clean up containers and temp files reliably
- Implement schedule CRUD, pause/resume, BullMQ Job Scheduler sync, and startup reconciliation
- Implement dashboard summary, problems, insights, and history endpoints
- Add per-run timeout limits
- Add worker concurrency controls
- Add shared, API, and worker sanity tests
- Pass `bun run typecheck`, `bun run test`, and `bun run build`

## In Progress
- Add request rate limiting
- Add dead-letter inspection path
- Add queue and worker observability surfaces for internal operations

## Remaining
- Inspect and adapt the live Supabase schema against the production project before applying the migration
- Add query/index optimization for recent runs and grouped failures against real production volumes
- Match payloads exactly to the Lovable dashboard components once the frontend is wired
- Add audit logging for sensitive actions
- Enable leaked password protection in Supabase Auth settings
- Add auth middleware tests
- Add flow validation tests
- Add publish/versioning tests
- Add manual run enqueueing tests
- Add worker execution integration tests
- Add schedule creation and reconciliation tests
- Add dashboard aggregation tests
- Add secret encryption and redaction tests
