import type {
  RuleIdValue,
  StandardDefinition,
  ViolationRecord,
} from '@apion/contracts';
import { ruleIds, standardPresets } from '@apion/contracts';
import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { endpoints } from './contract.js';
import { users } from './identity.js';
import { projects } from './projects.js';

export const ruleIdEnum = pgEnum('rule_id', ruleIds);
export const standardPresetEnum = pgEnum('standard_preset', standardPresets);
export const standardStateEnum = pgEnum('standard_state', ['draft', 'active']);

/**
 * PRD 03 FR-4.1: "A project has exactly one active, versioned response
 * standard. Edits create a draft."
 *
 * Both rows live here, distinguished by `state`, so publishing is a state swap
 * inside one transaction rather than a copy between tables. `version` only ever
 * moves on publish; that is the number endpoints cache against.
 */
export const responseStandards = pgTable(
  'response_standards',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    state: standardStateEnum('state').notNull().default('draft'),
    preset: standardPresetEnum('preset').notNull().default('simple'),
    definition: jsonb('definition').$type<StandardDefinition>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    entityVersion: integer('entity_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One active and one draft per project, enforced rather than assumed.
    uniqueIndex('response_standards_project_state_idx').on(
      table.projectId,
      table.state,
    ),
  ],
);

/**
 * The cached lint result for one endpoint. `standardVersion` is what makes the
 * recheck lazy: publishing bumps the project's standard in constant time and
 * every row here becomes stale without being touched.
 */
export const lintResults = pgTable(
  'lint_results',
  {
    endpointId: uuid('endpoint_id')
      .primaryKey()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    standardVersion: integer('standard_version').notNull(),
    violations: jsonb('violations')
      .$type<ViolationRecord[]>()
      .notNull()
      .default([]),
    /** Generated counts so health sums without opening the JSONB. */
    errorCount: integer('error_count').notNull().default(0),
    warnCount: integer('warn_count').notNull().default(0),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The health query: how much of this project is checked against v(n).
    index('lint_results_project_version_idx').on(
      table.projectId,
      table.standardVersion,
    ),
    index('lint_results_errors_idx').on(table.projectId, table.errorCount),
  ],
);

/**
 * FR-4.6: a waiver for one rule on one endpoint, with a justification that is
 * not optional. The unique index is what stops a second waiver quietly
 * widening the first.
 */
export const lintExemptions = pgTable(
  'lint_exemptions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    ruleId: ruleIdEnum('rule_id').$type<RuleIdValue>().notNull(),
    justification: text('justification').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('lint_exemptions_endpoint_rule_idx').on(
      table.endpointId,
      table.ruleId,
    ),
    index('lint_exemptions_project_idx').on(table.projectId),
  ],
);

export const responseStandardsRelations = relations(
  responseStandards,
  ({ one }) => ({
    project: one(projects, {
      fields: [responseStandards.projectId],
      references: [projects.id],
    }),
  }),
);

export const lintResultsRelations = relations(lintResults, ({ one }) => ({
  endpoint: one(endpoints, {
    fields: [lintResults.endpointId],
    references: [endpoints.id],
  }),
}));

export const lintExemptionsRelations = relations(lintExemptions, ({ one }) => ({
  endpoint: one(endpoints, {
    fields: [lintExemptions.endpointId],
    references: [endpoints.id],
  }),
  grantedByUser: one(users, {
    fields: [lintExemptions.grantedBy],
    references: [users.id],
  }),
}));
