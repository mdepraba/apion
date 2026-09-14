import type { MockLogEntry, MockLogQuery } from '@apion/contracts';
import { type Database, mockDailyStats, mockRequestLogs } from '@apion/db';
import { uuidv7 } from '@apion/domain';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';

/**
 * PRD 05: "Batch writes every two seconds or 100 rows into daily-partitioned
 * UNLOGGED storage. Retain detailed logs 48 hours and aggregates 90 days; store
 * bodies only on validation failure (8 KB cap) and redact `x-sensitive` fields."
 *
 * The batch is the point: a mock load test at 30 req/s must not become 30
 * inserts per second competing with the control plane for one vCPU.
 */

const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_AT_ROWS = 100;
const BODY_CAP_BYTES = 8 * 1024;
/** A bounded buffer: dropping diagnostics beats an unbounded queue on 1 GB. */
const MAX_BUFFERED = 1_000;

export interface PendingLog {
  projectId: string;
  environmentKey: string;
  method: string;
  path: string;
  endpointId: string | null;
  statusCode: number;
  source: string;
  latencyMs: number;
  validation: 'passed' | 'failed' | 'skipped';
  cache: 'hit' | 'miss' | 'bypass';
  requestId: string;
  callerIp: string | null;
  /** Held only for a validation failure; see `record`. */
  requestBody?: unknown;
}

@Injectable()
export class MockLogService implements OnApplicationShutdown {
  private readonly logger = new Logger(MockLogService.name);
  private buffer: (typeof mockRequestLogs.$inferInsert)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private dropped = 0;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Buffers one served request. Never awaits the write. */
  record(entry: PendingLog): void {
    if (this.buffer.length >= MAX_BUFFERED) {
      this.dropped += 1;
      return;
    }

    this.buffer.push({
      id: uuidv7(),
      projectId: entry.projectId,
      environmentKey: entry.environmentKey,
      method: entry.method,
      path: entry.path,
      endpointId: entry.endpointId,
      statusCode: entry.statusCode,
      source: entry.source,
      latencyMs: entry.latencyMs,
      validation: entry.validation,
      cache: entry.cache,
      requestId: entry.requestId,
      callerIp: entry.callerIp,
      requestBody:
        entry.validation === 'failed' && entry.requestBody !== undefined
          ? redact(entry.requestBody)
          : null,
    });

    if (this.buffer.length >= FLUSH_AT_ROWS) {
      void this.flush();
      return;
    }

    this.timer ??= setTimeout(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async flush(): Promise<number> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length === 0) return 0;

    const batch = this.buffer;
    this.buffer = [];

    if (this.dropped > 0) {
      this.logger.warn(
        `Dropped ${this.dropped} mock log entries while the buffer was full.`,
      );
      this.dropped = 0;
    }

    try {
      await this.db.insert(mockRequestLogs).values(batch);
      await this.aggregate(batch);
      return batch.length;
    } catch (error) {
      // A lost diagnostic log must never fail the request that produced it.
      this.logger.warn(
        `Could not write ${batch.length} mock log entries: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }

  /** The 90-day aggregates, written alongside the detail they outlive. */
  private async aggregate(
    batch: readonly (typeof mockRequestLogs.$inferInsert)[],
  ): Promise<void> {
    const buckets = new Map<
      string,
      {
        projectId: string;
        day: Date;
        endpointId: string | null;
        requestCount: number;
        errorCount: number;
        validationFailureCount: number;
        totalLatencyMs: number;
      }
    >();

    for (const row of batch) {
      const day = startOfDay(row.occurredAt ?? new Date());
      const key = `${row.projectId}:${day.toISOString()}:${row.endpointId ?? '-'}`;

      const bucket = buckets.get(key) ?? {
        projectId: row.projectId,
        day,
        endpointId: row.endpointId ?? null,
        requestCount: 0,
        errorCount: 0,
        validationFailureCount: 0,
        totalLatencyMs: 0,
      };

      bucket.requestCount += 1;
      if (row.statusCode >= 400) bucket.errorCount += 1;
      if (row.validation === 'failed') bucket.validationFailureCount += 1;
      bucket.totalLatencyMs += row.latencyMs;

      buckets.set(key, bucket);
    }

    for (const bucket of buckets.values()) {
      await this.db
        .insert(mockDailyStats)
        .values(bucket)
        .onConflictDoUpdate({
          target: [
            mockDailyStats.projectId,
            mockDailyStats.day,
            mockDailyStats.endpointId,
          ],
          set: {
            requestCount: sql`${mockDailyStats.requestCount} + ${bucket.requestCount}`,
            errorCount: sql`${mockDailyStats.errorCount} + ${bucket.errorCount}`,
            validationFailureCount: sql`${mockDailyStats.validationFailureCount} + ${bucket.validationFailureCount}`,
            totalLatencyMs: sql`${mockDailyStats.totalLatencyMs} + ${bucket.totalLatencyMs}`,
          },
        });
    }
  }

  /** FR-6.7's filterable log, newest first. */
  async list(
    projectId: string,
    query: MockLogQuery,
  ): Promise<{ items: MockLogEntry[]; nextCursor: string | null }> {
    // Anything still buffered is what the reader is most likely looking for.
    await this.flush();

    const filters = [eq(mockRequestLogs.projectId, projectId)];
    if (query.environmentKey) {
      filters.push(eq(mockRequestLogs.environmentKey, query.environmentKey));
    }
    if (query.status !== undefined) {
      filters.push(eq(mockRequestLogs.statusCode, query.status));
    }
    if (query.endpointId) {
      filters.push(eq(mockRequestLogs.endpointId, query.endpointId));
    }
    if (query.cursor) {
      filters.push(lt(mockRequestLogs.occurredAt, new Date(query.cursor)));
    }

    const rows = await this.db
      .select()
      .from(mockRequestLogs)
      .where(and(...filters))
      .orderBy(desc(mockRequestLogs.occurredAt))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);

    return {
      items: page.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        environmentKey: row.environmentKey,
        method: row.method,
        path: row.path,
        endpointId: row.endpointId,
        statusCode: row.statusCode,
        source: row.source,
        latencyMs: row.latencyMs,
        validation: row.validation,
        cache: row.cache,
        requestId: row.requestId,
        callerIp: row.callerIp,
        requestBody: row.requestBody,
        occurredAt: row.occurredAt.toISOString(),
      })),
      nextCursor:
        rows.length > query.limit
          ? (page.at(-1)?.occurredAt.toISOString() ?? null)
          : null,
    };
  }

  /** Detail for 48 hours, aggregates for 90 days. Run by the prune job. */
  async prune(
    now: Date = new Date(),
  ): Promise<{ logs: number; stats: number }> {
    const logCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const statsCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const logs = await this.db
      .delete(mockRequestLogs)
      .where(lt(mockRequestLogs.occurredAt, logCutoff))
      .returning({ id: mockRequestLogs.id });

    const stats = await this.db
      .delete(mockDailyStats)
      .where(lt(mockDailyStats.day, statsCutoff))
      .returning({ projectId: mockDailyStats.projectId });

    return { logs: logs.length, stats: stats.length };
  }

  /** Anything buffered at shutdown is written before the pool drains. */
  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }
}

/**
 * PRD 05 caps a stored body at 8 KB and redacts `x-sensitive` fields. A key is
 * treated as sensitive when the contract marked it so or when its name is one
 * of the obvious credentials, because a mock is not where a token should land.
 */
const SENSITIVE_NAME =
  /^(password|passwd|secret|token|authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|credit[-_]?card|card[-_]?number|cvv|ssn)$/i;

export function redact(body: unknown): string {
  const cleaned = walk(body, 0);
  const serialised = JSON.stringify(cleaned) ?? '';

  return serialised.length > BODY_CAP_BYTES
    ? `${serialised.slice(0, BODY_CAP_BYTES)}…[truncated]`
    : serialised;
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 8) return '[deep]';
  if (Array.isArray(value))
    return value.map((member) => walk(member, depth + 1));
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      SENSITIVE_NAME.test(key) ? '[redacted]' : walk(member, depth + 1),
    ]),
  );
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
