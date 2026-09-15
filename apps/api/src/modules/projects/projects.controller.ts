import {
  type AuditEvent,
  type ContractVersion,
  type CreateProjectRequest,
  type CreateVersionRequest,
  createProjectRequestSchema,
  createVersionRequestSchema,
  type Environment,
  type Project,
  type ProjectMember,
  type UpdateProjectRequest,
  type UpsertMemberRequest,
  updateProjectRequestSchema,
  upsertMemberRequestSchema,
} from '@apion/contracts';
import {
  Body,
  ConflictException,
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
import { AuditService } from '../audit/audit.service.js';
import { type AuthenticatedUser, CurrentUser } from '../auth/auth.guard.js';
import {
  CurrentProject,
  type ProjectContext,
  RequirePermission,
} from '../auth/project-access.guard.js';
import { LintService } from '../standard/lint.service.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    private readonly lint: LintService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<Project[]> {
    return this.projects.listForUser(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createProjectRequestSchema))
    body: CreateProjectRequest,
  ): Promise<Project> {
    return this.projects.create(user, body);
  }

  @Get(':slug')
  @RequirePermission('project.read')
  read(@CurrentProject() context: ProjectContext): Project {
    return context.project;
  }

  /** Tells the SPA which controls to render, so it never offers a save that fails. */
  @Get(':slug/access')
  @RequirePermission('project.read')
  access(@CurrentProject() context: ProjectContext): { role: string } {
    return { role: context.role };
  }

  @Patch(':slug')
  @RequirePermission('project.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
    @Body(new ZodValidationPipe(updateProjectRequestSchema))
    body: UpdateProjectRequest,
  ): Promise<Project> {
    return this.projects.update(user, context.project, expectedVersion, body);
  }

  @Post(':slug/archive')
  @RequirePermission('project.archive')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
  ): Promise<Project> {
    return this.projects.archive(user, context.project, expectedVersion);
  }

  @Delete(':slug')
  @RequirePermission('project.delete')
  softDelete(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
  ): Promise<Project> {
    return this.projects.softDelete(user, context.project, expectedVersion);
  }

  @Post(':slug/restore')
  @RequirePermission('project.restore')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @IfMatch() expectedVersion: number,
  ): Promise<Project> {
    return this.projects.restore(user, context.project, expectedVersion);
  }

  @Get(':slug/environments')
  @RequirePermission('project.read')
  environments(
    @CurrentProject() context: ProjectContext,
  ): Promise<Environment[]> {
    return this.projects.environments(context.project.id);
  }

  @Get(':slug/members')
  @RequirePermission('member.read')
  members(@CurrentProject() context: ProjectContext): Promise<ProjectMember[]> {
    return this.projects.members(context.project.id);
  }

  /** The people who could be added, scoped to this organisation. */
  @Get(':slug/members/candidates')
  @RequirePermission('member.manage')
  memberCandidates(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ id: string; displayName: string; email: string }[]> {
    return this.projects.organisationUsers(user.organisationId);
  }

  @Post(':slug/members')
  @RequirePermission('member.manage')
  upsertMember(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Body(new ZodValidationPipe(upsertMemberRequestSchema))
    body: UpsertMemberRequest,
  ): Promise<ProjectMember> {
    return this.projects.upsertMember(user, context.project, body);
  }

  @Delete(':slug/members/:userId')
  @RequirePermission('member.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.projects.removeMember(user, context.project, userId);
  }

  @Get(':slug/versions')
  @RequirePermission('project.read')
  versions(
    @CurrentProject() context: ProjectContext,
  ): Promise<ContractVersion[]> {
    return this.projects.versions(context.project.id);
  }

  @Post(':slug/versions')
  @RequirePermission('version.create')
  createVersion(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Body(new ZodValidationPipe(createVersionRequestSchema))
    body: CreateVersionRequest,
  ): Promise<ContractVersion> {
    return this.projects.createVersion(user, context.project, body);
  }

  @Post(':slug/versions/:versionId/publish')
  @RequirePermission('version.publish')
  async publishVersion(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentProject() context: ProjectContext,
    @Param('versionId') versionId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<ContractVersion> {
    // PRD 03 FR-4.5: "Error-severity violations block endpoint approval and
    // standard/contract publication." Checked here rather than inside the
    // version service so the contract module keeps no dependency on linting.
    const blocking = await this.lint.blockingEndpoints(
      context.project.id,
      versionId,
    );

    if (blocking.length > 0) {
      const summary = blocking
        .slice(0, 3)
        .map((entry) => `${entry.label} (${entry.ruleIds.join(', ')})`)
        .join('; ');

      throw new ConflictException(
        blocking.length === 1
          ? `${summary} breaks the response standard. Fix it or waive the rule, then publish.`
          : `${blocking.length} endpoints break the response standard, including ${summary}. Fix or waive them, then publish.`,
      );
    }

    return this.projects.publishVersion(
      user,
      context.project,
      versionId,
      expectedVersion,
    );
  }

  /** FR-1.7: the readable projection of the audit log. */
  @Get(':slug/activity')
  @RequirePermission('audit.read')
  activity(
    @CurrentProject() context: ProjectContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<{ items: AuditEvent[]; nextCursor: string | null }> {
    return this.audit.feed(context.project.id, {
      limit: Math.min(Number.parseInt(limit ?? '50', 10) || 50, 200),
      before: cursor ? new Date(cursor) : undefined,
    });
  }
}
