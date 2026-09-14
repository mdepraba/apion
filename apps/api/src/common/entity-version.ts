import {
  formatETag,
  MissingPreconditionError,
  parseIfMatch,
} from '@apion/domain';
import {
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { map } from 'rxjs';

/**
 * Reads the `If-Match` header for an optimistic-concurrency write (PRD 01,
 * PRD 06 FR-5.3). A write that needs a precondition and did not get one is
 * refused with `428` rather than being allowed to overwrite blindly.
 *
 *   `@IfMatch() expectedVersion: number`: required
 *   `@IfMatch({ optional: true }) v?: number`: server-initiated writes
 */
export const IfMatch = createParamDecorator(
  (options: { optional?: boolean } | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const parsed = parseIfMatch(request.headers['if-match']);

    if (parsed === undefined && !options?.optional) {
      throw new MissingPreconditionError('resource');
    }

    return parsed;
  },
);

/**
 * Stamps `ETag` on any response carrying an `entityVersion`, so a client can
 * echo it back on the next write without tracking the number itself.
 */
@Injectable()
export class EntityVersionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (
          body !== null &&
          typeof body === 'object' &&
          'entityVersion' in body &&
          typeof (body as { entityVersion: unknown }).entityVersion === 'number'
        ) {
          reply.header(
            'etag',
            formatETag((body as { entityVersion: number }).entityVersion),
          );
        }
        return body;
      }),
    );
  }
}
