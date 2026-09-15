import type { ContractDiff } from '@apion/contracts';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { type AuthenticatedUser, CurrentUser } from '../auth/auth.guard.js';
import {
  CurrentProject,
  type ProjectContext,
  RequirePermission,
} from '../auth/project-access.guard.js';
import {
  PortabilityService,
  type ImportSummary,
} from './portability.service.js';

@Controller('projects/:slug/versions/:versionId')
export class PortabilityController {
  constructor(private readonly portability: PortabilityService) {}

  @Get('export/openapi.json')
  @RequirePermission('contract.export')
  exportOpenApi(
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
  ): Promise<unknown> {
    return this.portability.exportOpenApi(context.project, versionId);
  }

  @Get('export/types.ts')
  @RequirePermission('contract.export')
  @Header('content-type', 'text/plain; charset=utf-8')
  exportTypeScript(
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
  ): Promise<string> {
    return this.portability.exportTypeScript(context.project, versionId);
  }

  /**
   * Takes the raw document as text rather than JSON, so a YAML spec arrives
   * unmangled and a parse failure is reported by the importer with its own
   * message instead of by the body parser.
   */
  @Post('import/openapi')
  @RequirePermission('contract.import')
  importOpenApi(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Body() body: { document: string },
  ): Promise<ImportSummary> {
    return this.portability.importOpenApi(
      user,
      context.project,
      versionId,
      body.document,
    );
  }

  /** FR-2.6: classified diff against another version of the same project. */
  @Get('diff')
  @RequirePermission('contract.read')
  diff(
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Query('from') fromVersionId: string,
  ): Promise<ContractDiff> {
    return this.portability.diff(context.project, fromVersionId, versionId);
  }
}
