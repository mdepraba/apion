# PRD 04 — Implementation status and delivery health

## Purpose

Show whether each contract is available in a real environment—not merely designed—while retaining enough history to trust the result.

## Status model

**FR-3.1.** Valid states are:

`draft → in_review → approved → in_progress → implemented → deprecated → retired`

The list UI groups states before `implemented` as **Not implemented** for the common planning question, but preserves the exact state in detail and filters.

**FR-3.2.** Status is independent per project environment (`dev`, `staging`, `production`). Endpoint lists use an environment selector that defaults to the project’s primary environment. A status in dev does not imply status in production.

**FR-3.3.** Every change records actor, timestamp and optional note. History is visible in the endpoint sidebar and remains available to audit/reporting.

## Update channels

**FR-3.4.** Users update status in the UI. Deployment systems update it through `POST /api/v1/projects/:slug/endpoints/:id/status`. The endpoint is authenticated, authorised and auditable; it must update connected clients within two seconds.

When a human and CI update within the same second, later write wins for current state and both entries remain in history. Status writes follow the same entity-version/server-authoritative governance model as other structural actions, except that recorded history prevents loss of the earlier event.

## Health and planning views

**FR-3.5.** Flag an `in_progress` endpoint older than a configurable threshold (14 days by default) to its owner and the project health panel.

**FR-3.6.** Provide status filters, a status-board view, and per-resource/per-version rollups such as `Orders: 12/19 implemented`.

Health coverage must distinguish factual status from stale status. The organisation goal is at least 90% of endpoint status records less than 14 days old.

## Later scope: live verification

**FR-3.7.** When explicitly enabled, periodically call an endpoint marked `implemented` at its configured base URL and compare the response with its contract. Surface drift. This is disabled by default and later-phase work because it requires credentials, egress decisions and resource budgeting. It must not block the control plane or expose stored secrets to clients.

## Acceptance criteria

- The same endpoint may be `implemented` in dev and `in_progress` in production, and each state/history remains distinct.
- A CI update changes the board without a reload in under two seconds, preserving filters and scroll position.
- Every change attributes actor, time and note; competing writes produce two historical events.
- Endpoints past the configured in-progress threshold appear in owner and health views.
- A project/resource rollup is calculated for the selected environment and states its denominator.

## Delivery

Per-environment status, history and the CI status API are Phase 1. Live verification is Phase 6 and requires a security/egress decision first.
