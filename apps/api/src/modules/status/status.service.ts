import type {
  EndpointStatus,
  EndpointStatusEvent,
  ImplementationStatus,
  Project,
  StatusRollup,
  UpdateStatusRequest,
} from '@apion/contracts';
import {
  type Database,
  endpointStatusEvents,
  endpointStatuses,
  endpoints,
  environments,
  resources,
  users,
} from '@apion/db';
import {
  canTransition,
  DEFAULT_STALE_THRESHOLD_DAYS,
  explainTransition,
  isStatusStale,
  uuidv7,
} from '@apion/domain';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

@Injectable()
export class StatusService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * PRD 04 FR-3.4. Both the UI and the CI endpoint land here.
   *
   * Concurrency works differently from other writes: the later write wins the
   * current state and *both* events stay in history, so a human and a
   * deployment updating within the same second lose nothing.
   */
  async update(
    actor: AuthenticatedUser | null,
    project: Project,
    endpointId: string,
    request: UpdateStatusRequest,
    channel: 'ui' | 'ci',
  ): Promise<EndpointStatus> {
    return this.db.transaction(async (tx) => {
      const [environment] = await tx
        .select()
        .from(environments)
        .where(
          and(
            eq(environments.projectId, project.id),
            eq(environments.key, request.environment),
          ),
        )
        .limit(1);

      if (!environment) {
        throw new NotFoundException(
          `This project has no "${request.environment}" environment.`,
        );
      }

      const [endpoint] = await tx
        .select({
          id: endpoints.id,
          method: endpoints.method,
          path: endpoints.path,
        })
        .from(endpoints)
        .where(eq(endpoints.id, endpointId))
        .limit(1);

      if (!endpoint) throw new NotFoundException('No such endpoint.');

      const [existing] = await tx
        .select()
        .from(endpointStatuses)
        .where(
          and(
            eq(endpointStatuses.endpointId, endpointId),
            eq(endpointStatuses.environmentId, environment.id),
          ),
        )
        .limit(1);

      const from: ImplementationStatus = existing?.status ?? 'draft';
      if (!canTransition(from, request.status)) {
        throw new BadRequestException(explainTransition(from, request.status));
      }

      const changedAt = new Date();

      const [current] = await tx
        .insert(endpointStatuses)
        .values({
          endpointId,
          environmentId: environment.id,
          status: request.status,
          note: request.note ?? null,
          changedBy: actor?.id ?? null,
          changedVia: channel,
          changedAt,
        })
        .onConflictDoUpdate({
          target: [endpointStatuses.endpointId, endpointStatuses.environmentId],
          set: {
            status: request.status,
            note: request.note ?? null,
            changedBy: actor?.id ?? null,
            changedVia: channel,
            changedAt,
          },
        })
        .returning();

      // FR-3.3: history is append-only, so a lost race still leaves its event.
      await tx.insert(endpointStatusEvents).values({
        id: uuidv7(),
        endpointId,
        environmentId: environment.id,
        status: request.status,
        note: request.note ?? null,
        changedBy: actor?.id ?? null,
        changedVia: channel,
        changedAt,
      });

      await this.audit.record(
        {
          projectId: project.id,
          actor,
          action: 'endpoint.status_changed',
          targetType: 'endpoint',
          targetId: endpointId,
          targetLabel: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
          metadata: {
            environment: environment.key,
            from,
            to: request.status,
            via: channel,
          },
        },
        tx,
      );

      return toEndpointStatus(current);
    });
  }

  async statusesFor(endpointId: string): Promise<EndpointStatus[]> {
    const rows = await this.db
      .select()
      .from(endpointStatuses)
      .where(eq(endpointStatuses.endpointId, endpointId));

    return rows.map(toEndpointStatus);
  }

  /** FR-3.3: the endpoint sidebar's history, newest first. */
  async history(
    endpointId: string,
    environmentId?: string,
  ): Promise<EndpointStatusEvent[]> {
    const rows = await this.db
      .select({ event: endpointStatusEvents, actorName: users.displayName })
      .from(endpointStatusEvents)
      .leftJoin(users, eq(users.id, endpointStatusEvents.changedBy))
      .where(
        environmentId
          ? and(
              eq(endpointStatusEvents.endpointId, endpointId),
              eq(endpointStatusEvents.environmentId, environmentId),
            )
          : eq(endpointStatusEvents.endpointId, endpointId),
      )
      .orderBy(desc(endpointStatusEvents.changedAt))
      .limit(200);

    return rows.map(({ event, actorName }) => ({
      ...toEndpointStatus(event),
      id: event.id,
      actorName,
    }));
  }

  /**
   * FR-3.6: per-project and per-resource rollups for one environment, each
   * reporting its own denominator.
   */
  async rollups(
    project: Project,
    versionId: string,
    environmentKey: string,
    thresholdDays = DEFAULT_STALE_THRESHOLD_DAYS,
  ): Promise<StatusRollup[]> {
    const [environment] = await this.db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.projectId, project.id),
          eq(environments.key, environmentKey),
        ),
      )
      .limit(1);

    if (!environment) {
      throw new NotFoundException(
        `This project has no "${environmentKey}" environment.`,
      );
    }

    const rows = await this.db
      .select({
        resourceId: endpoints.resourceId,
        resourceName: resources.name,
        status: endpointStatuses.status,
        changedAt: endpointStatuses.changedAt,
      })
      .from(endpoints)
      .innerJoin(resources, eq(resources.id, endpoints.resourceId))
      .leftJoin(
        endpointStatuses,
        and(
          eq(endpointStatuses.endpointId, endpoints.id),
          eq(endpointStatuses.environmentId, environment.id),
        ),
      )
      .where(eq(endpoints.versionId, versionId));

    const now = new Date();
    const projectRollup = emptyRollup(
      'project',
      project.id,
      project.name,
      environment.id,
    );
    const byResource = new Map<string, StatusRollup>();

    for (const row of rows) {
      const status: ImplementationStatus = row.status ?? 'draft';
      const resourceRollup =
        byResource.get(row.resourceId) ??
        emptyRollup(
          'resource',
          row.resourceId,
          row.resourceName,
          environment.id,
        );

      for (const rollup of [projectRollup, resourceRollup]) {
        rollup.total += 1;
        rollup.byStatus[status] = (rollup.byStatus[status] ?? 0) + 1;
        if (status === 'implemented') rollup.implemented += 1;
        if (
          row.changedAt &&
          isStatusStale(status, row.changedAt, now, thresholdDays)
        ) {
          rollup.stale += 1;
        }
      }

      byResource.set(row.resourceId, resourceRollup);
    }

    return [projectRollup, ...byResource.values()];
  }
}

function emptyRollup(
  scope: 'project' | 'resource',
  scopeId: string,
  label: string,
  environmentId: string,
): StatusRollup {
  return {
    scope,
    scopeId,
    label,
    environmentId,
    total: 0,
    byStatus: {},
    implemented: 0,
    stale: 0,
  };
}

function toEndpointStatus(
  row:
    | typeof endpointStatuses.$inferSelect
    | typeof endpointStatusEvents.$inferSelect,
): EndpointStatus {
  return {
    endpointId: row.endpointId,
    environmentId: row.environmentId,
    status: row.status,
    note: row.note,
    changedBy: row.changedBy,
    changedVia: row.changedVia,
    changedAt: row.changedAt.toISOString(),
  };
}
