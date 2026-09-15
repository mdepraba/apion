import type {
  Project,
  ResponseStandardRecord,
  StandardDefinition,
  StandardPreset,
  UpdateStandardRequest,
} from '@apion/contracts';
import {
  type Database,
  type DatabaseExecutor,
  lintResults,
  responseStandards,
} from '@apion/db';
import { uuidv7 } from '@apion/domain';
import {
  type PresetId,
  presetStandard,
  type ResponseStandard,
} from '@apion/response-standard';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

/**
 * FR-4.1. A project has one active standard and, while someone is editing, one
 * draft. Publishing swaps them and bumps `version`; it does not relint.
 */
@Injectable()
export class StandardsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** The active standard, creating the `Simple` default on first read. */
  async active(projectId: string): Promise<ResponseStandardRecord> {
    const existing = await this.find(projectId, 'active');
    if (existing) return existing;

    // A project without a standard has no way to preview a response, so the
    // first read materialises the default rather than failing.
    return this.seed(projectId, 'simple');
  }

  /** The draft, or the active standard copied into one on first edit. */
  async draft(projectId: string): Promise<ResponseStandardRecord> {
    const existing = await this.find(projectId, 'draft');
    if (existing) return existing;

    const active = await this.active(projectId);

    const [row] = await this.db
      .insert(responseStandards)
      .values({
        id: uuidv7(),
        projectId,
        version: active.version,
        state: 'draft',
        preset: active.preset,
        definition: active.definition,
      })
      .returning();

    return toRecord(row);
  }

  async update(
    user: AuthenticatedUser,
    project: Project,
    expectedVersion: number,
    request: UpdateStandardRequest,
  ): Promise<ResponseStandardRecord> {
    const current = await this.draft(project.id);

    const definition: StandardDefinition = {
      ...current.definition,
      ...request.definition,
    };

    const [updated] = await this.db
      .update(responseStandards)
      .set({
        definition,
        entityVersion: current.entityVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(responseStandards.id, current.id),
          eq(responseStandards.entityVersion, expectedVersion),
        ),
      )
      .returning();

    if (!updated) {
      throw new ConflictException(
        'Someone else saved the standard while you were editing it. Reload to see their change.',
      );
    }

    return toRecord(updated);
  }

  /** FR-4.7. A preset replaces the draft's definition and stays editable. */
  async applyPreset(
    user: AuthenticatedUser,
    project: Project,
    expectedVersion: number,
    preset: StandardPreset,
  ): Promise<ResponseStandardRecord> {
    const current = await this.draft(project.id);

    const [updated] = await this.db
      .update(responseStandards)
      .set({
        preset,
        definition: toDefinition(presetStandard(preset as PresetId)),
        entityVersion: current.entityVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(responseStandards.id, current.id),
          eq(responseStandards.entityVersion, expectedVersion),
        ),
      )
      .returning();

    if (!updated) {
      throw new ConflictException(
        'Someone else saved the standard while you were editing it. Reload to see their change.',
      );
    }

    return toRecord(updated);
  }

  /**
   * FR-4.1: "Publishing activates the draft and makes previous endpoint lint
   * results stale; it must not synchronously relint the whole project."
   *
   * Constant time regardless of endpoint count: the draft becomes active with a
   * higher version, and every cached lint row is left behind at the old number.
   * That mismatch is what `LintService` reads as stale.
   */
  async publish(
    user: AuthenticatedUser,
    project: Project,
    expectedVersion: number,
  ): Promise<ResponseStandardRecord> {
    return this.db.transaction(async (tx) => {
      const [draftRow] = await tx
        .select()
        .from(responseStandards)
        .where(
          and(
            eq(responseStandards.projectId, project.id),
            eq(responseStandards.state, 'draft'),
          ),
        )
        .limit(1);

      if (!draftRow) {
        throw new NotFoundException(
          'There is nothing to publish. Edit the standard first.',
        );
      }

      if (draftRow.entityVersion !== expectedVersion) {
        throw new ConflictException(
          'Someone else saved the standard while you were reading it. Reload before publishing.',
        );
      }

      const [activeRow] = await tx
        .select()
        .from(responseStandards)
        .where(
          and(
            eq(responseStandards.projectId, project.id),
            eq(responseStandards.state, 'active'),
          ),
        )
        .limit(1);

      const nextVersion = (activeRow?.version ?? 0) + 1;

      // The active row goes first: the unique index allows only one per state.
      if (activeRow) {
        await tx
          .delete(responseStandards)
          .where(eq(responseStandards.id, activeRow.id));
      }

      const [published] = await tx
        .update(responseStandards)
        .set({
          state: 'active',
          version: nextVersion,
          publishedAt: new Date(),
          publishedBy: user.id,
          entityVersion: draftRow.entityVersion + 1,
          updatedAt: new Date(),
        })
        .where(eq(responseStandards.id, draftRow.id))
        .returning();

      await this.audit.record(
        {
          projectId: project.id,
          actor: user,
          action: 'standard.published',
          targetType: 'response_standard',
          targetId: published.id,
          targetLabel: `v${nextVersion}`,
          metadata: { version: nextVersion, preset: published.preset },
        },
        tx,
      );

      return toRecord(published);
    });
  }

  /** Discards the draft, leaving the active standard untouched. */
  async discardDraft(projectId: string): Promise<void> {
    await this.db
      .delete(responseStandards)
      .where(
        and(
          eq(responseStandards.projectId, projectId),
          eq(responseStandards.state, 'draft'),
        ),
      );
  }

  /** How many endpoints are checked against the current standard version. */
  async coverage(
    projectId: string,
    standardVersion: number,
  ): Promise<{ checked: number; errors: number; warnings: number }> {
    const [row] = await this.db
      .select({
        checked: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${lintResults.errorCount} > 0)::int`,
        warnings: sql<number>`count(*) filter (where ${lintResults.warnCount} > 0)::int`,
      })
      .from(lintResults)
      .where(
        and(
          eq(lintResults.projectId, projectId),
          eq(lintResults.standardVersion, standardVersion),
        ),
      );

    return {
      checked: row?.checked ?? 0,
      errors: row?.errors ?? 0,
      warnings: row?.warnings ?? 0,
    };
  }

  private async find(
    projectId: string,
    state: 'draft' | 'active',
    tx: DatabaseExecutor = this.db,
  ): Promise<ResponseStandardRecord | null> {
    const [row] = await tx
      .select()
      .from(responseStandards)
      .where(
        and(
          eq(responseStandards.projectId, projectId),
          eq(responseStandards.state, state),
        ),
      )
      .limit(1);

    return row ? toRecord(row) : null;
  }

  private async seed(
    projectId: string,
    preset: PresetId,
  ): Promise<ResponseStandardRecord> {
    const [row] = await this.db
      .insert(responseStandards)
      .values({
        id: uuidv7(),
        projectId,
        version: 1,
        state: 'active',
        preset,
        definition: toDefinition(presetStandard(preset)),
        publishedAt: new Date(),
      })
      // Two first reads can race; the loser reads the winner's row.
      .onConflictDoNothing()
      .returning();

    if (row) return toRecord(row);

    const existing = await this.find(projectId, 'active');
    if (!existing) {
      throw new ConflictException('The project standard could not be created.');
    }
    return existing;
  }
}

/** The engine's standard, minus the version the database owns. */
export function toDefinition(standard: ResponseStandard): StandardDefinition {
  return {
    envelope: standard.envelope,
    errorCodes: [...standard.errorCodes],
    propertyNaming: standard.propertyNaming,
    pathNaming: standard.pathNaming,
    allowedStatusesByMethod: Object.fromEntries(
      Object.entries(standard.allowedStatusesByMethod).map(
        ([method, statuses]) => [method, [...statuses]],
      ),
    ),
    requiredResponseHeaders: [...standard.requiredResponseHeaders],
    pagination: { ...standard.pagination },
    dateFormat: standard.dateFormat,
    timeZone: standard.timeZone,
    // An engine standard written before the switch existed was being enforced.
    rulesEnabled: standard.rulesEnabled !== false,
    severities: { ...standard.severities },
  };
}

/**
 * The stored definition as the engine wants it. This is the only place the two
 * representations meet, so the FR-4.8 boundary stays a single conversion.
 */
export function toEngineStandard(
  record: Pick<ResponseStandardRecord, 'version' | 'definition'>,
): ResponseStandard {
  return {
    version: record.version,
    ...record.definition,
  } as ResponseStandard;
}

function toRecord(
  row: typeof responseStandards.$inferSelect,
): ResponseStandardRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    state: row.state,
    preset: row.preset,
    definition: row.definition,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedBy: row.publishedBy,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
