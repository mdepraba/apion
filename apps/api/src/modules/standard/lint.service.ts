import type {
  CreateExemptionRequest,
  Endpoint,
  ExemptionRecord,
  LintResult,
  Project,
  RuleIdValue,
  StandardHealth,
  ViolationRecord,
} from '@apion/contracts';
import {
  type Database,
  type DatabaseExecutor,
  endpoints,
  jobs,
  lintExemptions,
  lintResults,
  namedSchemas,
  users,
} from '@apion/db';
import { uuidv7 } from '@apion/domain';
import {
  applyExemptions,
  type Exemption,
  isBlocked,
  lintEndpoint,
  type ResponseStandard,
} from '@apion/response-standard';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { toEndpoint } from '../contract/endpoints.service.js';
import { StandardsService, toEngineStandard } from './standards.service.js';

/**
 * Lazy linting, per PRD 03: "Opening a stale endpoint lint-checks that endpoint
 * and refreshes its cache."
 *
 * Nothing here ever walks a whole project on a request path. The sweep exists
 * for the `check all` button and runs in bounded chunks as a job.
 */
@Injectable()
export class LintService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly standards: StandardsService,
    private readonly audit: AuditService,
  ) {}

  /** The cached result when it is current, a fresh check when it is not. */
  async forEndpoint(
    projectId: string,
    endpointId: string,
  ): Promise<LintResult> {
    const standard = await this.standards.active(projectId);

    const [cached] = await this.db
      .select()
      .from(lintResults)
      .where(eq(lintResults.endpointId, endpointId))
      .limit(1);

    if (cached && cached.standardVersion === standard.version) {
      return this.resolve(
        projectId,
        endpointId,
        cached.violations,
        cached.standardVersion,
        cached.checkedAt,
        standard.definition.rulesEnabled !== false,
      );
    }

    return this.check(projectId, endpointId);
  }

  /** Lints one endpoint and refreshes its cache. */
  async check(projectId: string, endpointId: string): Promise<LintResult> {
    const standard = await this.standards.active(projectId);
    const engine = toEngineStandard(standard);

    const [row] = await this.db
      .select()
      .from(endpoints)
      .where(eq(endpoints.id, endpointId))
      .limit(1);

    if (!row) throw new NotFoundException('No such endpoint.');

    const violations = await this.run(toEndpoint(row), engine);
    const checkedAt = await this.store(
      projectId,
      endpointId,
      violations,
      standard.version,
    );

    return this.resolve(
      projectId,
      endpointId,
      violations,
      standard.version,
      checkedAt,
      engine.rulesEnabled !== false,
    );
  }

  /**
   * One chunk of the `check all` sweep. PRD 03 fixes the chunk at 25 and asks
   * the caller to yield between chunks; the cursor is the last endpoint id, so
   * a chunk that never returns costs at most a repeat rather than a restart.
   */
  async sweepChunk(
    projectId: string,
    cursor: string | null,
    size = 25,
  ): Promise<{ checked: number; nextCursor: string | null }> {
    const standard = await this.standards.active(projectId);
    const engine = toEngineStandard(standard);

    const stale = await this.db
      .select({ endpoint: endpoints })
      .from(endpoints)
      .innerJoin(
        sql`(select id, project_id from contract_versions) as cv`,
        sql`cv.id = ${endpoints.versionId} and cv.project_id = ${projectId}`,
      )
      .leftJoin(lintResults, eq(lintResults.endpointId, endpoints.id))
      .where(
        and(
          cursor ? sql`${endpoints.id} > ${cursor}` : undefined,
          or(
            sql`${lintResults.endpointId} is null`,
            ne(lintResults.standardVersion, standard.version),
          ),
        ),
      )
      .orderBy(asc(endpoints.id))
      .limit(size);

    for (const { endpoint } of stale) {
      const violations = await this.run(toEndpoint(endpoint), engine);
      await this.store(projectId, endpoint.id, violations, standard.version);
    }

    return {
      checked: stale.length,
      nextCursor:
        stale.length === size ? (stale.at(-1)?.endpoint.id ?? null) : null,
    };
  }

  /** Queues the sweep. One per project at a time; a second call joins the first. */
  async startSweep(projectId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, projectId),
          eq(jobs.kind, 'lint_sweep'),
          inArray(jobs.state, ['queued', 'running']),
        ),
      )
      .limit(1);

    if (existing) return existing.id;

    const [job] = await this.db
      .insert(jobs)
      .values({
        id: uuidv7(),
        kind: 'lint_sweep',
        projectId,
        payload: { projectId },
        progress: { checked: 0, cursor: null },
      })
      .returning({ id: jobs.id });

    return job.id;
  }

  /**
   * FR-4.5: an unresolved error blocks approval and publication. Called by the
   * version publisher, so a contract cannot go out violating its own standard.
   */
  async blockingEndpoints(
    projectId: string,
    versionId: string,
  ): Promise<{ endpointId: string; label: string; ruleIds: RuleIdValue[] }[]> {
    const standard = await this.standards.active(projectId);
    const engine = toEngineStandard(standard);

    const rows = await this.db
      .select()
      .from(endpoints)
      .where(eq(endpoints.versionId, versionId));

    const exemptions = await this.exemptionsFor(projectId);
    const blocking: {
      endpointId: string;
      label: string;
      ruleIds: RuleIdValue[];
    }[] = [];

    for (const row of rows) {
      const violations = await this.run(toEndpoint(row), engine);
      const resolved = applyExemptions(violations, exemptions, row.id);
      if (!isBlocked(resolved)) continue;

      blocking.push({
        endpointId: row.id,
        label: `${row.method.toUpperCase()} ${row.path}`,
        ruleIds: resolved
          .filter((v) => v.severity === 'error' && !v.exemption)
          .map((v) => v.ruleId as RuleIdValue),
      });
    }

    return blocking;
  }

  /** The health panel: real coverage, not a claim that the project is clean. */
  async health(projectId: string): Promise<StandardHealth> {
    const standard = await this.standards.active(projectId);

    const [totals] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(endpoints)
      .innerJoin(
        sql`(select id, project_id from contract_versions) as cv`,
        sql`cv.id = ${endpoints.versionId} and cv.project_id = ${projectId}`,
      );

    const coverage = await this.standards.coverage(projectId, standard.version);

    const perRule = await this.db
      .select({
        violations: lintResults.violations,
      })
      .from(lintResults)
      .where(
        and(
          eq(lintResults.projectId, projectId),
          eq(lintResults.standardVersion, standard.version),
        ),
      );

    const violationsByRule: Partial<Record<RuleIdValue, number>> = {};
    for (const row of perRule) {
      for (const violation of row.violations) {
        violationsByRule[violation.ruleId] =
          (violationsByRule[violation.ruleId] ?? 0) + 1;
      }
    }

    const [exemptionCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(lintExemptions)
      .where(eq(lintExemptions.projectId, projectId));

    const [sweep] = await this.db
      .select({
        id: jobs.id,
        state: jobs.state,
        progress: jobs.progress,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.projectId, projectId),
          eq(jobs.kind, 'lint_sweep'),
          inArray(jobs.state, ['queued', 'running']),
        ),
      )
      .limit(1);

    return {
      standardVersion: standard.version,
      totalEndpoints: totals?.total ?? 0,
      checkedEndpoints: coverage.checked,
      endpointsWithErrors: coverage.errors,
      endpointsWithWarnings: coverage.warnings,
      exemptionCount: exemptionCount?.count ?? 0,
      violationsByRule: violationsByRule as Record<RuleIdValue, number>,
      sweep: sweep
        ? {
            jobId: sweep.id,
            state: sweep.state,
            checked: Number(sweep.progress['checked'] ?? 0),
            total: totals?.total ?? 0,
          }
        : null,
    };
  }

  async listExemptions(projectId: string): Promise<ExemptionRecord[]> {
    const rows = await this.db
      .select({
        exemption: lintExemptions,
        endpointMethod: endpoints.method,
        endpointPath: endpoints.path,
        grantedByName: users.displayName,
      })
      .from(lintExemptions)
      .leftJoin(endpoints, eq(endpoints.id, lintExemptions.endpointId))
      .leftJoin(users, eq(users.id, lintExemptions.grantedBy))
      .where(eq(lintExemptions.projectId, projectId))
      .orderBy(asc(lintExemptions.grantedAt));

    return rows.map((row) => ({
      id: row.exemption.id,
      projectId: row.exemption.projectId,
      endpointId: row.exemption.endpointId,
      ruleId: row.exemption.ruleId,
      justification: row.exemption.justification,
      grantedBy: row.exemption.grantedBy,
      grantedByName: row.grantedByName,
      grantedAt: row.exemption.grantedAt.toISOString(),
      endpointLabel:
        row.endpointMethod && row.endpointPath
          ? `${row.endpointMethod.toUpperCase()} ${row.endpointPath}`
          : undefined,
    }));
  }

  async grantExemption(
    user: AuthenticatedUser,
    project: Project,
    request: CreateExemptionRequest,
  ): Promise<ExemptionRecord> {
    const [endpoint] = await this.db
      .select({ method: endpoints.method, path: endpoints.path })
      .from(endpoints)
      .where(eq(endpoints.id, request.endpointId))
      .limit(1);

    if (!endpoint) throw new NotFoundException('No such endpoint.');

    const label = `${endpoint.method.toUpperCase()} ${endpoint.path}`;

    const [row] = await this.db
      .insert(lintExemptions)
      .values({
        id: uuidv7(),
        projectId: project.id,
        endpointId: request.endpointId,
        ruleId: request.ruleId,
        justification: request.justification,
        grantedBy: user.id,
      })
      .onConflictDoNothing()
      .returning();

    if (!row) {
      throw new ConflictException(
        `${request.ruleId} is already waived for ${label}.`,
      );
    }

    await this.audit.record({
      projectId: project.id,
      actor: user,
      action: 'exemption.granted',
      targetType: 'lint_exemption',
      targetId: row.id,
      targetLabel: `${request.ruleId} on ${label}`,
      metadata: { justification: request.justification },
    });

    return {
      id: row.id,
      projectId: row.projectId,
      endpointId: row.endpointId,
      ruleId: row.ruleId,
      justification: row.justification,
      grantedBy: row.grantedBy,
      grantedByName: user.displayName,
      grantedAt: row.grantedAt.toISOString(),
      endpointLabel: label,
    };
  }

  async revokeExemption(
    user: AuthenticatedUser,
    project: Project,
    exemptionId: string,
  ): Promise<void> {
    const [row] = await this.db
      .delete(lintExemptions)
      .where(
        and(
          eq(lintExemptions.id, exemptionId),
          eq(lintExemptions.projectId, project.id),
        ),
      )
      .returning();

    if (!row) throw new NotFoundException('No such exemption.');

    await this.audit.record({
      projectId: project.id,
      actor: user,
      action: 'exemption.revoked',
      targetType: 'lint_exemption',
      targetId: exemptionId,
      targetLabel: row.ruleId,
    });
  }

  /**
   * Runs the engine for one endpoint, resolving `$ref`s against the version's
   * named schemas so a response pointing at a shared schema is still checked.
   */
  private async run(
    endpoint: Endpoint,
    standard: ResponseStandard,
  ): Promise<ViolationRecord[]> {
    const named = await this.db
      .select({ name: namedSchemas.name, schema: namedSchemas.schema })
      .from(namedSchemas)
      .where(eq(namedSchemas.versionId, endpoint.versionId));

    const byName = new Map(named.map((row) => [row.name, row.schema]));

    const violations = lintEndpoint({
      endpoint,
      standard,
      resolveRef: (ref) => byName.get(ref.split('/').pop() ?? ''),
    });

    return violations.map((violation) => ({
      ruleId: violation.ruleId,
      severity: violation.severity,
      pointer: violation.pointer,
      message: violation.message,
    }));
  }

  private async store(
    projectId: string,
    endpointId: string,
    violations: ViolationRecord[],
    standardVersion: number,
    tx: DatabaseExecutor = this.db,
  ): Promise<Date> {
    const checkedAt = new Date();

    await tx
      .insert(lintResults)
      .values({
        endpointId,
        projectId,
        standardVersion,
        violations,
        errorCount: violations.filter((v) => v.severity === 'error').length,
        warnCount: violations.filter((v) => v.severity === 'warn').length,
        checkedAt,
      })
      .onConflictDoUpdate({
        target: lintResults.endpointId,
        set: {
          standardVersion,
          violations,
          errorCount: violations.filter((v) => v.severity === 'error').length,
          warnCount: violations.filter((v) => v.severity === 'warn').length,
          checkedAt,
        },
      });

    await tx
      .update(endpoints)
      .set({ lintCheckedStandardVersion: standardVersion })
      .where(eq(endpoints.id, endpointId));

    return checkedAt;
  }

  private async resolve(
    projectId: string,
    endpointId: string,
    violations: ViolationRecord[],
    standardVersion: number,
    checkedAt: Date,
    rulesEnabled: boolean,
  ): Promise<LintResult> {
    const exemptions = await this.exemptionsFor(projectId, endpointId);
    const resolved = applyExemptions(violations, exemptions, endpointId);

    return {
      endpointId,
      standardVersion,
      violations: resolved as ViolationRecord[],
      blocked: isBlocked(resolved),
      rulesEnabled,
      checkedAt: checkedAt.toISOString(),
    };
  }

  private async exemptionsFor(
    projectId: string,
    endpointId?: string,
  ): Promise<Exemption[]> {
    const rows = await this.db
      .select()
      .from(lintExemptions)
      .where(
        endpointId
          ? and(
              eq(lintExemptions.projectId, projectId),
              eq(lintExemptions.endpointId, endpointId),
            )
          : eq(lintExemptions.projectId, projectId),
      );

    return rows.map((row) => ({
      id: row.id,
      endpointId: row.endpointId,
      ruleId: row.ruleId,
      justification: row.justification,
      grantedBy: row.grantedBy ?? '',
      grantedAt: row.grantedAt.toISOString(),
    }));
  }
}
