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

Requires Node 24, pnpm, and Docker.

```sh
pnpm install
cp .env.example .env          # the defaults match docker-compose.yml
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed                  # two projects, three people, realistic contract

pnpm dev:api                  # http://localhost:3000
pnpm dev:web                  # http://localhost:4200, proxies /api to the API
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
imports no other library. `pnpm boundaries` enforces all four against the real
Nx project graph, and CI runs it.

## Verifying

```sh
pnpm nx run-many -t check       # Biome lint and format
pnpm nx run-many -t typecheck
pnpm nx run-many -t test
pnpm nx run-many -t build
pnpm boundaries
```

Rules disabled in `biome.json` are each explained in
[docs/lint-decisions.md](docs/lint-decisions.md). One of them is load-bearing:
Biome rewriting a NestJS dependency to `import type` erases the runtime token
and takes the API down at startup, so that rule is off for `apps/api`.

## Design

[DESIGN.md](DESIGN.md) is the product owner's direction and the source of the
SPA's identity. Every colour pair in `apps/web/src/styles.css` was checked
against WCAG 2.2 AA before it was written down, and both themes are treated as
shipping surfaces.
