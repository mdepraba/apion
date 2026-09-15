# PRD 07 — Platform architecture and operations

## Non-negotiable deployment constraint

The target is one host: **1 vCPU / 1 GB RAM**. Expected resident allocation is OS/Docker 150–200 MB, tuned PostgreSQL about 200 MB, application 180–280 MB, and roughly 200 MB headroom (730–880 MB total). Prefer managed/off-host PostgreSQL when possible; add a 2 GB swap file (`vm.swappiness=10`) as OOM insurance, not capacity.

## Architecture

A single Bun `--smol` process runs NestJS/Fastify, static SPA serving, `/api/v1/*`, `/ws`, `/mock/:org/:proj/:env/*`, `/__mock/*`, in-process event bus and job loop. PostgreSQL 18 is the only backing service. There is no Redis, SSR, separate worker, mock, or collaboration service.

Core stack: Nx; Bun (validate against Node 22 in Phase 0); TanStack Start SPA + React; TanStack Query server state; Zustand UI state; PostgreSQL 18; `pg-boss`; Docker/Compose. Serve hashed SPA assets through Fastify. Collaborative state belongs to its sync layer and must not be mirrored into Zustand.

Mock traffic is isolated from the control plane by separate rate limits, a 32 MB deterministic-response LRU, 1 MB response cap, and a 20-connection/5-second delay cap. Extractable libraries preserve a future path to standalone services without prematurely operating them.

## Code boundaries

`apps/api` owns server composition; `apps/web` owns the SPA and its single-consumer design system. Shared libraries are `contracts`, `response-standard`, `mock-engine`, `spec-openapi`, `domain`, and `db`. Applications may import libraries; no library imports applications; domain is framework-free; contracts imports no other library. Enforce with Nx boundary tags.

## Data and jobs

Persist organisations/users/memberships/projects/environments/versions/resources/endpoints/responses/examples/schemas; per-environment status plus history; response-standard versions; lint violations/exemptions; proposals/comments; mock configuration/scenarios/sessions/logs; jobs; collaboration bytes/snapshots (Stage 2); and immutable audit events. Use UUIDv7, JSONB/GIN for schema search, generated derived counts, daily partitions for logs, and UNLOGGED state/log tables where recoverability is not required.

Lint uses `lint_checked_standard_version` and lazy rechecking. All remaining work is cooperative and in-process: a `job` table polled every five seconds, `pg-boss` retry/backoff and `SKIP LOCKED`, concurrency one, bounded slices/yields, streamed large exports. Jobs: lint sweep, export build, log prune, notification send and Stage-2 compaction.

## Database, deployment and monitoring

When local, PostgreSQL targets ~200 MB: 160 MB shared buffers, 4 MB work memory, 32 MB maintenance memory, max 20 connections (app pool 8–10), no parallel workers or JIT, 15-second statement timeout, 30-second idle-transaction timeout, one autovacuum worker and measured sync/one-worker async I/O. These limits are mandatory safety controls.

Development Compose runs Postgres 18, API, Vite web and Mailpit with seeded realistic projects, endpoints, standards/violations and scenarios. Production is API (420 MB limit) plus Postgres (280 MB limit), or API plus managed Postgres. Build images in CI; the host only pulls/restarts. Deploy is a health-gated 5–10-second restart outside working hours.

Expose RSS, p99 event-loop lag and Postgres connection count at `/metrics`. Back up nightly off-host with 14-day retention and quarterly restore rehearsal.

## Non-functional acceptance bar

- 500-endpoint tree p95 under 1.5 s; editor under 500 ms; usable to 1,500 endpoints/400 schemas/project.
- Presence/broadcast p95 under 500 ms; support 25 active users, 50 sockets, 200 named users.
- Mock target: 30 warm or 10 cold req/s without control-plane p95 above 1 s.
- RSS below 400 MB; no request may allocate over 32 MB.
- 99.5% monthly availability and acknowledged 5–10-second deployment downtime; nightly backup is the recovery strategy.
- TLS, argon2id, project mock tokens, encrypted secrets withheld from browsers, complete immutable audit logs, WCAG 2.2 AA, externalised copy (English then Bahasa Indonesia), current two browser versions, and streamed portability export.
