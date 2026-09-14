import type { Endpoint, MockEnvironmentRef } from '@apion/contracts';
import {
  contractVersions,
  type Database,
  endpoints,
  namedSchemas,
  organisations,
  projects,
} from '@apion/db';
import {
  DelayGate,
  MockEngine,
  type MockRequest,
  type MockResponse,
  parseFaults,
  RequestValidator,
  ResponseCache,
  SeededRandom,
} from '@apion/mock-engine';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { toEndpoint } from '../contract/endpoints.service.js';
import {
  StandardsService,
  toEngineStandard,
} from '../standard/standards.service.js';
import { MockConfigService } from './mock-config.service.js';

/**
 * Resolves `/mock/<org>/<project>/<env>/<path...>` to a contract and serves it.
 *
 * PRD 05 requires a contract edit to reach the mock within five seconds, so the
 * compiled engine is cached for a few seconds rather than for the life of a
 * version: long enough to absorb a burst, short enough that an author sees
 * their change without being told to do anything.
 */

const ENGINE_TTL_MS = 3_000;

/** PRD 05: 120 req/min for a private token, 30 for a public link. */
const RATE_LIMITS = { private: 120, public: 30 } as const;

export interface ResolvedTarget {
  projectId: string;
  projectSlug: string;
  versionId: string;
  versionLabel: string;
  environmentKey: string;
  /** `draft` follows the mutable head; a published version never moves. */
  mutable: boolean;
}

interface CachedEngine {
  engine: MockEngine;
  expiresAt: number;
  versionId: string;
}

@Injectable()
export class MockRuntimeService {
  private readonly logger = new Logger(MockRuntimeService.name);
  private readonly engines = new Map<string, CachedEngine>();
  private readonly cache = new ResponseCache();
  private readonly gate = new DelayGate();
  private readonly validator = new RequestValidator();
  private readonly rateWindows = new Map<
    string,
    { count: number; resetsAt: number }
  >();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly standards: StandardsService,
    private readonly config: MockConfigService,
  ) {}

  /**
   * `<env>` resolves a published version by label, or the mutable draft head.
   * Anything else is a 404 rather than a guess at what was meant.
   */
  async resolveTarget(
    orgSlug: string,
    projectSlug: string,
    env: string,
  ): Promise<ResolvedTarget | null> {
    // The organisation slug is part of the URL, so a project in another
    // organisation cannot be reached by guessing a project slug.
    const [project] = await this.db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .innerJoin(organisations, eq(organisations.id, projects.organisationId))
      .where(
        and(
          eq(projects.slug, projectSlug),
          eq(organisations.slug, orgSlug),
          // An archived or deleted project stops serving mocks.
          eq(projects.lifecycleState, 'active'),
        ),
      )
      .limit(1);

    if (!project) return null;

    if (env === 'draft') {
      const [draft] = await this.db
        .select()
        .from(contractVersions)
        .where(
          and(
            eq(contractVersions.projectId, project.id),
            eq(contractVersions.state, 'draft'),
          ),
        )
        .orderBy(desc(contractVersions.createdAt))
        .limit(1);

      if (!draft) return null;

      return {
        projectId: project.id,
        projectSlug: project.slug,
        versionId: draft.id,
        versionLabel: draft.label,
        environmentKey: env,
        mutable: true,
      };
    }

    const [version] = await this.db
      .select()
      .from(contractVersions)
      .where(
        and(
          eq(contractVersions.projectId, project.id),
          eq(contractVersions.label, env),
        ),
      )
      .limit(1);

    if (!version) return null;

    return {
      projectId: project.id,
      projectSlug: project.slug,
      versionId: version.id,
      versionLabel: version.label,
      environmentKey: env,
      mutable: version.state !== 'published',
    };
  }

  /** Serves one mock request, applying scenario, faults and delay. */
  async serve(
    target: ResolvedTarget,
    request: MockRequest,
    options: { scenarioName?: string },
  ): Promise<MockResponse & { held: boolean }> {
    const engine = await this.engineFor(target);
    const config = await this.config.config(target.projectId);

    const scenario = options.scenarioName
      ? await this.config.scenarioByName(target.projectId, options.scenarioName)
      : null;

    const result = engine.handle(request, {
      validateRequests: config.validateRequests,
      scenarioName: scenario?.name,
      scenarioRules: scenario?.rules,
      cache: this.cache,
    });

    const faults = parseFaults(
      {
        delay: headerOf(request.headers, 'x-mock-delay'),
        failureRate: headerOf(request.headers, 'x-mock-failure-rate'),
        timeout: headerOf(request.headers, 'x-mock-timeout'),
        malformed: headerOf(request.headers, 'x-mock-malformed'),
      },
      SeededRandom.from(request.requestId),
    );

    for (const problem of this.validator.drainSchemaProblems()) {
      this.logger.warn(
        `A schema in ${target.projectSlug}/${target.environmentKey} could not be compiled, so that request was not validated: ${problem}`,
      );
    }

    // A scenario's delay and a header's delay are both honoured; the larger one
    // wins rather than the two stacking into something over the cap.
    const delayMs = Math.max(faults.delayMs, result.diagnostics.delayMs);
    const held = delayMs > 0 ? await this.gate.hold(delayMs) : true;

    if (faults.malformed) {
      return {
        ...result,
        body: '{"data": {"truncated": ',
        headers: {
          ...result.headers,
          'content-type': 'application/json',
          'x-mock-fault': 'malformed',
        },
        held,
      };
    }

    if (faults.failureRate > 0) {
      const draw = SeededRandom.from(request.requestId, 'failure').next();
      if (draw < faults.failureRate) {
        return {
          ...result,
          statusCode: 503,
          body: JSON.stringify({
            error: {
              code: 'MOCK_INJECTED_FAILURE',
              message: 'This failure was requested with X-Mock-Failure-Rate.',
            },
          }),
          headers: { ...result.headers, 'x-mock-fault': 'failure-rate' },
          held,
        };
      }
    }

    return { ...result, held };
  }

  /**
   * The `<env>` segments that resolve for this project: every published version
   * by label, plus the mutable `draft` head. The UI builds real mock URLs from
   * these rather than guessing what a client should call.
   */
  async mockEnvironments(projectId: string): Promise<MockEnvironmentRef[]> {
    const [project] = await this.db
      .select({ slug: projects.slug, orgSlug: organisations.slug })
      .from(projects)
      .innerJoin(organisations, eq(organisations.id, projects.organisationId))
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) return [];

    const rows = await this.db
      .select()
      .from(contractVersions)
      .where(eq(contractVersions.projectId, projectId))
      .orderBy(desc(contractVersions.createdAt));

    const pathFor = (key: string) =>
      `/mock/${project.orgSlug}/${project.slug}/${key}/`;

    const refs: MockEnvironmentRef[] = rows
      .filter((row) => row.state === 'published')
      .map((row) => ({
        key: row.label,
        versionId: row.id,
        versionLabel: row.label,
        mutable: false,
        path: pathFor(row.label),
      }));

    const draft = rows.find((row) => row.state === 'draft');
    if (draft) {
      refs.unshift({
        key: 'draft',
        versionId: draft.id,
        versionLabel: draft.label,
        mutable: true,
        path: pathFor('draft'),
      });
    }

    return refs;
  }

  /** Route listing for `/__mock/routes`. */
  async routes(target: ResolvedTarget): Promise<readonly Endpoint[]> {
    return (await this.engineFor(target)).routes();
  }

  /**
   * PRD 05 rate-limits mock traffic separately from the control plane, so a
   * client load test cannot spend the API's budget. A fixed window is enough:
   * this protects a 1 vCPU host, it is not a billing meter.
   */
  checkRateLimit(
    key: string,
    mode: 'private' | 'public',
  ): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    const now = Date.now();
    const limit = RATE_LIMITS[mode];
    const window = this.rateWindows.get(key);

    if (!window || window.resetsAt <= now) {
      this.rateWindows.set(key, { count: 1, resetsAt: now + 60_000 });
      if (this.rateWindows.size > 5_000) this.pruneWindows(now);
      return { allowed: true, retryAfterSeconds: 0, remaining: limit - 1 };
    }

    window.count += 1;

    return window.count > limit
      ? {
          allowed: false,
          retryAfterSeconds: Math.ceil((window.resetsAt - now) / 1000),
          remaining: 0,
        }
      : {
          allowed: true,
          retryAfterSeconds: 0,
          remaining: limit - window.count,
        };
  }

  /** Called when a contract is saved, so the next request recompiles. */
  invalidate(projectId: string): void {
    for (const key of [...this.engines.keys()]) {
      if (key.startsWith(`${projectId}:`)) this.engines.delete(key);
    }
    this.cache.invalidateProject(projectId);
  }

  private async engineFor(target: ResolvedTarget): Promise<MockEngine> {
    const key = `${target.projectId}:${target.versionId}`;
    const cached = this.engines.get(key);

    // A published version is immutable, so its engine never needs rebuilding.
    if (cached && (!target.mutable || cached.expiresAt > Date.now())) {
      return cached.engine;
    }

    const engine = await this.compile(target);

    this.engines.set(key, {
      engine,
      versionId: target.versionId,
      expiresAt: Date.now() + ENGINE_TTL_MS,
    });

    return engine;
  }

  private async compile(target: ResolvedTarget): Promise<MockEngine> {
    const [rows, schemas, standard] = await Promise.all([
      this.db
        .select()
        .from(endpoints)
        .where(eq(endpoints.versionId, target.versionId))
        .orderBy(asc(endpoints.position)),
      this.db
        .select({ name: namedSchemas.name, schema: namedSchemas.schema })
        .from(namedSchemas)
        .where(eq(namedSchemas.versionId, target.versionId)),
      this.standards.active(target.projectId),
    ]);

    const config = await this.config.config(target.projectId);
    const byName = new Map(schemas.map((row) => [row.name, row.schema]));

    return new MockEngine(
      {
        projectId: target.projectId,
        versionId: target.versionId,
        endpoints: rows.map(toEndpoint),
        standard: toEngineStandard(standard),
        locale: config.locale,
        resolveRef: (ref) => byName.get(ref.split('/').pop() ?? ''),
      },
      this.validator,
    );
  }

  private pruneWindows(now: number): void {
    for (const [key, window] of this.rateWindows) {
      if (window.resetsAt <= now) this.rateWindows.delete(key);
    }
  }
}

function headerOf(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export type { MockRequest, MockResponse };
