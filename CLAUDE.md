# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Apion: teams agree an HTTP API contract before anyone writes the handler. A project owns a
versioned contract, a response standard, per-environment implementation status, and a mock
derived from the contract itself.

The product specification lives in `docs/prd/`. Read `docs/prd/00-product-overview.md` first.
`docs/prd/07-platform-architecture-and-operations.md` is a **constraint document, not a
suggestion** — the boundary rules, the modular-monolith shape, and the 1 GB deployment budget
all come from it, and code that contradicts it is a defect.

PRD Phases 0 and 1 are built. Phases 2–6 are not; `libs/response-standard` and
`libs/mock-engine` exist as seams so Phase 1 could not establish a conflicting model.

## Commands

```sh
bun install
cp .env.example .env            # defaults match docker-compose.yml
docker compose up -d postgres
bun run db:migrate
bun run db:seed                 # two projects, three people; prints sign-in details

bun run dev:api                 # http://localhost:3000
bun run dev:web                 # http://localhost:4200, proxies /api to the API
```

Verification, in the order CI runs it:

```sh
bunx nx sync:check              # route tree + TS project references are generated
bun run boundaries              # module boundary rules, against the real Nx graph
bunx nx run-many -t check       # Biome lint and format
bunx nx run-many -t typecheck
bunx nx run-many -t test
bunx nx run-many -t build
```

Scoped work: `bunx nx run @apion/api:test`, `bunx nx affected -t test`. A single test file goes
through Vitest's own filter: `bunx nx run @apion/domain:test -- diff.spec`. Every project has its
own `vitest.config.mts` with `watch: false`, so a run terminates.

Schema changes: edit `libs/db/src/lib/schema/*.ts`, then `bun run db:generate` (writes a migration
into `libs/db/migrations/`), then `bun run db:migrate`. Migrations are never hand-edited and are
excluded from Biome.

## Architecture

**Dependency direction is enforced, not conventional.** PRD 07 fixes four rules: applications may
import libraries, no library imports an application, `domain` stays framework-free, and
`contracts` imports no other library. `tools/boundaries/check-boundaries.mjs` reads the Nx project
graph and fails CI on a violation. It exists because the workspace lints with Biome, which has no
module-boundary rule. Tags in each `package.json` (`type:app`/`type:lib`, `scope:*`) are what the
checker keys off — a new project without them is silently unchecked.

| Path | Holds |
| --- | --- |
| `apps/api` | NestJS on Fastify. Server composition, HTTP, guards, jobs. |
| `apps/web` | The SPA: TanStack Router and Query, and its design system. |
| `libs/contracts` | Zod schemas and types shared by both apps. Imports no other library. |
| `libs/domain` | Business rules with no framework: permissions, status transitions, diffing, `applyEndpointChange`. |
| `libs/db` | Drizzle schema, migrations, the pooled client, and the dev seed. |
| `libs/response-standard` | Envelope and lint engine seam (PRD 03). |
| `libs/spec-openapi` | OpenAPI 3.1 import and export, TypeScript generation. |
| `libs/mock-engine` | Contract-derived mock route matching (PRD 05). |

There are no `project.json` files. Projects are bun workspace packages (`workspaces` in the root `package.json`); Nx infers targets from
plugins in `nx.json`, and per-project target overrides live under the `nx` key in `package.json`.

**The API is a modular monolith.** One process — no separate worker, mock service, or
collaboration service. `apps/api/src/app.module.ts` is the single composition root: feature
modules under `src/modules/` stay separable so the extractable-library path survives, but nothing
deploys on its own. Background work runs in-process via pg-boss (`infra/jobs.service.ts` plus the
`*.registrar.ts` files).

**Two global guards, by design.** `AuthGuard` opens only routes marked `@Public()`;
`ProjectAccessGuard` refuses any `:slug` route that does not declare the permission it needs. A
new controller therefore cannot ship unguarded by omission. Permissions themselves live in
`libs/domain/src/lib/permissions.ts` and are checked server-side; the SPA mirrors the table only
to choose an affordance, never to decide.

**Optimistic concurrency is on every structural write.** The client sends `If-Match`
(`@IfMatch()` in `common/entity-version.ts`), `EntityVersionInterceptor` stamps `ETag` on any
response carrying `entityVersion`, and a stale write raises `StaleWriteError` — which
`ApiExceptionFilter` turns into a `409` carrying the server's current state so the conflict UI
can show both sides without a second fetch.

**Routing is split deliberately.** `/api/v1/*` is the control plane and every failure in it leaves
through `ApiExceptionFilter` in the control plane's own envelope. `/mock/<org>/<project>/<env>/…`
is fixed by PRD 05 FR-6.1, so `MockController` binds to the Fastify instance directly in
`main.ts` after `app.init()` rather than living under the prefix. Project response standards
(PRD 03) govern how a *project's* API answers and have no bearing on the control plane's own
envelope — don't conflate the two.

**Production runs under systemd, not Docker.** The VPS is an LXC container, where `runc`
cannot write `net.ipv4.ip_unprivileged_port_start` and therefore starts no container at all —
`docker-compose.yml` is development only. The `deploy` job in `.github/workflows/ci.yml` builds
the bundles and the SPA, installs production dependencies from the same lockfile, rsyncs a
release to `/srv/apion/releases/<sha>`, applies migrations, swaps the `current` symlink and
restarts `apion.service`. PRD 08 lists host builds exhausting memory as a risk, so the host
compiles nothing. The unit, the Postgres drop-in and the sudoers rule live in `deploy/`.
Migrations go through `apps/api/src/cli/migrate.ts` (drizzle-orm's migrator, not drizzle-kit,
which is a dev dependency) and a failure there leaves the previous release running.

**The API serves the SPA.** PRD 07 puts both in one process. `@fastify/static` is registered
with `wildcard: false` so it globs `WEB_DIST_PATH` at startup and each hashed asset gets its
own route; `main.ts` then answers unmatched GETs with `index.html`. Requests under `/api/v1`,
`/mock`, `/__mock`, `/health` and `/metrics` are excluded and go through
`reply.callNotFound()` instead, which hands them to the handler Nest registered so the control
plane's 404 still leaves through `ApiExceptionFilter`. `WEB_DIST_PATH` is empty in
development, where Vite serves the SPA.

The SPA's `apps/web/src/api/client.ts` is the only place the session token is read or written, and
the only place `If-Match`/`RequestError` semantics live. Route files under `src/routes/` are
file-based TanStack Router; `routeTree.gen.ts` is generated and Biome-ignored.

## Landmines

- **Never let Biome rewrite an `apps/api` import to `import type`.** The constructor parameter
  type *is* the DI token, emitted into `design:paramtypes`; a type-only import has no runtime
  binding and Nest fails at startup with "can't resolve dependencies". `style/useImportType` and
  the import organiser are off for `apps/api` for this reason, and it has taken the API down once.
- **esbuild does not implement `emitDecoratorMetadata`.** `tools/esbuild/swc-decorator-metadata.cjs`
  supplies it via the plugin wired in `apps/api/esbuild.config.cjs`. That file also carries a
  `createRequire` banner because Nest and Fastify reach for CommonJS globals from ESM output.
- **Postgres 18 stores data in a major-version subdirectory.** The compose mount is
  `/var/lib/postgresql`, one level above where earlier images wanted it; mounting
  `/var/lib/postgresql/data` makes the container refuse to start.
- Every rule disabled in `biome.json` has a recorded reason in `docs/lint-decisions.md`. A rule
  without an entry there should be switched back on — and a new exception needs an entry.

## Design

`DESIGN.md` is the product owner's direction and the source of the SPA's identity: dense and
information-first, amber as the only accent, dark default with a fully working light mode, and the
method-and-path line (`GET /orders/{orderId}`) as the one repeated motif. Every colour pair in
`apps/web/src/styles.css` was verified against WCAG 2.2 AA before it was written down; both themes
are shipping surfaces and a broken light mode is a defect. Status and HTTP method are never
signalled by colour alone.

Where `DESIGN.md` and an antislop rule collide, raise the collision rather than resolving it
silently either way.

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `bunx nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, load the antislop skill for the task:
- Core filter, always on: `antislop`
- UI / visual: `antislop-ui`
- Copy & text: `antislop-copywriting`
- People: `antislop-human`
- Mobile / responsive: `antislop-layoutmobile`
- Code comments: `antislop-code`
Before starting, ask the user when antislop applies: during the work, or after it is done.
<!-- antislop:end -->
