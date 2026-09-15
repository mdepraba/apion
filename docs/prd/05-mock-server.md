# PRD 05 — Contract-derived mock server

## Purpose

Serve every project contract immediately so client teams can integrate before backend implementation. Mocks use schemas and examples—not hand-written fixtures—and always apply the active response standard.

## Route and access model

**FR-6.1–6.3.** The main process mounts one mock engine at:

`https://<host>/mock/<org-slug>/<project-slug>/<env>/<path...>`

`<env>` resolves a published version, change-proposal branch, or mutable `draft` head. Mocks serve endpoints regardless of status, including drafts. They use HTTP/1.1 or HTTP/2 over TLS only. Reserved contract paths are `/api/*`, `/mock/*` and `/__mock/*`.

Authentication options are `private` (default; rotatable/revocable project Bearer token), `public-link` (unguessable slug and tighter rate limit; never sensitive schemas), and `simulated-auth` (validates declared auth and emits the contract’s `401`).

## Matching and response selection

Match method first, then path. Literal segments beat parameters (`/orders/export` precedes `/orders/{id}`). Missing route returns contract-envelope `404` / `MOCK_ROUTE_NOT_FOUND`; method mismatch returns `405` with `Allow`. Captured parameters are available to templating.

**FR-6.4.** Response selection precedence is: `Prefer: code=404`, `Prefer: example=emptyList`, `X-Mock-Scenario`, default example, then lowest declared 2xx generated from schema. Responses return endpoint ID, response source, contract version, endpoint status, request ID and cache result in `X-Mock-*` headers.

## Generation and validation

Generation is deterministic from project, endpoint and path parameters; `X-Mock-Seed: random` opts out. It honours JSON Schema constraints, common formats and `x-mock-faker`, supports project locale (`en`, `id_ID`), echoes matching path/query values into payloads, and generates followable cursor pagination within the standard’s maximum limit.

**FR-6.5.** Request validation is per-project and on by default for dev. Validate path/query/header/body; failures use the project error envelope, mapped code (normally `VALIDATION_FAILED`) and JSON-pointer details. `X-Mock-Validate: off` bypasses one request.

## Scenarios, state and resilience controls

**FR-6.4, FR-6.6.** Named project scenarios override examples/codes for coordinated demos. Every project starts with `happyPath`, `emptyStates`, `serverErrors`, `slowNetwork` and `unauthenticated`; a session can pin a scenario.

Optional stateful CRUD is keyed by `X-Mock-Session`, uses an UNLOGGED Postgres store, expires after two idle hours, and resets through `DELETE /__mock/session`. Cap each collection at 100 entities/session and each project at 20 active sessions; evict oldest sessions. Stateless behaviour is the default.

Headers can request a capped fixed/range delay, failure rate, forced timeout or deliberately malformed JSON. No more than 20 delayed requests are held; later requests proceed with a warning header. Generated payloads are capped at 1 MB.

## Control plane, logging and limits

`/__mock/health`, `/__mock/openapi.json`, `/__mock/routes`, `/__mock/session` and authenticated `/__mock/log` form the reserved management surface. The UI provides a live, filterable request log and browser replay (**FR-6.7**).

Log timestamp, route, endpoint, source, status, latency, validation, request ID and truncated caller IP. Batch writes every two seconds or 100 rows into daily-partitioned UNLOGGED storage. Retain detailed logs 48 hours and aggregates 90 days; store bodies only on validation failure (8 KB cap) and redact `x-sensitive` fields.

Rate-limit mock traffic separately: 120 req/min/token private, 30 req/min public-link. Return envelope-compliant `429` and `Retry-After`. Cache deterministic responses in a roughly 32 MB LRU keyed by endpoint/version/selection/seed; invalidate on contract save and bypass random, stateful and fault-injected calls.

## Targets and delivery

Reflect edits under 5 seconds p95; target under 30 ms cached and 150 ms cold p95, 30 warm/10 cold req/s without control-plane p95 exceeding 1 s, and sub-second cold start. This is Phase 3; stateful CRUD is explicitly the last, deferrable item.
