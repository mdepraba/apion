import type {
  EndpointResponse,
  Parameter,
  RequestBody,
} from '@apion/contracts';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { httpMethodEnum } from './enums.js';
import { users } from './identity.js';
import { contractVersions, resources } from './projects.js';

/**
 * Parameters, request body and responses are stored as JSONB on the endpoint
 * rather than in child tables. An endpoint is always read and written whole
 * (the editor loads one and saves one), so splitting it would buy nothing but
 * joins, and PRD 07 budgets for a 1 vCPU host.
 */
export const endpoints = pgTable(
  'endpoints',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    method: httpMethodEnum('method').notNull(),
    path: varchar('path', { length: 500 }).notNull(),
    summary: varchar('summary', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    operationId: varchar('operation_id', { length: 120 }),
    parameters: jsonb('parameters').$type<Parameter[]>().notNull().default([]),
    requestBody: jsonb('request_body').$type<RequestBody | null>(),
    responses: jsonb('responses')
      .$type<EndpointResponse[]>()
      .notNull()
      .default([]),
    authRequired: boolean('auth_required').notNull().default(true),
    deprecated: boolean('deprecated').notNull().default(false),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ticketUrl: varchar('ticket_url', { length: 500 }),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    position: integer('position').notNull().default(0),
    /**
     * PRD 03: the standard version this endpoint's cached lint result belongs
     * to. Publishing a standard bumps the project counter in constant time and
     * leaves these behind, which is what makes the relint lazy.
     */
    lintCheckedStandardVersion: integer('lint_checked_standard_version'),
    entityVersion: integer('entity_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Two endpoints in one version cannot answer the same request.
    uniqueIndex('endpoints_version_method_path_idx').on(
      table.versionId,
      table.method,
      table.path,
    ),
    index('endpoints_resource_position_idx').on(
      table.resourceId,
      table.position,
    ),
    index('endpoints_owner_idx').on(table.ownerId),
    // FR-1.6 searches summary and path across every readable project.
    index('endpoints_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.summary} || ' ' || ${table.path})`,
    ),
  ],
);

export const namedSchemas = pgTable(
  'named_schemas',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    description: text('description').notNull().default(''),
    schema: jsonb('schema').notNull(),
    /** Maintained on write so FR-2.4 can show it without a scan. */
    usageCount: integer('usage_count').notNull().default(0),
    entityVersion: integer('entity_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('named_schemas_version_name_idx').on(
      table.versionId,
      table.name,
    ),
    // PRD 07 calls for JSONB/GIN so schema bodies are searchable.
    index('named_schemas_body_idx').using('gin', table.schema),
  ],
);

/**
 * Which endpoint or schema references which named schema. Derived from the
 * documents on every write, so a rename can report its impact count and update
 * all references in one transaction (FR-2.4) without scanning every row.
 */
export const schemaReferences = pgTable(
  'schema_references',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => contractVersions.id, { onDelete: 'cascade' }),
    schemaId: uuid('schema_id')
      .notNull()
      .references(() => namedSchemas.id, { onDelete: 'cascade' }),
    sourceEndpointId: uuid('source_endpoint_id').references(
      () => endpoints.id,
      {
        onDelete: 'cascade',
      },
    ),
    sourceSchemaId: uuid('source_schema_id').references(() => namedSchemas.id, {
      onDelete: 'cascade',
    }),
    pointer: varchar('pointer', { length: 1000 }).notNull(),
  },
  (table) => [
    index('schema_references_schema_idx').on(table.schemaId),
    index('schema_references_endpoint_idx').on(table.sourceEndpointId),
    index('schema_references_version_idx').on(table.versionId),
  ],
);

export const endpointsRelations = relations(endpoints, ({ one, many }) => ({
  version: one(contractVersions, {
    fields: [endpoints.versionId],
    references: [contractVersions.id],
  }),
  resource: one(resources, {
    fields: [endpoints.resourceId],
    references: [resources.id],
  }),
  owner: one(users, { fields: [endpoints.ownerId], references: [users.id] }),
  references: many(schemaReferences),
}));

export const namedSchemasRelations = relations(
  namedSchemas,
  ({ one, many }) => ({
    version: one(contractVersions, {
      fields: [namedSchemas.versionId],
      references: [contractVersions.id],
    }),
    referencedBy: many(schemaReferences),
  }),
);

export const schemaReferencesRelations = relations(
  schemaReferences,
  ({ one }) => ({
    schema: one(namedSchemas, {
      fields: [schemaReferences.schemaId],
      references: [namedSchemas.id],
    }),
    sourceEndpoint: one(endpoints, {
      fields: [schemaReferences.sourceEndpointId],
      references: [endpoints.id],
    }),
  }),
);
