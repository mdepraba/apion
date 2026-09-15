import {
  contractVersions,
  type Database,
  endpoints,
  namedSchemas,
  projects,
} from '@apion/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { ProjectAccessService } from '../auth/project-access.service.js';

export interface SearchHit {
  kind: 'endpoint' | 'schema';
  id: string;
  label: string;
  detail: string;
  projectSlug: string;
  projectName: string;
  versionId: string;
  versionLabel: string;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * FR-1.6: finds endpoints and schemas only in projects the caller may read,
   * and never leaks a name, path or schema fragment from anywhere else.
   *
   * The scope is computed from membership first and applied as a hard `IN`
   * filter, so an inaccessible project cannot reach the result set at all,
   * rather than being matched and then filtered out.
   */
  async search(
    user: AuthenticatedUser,
    query: string,
    limit = 25,
  ): Promise<SearchHit[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const projectIds = await this.access.readableProjectIds(user);
    if (projectIds.length === 0) return [];

    const pattern = `%${trimmed}%`;

    const endpointHits = await this.db
      .select({
        id: endpoints.id,
        method: endpoints.method,
        path: endpoints.path,
        summary: endpoints.summary,
        versionId: contractVersions.id,
        versionLabel: contractVersions.label,
        projectSlug: projects.slug,
        projectName: projects.name,
      })
      .from(endpoints)
      .innerJoin(contractVersions, eq(contractVersions.id, endpoints.versionId))
      .innerJoin(projects, eq(projects.id, contractVersions.projectId))
      .where(
        and(
          inArray(contractVersions.projectId, projectIds),
          or(ilike(endpoints.path, pattern), ilike(endpoints.summary, pattern)),
        ),
      )
      .orderBy(sql`length(${endpoints.path})`)
      .limit(limit);

    const schemaHits = await this.db
      .select({
        id: namedSchemas.id,
        name: namedSchemas.name,
        description: namedSchemas.description,
        versionId: contractVersions.id,
        versionLabel: contractVersions.label,
        projectSlug: projects.slug,
        projectName: projects.name,
      })
      .from(namedSchemas)
      .innerJoin(
        contractVersions,
        eq(contractVersions.id, namedSchemas.versionId),
      )
      .innerJoin(projects, eq(projects.id, contractVersions.projectId))
      .where(
        and(
          inArray(contractVersions.projectId, projectIds),
          ilike(namedSchemas.name, pattern),
        ),
      )
      .orderBy(sql`length(${namedSchemas.name})`)
      .limit(limit);

    return [
      ...endpointHits.map(
        (hit): SearchHit => ({
          kind: 'endpoint',
          id: hit.id,
          label: `${hit.method.toUpperCase()} ${hit.path}`,
          detail: hit.summary,
          projectSlug: hit.projectSlug,
          projectName: hit.projectName,
          versionId: hit.versionId,
          versionLabel: hit.versionLabel,
        }),
      ),
      ...schemaHits.map(
        (hit): SearchHit => ({
          kind: 'schema',
          id: hit.id,
          label: hit.name,
          detail: hit.description,
          projectSlug: hit.projectSlug,
          projectName: hit.projectName,
          versionId: hit.versionId,
          versionLabel: hit.versionLabel,
        }),
      ),
    ].slice(0, limit);
  }
}
