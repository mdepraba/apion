import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ProjectAccessService } from './project-access.service.js';

/**
 * Global because every feature module's routes are guarded by `AuthGuard` and
 * `ProjectAccessGuard`, which are registered application-wide in `AppModule`.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<number>('JWT_TTL_SECONDS', 43_200),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, ProjectAccessService],
  exports: [AuthService, ProjectAccessService, JwtModule],
})
export class AuthModule {}
