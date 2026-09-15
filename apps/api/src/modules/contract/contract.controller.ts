import {
  type CreateEndpointRequest,
  type CreateResourceRequest,
  type CreateSchemaRequest,
  createEndpointRequestSchema,
  createResourceRequestSchema,
  createSchemaRequestSchema,
  type Endpoint,
  type EndpointSummary,
  type NamedSchema,
  type RenameSchemaRequest,
  type Resource,
  renameSchemaRequestSchema,
  type SchemaImpact,
  type UpdateEndpointRequest,
  updateEndpointRequestSchema,
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
import { MockRuntimeService } from '../mock/mock-runtime.service.js';
import { EndpointsService } from './endpoints.service.js';
import { ResourcesService } from './resources.service.js';
import { SchemasService } from './schemas.service.js';

/**
 * Contract authoring for one version. Routes are nested under the version so a
 * client always says which snapshot it is editing: an omitted version is the
 * kind of ambiguity that silently writes to the wrong one.
 */
@Controller('projects/:slug/versions/:versionId')
export class ContractController {
  constructor(
    private readonly endpoints: EndpointsService,
    private readonly schemas: SchemasService,
    private readonly resources: ResourcesService,
    private readonly mocks: MockRuntimeService,
  ) {}

  @Get('resources')
  @RequirePermission('contract.read')
  listResources(@Param('versionId') versionId: string): Promise<Resource[]> {
    return this.resources.list(versionId);
  }

  @Post('resources')
  @RequirePermission('contract.write')
  createResource(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(createResourceRequestSchema))
    body: CreateResourceRequest,
  ): Promise<Resource> {
    return this.resources.create(user, context.project, versionId, body);
  }

  @Delete('resources/:resourceId')
  @RequirePermission('contract.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeResource(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Param('resourceId') resourceId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    return this.resources.remove(
      user,
      context.project,
      versionId,
      resourceId,
      expectedVersion,
    );
  }

  @Get('endpoints')
  @RequirePermission('contract.read')
  listEndpoints(
    @Param('versionId') versionId: string,
    @Query('resourceId') resourceId?: string,
    @Query('environmentId') environmentId?: string,
  ): Promise<EndpointSummary[]> {
    return this.endpoints.listSummaries(versionId, {
      resourceId,
      environmentId,
    });
  }

  @Get('endpoints/:endpointId')
  @RequirePermission('contract.read')
  readEndpoint(
    @Param('versionId') versionId: string,
    @Param('endpointId') endpointId: string,
  ): Promise<Endpoint> {
    return this.endpoints.findOne(versionId, endpointId);
  }

  @Post('endpoints')
  @RequirePermission('contract.write')
  async createEndpoint(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(createEndpointRequestSchema))
    body: CreateEndpointRequest,
  ): Promise<Endpoint> {
    const created = await this.endpoints.create(
      user,
      context.project,
      versionId,
      body,
    );
    // PRD 05 gives a contract edit five seconds to reach the mock; dropping the
    // compiled engine here makes it the next request instead.
    this.mocks.invalidate(context.project.id);
    return created;
  }

  @Patch('endpoints/:endpointId')
  @RequirePermission('contract.write')
  async updateEndpoint(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Param('endpointId') endpointId: string,
    @IfMatch() expectedVersion: number,
    @Body(new ZodValidationPipe(updateEndpointRequestSchema))
    body: UpdateEndpointRequest,
  ): Promise<Endpoint> {
    const updated = await this.endpoints.update(
      user,
      context.project,
      versionId,
      endpointId,
      expectedVersion,
      body,
    );
    this.mocks.invalidate(context.project.id);
    return updated;
  }

  @Delete('endpoints/:endpointId')
  @RequirePermission('contract.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeEndpoint(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Param('endpointId') endpointId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.endpoints.remove(
      user,
      context.project,
      versionId,
      endpointId,
      expectedVersion,
    );
    this.mocks.invalidate(context.project.id);
  }

  @Get('schemas')
  @RequirePermission('contract.read')
  listSchemas(@Param('versionId') versionId: string): Promise<NamedSchema[]> {
    return this.schemas.list(versionId);
  }

  @Get('schemas/:schemaId')
  @RequirePermission('contract.read')
  readSchema(
    @Param('versionId') versionId: string,
    @Param('schemaId') schemaId: string,
  ): Promise<NamedSchema> {
    return this.schemas.findOne(versionId, schemaId);
  }

  @Post('schemas')
  @RequirePermission('contract.write')
  createSchema(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(createSchemaRequestSchema))
    body: CreateSchemaRequest,
  ): Promise<NamedSchema> {
    return this.schemas.create(user, context.project, versionId, body);
  }

  @Patch('schemas/:schemaId')
  @RequirePermission('contract.write')
  updateSchema(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Param('schemaId') schemaId: string,
    @IfMatch() expectedVersion: number,
    @Body() body: { description?: string; schema?: unknown },
  ): Promise<NamedSchema> {
    return this.schemas.update(
      user,
      context.project,
      versionId,
      schemaId,
      expectedVersion,
      body,
    );
  }

  /** FR-2.4: what a rename would touch, shown before the author confirms it. */
  @Get('schemas/:schemaId/impact')
  @RequirePermission('contract.read')
  schemaImpact(
    @Param('versionId') versionId: string,
    @Param('schemaId') schemaId: string,
  ): Promise<SchemaImpact> {
    return this.schemas.impact(versionId, schemaId);
  }

  @Post('schemas/:schemaId/rename')
  @RequirePermission('contract.write')
  renameSchema(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Param('schemaId') schemaId: string,
    @IfMatch() expectedVersion: number,
    @Body(new ZodValidationPipe(renameSchemaRequestSchema))
    body: RenameSchemaRequest,
  ): Promise<{ schema: NamedSchema; updatedReferences: number }> {
    return this.schemas.rename(
      user,
      context.project,
      versionId,
      schemaId,
      expectedVersion,
      body,
    );
  }

  @Delete('schemas/:schemaId')
  @RequirePermission('contract.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSchema(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @Param('schemaId') schemaId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    return this.schemas.remove(
      user,
      context.project,
      versionId,
      schemaId,
      expectedVersion,
    );
  }
}
