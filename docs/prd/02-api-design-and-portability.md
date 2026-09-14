# PRD 02 — API design and portability

## Purpose

Enable mixed-discipline teams to author a complete HTTP API contract, reuse schemas safely, review its change impact, and import/export without lock-in.

## API surface editor

**FR-2.1.** Present a virtualised tree: **Version → Resource → Endpoint**. It supports drag reorder and multi-select. Resources are lazily loaded/paginated so a 1,500-endpoint project remains usable.

**FR-2.2.** An endpoint includes:

- summary and Markdown description;
- HTTP method and path;
- typed path parameters extracted automatically from `{braces}`;
- query parameters and headers;
- request body;
- one or more responses keyed by HTTP status;
- auth requirement, deprecation flag, owner and linked ticket URL.

Path validation must reject routes under `/api/*`, `/mock/*` and `/__mock/*`, because platform routes would otherwise shadow contracts.

## Schema authoring and reuse

**FR-2.3.** The same underlying JSON Schema is editable in two modes: a guided form/tree for non-technical authors and a raw JSON Schema editor for engineers. Switching modes cannot alter semantic content.

**FR-2.4.** `$ref` autocomplete spans local and inherited schemas. Each named schema displays usage count. Safe rename shows the impact count, requires confirmation and updates every reference atomically. If an editor has an affected endpoint open, its state becomes read-only with an actionable notice until refreshed/resolved.

**FR-2.5.** Each response needs at least one named example, optionally marked `default`. Validate examples against their response schema on save. Invalid examples block publication.

## Change classification and review inputs

**FR-2.6.** Diffs classify at minimum the following as `breaking`, `non-breaking`, or `additive`: removed fields, narrowed types, new required request fields, removed status codes and changed paths. The classification appears in a change proposal and recomputes on contract changes.

The editor must make payload shape distinct from response-standard wire shape. PRD 03 owns envelope construction and lint rules; the API editor receives its preview from that shared engine.

## Interoperability

**FR-2.7.** Import OpenAPI 3.0/3.1 in YAML or JSON and Postman collections. Export OpenAPI 3.1, TypeScript types and a typed `fetch` client. OpenAPI 3.1 is the portability baseline: import/export must not intentionally discard representable contract data.

Exports, type generation and mock response generation consume common libraries rather than separate interpretations of the contract or response standard. Large exports run as bounded, streamed background work rather than allocating the complete archive in memory.

## Acceptance criteria

- Creating `/orders/{orderId}` creates a typed path parameter; malformed or reserved paths cannot be saved.
- An author can make an equivalent schema change in either editor mode and see it in the other mode immediately.
- A schema rename with seven references reports seven impacts and updates all seven or none.
- A response example that fails its schema cannot be published.
- A diff labels a removed response status and newly required request field as breaking, with the affected endpoint/version visible.
- Imported contracts can be exported as OpenAPI 3.1 without using the platform as a data prison.

## Delivery

Core CRUD, schema editing, OpenAPI import/export and optimistic `If-Match` conflicts are Phase 1. Postman import, rich generated clients and shared library inheritance should be sequenced without weakening the Phase 1 portability commitment.
