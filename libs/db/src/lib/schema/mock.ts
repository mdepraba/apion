import type { ScenarioRule } from '@apion/contracts';
import { mockAuthModes, mockLocales } from '@apion/contracts';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { endpoints } from './contract.js';
import { projects } from './projects.js';

export const mockAuthModeEnum = pgEnum('mock_auth_mode', mockAuthModes);
export const mockLocaleEnum = pgEnum('mock_locale', mockLocales);
export const mockValidationEnum = pgEnum('mock_validation', [
  'passed',
  'failed',
  'skipped',
]);
export const mockCacheEnum = pgEnum('mock_cache', ['hit', 'miss', 'bypass']);

/** PRD 05: one mock configuration per project, `private` by default. */
export const mockConfigs = pgTable('mock_configs', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  authMode: mockAuthModeEnum('auth_mode').notNull().default('private'),
  validateRequests: boolean('validate_requests').notNull().default(true),
  locale: mockLocaleEnum('locale').notNull().default('en'),
  /**
   * argon2id, like a password: a mock token reaches whatever the contract
   * describes, so a leaked database must not hand over working tokens.
   */
  tokenHash: text('token_hash'),
  /** Last four characters, so the UI can tell two tokens apart. */
  tokenHint: varchar('token_hint', { length: 16 }),
  tokenRotatedAt: timestamp('token_rotated_at', { withTimezone: true }),
  /** The unguessable slug for `public-link` mode. */
  publicSlug: varchar('public_slug', { length: 64 }),
  entityVersion: integer('entity_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** FR-6.4: named overrides so a demo can be coordinated by name. */
export const mockScenarios = pgTable(
  'mock_scenarios',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    description: text('description').notNull().default(''),
    rules: jsonb('rules').$type<ScenarioRule[]>().notNull().default([]),
    /** One of the five every project starts with, so the UI can say so. */
    isDefault: boolean('is_default').notNull().default(false),
    entityVersion: integer('entity_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('mock_scenarios_project_name_idx').on(
      table.projectId,
      table.name,
    ),
  ],
);

/**
 * PRD 05: "Log timestamp, route, endpoint, source, status, latency, validation,
 * request ID and truncated caller IP."
 *
 * UNLOGGED per PRD 07: a mock log is diagnostic, and paying WAL for it on a
 * 1 vCPU host would tax the control plane to protect data nobody recovers.
 * Rows are written in batches and pruned at 48 hours by the `log_prune` job.
 */
export const mockRequestLogs = pgTable(
  'mock_request_logs',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id').notNull(),
    environmentKey: varchar('environment_key', { length: 64 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    path: text('path').notNull(),
    endpointId: uuid('endpoint_id'),
    statusCode: integer('status_code').notNull(),
    /** Which precedence rule from FR-6.4 chose the response. */
    source: varchar('source', { length: 40 }).notNull(),
    latencyMs: integer('latency_ms').notNull(),
    validation: mockValidationEnum('validation').notNull().default('skipped'),
    cache: mockCacheEnum('cache').notNull().default('miss'),
    requestId: varchar('request_id', { length: 64 }).notNull(),
    /** Truncated to a /24 or /48: enough to group callers, not to identify one. */
    callerIp: varchar('caller_ip', { length: 64 }),
    /** Held only for a validation failure, capped at 8 KB, sensitive fields redacted. */
    requestBody: text('request_body'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The live log: newest first for one project, optionally one environment.
    index('mock_request_logs_project_time_idx').on(
      table.projectId,
      table.occurredAt,
    ),
    index('mock_request_logs_endpoint_idx').on(table.endpointId),
  ],
);

/**
 * Daily aggregates, retained 90 days after the detailed rows are gone. Written
 * by the same prune job that deletes them, so the counts survive the detail.
 */
export const mockDailyStats = pgTable(
  'mock_daily_stats',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    day: timestamp('day', { withTimezone: true }).notNull(),
    endpointId: uuid('endpoint_id'),
    requestCount: integer('request_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    validationFailureCount: integer('validation_failure_count')
      .notNull()
      .default(0),
    totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  },
  (table) => [
    uniqueIndex('mock_daily_stats_key_idx').on(
      table.projectId,
      table.day,
      table.endpointId,
    ),
  ],
);

export const mockConfigsRelations = relations(mockConfigs, ({ one }) => ({
  project: one(projects, {
    fields: [mockConfigs.projectId],
    references: [projects.id],
  }),
}));

export const mockScenariosRelations = relations(mockScenarios, ({ one }) => ({
  project: one(projects, {
    fields: [mockScenarios.projectId],
    references: [projects.id],
  }),
}));

export const mockRequestLogsRelations = relations(
  mockRequestLogs,
  ({ one }) => ({
    endpoint: one(endpoints, {
      fields: [mockRequestLogs.endpointId],
      references: [endpoints.id],
    }),
  }),
);
