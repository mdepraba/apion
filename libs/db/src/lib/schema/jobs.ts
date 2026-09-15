import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * PRD 07: "a `job` table polled every five seconds, `pg-boss` retry/backoff and
 * `SKIP LOCKED`, concurrency one". There is no worker process: the API polls
 * this in-process and yields between slices, so a job must never assume it can
 * run to completion in one pass.
 */
export const jobKindEnum = pgEnum('job_kind', [
  'lint_sweep',
  'export_build',
  'log_prune',
  'notification_send',
  'collab_compaction',
]);

export const jobStateEnum = pgEnum('job_state', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    kind: jobKindEnum('kind').notNull(),
    state: jobStateEnum('state').notNull().default('queued'),
    projectId: uuid('project_id'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /**
     * Where a bounded slice stopped, so the next pass resumes instead of
     * restarting. A lint sweep keeps its cursor here between chunks of 25.
     */
    progress: jsonb('progress')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lastError: text('last_error'),
    runAfter: timestamp('run_after', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The claim query: queued jobs whose time has come, oldest first.
    index('jobs_claim_idx').on(table.state, table.runAfter),
    index('jobs_project_idx').on(table.projectId),
  ],
);

/**
 * A completed export, held on disk and reaped by the `log_prune` job. PRD 02
 * requires large exports to stream rather than allocate the archive in memory,
 * so the API hands back a job id and the file is fetched once it exists.
 */
export const exportArtifacts = pgTable(
  'export_artifacts',
  {
    id: uuid('id').primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    versionId: uuid('version_id').notNull(),
    format: varchar('format', { length: 40 }).notNull(),
    filePath: text('file_path').notNull(),
    byteSize: integer('byte_size').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('export_artifacts_expiry_idx').on(table.expiresAt)],
);
