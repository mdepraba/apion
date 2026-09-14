import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';

export interface AuthenticatedUser {
  id: string;
  organisationId: string;
  email: string;
  displayName: string;
}

/** Set on the request by `AuthGuard`; read by `CurrentUser`. */
export const AUTHENTICATED_USER = Symbol('authenticatedUser');

const IS_PUBLIC = 'auth:public';

/** Marks a route reachable without a session: login, register, health. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface JwtPayload {
  sub: string;
  org: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(header.slice(7));
      (request as FastifyRequest & Record<symbol, unknown>)[
        AUTHENTICATED_USER
      ] = {
        id: payload.sub,
        organisationId: payload.org,
        email: payload.email,
        displayName: payload.name,
      } satisfies AuthenticatedUser;
      return true;
    } catch {
      // Expiry and tampering are the same answer to the caller; the difference
      // only tells an attacker which half of the token to work on.
      throw new UnauthorizedException(
        'Your session has expired. Sign in again.',
      );
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const user = (request as FastifyRequest & Record<symbol, unknown>)[
      AUTHENTICATED_USER
    ] as AuthenticatedUser | undefined;

    if (!user) throw new UnauthorizedException('Sign in to continue.');
    return user;
  },
);
