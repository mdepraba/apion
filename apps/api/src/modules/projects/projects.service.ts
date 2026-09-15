import type {
  ContractVersion,
  CreateProjectRequest,
  CreateVersionRequest,
  Environment,
  Project,
  ProjectMember,
  UpdateProjectRequest,
  UpsertMemberRequest,
} from '@apion/contracts';
import {
  contractVersions,
  type Database,
  type DatabaseExecutor,
  endpoints,
  environments,
  namedSchemas,
  projectMembers,
  projects,
  resources,
  users,
} from '@apion/db';
import { assertFresh, uuidv7 } from '@apion/domain';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { toProject } from '../auth/project-access.service.js';

/** FR-3.2 names these three; a project may add more later. */
const DEFAULT_ENVIRONMENTS = [
  { key: 'dev', name: 'Development', isPrimary: true },
  { key: 'staging', name: 'Staging', isPrimary: false },
  { key: 'production', name: 'Production', isPrimary: false },
] as const;

/** PRD 01 FR-1.5. */
const RECOVERY_WINDOW_DAYS = 30;

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** FR-1.2: the switcher lists every project the caller may open. */
  async listForUser(user: AuthenticatedUser): Promise<Project[]> {
    const rows = await this.db
      .select({ project: projects, role: projectMembers.role })
      .from(projects)
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, user.id),
        ),
      )
      .where(eq(projects.organisationId, user.organisationId))
      .orderBy(asc(projects.name));

    return rows
      .filter(
        (row) =>
          row.role !== null ||
          (row.project.visibility === 'organisation' &&
            row.project.lifecycleState === 'active'),
      )
      .map((row) => toProject(row.project));
  }

  /**
   * Creates the project, its default environments, its first draft version and
   * the creator's Owner membership in one transaction. A project that exists
   * without an owner or a version is not a state anything else handles.
   */
  async create(
    user: AuthenticatedUser,
    request: CreateProjectRequest,
  ): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organisationId, user.organisationId),
            eq(projects.slug, request.slug),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(
          `The slug "${request.slug}" is taken in this organisation.`,
        );
      }

      const [row] = await tx
        .insert(projects)
        .values({
          id: uuidv7(),
          organisationId: user.organisationId,
          slug: request.slug,
          name: request.name,
          description: request.description ?? '',
          visibility: request.visibility,
        })
        .returning();

      await tx.insert(projectMembers).values({
        projectId: row.id,
        userId: user.id,
        role: 'owner',
      });

      await tx.insert(environments).values(
        DEFAULT_ENVIRONMENTS.map((environment, index) => ({
          id: uuidv7(),
          projectId: row.id,
          key: environment.key,
          name: environment.name,
          isPrimary: environment.isPrimary,
          position: index,
        })),
      );

      await tx.insert(contractVersions).values({
        id: uuidv7(),
        projectId: row.id,
        label: 'v1',
        state: 'draft',
      });

      await this.audit.record(
        {
          projectId: row.id,
          actor: user,
          action: 'project.created',
          targetType: 'project',
          targetId: row.id,
          targetLabel: row.name,
        },
        tx,
      );

      return toProject(row);
    });
  }

  async update(
    user: AuthenticatedUser,
    current: Project,
    expectedVersion: number,
    request: UpdateProjectRequest,
  ): Promise<Project> {
    assertFresh(current, expectedVersion);

    return this.db.transaction(async (tx) => {
      if (request.slug && request.slug !== current.slug) {
        // FR-1.3: the slug is part of the mock URL, so a collision is a hard
        // failure rather than something to disambiguate silently.
        const clash = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.organisationId, current.organisationId),
              eq(projects.slug, request.slug),
            ),
          )
          .limit(1);

        if (clash.length > 0) {
          throw new ConflictException(
            `The slug "${request.slug}" is taken in this organisation.`,
          );
        }
      }

      const [row] = await tx
        .update(projects)
        .set({
          ...(request.slug !== undefined && { slug: request.slug }),
          ...(request.name !== undefined && { name: request.name }),
          ...(request.description !== undefined && {
            description: request.description,
          }),
          ...(request.visibility !== undefined && {
            visibility: request.visibility,
          }),
          entityVersion: current.entityVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projects.id, current.id),
            eq(projects.entityVersion, expectedVersion),
          ),
        )
        .returning();

      // The row moved between the read and the write. Re-read so the caller
      // gets a conflict carrying the state that actually won.
      if (!row) return this.reportConflict(current.id, expectedVersion);

      await this.audit.record(
        {
          projectId: row.id,
          actor: user,
          action: 'project.updated',
          targetType: 'project',
          targetId: row.id,
          targetLabel: row.name,
          metadata: { changed: Object.keys(request) },
        },
        tx,
      );

      return toProject(row);
    });
  }

  /** FR-1.5: archiving freezes edits and stops the project's mocks. */
  async archive(
    user: AuthenticatedUser,
    current: Project,
    expectedVersion: number,
  ): Promise<Project> {
    return this.setLifecycle(user, current, expectedVersion, {
      lifecycleState: 'archived',
      deletedAt: null,
      action: 'project.archived',
    });
  }

  /** FR-1.5: a soft delete, recoverable for 30 days. No purge happens here. */
  async softDelete(
    user: AuthenticatedUser,
    current: Project,
    expectedVersion: number,
  ): Promise<Project> {
    return this.setLifecycle(user, current, expectedVersion, {
      lifecycleState: 'deleted',
      deletedAt: new Date(),
      action: 'project.deleted',
    });
  }

  /** FR-1.5: restoring is a Maintainer action and is always audited. */
  async restore(
    user: AuthenticatedUser,
    current: Project,
    expectedVersion: number,
  ): Promise<Project> {
    if (current.lifecycleState === 'active') {
      throw new BadRequestException('This project is already active.');
    }

    if (current.deletedAt) {
      const deadline = new Date(current.deletedAt);
      deadline.setDate(deadline.getDate() + RECOVERY_WINDOW_DAYS);
      if (deadline.getTime() < Date.now()) {
        throw new BadRequestException(
          `The ${RECOVERY_WINDOW_DAYS}-day recovery window for this project has passed.`,
        );
      }
    }

    return this.setLifecycle(user, current, expectedVersion, {
      lifecycleState: 'active',
      deletedAt: null,
      action: 'project.restored',
    });
  }

  private async setLifecycle(
    user: AuthenticatedUser,
    current: Project,
    expectedVersion: number,
    change: {
      lifecycleState: 'active' | 'archived' | 'deleted';
      deletedAt: Date | null;
      action: 'project.archived' | 'project.deleted' | 'project.restored';
    },
  ): Promise<Project> {
    assertFresh(current, expectedVersion);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set({
          lifecycleState: change.lifecycleState,
          deletedAt: change.deletedAt,
          entityVersion: current.entityVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projects.id, current.id),
            eq(projects.entityVersion, expectedVersion),
          ),
        )
        .returning();

      if (!row) return this.reportConflict(current.id, expectedVersion);

      await this.audit.record(
        {
          projectId: row.id,
          actor: user,
          action: change.action,
          targetType: 'project',
          targetId: row.id,
          targetLabel: row.name,
        },
        tx,
      );

      return toProject(row);
    });
  }

  async environments(projectId: string): Promise<Environment[]> {
    const rows = await this.db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(asc(environments.position));

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      name: row.name,
      isPrimary: row.isPrimary,
      position: row.position,
    }));
  }

  async members(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.db
      .select({ member: projectMembers, user: users })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(users.displayName));

    return rows.map(({ member, user }) => ({
      projectId: member.projectId,
      userId: member.userId,
      role: member.role,
      displayName: user.displayName,
      email: user.email,
      addedAt: member.addedAt.toISOString(),
    }));
  }

  /**
   * Everyone in the organisation, so the member picker can offer real people
   * rather than asking someone to paste a user id.
   */
  async organisationUsers(
    organisationId: string,
  ): Promise<{ id: string; displayName: string; email: string }[]> {
    const rows = await this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.organisationId, organisationId))
      .orderBy(asc(users.displayName));

    return rows;
  }

  async upsertMember(
    actor: AuthenticatedUser,
    project: Project,
    request: UpsertMemberRequest,
  ): Promise<ProjectMember> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.id, request.userId),
            eq(users.organisationId, project.organisationId),
          ),
        )
        .limit(1);

      if (!user)
        throw new NotFoundException('No such person in this organisation.');

      const [existing] = await tx
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, project.id),
            eq(projectMembers.userId, request.userId),
          ),
        )
        .limit(1);

      const [member] = await tx
        .insert(projectMembers)
        .values({
          projectId: project.id,
          userId: request.userId,
          role: request.role,
        })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: { role: request.role },
        })
        .returning();

      await this.audit.record(
        {
          projectId: project.id,
          actor,
          action: existing ? 'member.role_changed' : 'member.added',
          targetType: 'user',
          targetId: user.id,
          targetLabel: user.displayName,
          metadata: existing
            ? { from: existing.role, to: request.role }
            : { role: request.role },
        },
        tx,
      );

      return {
        projectId: member.projectId,
        userId: member.userId,
        role: member.role,
        displayName: user.displayName,
        email: user.email,
        addedAt: member.addedAt.toISOString(),
      };
    });
  }

  async removeMember(
    actor: AuthenticatedUser,
    project: Project,
    userId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const owners = await tx
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, project.id),
            eq(projectMembers.role, 'owner'),
          ),
        );

      // A project with no owner has nobody who can grant access back.
      if (owners.length === 1 && owners[0].userId === userId) {
        throw new ConflictException(
          'This is the only owner. Make someone else an owner first.',
        );
      }

      const [removed] = await tx
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, project.id),
            eq(projectMembers.userId, userId),
          ),
        )
        .returning();

      if (!removed) throw new NotFoundException('That person is not a member.');

      await this.audit.record(
        {
          projectId: project.id,
          actor,
          action: 'member.removed',
          targetType: 'user',
          targetId: userId,
          metadata: { role: removed.role },
        },
        tx,
      );
    });
  }

  async versions(projectId: string): Promise<ContractVersion[]> {
    const rows = await this.db
      .select()
      .from(contractVersions)
      .where(eq(contractVersions.projectId, projectId))
      .orderBy(asc(contractVersions.createdAt));

    return rows.map(toContractVersion);
  }

  async findVersion(
    projectId: string,
    versionId: string,
  ): Promise<ContractVersion> {
    const [row] = await this.db
      .select()
      .from(contractVersions)
      .where(
        and(
          eq(contractVersions.id, versionId),
          eq(contractVersions.projectId, projectId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException('No such version.');
    return toContractVersion(row);
  }

  /** The version a request means when it does not name one. */
  async currentDraft(projectId: string): Promise<ContractVersion> {
    const [row] = await this.db
      .select()
      .from(contractVersions)
      .where(
        and(
          eq(contractVersions.projectId, projectId),
          eq(contractVersions.state, 'draft'),
        ),
      )
      .orderBy(asc(contractVersions.createdAt))
      .limit(1);

    if (!row) throw new NotFoundException('This project has no draft version.');
    return toContractVersion(row);
  }

  async createVersion(
    user: AuthenticatedUser,
    project: Project,
    request: CreateVersionRequest,
  ): Promise<ContractVersion> {
    return this.db.transaction(async (tx) => {
      const clash = await tx
        .select({ id: contractVersions.id })
        .from(contractVersions)
        .where(
          and(
            eq(contractVersions.projectId, project.id),
            eq(contractVersions.label, request.label),
          ),
        )
        .limit(1);

      if (clash.length > 0) {
        throw new ConflictException(
          `Version "${request.label}" already exists.`,
        );
      }

      const [version] = await tx
        .insert(contractVersions)
        .values({
          id: uuidv7(),
          projectId: project.id,
          label: request.label,
          state: 'draft',
        })
        .returning();

      if (request.copyFromVersionId) {
        await this.copyContract(tx, request.copyFromVersionId, version.id);
      }

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'version.created',
          targetType: 'version',
          targetId: version.id,
          targetLabel: version.label,
          metadata: request.copyFromVersionId
            ? { copiedFrom: request.copyFromVersionId }
            : {},
        },
        tx,
      );

      return toContractVersion(version);
    });
  }

  /** PRD 01: publishing freezes a version. Published versions are immutable. */
  async publishVersion(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    expectedVersion: number,
  ): Promise<ContractVersion> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(contractVersions)
        .where(
          and(
            eq(contractVersions.id, versionId),
            eq(contractVersions.projectId, project.id),
          ),
        )
        .limit(1);

      if (!current) throw new NotFoundException('No such version.');
      if (current.state === 'published') {
        throw new ConflictException('This version is already published.');
      }
      assertFresh(toContractVersion(current), expectedVersion);

      const [row] = await tx
        .update(contractVersions)
        .set({
          state: 'published',
          publishedAt: new Date(),
          publishedBy: user.id,
          entityVersion: current.entityVersion + 1,
        })
        .where(
          and(
            eq(contractVersions.id, versionId),
            eq(contractVersions.entityVersion, expectedVersion),
          ),
        )
        .returning();

      if (!row) {
        throw new ConflictException(
          'Someone published or changed this version while you were reading it.',
        );
      }

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'version.published',
          targetType: 'version',
          targetId: row.id,
          targetLabel: row.label,
        },
        tx,
      );

      return toContractVersion(row);
    });
  }

  /**
   * Deep-copies a version's contract. Resources and schemas are remapped to new
   * ids first, so an endpoint's `resourceId` points inside the new version.
   */
  private async copyContract(
    tx: DatabaseExecutor,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<void> {
    const sourceResources = await tx
      .select()
      .from(resources)
      .where(eq(resources.versionId, fromVersionId));

    const resourceIdMap = new Map(sourceResources.map((r) => [r.id, uuidv7()]));

    if (sourceResources.length > 0) {
      await tx.insert(resources).values(
        sourceResources.map((resource) => ({
          id: resourceIdMap.get(resource.id) as string,
          versionId: toVersionId,
          name: resource.name,
          description: resource.description,
          position: resource.position,
        })),
      );
    }

    const sourceSchemas = await tx
      .select()
      .from(namedSchemas)
      .where(eq(namedSchemas.versionId, fromVersionId));

    if (sourceSchemas.length > 0) {
      await tx.insert(namedSchemas).values(
        sourceSchemas.map((schema) => ({
          id: uuidv7(),
          versionId: toVersionId,
          name: schema.name,
          description: schema.description,
          schema: schema.schema,
          usageCount: schema.usageCount,
        })),
      );
    }

    const sourceEndpoints = await tx
      .select()
      .from(endpoints)
      .where(eq(endpoints.versionId, fromVersionId));

    if (sourceEndpoints.length > 0) {
      await tx.insert(endpoints).values(
        sourceEndpoints.map((endpoint) => ({
          id: uuidv7(),
          versionId: toVersionId,
          resourceId: resourceIdMap.get(endpoint.resourceId) as string,
          method: endpoint.method,
          path: endpoint.path,
          summary: endpoint.summary,
          description: endpoint.description,
          operationId: endpoint.operationId,
          parameters: endpoint.parameters,
          requestBody: endpoint.requestBody,
          responses: endpoint.responses,
          authRequired: endpoint.authRequired,
          deprecated: endpoint.deprecated,
          ownerId: endpoint.ownerId,
          ticketUrl: endpoint.ticketUrl,
          tags: endpoint.tags,
          position: endpoint.position,
        })),
      );
    }
  }

  /** Re-reads a row that moved mid-write so the caller gets the winning state. */
  private async reportConflict(
    projectId: string,
    expectedVersion: number,
  ): Promise<never> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!row) throw new NotFoundException('This project no longer exists.');
    assertFresh(toProject(row), expectedVersion);

    // assertFresh throws whenever the versions differ, and they must differ for
    // the update to have matched nothing.
    throw new ConflictException(
      'This project changed while you were editing it.',
    );
  }
}

function toContractVersion(
  row: typeof contractVersions.$inferSelect,
): ContractVersion {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    state: row.state,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedBy: row.publishedBy,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export { toContractVersion };

/** Reused by other services that need to reject writes to a frozen version. */
export function assertVersionMutable(version: ContractVersion): void {
  if (version.state === 'published') {
    throw new ConflictException(
      `Version ${version.label} is published and cannot change. Create a new version to keep working.`,
    );
  }
  if (version.state === 'archived') {
    throw new ConflictException(`Version ${version.label} is archived.`);
  }
}
