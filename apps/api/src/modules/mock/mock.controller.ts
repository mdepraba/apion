import type { HttpMethod } from '@apion/contracts';
import { httpMethods } from '@apion/contracts';
import { exportOpenApi } from '@apion/spec-openapi';
import { truncateIp } from '@apion/mock-engine';
import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MockConfigService } from './mock-config.service.js';
import { MockLogService } from './mock-log.service.js';
import { MockRuntimeService } from './mock-runtime.service.js';

/**
 * PRD 05 FR-6.1: "The main process mounts one mock engine at
 * `/mock/<org-slug>/<project-slug>/<env>/<path...>`."
 *
 * This is not part of `/api/v1`, and it does not answer in the control plane's
 * error envelope: every response here, success or failure, wears the project's
 * own response standard, because a client integrating against the mock is
 * integrating against the contract.
 *
 * The routes are registered straight onto Fastify rather than through Nest's
 * router: the mock needs a trailing wildcard at the URL root, and Nest's global
 * prefix and its wildcard syntax both get in the way of exactly that.
 */
@Injectable()
export class MockController {
  constructor(
    private readonly runtime: MockRuntimeService,
    private readonly config: MockConfigService,
    private readonly logs: MockLogService,
  ) {}

  /**
   * Binds both surfaces. Called once, from `main.ts`, before `listen`.
   *
   * The instance is typed structurally because Nest's Fastify adapter and the
   * workspace's own Fastify resolve to different copies of the package, and
   * only `all` is used here.
   */
  register(fastify: {
    all: (path: string, handler: never, ...rest: never[]) => unknown;
  }): void {
    // `/__mock` is declared first so the management surface is never shadowed
    // by a contract route, and both sit outside the `/api/v1` prefix.
    const control: RouteHandler = async (request, reply) => {
      const { org, project, env } = request.params as Record<string, string>;
      await this.control(org, project, env, request, reply);
    };

    const serve: RouteHandler = async (request, reply) => {
      const { org, project, env } = request.params as Record<string, string>;
      await this.serve(org, project, env, request, reply);
    };

    fastify.all('/__mock/:org/:project/:env/*', control as never);
    fastify.all('/mock/:org/:project/:env/*', serve as never);
  }

  /** The reserved management surface. */
  async control(
    org: string,
    project: string,
    env: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const path = wildcardOf(request);

    const target = await this.runtime.resolveTarget(org, project, env);
    if (!target) {
      await reply.status(404).send({
        error: { code: 'MOCK_ROUTE_NOT_FOUND', message: 'No such mock.' },
      });
      return;
    }

    const auth = await this.authorise(target.projectId, request);
    if (!auth.allowed) {
      await reply
        .status(auth.status)
        .send({ error: { code: auth.code, message: auth.message } });
      return;
    }

    switch (path.replace(/^\/+/, '')) {
      case 'health':
        await reply.send({
          status: 'ok',
          project: target.projectSlug,
          environment: target.environmentKey,
          version: target.versionLabel,
          mutable: target.mutable,
        });
        return;

      case 'routes': {
        const endpoints = await this.runtime.routes(target);
        await reply.send(
          endpoints.map((endpoint) => ({
            method: endpoint.method,
            path: endpoint.path,
            endpointId: endpoint.id,
            summary: endpoint.summary,
            statusCodes: endpoint.responses.map(
              (response) => response.statusCode,
            ),
          })),
        );
        return;
      }

      case 'openapi.json': {
        const endpoints = await this.runtime.routes(target);
        await reply.send(
          exportOpenApi({
            title: `${target.projectSlug} (mock)`,
            version: target.versionLabel,
            description:
              'Served by an Apion mock. This describes an agreed contract, not a deployed service.',
            endpoints,
            schemas: [],
            resources: [],
          }),
        );
        return;
      }

      default:
        await reply.status(404).send({
          error: {
            code: 'MOCK_ROUTE_NOT_FOUND',
            message:
              'The mock control plane serves /health, /routes and /openapi.json.',
          },
        });
    }
  }

  /**
   * Every contract route. Reserved prefixes cannot reach here because the
   * contract editor refuses to save a path under `/api`, `/mock` or `/__mock`.
   */
  async serve(
    org: string,
    project: string,
    env: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const startedAt = Date.now();
    const path = wildcardOf(request);

    const target = await this.runtime.resolveTarget(org, project, env);
    if (!target) {
      await reply.status(404).send({
        error: {
          code: 'MOCK_ROUTE_NOT_FOUND',
          message: `No mock is published at /mock/${org}/${project}/${env}.`,
        },
      });
      return;
    }

    const auth = await this.authorise(target.projectId, request);
    if (!auth.allowed) {
      await reply
        .status(auth.status)
        .send({ error: { code: auth.code, message: auth.message } });
      return;
    }

    // PRD 05 rate-limits mock traffic separately from the control plane.
    const limit = this.runtime.checkRateLimit(
      `${target.projectId}:${auth.identity}`,
      auth.mode,
    );

    if (!limit.allowed) {
      await reply
        .status(429)
        .header('retry-after', String(limit.retryAfterSeconds))
        .send({
          error: {
            code: 'MOCK_RATE_LIMITED',
            message: `This mock accepts a limited number of requests per minute. Try again in ${limit.retryAfterSeconds}s.`,
          },
        });
      return;
    }

    const method = normaliseMethod(request.method);
    if (!method) {
      await reply.status(405).send({
        error: {
          code: 'MOCK_METHOD_NOT_ALLOWED',
          message: `${request.method} is not a contract method.`,
        },
      });
      return;
    }

    const contractPath = `/${path.replace(/^\/+/, '')}`;

    const result = await this.runtime.serve(
      target,
      {
        method,
        path: contractPath,
        query: request.query as Record<string, string | string[]>,
        headers: request.headers as Record<
          string,
          string | string[] | undefined
        >,
        body: request.body,
        requestId: request.id,
        environmentKey: target.environmentKey,
      },
      {
        scenarioName: headerOf(request, 'x-mock-scenario'),
      },
    );

    this.logs.record({
      projectId: target.projectId,
      environmentKey: target.environmentKey,
      method: method.toUpperCase(),
      path: contractPath,
      endpointId: result.diagnostics.endpointId,
      statusCode: result.statusCode,
      source: result.diagnostics.source,
      latencyMs: Date.now() - startedAt,
      validation: result.diagnostics.validation,
      cache: result.diagnostics.cache,
      requestId: request.id,
      callerIp: truncateIp(request.ip),
      requestBody: request.body,
    });

    for (const [name, value] of Object.entries(result.headers)) {
      void reply.header(name, value);
    }

    void reply.header('x-mock-request-id', request.id);
    void reply.header('x-mock-environment', target.environmentKey);

    // FR-6.6: past the held-request cap a delay is skipped, and the caller is
    // told rather than quietly given a fast response it did not ask for.
    if (!result.held) {
      void reply.header(
        'x-mock-warning',
        'Delay skipped: too many requests are already being held.',
      );
    }

    await reply
      .status(result.statusCode)
      .send(result.body === null ? undefined : result.body);
  }

  /**
   * FR-6.1's three modes. `private` is the default and wants a project token;
   * `public-link` trades the token for a tighter rate limit; `simulated-auth`
   * checks the contract's own declared auth and answers the contract's 401.
   */
  private async authorise(
    projectId: string,
    request: FastifyRequest,
  ): Promise<
    | {
        allowed: true;
        mode: 'private' | 'public';
        identity: string;
      }
    | {
        allowed: false;
        status: number;
        code: string;
        message: string;
      }
  > {
    const config = await this.config.config(projectId);
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (config.authMode === 'public-link') {
      return { allowed: true, mode: 'public', identity: 'public' };
    }

    if (config.authMode === 'simulated-auth') {
      // The contract's own auth requirement decides; any bearer token passes,
      // because the point is to exercise a client's auth path, not to guard.
      return bearer
        ? { allowed: true, mode: 'private', identity: bearer.slice(-8) }
        : {
            allowed: false,
            status: 401,
            code: 'UNAUTHORIZED',
            message:
              'This mock simulates authentication. Send any Bearer token to continue.',
          };
    }

    if (!bearer) {
      return {
        allowed: false,
        status: 401,
        code: 'UNAUTHORIZED',
        message:
          'This mock is private. Send the project mock token as a Bearer token.',
      };
    }

    const valid = await this.config.verifyToken(projectId, bearer);

    return valid
      ? { allowed: true, mode: 'private', identity: bearer.slice(-8) }
      : {
          allowed: false,
          status: 401,
          code: 'UNAUTHORIZED',
          message: 'That mock token is not valid. It may have been rotated.',
        };
  }
}

function normaliseMethod(method: string): HttpMethod | null {
  const lower = method.toLowerCase();
  return (httpMethods as readonly string[]).includes(lower)
    ? (lower as HttpMethod)
    : null;
}

/**
 * The remainder of the path after `/mock/<org>/<project>/<env>/`. Fastify's
 * router only accepts a bare `*` as the final segment, and stores what it
 * captured under that name.
 */
type RouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

function wildcardOf(request: FastifyRequest): string {
  const params = request.params as Record<string, string | undefined>;
  return params['*'] ?? '';
}

function headerOf(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
