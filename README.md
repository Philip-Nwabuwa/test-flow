# Playwright Docker Automation Backend

Express + TypeScript backend for Lovable + Supabase that runs website automation flows in headless Playwright Docker containers and serves live Playwright authoring sessions for the Lovable flow builder.

## Workspace Layout

- `apps/api`: REST API, auth, flow management, dashboard queries, schedule management
- `apps/recorder`: stateful live-browser authoring sessions with Playwright, Xvfb, and noVNC
- `apps/worker`: BullMQ worker, scheduler reconciler, Docker runtime, Playwright execution
- `packages/shared`: shared types and helpers
- `sql`: additive schema migrations for Supabase Postgres
- `docs`: product and implementation docs

## Local Development

1. Copy `.env.example` to `.env` and add real Supabase credentials.
2. Start Redis with `docker compose up redis -d`.
3. Install dependencies with `bun install`.
4. Run the API, worker, and recorder with `bun run dev`.

## Notes

- This scaffold assumes Supabase Postgres is the source of truth.
- BullMQ uses Redis for queueing and job scheduling.
- The worker launches one Playwright Docker container per run via the host Docker socket.
- The recorder keeps one live Playwright browser session per authoring session and emits step suggestions over Redis-backed SSE.
