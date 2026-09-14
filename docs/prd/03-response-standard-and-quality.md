# PRD 03 — Response standard and contract quality

## Purpose

Make each project’s response conventions executable. The response standard is both a template for new endpoint responses and a linter that keeps existing responses consistent.

## Standard lifecycle

**FR-4.1.** A project has exactly one active, versioned response standard. Edits create a draft. Publishing activates the draft and makes previous endpoint lint results stale; it must not synchronously relint the whole project.

The declarative standard model covers property/path/enum naming; success envelope and allowed HTTP status policy; error envelope and error-code registry; pagination; required response headers; date format/time zone; and nullability. `$payload` is the success-envelope substitution point. Authors edit the payload and receive a read-only wire-shape preview.

## Bootstrap presets

**FR-4.7.** Offer editable starting presets: `JSON:API`, `RFC 9457 Problem Details`, `Google API Design Guide`, `Simple {data, error}`, and `None`. A preset is never a locked mode.

## Rules and enforcement

**FR-4.4.** Rules have stable IDs and severity `error`, `warn`, or `off`:

| ID | Check |
| --- | --- |
| RS001 | Success response does not match the success envelope |
| RS002 | Property naming violates configured convention |
| RS003 | Error response is absent or has the wrong envelope |
| RS004 | Error code is outside the registry |
| RS005 | Status is not allowed for its HTTP method |
| RS006 | Collection response lacks configured pagination shape |
| RS007 | Date/time fields use the wrong format |
| RS008 | Required response header is absent |
| RS009 | Required error status class has no response |
| RS010 | Path segment violates naming rules |

**FR-4.5.** Inline feedback appears while an author works. Error-severity violations block endpoint approval and standard/contract publication. Warnings remain visible without blocking.

**FR-4.6.** A Maintainer may waive a rule for one endpoint only with mandatory justification. Every exemption is visible in project health; it cannot silently suppress a violation across a project.

**FR-4.8.** The same standard engine must drive editor preview, mock responses, OpenAPI export and generated TypeScript. This is a correctness boundary: re-declaring envelopes in each feature is prohibited.

## Lazy linting and health

Each endpoint records `lint_checked_standard_version` with cached violations. Publishing increases the standard version in constant time. Opening a stale endpoint lint-checks that endpoint and refreshes its cache. The health panel reports actual coverage (for example, `412 of 500 checked against v3`) and provides a `check all` sweep in chunks of 25, yielding between chunks and streaming progress. An idle in-process job may continue that sweep.

## Acceptance criteria

- A new success response displays the standard’s full envelope without requiring an author to duplicate it.
- A response violating RS001–RS010 receives the configured severity and a stable rule ID.
- An unresolved `error` violation prevents approval and publication; a documented exemption allows only its specified rule/endpoint.
- Publishing a standard returns promptly regardless of endpoint count, broadcasts its change, and correctly marks coverage stale.
- Mock and OpenAPI output expose the same wrapped shape as the editor preview for the same payload.

## Delivery

This is Phase 2. Its API and domain seam should exist early enough that Phase 1 endpoints do not establish a conflicting response model.
