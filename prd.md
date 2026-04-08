# PRD: Website Automation Backend

## Overview
Build an Express + TypeScript backend that lets users create, schedule, run, and monitor website automation flows powered by Playwright in headless Docker containers.

The system supports this execution path:

User Task -> API -> Queue -> Worker -> Playwright Container -> Result -> Dashboard

The frontend web app is already built in Lovable and uses Supabase for auth and data. This backend validates Supabase JWTs, reuses the existing Supabase schema where possible, stores artifacts in Supabase Storage, and exposes REST endpoints for dashboard and run control.

## Problem
Users need a reliable way to automate flows on websites, schedule them hourly or daily, run them manually, inspect failures, and view execution history from the dashboard.

## Goals
- Allow users to create and manage flows from the dashboard
- Execute flows using Playwright in headless Docker containers
- Support hourly and daily schedules with timezone support
- Support retry policies for infrastructure failures
- Show results, failures, and execution history in the dashboard
- Reuse Supabase auth, Postgres, and Storage
- Keep flows as the primary executable unit

## Non-Goals
- Live browser recording via extension in v1
- User-authored arbitrary JavaScript execution
- Kubernetes-based execution in v1
- Replacing the existing Lovable/Supabase frontend

## Users
- Workspace members who create and manage flows
- Admins who configure credentials, schedules, and monitor failures
- Team members who inspect run history and artifacts

## Product Decisions
- Auth: Supabase JWT validated by Express API
- Data store: Supabase Postgres
- Artifact store: Supabase Storage
- Execution runtime: Single-host Docker Engine
- Queue: BullMQ with Redis
- Executable unit: Flow
- Flow authoring: Dashboard-only builder
- Secrets model: Encrypted reusable variables
- Scheduling: BullMQ Job Schedulers with hourly/daily frequency and IANA timezone

## Existing Domain Mapping
- `test_flows`: metadata layer for dashboard flow cards
- `test_cases`: executable definition and scheduling/health configuration
- `test_steps`: ordered actions linked to `test_cases.id`
- `test_runs_v2`: run history and outcome storage
- `execution_queue`: queue audit table visible to the app
- `test_credentials`: project-scoped credentials

## Functional Requirements
- Validate Supabase JWT on all protected endpoints
- Enforce workspace/project-level authorization
- Create, update, duplicate, publish, and list flows
- Support structured step types:
  - `click`
  - `input`
  - `select`
  - `navigate`
  - `wait`
  - `scroll`
  - `KeyPress`
  - `assert`
- Enqueue manual and scheduled runs through BullMQ
- Launch one isolated Docker container per run
- Persist run status, step results, timestamps, failure reasons, and artifacts
- Upload screenshots and result files to Supabase Storage
- Support hourly and daily schedules
- Support schedule timezone, retry attempts, and backoff policy
- Expose dashboard endpoints for summary, problems, insights, and history

## API Endpoints
### System
- `GET /v1/health/live`
- `GET /v1/health/ready`
- `GET /v1/me`

### Dashboard
- `GET /v1/dashboard/summary`
- `GET /v1/dashboard/problems`
- `GET /v1/dashboard/insights`
- `GET /v1/dashboard/history`

### Flows
- `GET /v1/flows`
- `POST /v1/flows`
- `GET /v1/flows/:flowId`
- `PATCH /v1/flows/:flowId`
- `PUT /v1/flows/:flowId/draft`
- `POST /v1/flows/:flowId/publish`
- `POST /v1/flows/:flowId/duplicate`
- `GET /v1/flows/:flowId/versions`

### Runs
- `POST /v1/flows/:flowId/runs`
- `GET /v1/flows/:flowId/runs`
- `GET /v1/runs/:runId`
- `GET /v1/runs/:runId/steps`
- `GET /v1/runs/:runId/artifacts`
- `GET /v1/runs/:runId/events`
- `POST /v1/runs/:runId/retry`
- `POST /v1/runs/:runId/cancel`

### Schedules
- `GET /v1/flows/:flowId/schedules`
- `POST /v1/flows/:flowId/schedules`
- `PATCH /v1/schedules/:scheduleId`
- `POST /v1/schedules/:scheduleId/pause`
- `POST /v1/schedules/:scheduleId/resume`
- `DELETE /v1/schedules/:scheduleId`

### Variables
- `GET /v1/variables`
- `POST /v1/variables`
- `PATCH /v1/variables/:variableId`
- `DELETE /v1/variables/:variableId`

## Execution Architecture
- Express API receives requests from Lovable frontend
- Supabase JWT is validated and mapped to workspace/project access
- Manual runs are inserted into DB and pushed to BullMQ
- BullMQ worker consumes jobs
- Worker launches Playwright in a Docker container
- Container executes structured steps against target website
- Worker captures screenshots and step results
- Worker uploads artifacts to Supabase Storage
- Dashboard reads run state and history from Supabase Postgres

## Security Requirements
- Use Supabase JWT for auth
- Encrypt stored variables and credentials at rest
- Never return plaintext secrets in API responses
- Restrict flow and run access by workspace/project membership
- Run each execution in an isolated container
- Enforce execution timeout and cleanup

## Acceptance Criteria
- A user can create a flow and run it manually from the dashboard
- A user can create an hourly or daily schedule with timezone
- A scheduled run creates a queue job and finishes with a visible result
- A failed selector step is shown in problems and execution history
- Artifacts from a run are stored and retrievable
- Stored credentials can be referenced in steps without exposing plaintext
