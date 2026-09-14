import { type Database, jobs } from '@apion/db';
import { uuidv7 } from '@apion/domain';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DATABASE } from './database.module.js';

/**
 * PRD 07: "a `job` table polled every five seconds, retry/backoff and
 * `SKIP LOCKED`, concurrency one, bounded slices/yields".
 *
 * There is no worker process. One job runs at a time, in this process, and a
 * handler is expected to do a bounded slice and say whether more remains, so a
 * long sweep never holds the single vCPU away from the control plane.
 */

export type JobKind =
  | 'lint_sweep'
  | 'export_build'
  | 'log_prune'
  | 'notification_send'
  | 'collab_compaction';

export interface JobContext {
  jobId: string;
  projectId: string | null;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
}

export interface SliceResult {
  /** Where the next slice resumes. Merged into the job's progress. */
  progress: Record<string, unknown>;
  /** False when the job still has work; it is requeued rather than finished. */
  done: boolean;
}

export type JobHandler = (context: JobContext) => Promise<SliceResult>;

const POLL_INTERVAL_MS = 5_000;

@Injectable()
export class JobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<JobKind, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    // The loop must not hold the process open during a deploy restart.
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Claims and runs one slice. Public so a test can drive the loop without
   * waiting five seconds for the timer.
   */
  async tick(): Promise<boolean> {
    if (this.running || this.stopped) return false;
    this.running = true;

    try {
      const claimed = await this.claim();
      if (!claimed) return false;

      const handler = this.handlers.get(claimed.kind as JobKind);
      if (!handler) {
        await this.fail(claimed.id, `No handler for ${claimed.kind}.`);
        return true;
      }

      try {
        const result = await handler({
          jobId: claimed.id,
          projectId: claimed.projectId,
          payload: claimed.payload,
          progress: claimed.progress,
        });

        await (result.done
          ? this.finish(claimed.id, result.progress)
          : this.requeue(claimed.id, result.progress));
      } catch (error) {
        await this.fail(
          claimed.id,
          error instanceof Error ? error.message : String(error),
        );
      }

      return true;
    } finally {
      this.running = false;
    }
  }

  /**
   * `SKIP LOCKED` so a second process, if one ever exists, takes a different
   * row instead of blocking on this one.
   */
  private async claim(): Promise<typeof jobs.$inferSelect | null> {
    const [row] = await this.db
      .update(jobs)
      .set({ state: 'running', startedAt: new Date() })
      .where(
        eq(
          jobs.id,
          this.db
            .select({ id: jobs.id })
            .from(jobs)
            .where(
              and(eq(jobs.state, 'queued'), lte(jobs.runAfter, new Date())),
            )
            .orderBy(asc(jobs.runAfter), asc(jobs.id))
            .limit(1)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning();

    return row ?? null;
  }

  /** Requeued immediately: the yield between slices is the poll interval. */
  private async requeue(
    jobId: string,
    progress: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(jobs)
      .set({ state: 'queued', progress, runAfter: new Date() })
      .where(eq(jobs.id, jobId));
  }

  private async finish(
    jobId: string,
    progress: Record<string, unknown>,
  ): Promise<void> {
    await this.db
      .update(jobs)
      .set({ state: 'succeeded', progress, finishedAt: new Date() })
      .where(eq(jobs.id, jobId));
  }

  /** Exponential backoff until `maxAttempts`, then the job stays failed. */
  private async fail(jobId: string, message: string): Promise<void> {
    const [row] = await this.db
      .select({ attempts: jobs.attempts, maxAttempts: jobs.maxAttempts })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    const attempts = (row?.attempts ?? 0) + 1;
    const exhausted = attempts >= (row?.maxAttempts ?? 3);

    this.logger.warn(`Job ${jobId} failed (attempt ${attempts}): ${message}`);

    await this.db
      .update(jobs)
      .set({
        state: exhausted ? 'failed' : 'queued',
        attempts,
        lastError: message,
        runAfter: new Date(Date.now() + 2 ** attempts * 1_000),
        ...(exhausted ? { finishedAt: new Date() } : {}),
      })
      .where(eq(jobs.id, jobId));
  }

  async enqueue(
    kind: JobKind,
    projectId: string | null,
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    return this.enqueueAfter(kind, projectId, payload, 0);
  }

  /** Queues a job to run once a delay has passed; how a job reschedules itself. */
  async enqueueAfter(
    kind: JobKind,
    projectId: string | null,
    payload: Record<string, unknown>,
    delayMs: number,
  ): Promise<string> {
    const [row] = await this.db
      .insert(jobs)
      .values({
        id: uuidv7(),
        kind,
        projectId,
        payload,
        progress: {},
        runAfter: new Date(Date.now() + delayMs),
      })
      .returning({ id: jobs.id });

    return row.id;
  }

  /**
   * Queues a job only when no equivalent one is already pending. A recurring
   * job that reschedules itself would otherwise multiply on every restart.
   */
  async enqueueUnique(
    kind: JobKind,
    projectId: string | null,
    payload: Record<string, unknown> = {},
  ): Promise<string | null> {
    const [existing] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, kind),
          projectId === null
            ? isNull(jobs.projectId)
            : eq(jobs.projectId, projectId),
          inArray(jobs.state, ['queued', 'running']),
        ),
      )
      .limit(1);

    if (existing) return null;

    return this.enqueue(kind, projectId, payload);
  }

  /** Drops finished rows so the table does not grow without bound. */
  async pruneFinished(olderThan: Date): Promise<number> {
    const rows = await this.db
      .delete(jobs)
      .where(
        and(
          sql`${jobs.state} in ('succeeded', 'cancelled')`,
          lte(jobs.finishedAt, olderThan),
        ),
      )
      .returning({ id: jobs.id });

    return rows.length;
  }
}
