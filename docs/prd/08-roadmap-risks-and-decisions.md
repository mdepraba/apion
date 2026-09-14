# PRD 08 — Roadmap, risks and decisions

## Delivery roadmap

| Phase | Timing | Exit scope |
| --- | --- | --- |
| 0 — Runtime validation | Week 0, 3–5 days | Measure Nest/Fastify plus required plugins and Postgres on target hardware under load; under 200 MB idle; decide Bun vs Node 22 |
| 1 — Foundations | Weeks 1–6 | Nx boundaries, auth, organisations/projects, endpoint/schema CRUD, environment status/history/CI API, OpenAPI import/export, SPA, optimistic conflicts, metrics |
| 2 — Response standard | Weeks 6–10 | Standard model/editor/presets, preview, RS001–RS010, blocking/exemptions, lazy lint, health panel |
| 3 — Mock server | Weeks 10–15 | Matching/generation, selection, validation, faults/delay, cache/rate limit/log; stateful mocks may slip |
| 4 — Collaboration Stage 1 | Weeks 15–20 | Presence, locks, anchored comments/mentions, broadcasts and notification jobs |
| 5 — Collaboration Stage 2 | Gated | CRDT documents/cursors/live proposal diffs only with at least 2 GB RAM |
| 6 — Governance and reach | Later | Libraries, live verification, OIDC, follow mode, custom domains, partner access and advanced SDKs |

## Principal risks and controls

| Risk | Control |
| --- | --- |
| OOM interrupts application or database | Container limits, swap, bounded caches/payloads/exports/jobs, RSS alerts; move Postgres off-host where possible |
| Mock tests starve the UI | Separate limits, deterministic cache, payload/delay caps |
| Bun incompatibility discovered late | Prove on target in Phase 0; Node 22 remains Dockerfile-level fallback |
| Host builds exhaust memory | CI builds and registry; deployment only pulls/restarts |
| Backups are unusable | Nightly off-host dump, 14-day retention, quarterly restore rehearsal |
| CRDT cache becomes unbounded | Stage-2 hardware gate and hard document caps/eviction |
| Standards cause teams to disable lint | Per-rule severity and visible, justified exemptions |
| Status becomes fiction | CI updates, staleness reporting and later live verification |
| Mock is mistaken for staging | Limits, diagnostic headers and explicit export disclaimer |
| Scope expands into generic API tooling | Treat non-goals as load-bearing through Phase 6 |

## Decisions required before affected scope starts

1. Is 1 GB permanent or temporary? This determines whether Stage 2 is deferred or cancelled.
2. Can PostgreSQL run off-host? This materially changes capacity and operations.
3. Is planned 5–10-second deployment downtime acceptable?
4. Do versions remain linear snapshots/proposals, or need Git-style branches/merges?
5. Is standard publication Owner-only or also available to Maintainers?
6. Is a shared library a project type or organisation-level object?
7. Is the product self-hosted single-tenant or future multi-tenant SaaS?
8. What is the pricing unit, and are Commenter/Viewer roles free?
9. Does live verification require an in-network agent or allow-listed egress?
10. Are generated contract-test artefacts (Pact/Schemathesis) necessary beyond OpenAPI export?

## Planning guardrails

Do not schedule Stage 2 by calendar alone; hardware is its acceptance condition. Do not introduce a worker, Redis, SSR or an independently deployed mock service to solve a premature scale problem. Do not turn a standard change into an eager full-project lint job. Each decision above must be captured with owner, date and rationale before committing dependent implementation work.
