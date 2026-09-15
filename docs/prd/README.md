# Contractor PRD set

This directory splits the source PRD, **Collaborative API Contract Design Platform** (13 September 2026), into implementation-oriented documents. The split preserves the source's scope, requirement IDs, delivery phases, and 1 vCPU / 1 GB deployment constraint; it does not introduce new product commitments.

| Document | Purpose | Primary phase |
| --- | --- | --- |
| [00-product-overview.md](00-product-overview.md) | Product boundary, users, concepts, outcomes and shared quality bar | All |
| [01-projects-access-and-governance.md](01-projects-access-and-governance.md) | Organisation/project lifecycle, roles, versions, audit and search | 1; some later |
| [02-api-design-and-portability.md](02-api-design-and-portability.md) | Endpoint and schema authoring, versioning, imports/exports and diffs | 1 |
| [03-response-standard-and-quality.md](03-response-standard-and-quality.md) | Response-standard authoring, templates, linting and exemptions | 2 |
| [04-implementation-status-and-health.md](04-implementation-status-and-health.md) | Per-environment delivery status, CI updates and health reporting | 1; verification later |
| [05-mock-server.md](05-mock-server.md) | Contract-derived mock behaviour, safety controls and observability | 3 |
| [06-collaboration-and-review.md](06-collaboration-and-review.md) | Real-time collaboration, comments, reviews and conflict handling | 4; Stage 2 gated |
| [07-platform-architecture-and-operations.md](07-platform-architecture-and-operations.md) | System design, data model, resource limits, deployment and NFRs | 0–4 |
| [08-roadmap-risks-and-decisions.md](08-roadmap-risks-and-decisions.md) | Phased delivery, risk controls and unresolved product decisions | All |

## Reading order

Read `00` first. Product teams can then use `01`–`06` independently. Engineering should treat `07` as a cross-cutting, non-negotiable constraint document. `08` is the delivery planning and decision log.

## Source-of-truth rules

- Requirement IDs (`FR-*`, `RS*`, `US-RT-*`) deliberately retain their original identifiers for traceability.
- “Later” and “gated” items are not MVP requirements. In particular, character-level CRDT collaboration requires at least 2 GB RAM.
- One project response standard must drive editor previews, mocks, OpenAPI exports and generated TypeScript; no feature may independently reimplement its rules.
