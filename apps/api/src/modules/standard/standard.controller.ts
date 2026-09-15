import type {
  ApplyPresetRequest,
  CreateExemptionRequest,
  EnvelopeSlotsResponse,
  ExemptionRecord,
  LintResult,
  PreviewRequest,
  PreviewResponse,
  ResponseStandardRecord,
  StandardHealth,
  UpdateStandardRequest,
} from '@apion/contracts';
import {
  applyPresetRequestSchema,
  createExemptionRequestSchema,
  previewRequestSchema,
  updateStandardRequestSchema,
} from '@apion/contracts';
import {
  envelopeSlots,
  missingSlots,
  PRESETS,
  slotValuesOf,
  wireExample,
  wireSchema,
} from '@apion/response-standard';
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
} from '@nestjs/common';
import { IfMatch } from '../../common/entity-version.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { type AuthenticatedUser, CurrentUser } from '../auth/auth.guard.js';
import {
  CurrentProject,
  type ProjectContext,
  RequirePermission,
} from '../auth/project-access.guard.js';
import { LintService } from './lint.service.js';
import { StandardsService, toEngineStandard } from './standards.service.js';

/**
 * PRD 03's surface. The standard is a project-level object, not a per-version
 * one: a project has one set of response conventions whichever contract version
 * is open.
 */
@Controller('projects/:slug/standard')
export class StandardController {
  constructor(
    private readonly standards: StandardsService,
    private readonly lint: LintService,
  ) {}

  @Get()
  @RequirePermission('standard.read')
  read(
    @CurrentProject() context: ProjectContext,
  ): Promise<ResponseStandardRecord> {
    return this.standards.active(context.project.id);
  }

  /** The editable copy. Reading it is what creates it, so opening the editor works. */
  @Get('draft')
  @RequirePermission('standard.write')
  readDraft(
    @CurrentProject() context: ProjectContext,
  ): Promise<ResponseStandardRecord> {
    return this.standards.draft(context.project.id);
  }

  @Patch('draft')
  @RequirePermission('standard.write')
  updateDraft(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
    @Body(new ZodValidationPipe(updateStandardRequestSchema))
    body: UpdateStandardRequest,
  ): Promise<ResponseStandardRecord> {
    return this.standards.update(user, context.project, expectedVersion, body);
  }

  @Delete('draft')
  @RequirePermission('standard.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  discardDraft(@CurrentProject() context: ProjectContext): Promise<void> {
    return this.standards.discardDraft(context.project.id);
  }

  /** FR-4.7. The starting points, for the project-setup picker. */
  @Get('presets')
  @RequirePermission('standard.read')
  listPresets() {
    return PRESETS;
  }

  @Post('draft/preset')
  @RequirePermission('standard.write')
  applyPreset(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
    @Body(new ZodValidationPipe(applyPresetRequestSchema))
    body: ApplyPresetRequest,
  ): Promise<ResponseStandardRecord> {
    return this.standards.applyPreset(
      user,
      context.project,
      expectedVersion,
      body.preset,
    );
  }

  /**
   * FR-4.1: publishing returns promptly regardless of endpoint count. It bumps
   * the version and leaves every cached lint result stale; nothing is relinted
   * here.
   */
  @Post('publish')
  @RequirePermission('standard.publish')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
  ): Promise<ResponseStandardRecord> {
    return this.standards.publish(user, context.project, expectedVersion);
  }

  /**
   * The read-only wire shape beside the author's payload. Same engine the mock
   * and the exporter use, which is the whole point of FR-4.8.
   */
  @Post('preview')
  @RequirePermission('standard.read')
  async preview(
    @CurrentProject() context: ProjectContext,
    @Body(new ZodValidationPipe(previewRequestSchema)) body: PreviewRequest,
  ): Promise<PreviewResponse> {
    const standard = toEngineStandard(
      await this.standards.active(context.project.id),
    );

    const response = {
      id: '00000000-0000-0000-0000-000000000000',
      statusCode: body.statusCode,
      description: '',
      headers: [],
      payloadSchema: body.payloadSchema ?? null,
      examples: [],
    };

    const slotValues =
      body.example === undefined ? {} : slotValuesOf(body.example);

    return {
      schema: wireSchema(standard, response) ?? null,
      example:
        body.example === undefined
          ? null
          : (wireExample(standard, response, slotValues) ?? null),
      // What the author still has to fill, so the editor can prompt for it.
      missingSlots: missingSlots(standard, response, slotValues),
    };
  }

  /**
   * The slots this project's envelope declares. The endpoint editor renders one
   * field per slot, which is how an author comes to fill every one.
   */
  @Get('slots')
  @RequirePermission('standard.read')
  async slots(
    @CurrentProject() context: ProjectContext,
  ): Promise<EnvelopeSlotsResponse> {
    const record = await this.standards.active(context.project.id);
    const standard = toEngineStandard(record);

    return {
      standardVersion: record.version,
      envelope: standard.envelope,
      slots: envelopeSlots(standard.envelope),
    };
  }

  @Get('health')
  @RequirePermission('standard.read')
  health(@CurrentProject() context: ProjectContext): Promise<StandardHealth> {
    return this.lint.health(context.project.id);
  }

  /** The `check all` sweep. Returns the job; progress arrives through health. */
  @Post('health/sweep')
  @RequirePermission('standard.write')
  async sweep(
    @CurrentProject() context: ProjectContext,
  ): Promise<{ jobId: string }> {
    return { jobId: await this.lint.startSweep(context.project.id) };
  }

  @Get('exemptions')
  @RequirePermission('standard.read')
  listExemptions(
    @CurrentProject() context: ProjectContext,
  ): Promise<ExemptionRecord[]> {
    return this.lint.listExemptions(context.project.id);
  }

  /** FR-4.6. Maintainer only, and the justification is validated as mandatory. */
  @Post('exemptions')
  @RequirePermission('exemption.grant')
  grantExemption(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Body(new ZodValidationPipe(createExemptionRequestSchema))
    body: CreateExemptionRequest,
  ): Promise<ExemptionRecord> {
    return this.lint.grantExemption(user, context.project, body);
  }

  @Delete('exemptions/:exemptionId')
  @RequirePermission('exemption.grant')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeExemption(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('exemptionId') exemptionId: string,
  ): Promise<void> {
    return this.lint.revokeExemption(user, context.project, exemptionId);
  }
}

/** Lint results hang off the endpoint, which is where an author reads them. */
@Controller('projects/:slug/versions/:versionId/endpoints/:endpointId')
export class EndpointLintController {
  constructor(private readonly lint: LintService) {}

  @Get('lint')
  @RequirePermission('contract.read')
  read(
    @CurrentProject() context: ProjectContext,
    @Param('endpointId') endpointId: string,
  ): Promise<LintResult> {
    return this.lint.forEndpoint(context.project.id, endpointId);
  }

  /** Forces a recheck after an edit, without waiting for the endpoint to go stale. */
  @Post('lint')
  @RequirePermission('contract.read')
  recheck(
    @CurrentProject() context: ProjectContext,
    @Param('endpointId') endpointId: string,
  ): Promise<LintResult> {
    return this.lint.check(context.project.id, endpointId);
  }
}
