import type {
  MockConfig,
  MockScenario,
  MockToken,
  Project,
  UpdateMockConfigRequest,
  UpsertScenarioRequest,
} from '@apion/contracts';
import { DEFAULT_SCENARIO_NAMES } from '@apion/contracts';
import { type Database, mockConfigs, mockScenarios } from '@apion/db';
import { uuidv7 } from '@apion/domain';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import { and, asc, eq } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';

/**
 * PRD 05's control plane: how a project's mock authenticates, whether it
 * validates requests, and which named scenarios it offers.
 */
@Injectable()
export class MockConfigService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Creates the default configuration and the five scenarios on first read. */
  async config(projectId: string): Promise<MockConfig> {
    const existing = await this.find(projectId);
    if (existing) return existing;

    await this.db
      .insert(mockConfigs)
      .values({ projectId })
      .onConflictDoNothing();

    await this.seedScenarios(projectId);

    const created = await this.find(projectId);
    if (!created) {
      throw new ConflictException(
        'The mock configuration could not be created.',
      );
    }
    return created;
  }

  async update(
    user: AuthenticatedUser,
    project: Project,
    expectedVersion: number,
    request: UpdateMockConfigRequest,
  ): Promise<MockConfig> {
    const current = await this.config(project.id);

    // A public link needs a slug to be reachable at all, and losing public mode
    // should not silently leave one live.
    const publicSlug =
      request.authMode === 'public-link'
        ? (current.publicSlug ?? randomSlug())
        : request.authMode !== undefined
          ? null
          : current.publicSlug;

    const [updated] = await this.db
      .update(mockConfigs)
      .set({
        ...(request.authMode !== undefined
          ? { authMode: request.authMode }
          : {}),
        ...(request.validateRequests !== undefined
          ? { validateRequests: request.validateRequests }
          : {}),
        ...(request.locale !== undefined ? { locale: request.locale } : {}),
        publicSlug,
        entityVersion: current.entityVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mockConfigs.projectId, project.id),
          eq(mockConfigs.entityVersion, expectedVersion),
        ),
      )
      .returning();

    if (!updated) {
      throw new ConflictException(
        'Someone changed the mock settings while you were editing them. Reload to see their change.',
      );
    }

    await this.audit.record({
      projectId: project.id,
      actor: user,
      action: 'mock.config_updated',
      targetType: 'mock_config',
      targetId: project.id,
      targetLabel: updated.authMode,
      metadata: { authMode: updated.authMode, locale: updated.locale },
    });

    return toConfig(updated);
  }

  /**
   * FR-6.1: the project bearer token is rotatable and revocable. The plaintext
   * is returned once and only its argon2id hash is kept, so a database dump
   * does not hand over working mock access.
   */
  async rotateToken(
    user: AuthenticatedUser,
    project: Project,
  ): Promise<MockToken> {
    await this.config(project.id);

    const token = `apm_${randomSlug(40)}`;
    const rotatedAt = new Date();

    await this.db
      .update(mockConfigs)
      .set({
        tokenHash: await argon2.hash(token, { type: argon2.argon2id }),
        tokenHint: token.slice(-6),
        tokenRotatedAt: rotatedAt,
        updatedAt: rotatedAt,
      })
      .where(eq(mockConfigs.projectId, project.id));

    await this.audit.record({
      projectId: project.id,
      actor: user,
      action: 'mock.token_rotated',
      targetType: 'mock_config',
      targetId: project.id,
    });

    return {
      token,
      hint: token.slice(-6),
      rotatedAt: rotatedAt.toISOString(),
    };
  }

  async revokeToken(user: AuthenticatedUser, project: Project): Promise<void> {
    await this.db
      .update(mockConfigs)
      .set({ tokenHash: null, tokenHint: null, updatedAt: new Date() })
      .where(eq(mockConfigs.projectId, project.id));

    await this.audit.record({
      projectId: project.id,
      actor: user,
      action: 'mock.token_rotated',
      targetType: 'mock_config',
      targetId: project.id,
      metadata: { revoked: true },
    });
  }

  /** Verifies a presented bearer token against the stored hash. */
  async verifyToken(projectId: string, token: string): Promise<boolean> {
    const [row] = await this.db
      .select({ tokenHash: mockConfigs.tokenHash })
      .from(mockConfigs)
      .where(eq(mockConfigs.projectId, projectId))
      .limit(1);

    if (!row?.tokenHash) return false;

    try {
      return await argon2.verify(row.tokenHash, token);
    } catch {
      return false;
    }
  }

  async scenarios(projectId: string): Promise<MockScenario[]> {
    await this.config(projectId);

    const rows = await this.db
      .select()
      .from(mockScenarios)
      .where(eq(mockScenarios.projectId, projectId))
      .orderBy(asc(mockScenarios.name));

    return rows.map(toScenario);
  }

  async scenarioByName(
    projectId: string,
    name: string,
  ): Promise<MockScenario | null> {
    const [row] = await this.db
      .select()
      .from(mockScenarios)
      .where(
        and(
          eq(mockScenarios.projectId, projectId),
          eq(mockScenarios.name, name),
        ),
      )
      .limit(1);

    return row ? toScenario(row) : null;
  }

  async upsertScenario(
    user: AuthenticatedUser,
    project: Project,
    request: UpsertScenarioRequest,
  ): Promise<MockScenario> {
    const [row] = await this.db
      .insert(mockScenarios)
      .values({
        id: uuidv7(),
        projectId: project.id,
        name: request.name,
        description: request.description ?? '',
        rules: request.rules,
      })
      .onConflictDoUpdate({
        target: [mockScenarios.projectId, mockScenarios.name],
        set: {
          description: request.description ?? '',
          rules: request.rules,
        },
      })
      .returning();

    await this.audit.record({
      projectId: project.id,
      actor: user,
      action: 'mock.scenario_saved',
      targetType: 'mock_scenario',
      targetId: row.id,
      targetLabel: row.name,
    });

    return toScenario(row);
  }

  async deleteScenario(
    user: AuthenticatedUser,
    project: Project,
    scenarioId: string,
  ): Promise<void> {
    const [row] = await this.db
      .delete(mockScenarios)
      .where(
        and(
          eq(mockScenarios.id, scenarioId),
          eq(mockScenarios.projectId, project.id),
        ),
      )
      .returning();

    if (!row) throw new NotFoundException('No such scenario.');

    await this.audit.record({
      projectId: project.id,
      actor: user,
      action: 'mock.scenario_deleted',
      targetType: 'mock_scenario',
      targetId: scenarioId,
      targetLabel: row.name,
    });
  }

  /** Resolves a project by its public-link slug, for unauthenticated mocks. */
  async projectIdForPublicSlug(slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ projectId: mockConfigs.projectId })
      .from(mockConfigs)
      .where(eq(mockConfigs.publicSlug, slug))
      .limit(1);

    return row?.projectId ?? null;
  }

  /**
   * FR-6.4: "Every project starts with `happyPath`, `emptyStates`,
   * `serverErrors`, `slowNetwork` and `unauthenticated`."
   *
   * They are empty of rules beyond what their name implies, because the
   * endpoints they would name do not exist yet; a project fills them in.
   */
  private async seedScenarios(projectId: string): Promise<void> {
    await this.db
      .insert(mockScenarios)
      .values(
        DEFAULT_SCENARIO_NAMES.map((name) => ({
          id: uuidv7(),
          projectId,
          name,
          description: SCENARIO_DESCRIPTIONS[name],
          rules: defaultRules(name),
          isDefault: true,
        })),
      )
      .onConflictDoNothing();
  }

  private async find(projectId: string): Promise<MockConfig | null> {
    const [row] = await this.db
      .select()
      .from(mockConfigs)
      .where(eq(mockConfigs.projectId, projectId))
      .limit(1);

    return row ? toConfig(row) : null;
  }
}

const SCENARIO_DESCRIPTIONS: Record<
  (typeof DEFAULT_SCENARIO_NAMES)[number],
  string
> = {
  happyPath: 'Every endpoint answers with its default example.',
  emptyStates: 'Collections come back empty, so empty views can be built.',
  serverErrors: 'Every endpoint answers 500, to exercise error handling.',
  slowNetwork: 'Responses are held for two seconds.',
  unauthenticated: 'Every endpoint answers 401.',
};

/** What each default scenario does before a project narrows it. */
function defaultRules(name: (typeof DEFAULT_SCENARIO_NAMES)[number]): {
  endpointId: null;
  statusCode: number | null;
  exampleName: string | null;
  delayMs: number | null;
}[] {
  switch (name) {
    case 'happyPath':
      return [];
    case 'emptyStates':
      return [
        {
          endpointId: null,
          statusCode: null,
          exampleName: 'emptyList',
          delayMs: null,
        },
      ];
    case 'serverErrors':
      return [
        { endpointId: null, statusCode: 500, exampleName: null, delayMs: null },
      ];
    case 'slowNetwork':
      return [
        {
          endpointId: null,
          statusCode: null,
          exampleName: null,
          delayMs: 2000,
        },
      ];
    case 'unauthenticated':
      return [
        { endpointId: null, statusCode: 401, exampleName: null, delayMs: null },
      ];
  }
}

/** Unguessable, and safe in a URL path segment. */
function randomSlug(length = 32): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function toConfig(row: typeof mockConfigs.$inferSelect): MockConfig {
  return {
    projectId: row.projectId,
    authMode: row.authMode,
    validateRequests: row.validateRequests,
    locale: row.locale,
    publicSlug: row.publicSlug,
    tokenHint: row.tokenHint,
    tokenRotatedAt: row.tokenRotatedAt?.toISOString() ?? null,
    entityVersion: row.entityVersion,
  };
}

function toScenario(row: typeof mockScenarios.$inferSelect): MockScenario {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    rules: row.rules,
    isDefault: row.isDefault,
    entityVersion: row.entityVersion,
  };
}
