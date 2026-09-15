import type { ApiErrorCode } from '@apion/contracts';
import { MissingPreconditionError, StaleWriteError } from '@apion/domain';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * Every `/api/v1/*` failure leaves through here in the control plane's own
 * envelope (see `apiErrorSchema`). Project response standards (PRD 03) govern
 * how a *project's* API answers and have no bearing on this one.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const requestId = request.id;

    if (exception instanceof StaleWriteError) {
      // PRD 01: a stale write gets the current state and a resolution path, not
      // a bare rejection.
      reply.status(HttpStatus.CONFLICT).send({
        error: {
          code: 'VERSION_CONFLICT',
          message: exception.message,
          requestId,
          expectedVersion: exception.expectedVersion,
          actualVersion: exception.actualVersion,
          current: exception.current,
        },
      });
      return;
    }

    if (exception instanceof MissingPreconditionError) {
      reply.status(HttpStatus.PRECONDITION_REQUIRED).send({
        error: {
          code: 'PRECONDITION_REQUIRED',
          message: exception.message,
          requestId,
        },
      });
      return;
    }

    if (exception instanceof ZodError) {
      reply.status(HttpStatus.UNPROCESSABLE_ENTITY).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields need attention.',
          requestId,
          details: exception.issues.map((issue) => ({
            pointer: `#/${issue.path.join('/')}`,
            message: issue.message,
          })),
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const { message, code } = describeHttpException(response, status);

      reply.status(status).send({ error: { code, message, requestId } });
      return;
    }

    // Anything unrecognised is a defect. Log it with the request id and tell the
    // caller nothing about the internals.
    this.logger.error(
      `Unhandled error on ${request.method} ${request.url} (request ${requestId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. The request id is below.',
        requestId,
      },
    });
  }
}

const STATUS_CODES: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PRECONDITION_REQUIRED]: 'PRECONDITION_REQUIRED',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_FAILED',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

function describeHttpException(
  response: string | object,
  status: number,
): { message: string; code: ApiErrorCode } {
  const fallbackCode = STATUS_CODES[status] ?? 'INTERNAL_ERROR';

  if (typeof response === 'string') {
    return { message: response, code: fallbackCode };
  }

  const body = response as Record<string, unknown>;
  const message = Array.isArray(body['message'])
    ? body['message'].join(' ')
    : typeof body['message'] === 'string'
      ? body['message']
      : 'Request failed.';
  const code =
    typeof body['code'] === 'string'
      ? (body['code'] as ApiErrorCode)
      : fallbackCode;

  return { message, code };
}
