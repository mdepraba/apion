import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EntityVersionInterceptor } from './common/entity-version.js';
import { loadConfiguration } from './config/configuration.js';
import { DatabaseModule } from './infra/database.module.js';
import { HealthController } from './infra/health.controller.js';
import { JobsService } from './infra/jobs.service.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ProjectAccessGuard } from './modules/auth/project-access.guard.js';
import { ContractController } from './modules/contract/contract.controller.js';
import { EndpointsService } from './modules/contract/endpoints.service.js';
import { ResourcesService } from './modules/contract/resources.service.js';
import { SchemasService } from './modules/contract/schemas.service.js';
import { PortabilityController } from './modules/portability/portability.controller.js';
import { PortabilityService } from './modules/portability/portability.service.js';
import { ProjectsController } from './modules/projects/projects.controller.js';
import { ProjectsService } from './modules/projects/projects.service.js';
import { SearchController } from './modules/search/search.controller.js';
import { SearchService } from './modules/search/search.service.js';
import { LogPruneRegistrar } from './modules/mock/log-prune.registrar.js';
import { MockAdminController } from './modules/mock/mock-admin.controller.js';
import { MockConfigService } from './modules/mock/mock-config.service.js';
import { MockLogService } from './modules/mock/mock-log.service.js';
import { MockRuntimeService } from './modules/mock/mock-runtime.service.js';
import { MockController } from './modules/mock/mock.controller.js';
import { LintService } from './modules/standard/lint.service.js';
import { LintSweepRegistrar } from './modules/standard/lint-sweep.registrar.js';
import {
  EndpointLintController,
  StandardController,
} from './modules/standard/standard.controller.js';
import { StandardsService } from './modules/standard/standards.service.js';
import { StatusController } from './modules/status/status.controller.js';
import { StatusService } from './modules/status/status.service.js';

/**
 * A modular monolith, as PRD 07 requires: one process, no separate worker,
 * mock service or collaboration service. Feature modules stay separable so the
 * extractable-library path survives, but nothing is deployed on its own.
 *
 * The two guards are global. `AuthGuard` opens only routes marked `@Public()`;
 * `ProjectAccessGuard` refuses any `:slug` route that does not declare the
 * permission it needs, so a new controller cannot ship unguarded by omission.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [() => loadConfiguration()],
    }),
    DatabaseModule,
    AuthModule,
  ],
  controllers: [
    HealthController,
    ProjectsController,
    ContractController,
    StatusController,
    PortabilityController,
    SearchController,
    StandardController,
    EndpointLintController,
    MockAdminController,
  ],
  providers: [
    AuditService,
    ProjectsService,
    EndpointsService,
    SchemasService,
    ResourcesService,
    StatusService,
    PortabilityService,
    SearchService,
    JobsService,
    StandardsService,
    LintService,
    LintSweepRegistrar,
    MockConfigService,
    MockLogService,
    MockRuntimeService,
    MockController,
    LogPruneRegistrar,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ProjectAccessGuard },
    { provide: APP_INTERCEPTOR, useClass: EntityVersionInterceptor },
  ],
})
export class AppModule {}
