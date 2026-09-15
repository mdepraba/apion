import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { endpoints } from './contract.js';
import {
  auditActionEnum,
  implementationStatusEnum,
  statusChannelEnum,
} from './enums.js';
import { users } from './identity.js';
import { environments, projects } from './projects.js';

/**
 * PRD 04 FR-3.2: current status, one row per endpoint and environment. The
 * append-only history lives in `endpointStatusEvents`, so a lost race here
 * still leaves both events on record (FR-3.4).
 */
export const endpointStatuses = pgTable(
  'endpoint_statuses',
  {
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    status: implementationStatusEnum('status').notNull().default('draft'),
    note: text('note'),
    changedBy: uuid('changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    changedVia: statusChannelEnum('changed_via').notNull().default('ui'),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.endpointId, table.environmentId] }),
    // Drives the status board and the FR-3.6 rollups for one environment.
    index('endpoint_statuses_env_status_idx').on(
      table.environmentId,
      table.status,
    ),
    // FR-3.5 sweeps for in_progress endpoints older than the threshold.
    index('endpoint_statuses_changed_at_idx').on(table.changedAt),
  ],
);

export const endpointStatusEvents = pgTable(
  'endpoint_status_events',
  {
    id: uuid('id').primaryKey(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    environmentId: uuid('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    status: implementationStatusEnum('status').notNull(),
    note: text('note'),
    changedBy: uuid('changed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    changedVia: statusChannelEnum('changed_via').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The endpoint sidebar reads this newest-first.
    index('endpoint_status_events_endpoint_idx').on(
      table.endpointId,
      table.environmentId,
      table.changedAt,
    ),
  ],
);

/**
 * PRD 01 FR-1.7 and PRD 07: immutable audit events, retained 12 months. The
 * activity feed is a read of this table; nothing updates or deletes a row.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Denormalised so the feed still names the actor after an account is removed. */
    actorName: varchar('actor_name', { length: 120 }),
    action: auditActionEnum('action').notNull(),
    targetType: varchar('target_type', { length: 60 }).notNull(),
    targetId: uuid('target_id'),
    targetLabel: varchar('target_label', { length: 300 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_events_project_time_idx').on(
      table.projectId,
      table.occurredAt,
    ),
    index('audit_events_actor_idx').on(table.actorId),
  ],
);

export const endpointStatusesRelations = relations(
  endpointStatuses,
  ({ one }) => ({
    endpoint: one(endpoints, {
      fields: [endpointStatuses.endpointId],
      references: [endpoints.id],
    }),
    environment: one(environments, {
      fields: [endpointStatuses.environmentId],
      references: [environments.id],
    }),
  }),
);

export const endpointStatusEventsRelations = relations(
  endpointStatusEvents,
  ({ one }) => ({
    endpoint: one(endpoints, {
      fields: [endpointStatusEvents.endpointId],
      references: [endpoints.id],
    }),
    actor: one(users, {
      fields: [endpointStatusEvents.changedBy],
      references: [users.id],
    }),
  }),
);

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  project: one(projects, {
    fields: [auditEvents.projectId],
    references: [projects.id],
  }),
  actor: one(users, { fields: [auditEvents.actorId], references: [users.id] }),
}));
