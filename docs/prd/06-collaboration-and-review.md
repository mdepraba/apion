# PRD 06 — Collaboration and review

## Purpose

Support safe concurrent contract work on constrained hardware. Stage 1 prevents and resolves conflicts; Stage 2 provides character-level convergence only after the host reaches 2 GB RAM.

## Stage 1: presence, locks and optimistic concurrency

**FR-5.1–5.3.** One WebSocket per active user carries project, endpoint and focused-field presence. Project headers show up to five avatars and an overflow count; hover reveals identity, role and location. Tree rows identify endpoints another user is editing; stale presence disappears within 30 seconds.

Focusing a field broadcasts a soft lock within 500 ms. Other users see the editor and a read-only field. Locks release on blur, disconnect or two minutes idle, never block reading/commenting/navigation, and a Maintainer can force-release with audit logging.

Every save uses `If-Match` against `endpoint.entity_version`. Different-field changes persist and appear within 500 ms. A same-field stale write receives `409`, current and attempted values, and a side-by-side resolution UI. Offline edits queue for up to 10 minutes and either apply or surface a conflict after reconnect—never disappear silently.

## Comments and participation

**FR-5.4.** Comment threads anchor to an endpoint, response or JSON pointer such as `Order.items[].price`. Unresolved counts appear in the tree. Renamed fields preserve their anchors; deleted fields leave readable orphaned threads. Mentions notify in-app and, if preferences allow, by email within 60 seconds. Threads support resolution and reactions.

**US-RT-10.** Commenters remain visible and can comment, mention, resolve their own threads and read history while contract fields are read-only.

## Proposals and structural safety

**FR-5.5.** A change proposal has a contract branch/change set, diff, requested reviewers, approval/request-changes state and merge. Its diff refreshes without a disruptive rerender as authors save. Lint and breaking-change classification update within two seconds. Approval is blocked by non-exempt error lint violations; simultaneous comments appear live.

**FR-5.7 / US-RT-06.** Delete, schema rename, publication, status changes, standard publication and permissions are server-authoritative versioned transactions. A user editing an item deleted by another sees a read-only banner identifying the actor and a one-click Maintainer restore where available. Schema rename shows impact and is all-or-nothing.

Standard publication broadcasts an in-app change notice, provides a before/after sample wire-shape preview, and reports actual lint coverage. It never blocks UI interaction as the project grows.

## Status broadcasts and later follow mode

CI/API status updates reach connected users within two seconds and update chips without discarding filters or scroll. Later Phase 6 follow mode lets a user mirror a presenter’s navigation/scroll until they navigate themselves.

## Stage 2: gated CRDT collaboration

Live cursors, text selections, character-level simultaneous edits and continuously updating proposal diffs use one Yjs document per endpoint. Persist updates as bytes, snapshot every 200 updates or 60 seconds, remove superseded records, cap loaded documents at 30, evict after five idle minutes and enforce a document-size limit. Relational projection remains authoritative for mocks, exports and search.

**Hard gate:** Stage 2 does not ship on 1 GB RAM. It requires at least 2 GB. All mutation paths therefore use one `applyEndpointChange` seam now, allowing CRDTs later without a rewrite.
