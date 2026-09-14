import {
  type EndpointStatus,
  type EndpointStatusEvent,
  type StatusRollup,
  type UpdateStatusRequest,
  updateStatusRequestSchema,
} from '@apion/contracts';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { type AuthenticatedUser, CurrentUser } from '../auth/auth.guard.js';
import {
  CurrentProject,
  type ProjectContext,
  RequirePermission,
} from '../auth/project-access.guard.js';
import { StatusService } from './status.service.js';

@Controller('projects/:slug')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  /**
   * FR-3.4: the channel deployment systems call. It is the same authenticated,
   * authorised, audited path as a UI change: a CI token is just a session
   * belonging to a service account.
   */
  @Post('endpoints/:endpointId/status')
  @RequirePermission('status.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('endpointId') endpointId: string,
    @Body(new ZodValidationPipe(updateStatusRequestSchema))
    body: UpdateStatusRequest,
  ): Promise<EndpointStatus> {
    return this.status.update(user, context.project, endpointId, body, 'ci');
  }

  @Get('endpoints/:endpointId/status')
  @RequirePermission('contract.read')
  read(@Param('endpointId') endpointId: string): Promise<EndpointStatus[]> {
    return this.status.statusesFor(endpointId);
  }

  @Get('endpoints/:endpointId/status/history')
  @RequirePermission('contract.read')
  history(
    @Param('endpointId') endpointId: string,
    @Query('environmentId') environmentId?: string,
  ): Promise<EndpointStatusEvent[]> {
    return this.status.history(endpointId, environmentId);
  }

  /** FR-3.6: the health panel's rollups for one version and environment. */
  @Get('versions/:versionId/health')
  @RequirePermission('contract.read')
  health(
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Query('environment') environment = 'dev',
  ): Promise<StatusRollup[]> {
    return this.status.rollups(context.project, versionId, environment);
  }
}
