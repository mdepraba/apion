import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  projectLifecycleStateEnum,
  projectVisibilityEnum,
  versionStateEnum,
} from './enums.js';
import { organisations, projectMembers, users } from './identity.js';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** Part of the mock URL, so a change has to be deliberate (FR-1.3). */
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description').notNull().default(''),
    visibility: projectVisibilityEnum('visibility')
      .notNull()
      .default('organisation'),
    lifecycleState: projectLifecycleStateEnum('lifecycle_state')
      .notNull()
      .default('active'),
    /** FR-1.5: a soft delete is recoverable for 30 days before any purge. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** FR-3.5: days an endpoint may sit in_progress before it is flagged. */
    staleStatusThresholdDays: integer('stale_status_threshold_days')
      .notNull()
      .default(14),
    entityVersion: integer('entity_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_org_slug_idx').on(table.organisationId, table.slug),
    index('projects_lifecycle_idx').on(
      table.organisationId,
      table.lifecycleState,
    ),
  ],
);

/** FR-3.2: `dev`, `staging`, `production` by default; status is per environment. */
export const environments = pgTable(
  'environments',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('environments_project_key_idx').on(table.projectId, table.key),
  ],
);

/** PRD 01: published versions are immutable snapshots; Phase 1 keeps them linear. */
export const contractVersions = pgTable(
  'contract_versions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 60 }).notNull(),
    state: versionStateEnum('state').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    entityVersion: integer('entity_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('contract_versions_project_label_idx').on(
      table.projectId,
      table.label,
    ),
    index('contract_versions_project_state_idx').on(
      table.projectId,
      table.state,
    ),
  ],
);

/** An endpoint group, and the OpenAPI tag it exports as. */
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    description: text('description').notNull().default(''),
    position: integer('position').notNull().default(0),
    entityVersion: integer('entity_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('resources_version_name_idx').on(table.versionId, table.name),
    // FR-2.1 loads the tree one resource at a time, ordered by position.
    index('resources_version_position_idx').on(table.versionId, table.position),
  ],
);

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [projects.organisationId],
    references: [organisations.id],
  }),
  members: many(projectMembers),
  environments: many(environments),
  versions: many(contractVersions),
}));

export const environmentsRelations = relations(environments, ({ one }) => ({
  project: one(projects, {
    fields: [environments.projectId],
    references: [projects.id],
  }),
}));

export const contractVersionsRelations = relations(
  contractVersions,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [contractVersions.projectId],
      references: [projects.id],
    }),
    resources: many(resources),
  }),
);

export const resourcesRelations = relations(resources, ({ one }) => ({
  version: one(contractVersions, {
    fields: [resources.versionId],
    references: [contractVersions.id],
  }),
}));
