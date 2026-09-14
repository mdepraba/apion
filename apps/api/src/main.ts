import 'reflect-metadata';
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

  // PRD 05 FR-6.1 fixes the mock at `/mock/<org>/<project>/<env>/<path...>`, so
  // it binds to the Fastify instance directly rather than under `/api/v1`.
  await app.init();
  app.get(MockController).register(app.getHttpAdapter().getInstance());

  await app.listen({ port: config.PORT, host: config.HOST });
  Logger.log(
    `Apion API listening on http://${config.HOST}:${config.PORT}`,
    'Bootstrap',
  );
}

void bootstrap();
