# Apion

Teams agree an HTTP API contract here before anyone writes the handler. A
project owns a versioned contract, a response standard, per-environment
implementation status, and a mock derived from the contract itself.

The product specification lives in [docs/prd/](docs/prd/). Read
[00-product-overview.md](docs/prd/00-product-overview.md) first;
[07-platform-architecture-and-operations.md](docs/prd/07-platform-architecture-and-operations.md)
is a constraint document, not a suggestion.

## What is built

PRD Phase 0 and Phase 1. Authentication, organisations and projects, roles and
server-side permission checks, contract versions, resources, endpoints and
schemas, per-environment status with history and a CI status API, optimistic
concurrency on every structural write, OpenAPI 3.1 import and export,
TypeScript client generation, cross-project search, and the SPA that drives all
of it.

Phases 2 to 6 are not built. Their library seams exist so Phase 1 could not
establish a conflicting model: `libs/response-standard` holds the envelope
engine that PRD 03 FR-4.8 requires every feature to share, and
`libs/mock-engine` holds the route matcher whose precedence PRD 05 specifies.

## Running it

Requires Bun 1.3 or newer and Docker. Node 24 must also be on PATH: Nx,
esbuild and Vitest spawn it for their own work even though the API runs on Bun.

```sh
bun install
cp .env.example .env          # the defaults match docker-compose.yml
docker compose up -d postgres
bun run db:migrate
bun run db:seed               # two projects, three people, realistic contract

bun run dev:api               # http://localhost:3000
bun run dev:web               # http://localhost:4200, proxies /api to the API
```

The seed prints its sign-in details. All three accounts share one password and
hold different roles, so the permission behaviour is visible without editing
anything: `ada@` owns both projects, `rin@` is an editor, `sam@` is a commenter
and every contract field is read-only for them.

## Layout

| Path | Holds |
| --- | --- |
| `apps/api` | NestJS on Fastify. Server composition, HTTP, guards, jobs. |
| `apps/web` | The SPA: TanStack Router and Query, and its design system. |
| `libs/contracts` | Zod schemas and types shared by both apps. Imports no other library. |
| `libs/domain` | Business rules with no framework: permissions, status transitions, diffing, `applyEndpointChange`. |
| `libs/db` | Drizzle schema, migrations, the pooled client, and the dev seed. |
| `libs/response-standard` | The envelope and lint engine seam (PRD 03). |
| `libs/spec-openapi` | OpenAPI 3.1 import and export, TypeScript generation. |
| `libs/mock-engine` | Contract-derived mock route matching (PRD 05). |

PRD 07 fixes the dependency direction: applications may import libraries, no
library imports an application, `domain` stays framework-free, and `contracts`
imports no other library. `bun run boundaries` enforces all four against the real
Nx project graph, and CI runs it.

## Verifying

```sh
bunx nx run-many -t check       # Biome lint and format
bunx nx run-many -t typecheck
bunx nx run-many -t test
bunx nx run-many -t build
bun run boundaries
```

Rules disabled in `biome.json` are each explained in
[docs/lint-decisions.md](docs/lint-decisions.md). One of them is load-bearing:
Biome rewriting a NestJS dependency to `import type` erases the runtime token
and takes the API down at startup, so that rule is off for `apps/api`.

## Deploying

One VPS, one Docker image, no build on the host. PRD 08 lists host builds
exhausting memory as a risk, so `.github/workflows/ci.yml` builds the image,
pushes it to GHCR, and the VPS only pulls and restarts.

A push to `main` runs `verify`; if it passes, `publish` builds the image and
tags it with the commit SHA and `main`; `deploy` copies
`docker-compose.prod.yml` to the host, pulls that tag, runs migrations as a
one-shot container, starts the API only if they succeed, and fails the job if
`/health` does not report healthy within two minutes.

The host needs Docker with the Compose plugin, a directory (`/srv/apion` by
default) and a `.env` in it. The keys are listed at the bottom of
[.env.example](.env.example); `POSTGRES_PASSWORD` and a real `JWT_SECRET` are
required. Nothing else on the host is managed by the pipeline.

Repository secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (a private key whose
public half is in the deploy user's `authorized_keys`) and `VPS_SSH_KNOWN_HOSTS`
(`ssh-keyscan your-host`). Optional variable: `VPS_APP_DIR`. The `production`
environment exists so a required reviewer can gate the deploy without editing
the workflow.

The API is published on `127.0.0.1:3000`, not on a public interface. Terminate
TLS with a reverse proxy on the host.

To roll back, set `APION_IMAGE` in the host's `.env` to an earlier commit's tag
and run `docker compose -f docker-compose.prod.yml up -d`.

## Design

[DESIGN.md](DESIGN.md) is the product owner's direction and the source of the
SPA's identity. Every colour pair in `apps/web/src/styles.css` was checked
against WCAG 2.2 AA before it was written down, and both themes are treated as
shipping surfaces.
