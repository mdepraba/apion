import type { Project } from '@apion/contracts';
import { type Database, projectMembers, projects } from '@apion/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import type { AuthenticatedUser } from './auth.guard.js';
import type { ProjectContext } from './project-access.guard.js';

@Injectable()
export class ProjectAccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Resolves a slug to the project plus the caller's role, or nothing when the
   * caller has no business knowing the project exists.
   *
   * An `organisation`-visible project grants an implicit `viewer` role to any
   * member of the organisation, which is what lets a PM read a contract they
   * were never explicitly added to (PRD 00, "Users and jobs").
   */
  async resolve(
    slug: string,
    user: AuthenticatedUser,
  ): Promise<ProjectContext | undefined> {
    const [row] = await this.db
      .select({ project: projects, role: projectMembers.role })
      .from(projects)
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, user.id),
        ),
      )
      .where(
        and(
          eq(projects.slug, slug),
          eq(projects.organisationId, user.organisationId),
        ),
      )
      .limit(1);

    if (!row) return undefined;

    const role =
      row.role ?? (row.project.visibility === 'organisation' ? 'viewer' : null);
    if (!role) return undefined;

    return { project: toProject(row.project), role };
  }

  /** Project ids the caller may read; the guard behind FR-1.6 search scoping. */
  async readableProjectIds(user: AuthenticatedUser): Promise<string[]> {
    const rows = await this.db
      .select({
        id: projects.id,
        visibility: projects.visibility,
        role: projectMembers.role,
      })
      .from(projects)
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, user.id),
        ),
      )
      .where(
        and(
          eq(projects.organisationId, user.organisationId),
          eq(projects.lifecycleState, 'active'),
        ),
      );

    return rows
      .filter((row) => row.role !== null || row.visibility === 'organisation')
      .map((row) => row.id);
  }
}

type ProjectRow = typeof projects.$inferSelect;

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    organisationId: row.organisationId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    lifecycleState: row.lifecycleState,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
