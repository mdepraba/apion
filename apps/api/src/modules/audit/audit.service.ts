import type { AuditAction, AuditEvent } from '@apion/contracts';
import { auditEvents, type Database, type DatabaseExecutor } from '@apion/db';
import { uuidv7 } from '@apion/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

export interface RecordAuditInput {
  projectId: string | null;
  actor: Pick<AuthenticatedUser, 'id' | 'displayName'> | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * PRD 01 FR-1.7 and PRD 07: an append-only log. Nothing here updates or deletes
 * a row: the 12-month retention sweep is a job, not a service method.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes one event. Pass `tx` when the event must land with the change it
   * describes; a permission grant that commits without its audit row is exactly
   * the gap FR-1.7 exists to close.
   */
  async record(
    input: RecordAuditInput,
    tx: DatabaseExecutor = this.db,
  ): Promise<void> {
    await tx.insert(auditEvents).values({
      id: uuidv7(),
      projectId: input.projectId,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.displayName ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      metadata: input.metadata ?? {},
    });
  }

  /** The project activity feed, newest first, cursor-paged on `occurredAt`. */
  async feed(
    projectId: string,
    options: { limit: number; before?: Date },
  ): Promise<{ items: AuditEvent[]; nextCursor: string | null }> {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(
        options.before
          ? and(
              eq(auditEvents.projectId, projectId),
              lt(auditEvents.occurredAt, options.before),
            )
          : eq(auditEvents.projectId, projectId),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(options.limit + 1);

    const page = rows.slice(0, options.limit);
    const hasMore = rows.length > options.limit;

    return {
      items: page.map(toAuditEvent),
      nextCursor: hasMore
        ? (page.at(-1)?.occurredAt.toISOString() ?? null)
        : null,
    };
  }
}

function toAuditEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: row.id,
    projectId: row.projectId,
    actorId: row.actorId,
    actorName: row.actorName,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    metadata: row.metadata,
    occurredAt: row.occurredAt.toISOString(),
  };
}
