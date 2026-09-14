import type {
  MockConfig,
  MockEnvironmentRef,
  MockLogEntry,
  MockLogQuery,
  MockScenario,
  MockToken,
  UpdateMockConfigRequest,
  UpsertScenarioRequest,
} from '@apion/contracts';
import {
  mockLogQuerySchema,
  updateMockConfigRequestSchema,
  upsertScenarioRequestSchema,
} from '@apion/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IfMatch } from '../../common/entity-version.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { type AuthenticatedUser, CurrentUser } from '../auth/auth.guard.js';
import {
  CurrentProject,
  type ProjectContext,
  RequirePermission,
} from '../auth/project-access.guard.js';
import { MockConfigService } from './mock-config.service.js';
import { MockLogService } from './mock-log.service.js';
import { MockRuntimeService } from './mock-runtime.service.js';

/**
 * Managing a project's mock, inside `/api/v1` and behind the ordinary project
 * roles. The mock itself is served elsewhere; nothing here answers a mock call.
 */
@Controller('projects/:slug/mock')
export class MockAdminController {
  constructor(
    private readonly config: MockConfigService,
    private readonly logs: MockLogService,
    private readonly runtime: MockRuntimeService,
  ) {}

  @Get()
  @RequirePermission('project.read')
  read(@CurrentProject() context: ProjectContext): Promise<MockConfig> {
    return this.config.config(context.project.id);
  }

  @Patch()
  @RequirePermission('project.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
    @Body(new ZodValidationPipe(updateMockConfigRequestSchema))
    body: UpdateMockConfigRequest,
  ): Promise<MockConfig> {
    return this.config.update(user, context.project, expectedVersion, body);
  }

  /** Returns the plaintext token once; only its hash is stored. */
  @Post('token')
  @RequirePermission('project.update')
  rotateToken(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
  ): Promise<MockToken> {
    return this.config.rotateToken(user, context.project);
  }

  @Delete('token')
  @RequirePermission('project.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeToken(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
  ): Promise<void> {
    return this.config.revokeToken(user, context.project);
  }

  /** Which `<env>` segments resolve, so the UI can show real mock URLs. */
  @Get('environments')
  @RequirePermission('project.read')
  async environments(
    @CurrentProject() context: ProjectContext,
  ): Promise<MockEnvironmentRef[]> {
    return this.runtime.mockEnvironments(context.project.id);
  }

  @Get('scenarios')
  @RequirePermission('project.read')
  scenarios(
    @CurrentProject() context: ProjectContext,
  ): Promise<MockScenario[]> {
    return this.config.scenarios(context.project.id);
  }

  @Post('scenarios')
  @RequirePermission('contract.write')
  upsertScenario(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Body(new ZodValidationPipe(upsertScenarioRequestSchema))
    body: UpsertScenarioRequest,
  ): Promise<MockScenario> {
    return this.config.upsertScenario(user, context.project, body);
  }

  @Delete('scenarios/:scenarioId')
  @RequirePermission('contract.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteScenario(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('scenarioId') scenarioId: string,
  ): Promise<void> {
    return this.config.deleteScenario(user, context.project, scenarioId);
  }

  /** FR-6.7's live, filterable request log. */
  @Get('log')
  @RequirePermission('project.read')
  log(
    @CurrentProject() context: ProjectContext,
    @Query(new ZodValidationPipe(mockLogQuerySchema)) query: MockLogQuery,
  ): Promise<{ items: MockLogEntry[]; nextCursor: string | null }> {
    return this.logs.list(context.project.id, query);
  }
}
