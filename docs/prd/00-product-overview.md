# PRD 00 — Product overview

**Product:** Contractor (working name)  
**Deployment assumption:** one organisation per instance; single host with 1 vCPU and 1 GB RAM  
**Document status:** split from the master PRD dated 13 September 2026

## Product statement

Contractor is an internal web application in which product, backend, frontend, mobile and QA teams agree on HTTP API contracts before implementation. A project owns a versioned contract, a project-level response standard, implementation status per environment, and an immediately usable mock server.

The product is the canonical agreement on API shape. It is not an API gateway, production traffic proxy, general-purpose API client, load-testing service, CI test runner, public documentation portal, or a multi-tenant SaaS platform.

## Problems to solve

| Current failure | Product outcome |
| --- | --- |
| Decisions live in chat, wikis and meetings | One reviewable, versioned contract is canonical |
| Teams use incompatible envelopes and error codes | A response standard is authored once and mechanically enforced |
| Clients wait for backend deployment | A contract-derived mock is available while endpoints are still drafts |
| OpenAPI belongs only to the backend repository | Non-backend stakeholders can read, review and comment safely |
| Delivery questions require status chasing | Per-environment endpoint status makes progress visible |

## Goals and success measures

- **G1:** multiple people can work on an endpoint without lost changes and can see one another’s activity.
- **G2:** every project can enforce a shared response standard.
- **G3:** implementation status is credible enough for sprint planning.
- **G4:** a contract change reaches the mock in under five seconds.
- **G5:** OpenAPI 3.1 round-trips without loss of ownership or portability.
- **G6:** the complete product operates comfortably within the target host budget.

At six months, target at least 80% of active projects with a published standard, at least 90% of endpoint statuses fresher than 14 days, 500 mock calls per active project per week, median active-session participation of 1.6 people, no more than 0.2 outstanding publish-time lint violations per endpoint, and a sub-ten-minute median path from endpoint creation to first mock request. Application steady-state RSS must remain below 400 MB.

## Users and jobs

| Persona | Primary job | Evidence of success |
| --- | --- | --- |
| Backend engineer | Turn an agreed contract into handlers; report real delivery state | Generates DTOs/validators and updates status through normal delivery work |
| Frontend/mobile engineer | Build and demo before server delivery | Uses realistic mocks for happy, empty and error states |
| Tech lead/architect | Set standards and review contract changes | Reviews focused diffs and receives violations before approval |
| QA engineer | Derive positive and negative test cases | Treats the contract as test-case source of truth |
| PM/BA | Confirm scope and progress without changing the contract | Reads and comments safely |
| External partner/integrator | Consume a published subset and mock | Later-phase, read-only access only |

The anti-persona is a solo developer building a throwaway API. Collaboration and governance should not be optimised for that use case.

## Shared vocabulary

- **Organisation:** identity and billing boundary containing users and projects.
- **Project:** one API surface; owns members, standards, environments and mock configuration.
- **Version:** named contract snapshot, immutable once published; drafts hang from it.
- **Resource:** organisational endpoint group and OpenAPI tag.
- **Endpoint:** atomic collaboration unit: method, path, schemas, responses, owner and status.
- **Schema:** reusable named JSON Schema object.
- **Response standard:** project rules for envelopes, errors, pagination, naming and status policy; both template and linter.
- **Change proposal:** reviewable contract change set, analogous to a pull request.
- **Mock environment:** URL serving contract-derived responses.

## Shared product rules

- The standard, not each endpoint, owns wire-level consistency. Endpoint authors define payloads and see the resulting wrapped response.
- A mock is for integration ahead of backend delivery, including draft endpoints; it is never production infrastructure.
- Structural/governance changes are server-authoritative transactions with optimistic concurrency, never merge operations.
- Resource and performance limits are product requirements, not implementation details. They are defined in [07-platform-architecture-and-operations.md](07-platform-architecture-and-operations.md).
