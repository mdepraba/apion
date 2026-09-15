import 'reflect-metadata';
import type { FastifyReply } from 'fastify';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { loadConfiguration } from './config/configuration.js';
import { MockController } from './modules/mock/mock.controller.js';

/**
 * Paths this server answers itself. A request under one of these that matches
 * no route is a real 404 and has to leave through ApiExceptionFilter in the
 * control plane's envelope, rather than being handed the SPA's index.html.
 */
const SERVER_PATHS = ['/api/v1', '/mock/', '/__mock', '/health', '/metrics'];

/**
 * @fastify/static decorates the reply with `sendFile`. Its `declare module
 * 'fastify'` augmentation resolves against its own copy of the fastify types
 * rather than the one this file sees, so the decorator is declared here.
 */
interface StaticReply extends FastifyReply {
  sendFile(filename: string): FastifyReply;
}

async function bootstrap(): Promise<void> {
  const config = loadConfiguration();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // PRD 07 caps a single request's allocation; a 1 GB host cannot absorb an
      // unbounded upload while also serving the control plane.
      bodyLimit: 32 * 1024 * 1024,
      trustProxy: true,
      genReqId: () => crypto.randomUUID(),
      logger: { level: config.LOG_LEVEL },
    }),
    { bufferLogs: true },
  );

  app.setGlobalPrefix('api/v1', {
    // Everything outside the control plane: the SPA, /mock, /__mock, /metrics
    //: is served without the prefix.
    // PRD 05 FR-6.1 fixes the mock at `/mock/<org>/<project>/<env>/...`, so a
    // client calls the URL the contract advertises rather than one nested
    // under the control plane's prefix.
    exclude: ['metrics', 'health'],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  // `wildcard: false` globs the build once at startup and gives each hashed
  // asset its own route, which leaves `/*` free for the client-route fallback
  // below. Empty in development, where Vite serves the SPA instead.
  if (config.WEB_DIST_PATH) {
    app.useStaticAssets({ root: config.WEB_DIST_PATH, wildcard: false });
  }

  // PRD 05 FR-6.1 fixes the mock at `/mock/<org>/<project>/<env>/<path...>`, so
  // it binds to the Fastify instance directly rather than under `/api/v1`.
  await app.init();
  app.get(MockController).register(app.getHttpAdapter().getInstance());

  if (config.WEB_DIST_PATH) {
    registerSpaFallback(app);
  }

  await app.listen({ port: config.PORT, host: config.HOST });
  Logger.log(
    `Apion API listening on http://${config.HOST}:${config.PORT}`,
    'Bootstrap',
  );
}

/**
 * PRD 07 puts the SPA in the same process as the API. A deep link like
 * `/projects/acme/contract` is a client route with no file behind it, so it is
 * answered with index.html and the router resolves it in the browser.
 *
 * `callNotFound()` hands a genuine miss back to the handler Nest registered,
 * which throws NotFoundException into the filter chain. Replacing the
 * not-found handler outright would take the control plane's 404 envelope with
 * it.
 */
function registerSpaFallback(app: NestFastifyApplication): void {
  const instance = app.getHttpAdapter().getInstance();

  instance.get('/*', (request, reply) => {
    const isServerPath = SERVER_PATHS.some((path) =>
      request.url.startsWith(path),
    );

    return isServerPath
      ? reply.callNotFound()
      : (reply as StaticReply).sendFile('index.html');
  });
}

void bootstrap();
