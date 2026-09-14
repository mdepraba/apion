import type {
  CreateResourceRequest,
  Project,
  Resource,
} from '@apion/contracts';
import { type Database, endpoints, resources } from '@apion/db';
import { assertFresh, uuidv7 } from '@apion/domain';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import {
  assertVersionMutable,
  ProjectsService,
} from '../projects/projects.service.js';

@Injectable()
export class ResourcesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  async list(versionId: string): Promise<Resource[]> {
    const rows = await this.db
      .select()
      .from(resources)
      .where(eq(resources.versionId, versionId))
      .orderBy(asc(resources.position), asc(resources.name));

    return rows.map(toResource);
  }

  async create(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    request: CreateResourceRequest,
  ): Promise<Resource> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    return this.db.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: resources.id })
        .from(resources)
        .where(
          and(
            eq(resources.versionId, versionId),
            eq(resources.name, request.name),
          ),
        )
        .limit(1);

      if (clash) {
        throw new ConflictException(
          `A resource named ${request.name} already exists.`,
        );
      }

      const [{ nextPosition }] = await tx
        .select({
          nextPosition: sql<number>`coalesce(max(${resources.position}) + 1, 0)`,
        })
        .from(resources)
        .where(eq(resources.versionId, versionId));

      const [row] = await tx
        .insert(resources)
        .values({
          id: uuidv7(),
          versionId,
          name: request.name,
          description: request.description ?? '',
          position: request.position ?? nextPosition,
        })
        .returning();

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'resource.created',
          targetType: 'resource',
          targetId: row.id,
          targetLabel: row.name,
        },
        tx,
      );

      return toResource(row);
    });
  }

  async remove(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    resourceId: string,
    expectedVersion: number,
  ): Promise<void> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(resources)
        .where(
          and(eq(resources.id, resourceId), eq(resources.versionId, versionId)),
        )
        .limit(1);

      if (!row) throw new NotFoundException('No such resource.');
      assertFresh(toResource(row), expectedVersion);

      const [{ endpointCount }] = await tx
        .select({ endpointCount: sql<number>`count(*)::int` })
        .from(endpoints)
        .where(eq(endpoints.resourceId, resourceId));

      // Deleting a resource would cascade to its endpoints. That is a bigger
      // decision than "remove this group", so it has to be explicit.
      if (endpointCount > 0) {
        throw new ConflictException(
          `${row.name} still holds ${endpointCount} ${endpointCount === 1 ? 'endpoint' : 'endpoints'}. Move or delete them first.`,
        );
      }

      await tx.delete(resources).where(eq(resources.id, resourceId));

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'resource.deleted',
          targetType: 'resource',
          targetId: resourceId,
          targetLabel: row.name,
        },
        tx,
      );
    });
  }
}

function toResource(row: typeof resources.$inferSelect): Resource {
  return {
    id: row.id,
    versionId: row.versionId,
    name: row.name,
    description: row.description,
    position: row.position,
    entityVersion: row.entityVersion,
  };
}
