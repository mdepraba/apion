import type {
  CreateEndpointRequest,
  Endpoint,
  EndpointSummary,
  Project,
  UpdateEndpointRequest,
} from '@apion/contracts';
import { validateEndpointPath } from '@apion/contracts';
import {
  type Database,
  type DatabaseExecutor,
  endpointStatuses,
  endpoints,
  environments,
  namedSchemas,
  resources,
  schemaReferences,
} from '@apion/db';
import { applyEndpointChange, collectRefs, uuidv7 } from '@apion/domain';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import {
  assertVersionMutable,
  ProjectsService,
} from '../projects/projects.service.js';

@Injectable()
export class EndpointsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * FR-2.1: the tree loads one resource at a time. Rows carry only what a
   * virtualised list renders, so a 1,500-endpoint project stays usable.
   */
  async listSummaries(
    versionId: string,
    options: { resourceId?: string; environmentId?: string },
  ): Promise<EndpointSummary[]> {
    const where = options.resourceId
      ? and(
          eq(endpoints.versionId, versionId),
          eq(endpoints.resourceId, options.resourceId),
        )
      : eq(endpoints.versionId, versionId);

    const rows = await this.db
      .select({
        id: endpoints.id,
        resourceId: endpoints.resourceId,
        method: endpoints.method,
        path: endpoints.path,
        summary: endpoints.summary,
        deprecated: endpoints.deprecated,
        position: endpoints.position,
        status: endpointStatuses.status,
      })
      .from(endpoints)
      .leftJoin(
        endpointStatuses,
        options.environmentId
          ? and(
              eq(endpointStatuses.endpointId, endpoints.id),
              eq(endpointStatuses.environmentId, options.environmentId),
            )
          : sql`false`,
      )
      .where(where)
      .orderBy(asc(endpoints.position), asc(endpoints.path));

    return rows.map((row) => ({
      id: row.id,
      resourceId: row.resourceId,
      method: row.method,
      path: row.path,
      summary: row.summary,
      deprecated: row.deprecated,
      status: row.status ?? null,
      // Populated in Phase 4 when comments land (PRD 06 FR-5.4).
      unresolvedComments: 0,
      position: row.position,
    }));
  }

  async findOne(versionId: string, endpointId: string): Promise<Endpoint> {
    const [row] = await this.db
      .select()
      .from(endpoints)
      .where(
        and(eq(endpoints.id, endpointId), eq(endpoints.versionId, versionId)),
      )
      .limit(1);

    if (!row) throw new NotFoundException('No such endpoint.');
    return toEndpoint(row);
  }

  async create(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    request: CreateEndpointRequest,
  ): Promise<Endpoint> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);
    assertPathUsable(request.path);

    return this.db.transaction(async (tx) => {
      const [resource] = await tx
        .select({ id: resources.id })
        .from(resources)
        .where(
          and(
            eq(resources.id, request.resourceId),
            eq(resources.versionId, versionId),
          ),
        )
        .limit(1);

      if (!resource)
        throw new NotFoundException('No such resource in this version.');

      const [existing] = await tx
        .select({ id: endpoints.id })
        .from(endpoints)
        .where(
          and(
            eq(endpoints.versionId, versionId),
            eq(endpoints.method, request.method),
            eq(endpoints.path, request.path),
          ),
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `${request.method.toUpperCase()} ${request.path} already exists in this version.`,
        );
      }

      const [{ nextPosition }] = await tx
        .select({
          nextPosition: sql<number>`coalesce(max(${endpoints.position}) + 1, 0)`,
        })
        .from(endpoints)
        .where(eq(endpoints.resourceId, request.resourceId));

      const [row] = await tx
        .insert(endpoints)
        .values({
          id: uuidv7(),
          versionId,
          resourceId: request.resourceId,
          method: request.method,
          path: request.path,
          summary: request.summary,
          description: request.description ?? '',
          operationId: request.operationId ?? null,
          parameters: request.parameters ?? [],
          requestBody: request.requestBody ?? null,
          // Ids are the server's to assign, for the response and each example.
          responses: withResponseIds(request.responses ?? []),
          authRequired: request.authRequired ?? true,
          deprecated: request.deprecated ?? false,
          ownerId: request.ownerId ?? null,
          ticketUrl: request.ticketUrl ?? null,
          tags: request.tags ?? [],
          position: nextPosition,
        })
        .returning();

      await this.seedStatuses(tx, project.id, row.id);
      await this.reindexReferences(tx, versionId, row.id, row);

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'endpoint.created',
          targetType: 'endpoint',
          targetId: row.id,
          targetLabel: `${row.method.toUpperCase()} ${row.path}`,
        },
        tx,
      );

      return toEndpoint(row);
    });
  }

  /**
   * Every endpoint mutation goes through `applyEndpointChange` (PRD 06), which
   * owns the version check and works out which fields actually moved.
   */
  async update(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    endpointId: string,
    expectedVersion: number,
    request: UpdateEndpointRequest,
  ): Promise<Endpoint> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);
    if (request.path !== undefined) assertPathUsable(request.path);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(endpoints)
        .where(
          and(eq(endpoints.id, endpointId), eq(endpoints.versionId, versionId)),
        )
        .limit(1);

      if (!row) throw new NotFoundException('No such endpoint.');

      const { next, changedFields } = applyEndpointChange(toEndpoint(row), {
        // Ids stay the server's to assign here as they are on create: a client
        // may send back the ones it was given, and anything new gets one.
        patch: request.responses
          ? { ...request, responses: withResponseIds(request.responses) }
          : request,
        expectedVersion,
        actorId: user.id,
        at: new Date(),
      });

      if (changedFields.length === 0) return next;

      const [updated] = await tx
        .update(endpoints)
        .set({
          resourceId: next.resourceId,
          method: next.method,
          path: next.path,
          summary: next.summary,
          description: next.description,
          operationId: next.operationId,
          parameters: next.parameters,
          requestBody: next.requestBody,
          responses: next.responses,
          authRequired: next.authRequired,
          deprecated: next.deprecated,
          ownerId: next.ownerId,
          ticketUrl: next.ticketUrl,
          tags: next.tags,
          entityVersion: next.entityVersion,
          updatedAt: new Date(next.updatedAt),
        })
        .where(
          and(
            eq(endpoints.id, endpointId),
            eq(endpoints.entityVersion, expectedVersion),
          ),
        )
        .returning();

      if (!updated) {
        throw new ConflictException(
          'Someone saved this endpoint while you were editing it. Reload to see their change.',
        );
      }

      await this.reindexReferences(tx, versionId, endpointId, updated);

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'endpoint.updated',
          targetType: 'endpoint',
          targetId: endpointId,
          targetLabel: `${updated.method.toUpperCase()} ${updated.path}`,
          metadata: { changed: changedFields },
        },
        tx,
      );

      return toEndpoint(updated);
    });
  }

  /** PRD 01: a delete is a server-authoritative, version-checked transaction. */
  async remove(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    endpointId: string,
    expectedVersion: number,
  ): Promise<void> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(endpoints)
        .where(
          and(
            eq(endpoints.id, endpointId),
            eq(endpoints.versionId, versionId),
            eq(endpoints.entityVersion, expectedVersion),
          ),
        )
        .returning();

      if (!row) {
        const [current] = await tx
          .select({ entityVersion: endpoints.entityVersion })
          .from(endpoints)
          .where(eq(endpoints.id, endpointId))
          .limit(1);

        throw current
          ? new ConflictException(
              'Someone changed this endpoint while you were reading it. Reload before deleting.',
            )
          : new NotFoundException('No such endpoint.');
      }

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'endpoint.deleted',
          targetType: 'endpoint',
          targetId: endpointId,
          targetLabel: `${row.method.toUpperCase()} ${row.path}`,
        },
        tx,
      );
    });
  }

  /** Every environment starts an endpoint at `draft` so FR-3.6 has a denominator. */
  private async seedStatuses(
    tx: DatabaseExecutor,
    projectId: string,
    endpointId: string,
  ): Promise<void> {
    const rows = await tx
      .select({ id: environments.id })
      .from(environments)
      .where(eq(environments.projectId, projectId));

    if (rows.length === 0) return;

    await tx.insert(endpointStatuses).values(
      rows.map((environment) => ({
        endpointId,
        environmentId: environment.id,
        status: 'draft' as const,
        changedVia: 'ui' as const,
      })),
    );
  }

  /**
   * Rebuilds this endpoint's `$ref` rows and refreshes the affected schemas'
   * usage counts, so FR-2.4 can report a rename's impact without a scan.
   */
  private async reindexReferences(
    tx: DatabaseExecutor,
    versionId: string,
    endpointId: string,
    row: typeof endpoints.$inferSelect,
  ): Promise<void> {
    await tx
      .delete(schemaReferences)
      .where(eq(schemaReferences.sourceEndpointId, endpointId));

    const sites = [
      ...collectRefs(row.requestBody?.schema, '#/requestBody'),
      ...collectRefs(row.parameters, '#/parameters'),
      ...collectRefs(row.responses, '#/responses'),
    ];

    if (sites.length > 0) {
      const named = await tx
        .select({ id: namedSchemas.id, name: namedSchemas.name })
        .from(namedSchemas)
        .where(
          and(
            eq(namedSchemas.versionId, versionId),
            inArray(namedSchemas.name, [
              ...new Set(sites.map((s) => s.schemaName)),
            ]),
          ),
        );

      const idByName = new Map(named.map((schema) => [schema.name, schema.id]));
      const rows = sites
        .map((site) => ({
          id: uuidv7(),
          versionId,
          schemaId: idByName.get(site.schemaName),
          sourceEndpointId: endpointId,
          sourceSchemaId: null,
          pointer: site.pointer,
        }))
        // A ref to a schema that does not exist yet is a lint concern (PRD 03),
        // not a reason to refuse the save.
        .filter(
          (r): r is typeof r & { schemaId: string } => r.schemaId !== undefined,
        );

      if (rows.length > 0) await tx.insert(schemaReferences).values(rows);
    }

    await refreshUsageCounts(tx, versionId);
  }
}

/** Recomputes usage counts for one version from the reference table. */
export async function refreshUsageCounts(
  tx: DatabaseExecutor,
  versionId: string,
): Promise<void> {
  await tx
    .update(namedSchemas)
    .set({
      usageCount: sql`(
        select count(*) from ${schemaReferences}
        where ${schemaReferences.schemaId} = ${namedSchemas.id}
      )`,
    })
    .where(eq(namedSchemas.versionId, versionId));
}

/**
 * Ids for a response array on its way into storage.
 *
 * Both create and update go through here so there is one answer to who owns an
 * id. One the client already holds is kept, which is what lets an editor send
 * the whole array back and have every response it did not touch stay the same
 * response; anything without one is new and gets a fresh id.
 */
function withResponseIds(
  responses: NonNullable<UpdateEndpointRequest['responses']>,
): Endpoint['responses'] {
  return responses.map((response) => ({
    ...response,
    id: response.id ?? uuidv7(),
    examples: response.examples.map((example) => ({
      ...example,
      id: example.id ?? uuidv7(),
    })),
  }));
}

function assertPathUsable(path: string): void {
  const problems = validateEndpointPath(path);
  if (problems.length > 0) {
    // The Zod schema already rejects these at the boundary; this guards the
    // paths that reach the service from an import rather than a request body.
    throw new ConflictException(`"${path}" is not a usable endpoint path.`);
  }
}

export function toEndpoint(row: typeof endpoints.$inferSelect): Endpoint {
  return {
    id: row.id,
    versionId: row.versionId,
    resourceId: row.resourceId,
    method: row.method,
    path: row.path,
    summary: row.summary,
    description: row.description,
    operationId: row.operationId,
    parameters: row.parameters,
    requestBody: row.requestBody,
    responses: row.responses,
    authRequired: row.authRequired,
    deprecated: row.deprecated,
    ownerId: row.ownerId,
    ticketUrl: row.ticketUrl,
    tags: row.tags,
    position: row.position,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
