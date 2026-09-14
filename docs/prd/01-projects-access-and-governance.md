# PRD 01 — Projects, access and governance

## Purpose

Provide the safe organisational boundary around each API contract: membership, project lifecycle, versions, discoverability and accountable governance.

## Scope and requirements

### Membership and roles

**FR-1.1.** Users belong to an organisation and may belong to many projects. Project roles are `Owner`, `Maintainer`, `Editor`, `Commenter` and `Viewer`.

Role enforcement must happen server-side for every control-plane operation. `Commenter` and `Viewer` can read according to project visibility. `Commenter` may participate in comments but must never receive editable contract controls. The UI must show a read-only affordance and explain the restriction rather than silently failing a save.

Owners govern project-level settings. Maintainers can perform explicitly delegated governance actions, including documented lint exemptions and force-releasing a stale soft lock. The unresolved decision of whether a response-standard publication is Owner-only is recorded in PRD 08.

### Project lifecycle and navigation

**FR-1.2.** A keyboard-accessible (`Cmd+K`) project switcher lists accessible projects with recent activity, unread comments and open proposals.

**FR-1.3.** A project slug is unique inside its organisation and is part of the mock URL. Slug changes must preserve or deliberately redirect mock consumers; do not treat a slug as display-only.

**FR-1.5.** Archive makes a project read-only and stops its mocks. Hard deletion has 30-day recovery. The restore path is a Maintainer action and must be audited. No irreversible purge occurs before recovery expiry.

**FR-1.7.** Retain the project activity feed for 12 months. It records actor, time, action, target and pertinent change metadata; it is the user-facing view of immutable audit events.

### Shared library projects — later phase

**FR-1.4.** A project can inherit schemas and response standards from a parent library project. Inherited items are read-only in the downstream project; a downstream project may extend but cannot redefine them. The feature supports organisation-wide shared objects such as `ErrorEnvelope`.

Library projects are Phase 6 scope. The chosen initial implementation treats one as a special project type, while the alternative organisation-level entity remains open.

### Search

**FR-1.6.** Cross-project search finds endpoints and schemas only in projects the caller may read. The result must disclose the project/version context and never leak a name, path or schema fragment from inaccessible projects.

## Contract version governance

A version has a label (`v1`, `v2`, or a date), state and publication metadata. Published versions are immutable. Draft work is associated with a version and may be grouped into change proposals.

Phase 1 assumes linear snapshots plus change proposals. Git-style branching and merging are expressly not assumed; adopting them is a substantial product decision (PRD 08).

The following operations are server-authoritative, version-checked transactions: deleting an endpoint, renaming a schema, publishing a version, changing status, publishing a response standard and changing permissions. A request carries its known entity version. A stale request returns `409` with current state and a clear review/resolution path.

## Acceptance criteria

- A user sees only projects and search results covered by membership.
- A Commenter can add, mention in and resolve their own threads, read history and appear in presence, while every contract field stays read-only.
- Archived projects cannot be edited or mocked; a recovered project resumes only through an auditable restore action within 30 days.
- Concurrent governance operations never create partial state. A stale client receives a conflict, not a silent overwrite.
- Every permission, publication, archive/delete/restore and forced lock release appears in the activity/audit feed with actor and timestamp.

## Dependencies

This document depends on authentication, audit storage, optimistic concurrency and the core entities in PRD 07. It informs API authoring (PRD 02), collaboration (PRD 06), and mock route ownership (PRD 05).
