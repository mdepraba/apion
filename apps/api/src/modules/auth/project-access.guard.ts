import type { Project, ProjectRole } from '@apion/contracts';
import { can, explainDenial, type Permission } from '@apion/domain';
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AUTHENTICATED_USER, type AuthenticatedUser } from './auth.guard.js';
import { ProjectAccessService } from './project-access.service.js';

const REQUIRED_PERMISSION = 'auth:permission';

/**
 * Declares what a route needs. PRD 01: "Role enforcement must happen
 * server-side for every control-plane operation": a route under `:slug`
 * without this decorator is refused rather than silently left open.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export interface ProjectContext {
  project: Project;
  role: ProjectRole;
}

export const PROJECT_CONTEXT = Symbol('projectContext');

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const slug = (request.params as Record<string, string> | undefined)?.[
      'slug'
    ];
    if (!slug) return true;

    const permission = this.reflector.getAllAndOverride<Permission>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) {
      throw new ForbiddenException(
        'This route does not declare the access it needs.',
      );
    }

    const user = (request as FastifyRequest & Record<symbol, unknown>)[
      AUTHENTICATED_USER
    ] as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Sign in to continue.');

    const membership = await this.access.resolve(slug, user);

    // A project the caller cannot read is indistinguishable from one that does
    // not exist. FR-1.6 extends the same rule to search results.
    if (!membership) throw new NotFoundException('No such project.');

    if (!can(membership.role, permission)) {
      throw new ForbiddenException(explainDenial(membership.role, permission));
    }

    // An archived project is readable but frozen (FR-1.5). Restoring it is the
    // one write that has to get through.
    if (
      membership.project.lifecycleState !== 'active' &&
      permission !== 'project.restore' &&
      isWrite(permission)
    ) {
      throw new ForbiddenException(
        membership.project.lifecycleState === 'archived'
          ? 'This project is archived and read-only. Restore it to make changes.'
          : 'This project is deleted. Restore it within 30 days to make changes.',
      );
    }

    (request as FastifyRequest & Record<symbol, unknown>)[PROJECT_CONTEXT] =
      membership;
    return true;
  }
}

const READ_PERMISSIONS = new Set<Permission>([
  'project.read',
  'member.read',
  'contract.read',
  'contract.export',
  'standard.read',
  'audit.read',
]);

function isWrite(permission: Permission): boolean {
  return !READ_PERMISSIONS.has(permission);
}

export const CurrentProject = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ProjectContext => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const context = (request as FastifyRequest & Record<symbol, unknown>)[
      PROJECT_CONTEXT
    ] as ProjectContext | undefined;

    if (!context) throw new NotFoundException('No such project.');
    return context;
  },
);
