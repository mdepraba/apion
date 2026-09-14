import type {
  CreateSchemaRequest,
  NamedSchema,
  Project,
  RenameSchemaRequest,
  SchemaImpact,
} from '@apion/contracts';
import {
  type Database,
  type DatabaseExecutor,
  endpoints,
  namedSchemas,
  schemaReferences,
} from '@apion/db';
import { assertFresh, collectRefs, renameRefs, uuidv7 } from '@apion/domain';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import {
  assertVersionMutable,
  ProjectsService,
} from '../projects/projects.service.js';
import { refreshUsageCounts } from './endpoints.service.js';

@Injectable()
export class SchemasService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  async list(versionId: string): Promise<NamedSchema[]> {
    const rows = await this.db
      .select()
      .from(namedSchemas)
      .where(eq(namedSchemas.versionId, versionId))
      .orderBy(asc(namedSchemas.name));

    return rows.map(toNamedSchema);
  }

  async findOne(versionId: string, schemaId: string): Promise<NamedSchema> {
    const [row] = await this.db
      .select()
      .from(namedSchemas)
      .where(
        and(
          eq(namedSchemas.id, schemaId),
          eq(namedSchemas.versionId, versionId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException('No such schema.');
    return toNamedSchema(row);
  }

  async create(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    request: CreateSchemaRequest,
  ): Promise<NamedSchema> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    return this.db.transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: namedSchemas.id })
        .from(namedSchemas)
        .where(
          and(
            eq(namedSchemas.versionId, versionId),
            eq(namedSchemas.name, request.name),
          ),
        )
        .limit(1);

      if (clash) {
        throw new ConflictException(
          `A schema named ${request.name} already exists.`,
        );
      }

      const [row] = await tx
        .insert(namedSchemas)
        .values({
          id: uuidv7(),
          versionId,
          name: request.name,
          description: request.description ?? '',
          schema: request.schema,
        })
        .returning();

      await this.reindexSchemaRefs(tx, versionId, row.id, row.schema);

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'schema.created',
          targetType: 'schema',
          targetId: row.id,
          targetLabel: row.name,
        },
        tx,
      );

      return toNamedSchema(row);
    });
  }

  async update(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    schemaId: string,
    expectedVersion: number,
    request: { description?: string; schema?: unknown },
  ): Promise<NamedSchema> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    return this.db.transaction(async (tx) => {
      const current = await this.findOne(versionId, schemaId);
      assertFresh(current, expectedVersion);

      const [row] = await tx
        .update(namedSchemas)
        .set({
          ...(request.description !== undefined && {
            description: request.description,
          }),
          ...(request.schema !== undefined && { schema: request.schema }),
          entityVersion: current.entityVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(namedSchemas.id, schemaId),
            eq(namedSchemas.entityVersion, expectedVersion),
          ),
        )
        .returning();

      if (!row) {
        throw new ConflictException(
          'Someone saved this schema while you were editing it. Reload to see their change.',
        );
      }

      await this.reindexSchemaRefs(tx, versionId, row.id, row.schema);

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'schema.updated',
          targetType: 'schema',
          targetId: row.id,
          targetLabel: row.name,
        },
        tx,
      );

      return toNamedSchema(row);
    });
  }

  /**
   * FR-2.4: what a rename would touch. The author sees this count, confirms it,
   * and `rename` re-checks that the number has not moved since.
   */
  async impact(versionId: string, schemaId: string): Promise<SchemaImpact> {
    const schema = await this.findOne(versionId, schemaId);

    const rows = await this.db
      .select({
        pointer: schemaReferences.pointer,
        endpointId: schemaReferences.sourceEndpointId,
        sourceSchemaId: schemaReferences.sourceSchemaId,
        endpointMethod: endpoints.method,
        endpointPath: endpoints.path,
      })
      .from(schemaReferences)
      .leftJoin(endpoints, eq(endpoints.id, schemaReferences.sourceEndpointId))
      .where(eq(schemaReferences.schemaId, schemaId));

    const sourceSchemaIds = rows
      .map((row) => row.sourceSchemaId)
      .filter((id): id is string => id !== null);

    const sourceSchemas =
      sourceSchemaIds.length > 0
        ? await this.db
            .select({ id: namedSchemas.id, name: namedSchemas.name })
            .from(namedSchemas)
            .where(inArray(namedSchemas.id, sourceSchemaIds))
        : [];

    const schemaNameById = new Map(sourceSchemas.map((s) => [s.id, s.name]));

    return {
      schemaId,
      name: schema.name,
      references: rows.map((row) =>
        row.endpointId
          ? {
              kind: 'endpoint' as const,
              id: row.endpointId,
              label:
                `${row.endpointMethod?.toUpperCase() ?? ''} ${row.endpointPath ?? ''}`.trim(),
              pointer: row.pointer,
            }
          : {
              kind: 'schema' as const,
              id: row.sourceSchemaId as string,
              label:
                schemaNameById.get(row.sourceSchemaId as string) ??
                'Unknown schema',
              pointer: row.pointer,
            },
      ),
    };
  }

  /**
   * FR-2.4: renames the schema and rewrites every `$ref` to it, all or nothing.
   * The whole thing runs in one transaction, so a partial rename: some
   * endpoints pointing at a name that no longer exists: cannot be committed.
   */
  async rename(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    schemaId: string,
    expectedVersion: number,
    request: RenameSchemaRequest,
  ): Promise<{ schema: NamedSchema; updatedReferences: number }> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    return this.db.transaction(async (tx) => {
      const current = await this.findOne(versionId, schemaId);
      assertFresh(current, expectedVersion);

      if (current.name === request.name) {
        return { schema: current, updatedReferences: 0 };
      }

      const [clash] = await tx
        .select({ id: namedSchemas.id })
        .from(namedSchemas)
        .where(
          and(
            eq(namedSchemas.versionId, versionId),
            eq(namedSchemas.name, request.name),
          ),
        )
        .limit(1);

      if (clash) {
        throw new ConflictException(
          `A schema named ${request.name} already exists.`,
        );
      }

      const references = await tx
        .select({ count: schemaReferences.id })
        .from(schemaReferences)
        .where(eq(schemaReferences.schemaId, schemaId));

      // The author confirmed a specific impact. If the contract moved since
      // they looked, they need to see the new number before it goes ahead.
      if (references.length !== request.acknowledgedImpactCount) {
        throw new ConflictException(
          `This rename now affects ${references.length} references, not ${request.acknowledgedImpactCount}. Review the impact again.`,
        );
      }

      const affectedEndpoints = await tx
        .select()
        .from(endpoints)
        .where(eq(endpoints.versionId, versionId));

      for (const endpoint of affectedEndpoints) {
        const rewritten = {
          parameters: renameRefs(
            endpoint.parameters,
            current.name,
            request.name,
          ),
          requestBody: renameRefs(
            endpoint.requestBody,
            current.name,
            request.name,
          ),
          responses: renameRefs(endpoint.responses, current.name, request.name),
        };

        const unchanged =
          JSON.stringify(rewritten.parameters) ===
            JSON.stringify(endpoint.parameters) &&
          JSON.stringify(rewritten.requestBody) ===
            JSON.stringify(endpoint.requestBody) &&
          JSON.stringify(rewritten.responses) ===
            JSON.stringify(endpoint.responses);

        if (unchanged) continue;

        await tx
          .update(endpoints)
          .set({
            parameters: rewritten.parameters as typeof endpoint.parameters,
            requestBody: rewritten.requestBody as typeof endpoint.requestBody,
            responses: rewritten.responses as typeof endpoint.responses,
            // Bumping the version is what turns an open editor read-only until
            // it refreshes, which FR-2.4 requires.
            entityVersion: endpoint.entityVersion + 1,
            updatedAt: new Date(),
          })
          .where(eq(endpoints.id, endpoint.id));
      }

      const otherSchemas = await tx
        .select()
        .from(namedSchemas)
        .where(eq(namedSchemas.versionId, versionId));

      for (const other of otherSchemas) {
        if (other.id === schemaId) continue;
        const rewritten = renameRefs(other.schema, current.name, request.name);
        if (JSON.stringify(rewritten) === JSON.stringify(other.schema))
          continue;

        await tx
          .update(namedSchemas)
          .set({
            schema: rewritten,
            entityVersion: other.entityVersion + 1,
            updatedAt: new Date(),
          })
          .where(eq(namedSchemas.id, other.id));
      }

      const [renamed] = await tx
        .update(namedSchemas)
        .set({
          name: request.name,
          entityVersion: current.entityVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(namedSchemas.id, schemaId),
            eq(namedSchemas.entityVersion, expectedVersion),
          ),
        )
        .returning();

      if (!renamed) {
        throw new ConflictException(
          'Someone changed this schema while the rename was being prepared.',
        );
      }

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'schema.renamed',
          targetType: 'schema',
          targetId: schemaId,
          targetLabel: request.name,
          metadata: {
            from: current.name,
            to: request.name,
            references: references.length,
          },
        },
        tx,
      );

      return {
        schema: toNamedSchema(renamed),
        updatedReferences: references.length,
      };
    });
  }

  async remove(
    user: AuthenticatedUser,
    project: Project,
    versionId: string,
    schemaId: string,
    expectedVersion: number,
  ): Promise<void> {
    const version = await this.projects.findVersion(project.id, versionId);
    assertVersionMutable(version);

    await this.db.transaction(async (tx) => {
      const current = await this.findOne(versionId, schemaId);
      assertFresh(current, expectedVersion);

      const references = await tx
        .select({ id: schemaReferences.id })
        .from(schemaReferences)
        .where(eq(schemaReferences.schemaId, schemaId));

      // Deleting a referenced schema would leave dangling `$ref`s across the
      // contract; the author has to unpick them first.
      if (references.length > 0) {
        throw new ConflictException(
          `${current.name} is used by ${references.length} other ${references.length === 1 ? 'place' : 'places'}. Remove those references first.`,
        );
      }

      await tx.delete(namedSchemas).where(eq(namedSchemas.id, schemaId));

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'schema.deleted',
          targetType: 'schema',
          targetId: schemaId,
          targetLabel: current.name,
        },
        tx,
      );
    });
  }

  /** Mirrors the endpoint reindex for refs one schema makes to another. */
  private async reindexSchemaRefs(
    tx: DatabaseExecutor,
    versionId: string,
    schemaId: string,
    document: unknown,
  ): Promise<void> {
    await tx
      .delete(schemaReferences)
      .where(eq(schemaReferences.sourceSchemaId, schemaId));

    const sites = collectRefs(document);
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
          sourceEndpointId: null,
          sourceSchemaId: schemaId,
          pointer: site.pointer,
        }))
        .filter(
          (r): r is typeof r & { schemaId: string } => r.schemaId !== undefined,
        );

      if (rows.length > 0) await tx.insert(schemaReferences).values(rows);
    }

    await refreshUsageCounts(tx, versionId);
  }
}

function toNamedSchema(row: typeof namedSchemas.$inferSelect): NamedSchema {
  return {
    id: row.id,
    versionId: row.versionId,
    name: row.name,
    description: row.description,
    schema: row.schema,
    usageCount: row.usageCount,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
