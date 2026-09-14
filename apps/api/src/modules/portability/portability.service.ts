import type { ContractDiff, Project } from '@apion/contracts';
import { type Database, endpoints, namedSchemas, resources } from '@apion/db';
import { diffEndpointSets, summariseDiff, uuidv7 } from '@apion/domain';
import {
  exportOpenApi,
  generateTypeScript,
  type ImportResult,
  importOpenApi,
} from '@apion/spec-openapi';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { toEndpoint } from '../contract/endpoints.service.js';
import {
  assertVersionMutable,
  ProjectsService,
} from '../projects/projects.service.js';

export interface ImportSummary {
  versionId: string;
  resources: number;
  schemas: number;
  endpoints: number;
  warnings: string[];
}

@Injectable()
export class PortabilityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  /** FR-2.7: OpenAPI 3.1 is the portability baseline, not a lossy side export. */
  async exportOpenApi(project: Project, versionId: string): Promise<unknown> {
    const contract = await this.loadContract(project.id, versionId);

    return exportOpenApi({
      title: project.name,
      version: contract.version.label,
      description: project.description,
      endpoints: contract.endpoints,
      schemas: contract.schemas,
      resources: contract.resources,
    });
  }

  async exportTypeScript(project: Project, versionId: string): Promise<string> {
    const contract = await this.loadContract(project.id, versionId);

    return generateTypeScript({
      title: `${project.name} ${contract.version.label}`,
      endpoints: contract.endpoints,
      schemas: contract.schemas,
    });
  }

  /**
   * FR-2.6: the diff between two versions, classified. Recomputed on read
   * rather than cached, so it cannot go stale behind an edit.
   */
  async diff(
    project: Project,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<ContractDiff> {
    const [before, after] = await Promise.all([
      this.loadContract(project.id, fromVersionId),
      this.loadContract(project.id, toVersionId),
    ]);

    const entries = diffEndpointSets(before.endpoints, after.endpoints);
    const counts = summariseDiff(entries);

    return {
      fromVersionId,
      toVersionId,
      entries,
      summary: {
        breaking: counts.breaking,
        nonBreaking: counts.non_breaking,
        additive: counts.additive,
      },
    };
  }

  /**
   * Replaces a draft version's contract with an imported document. The whole
   * import is one transaction: a half-applied spec is worse than a rejected one.
   */
  async importOpenApi(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    source: string,
  ): Promise<ImportSummary> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    let parsed: ImportResult;
    try {
      parsed = importOpenApi(source);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'This file could not be read.',
      );
    }

    return this.db.transaction(async (tx) => {
      // Importing defines the version's contract; leaving the old rows behind
      // would silently merge two specs.
      await tx.delete(endpoints).where(eq(endpoints.versionId, versionId));
      await tx
        .delete(namedSchemas)
        .where(eq(namedSchemas.versionId, versionId));
      await tx.delete(resources).where(eq(resources.versionId, versionId));

      const resourceIdByName = new Map<string, string>();
      if (parsed.resources.length > 0) {
        const rows = parsed.resources.map((resource, index) => ({
          id: uuidv7(),
          versionId,
          name: resource.name,
          description: resource.description,
          position: index,
        }));
        await tx.insert(resources).values(rows);
        for (const row of rows) resourceIdByName.set(row.name, row.id);
      }

      if (parsed.schemas.length > 0) {
        await tx.insert(namedSchemas).values(
          parsed.schemas.map((schema) => ({
            id: uuidv7(),
            versionId,
            name: schema.name,
            description: schema.description,
            schema: schema.schema,
          })),
        );
      }

      if (parsed.endpoints.length > 0) {
        await tx.insert(endpoints).values(
          parsed.endpoints.map((endpoint, index) => ({
            id: uuidv7(),
            versionId,
            resourceId: resourceIdByName.get(endpoint.resourceName) as string,
            method: endpoint.method,
            path: endpoint.path,
            summary: endpoint.summary,
            description: endpoint.description ?? '',
            operationId: endpoint.operationId ?? null,
            parameters: endpoint.parameters ?? [],
            requestBody: endpoint.requestBody ?? null,
            responses: (endpoint.responses ?? []).map((response) => ({
              ...response,
              id: uuidv7(),
              examples: (response.examples ?? []).map((example) => ({
                ...example,
                id: uuidv7(),
              })),
            })),
            authRequired: endpoint.authRequired ?? true,
            deprecated: endpoint.deprecated ?? false,
            ownerId: null,
            ticketUrl: endpoint.ticketUrl ?? null,
            tags: endpoint.tags ?? [],
            position: index,
          })),
        );
      }

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'contract.imported',
          targetType: 'version',
          targetId: versionId,
          targetLabel: version.label,
          metadata: {
            endpoints: parsed.endpoints.length,
            schemas: parsed.schemas.length,
            warnings: parsed.warnings.length,
          },
        },
        tx,
      );

      return {
        versionId,
        resources: parsed.resources.length,
        schemas: parsed.schemas.length,
        endpoints: parsed.endpoints.length,
        warnings: parsed.warnings,
      };
    });
  }

  private async loadContract(projectId: string, versionId: string) {
    const version = await this.projects.findVersion(projectId, versionId);

    const [endpointRows, schemaRows, resourceRows] = await Promise.all([
      this.db
        .select()
        .from(endpoints)
        .where(eq(endpoints.versionId, versionId)),
      this.db
        .select()
        .from(namedSchemas)
        .where(eq(namedSchemas.versionId, versionId)),
      this.db
        .select()
        .from(resources)
        .where(eq(resources.versionId, versionId)),
    ]);

    return {
      version,
      endpoints: endpointRows.map(toEndpoint),
      schemas: schemaRows.map((row) => ({
        id: row.id,
        versionId: row.versionId,
        name: row.name,
        description: row.description,
        schema: row.schema,
        usageCount: row.usageCount,
        entityVersion: row.entityVersion,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      resources: resourceRows.map((row) => ({
        id: row.id,
        versionId: row.versionId,
        name: row.name,
        description: row.description,
        position: row.position,
        entityVersion: row.entityVersion,
      })),
    };
  }
}
