import {
  type LoginRequest,
  loginRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
  type Session,
  type User,
} from '@apion/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { type AuthenticatedUser, CurrentUser, Public } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
  ): Promise<Session> {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
  ): Promise<Session> {
    return this.auth.login(body);
  }

  /**
   * Lets the SPA confirm a stored token still works before it renders. Reads
   * the row rather than trusting the token's copy, so a renamed or removed
   * account is reflected without waiting for the token to expire.
   */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<User> {
    const found = await this.auth.findById(user.id, user.organisationId);
    if (!found)
      throw new UnauthorizedException('This account no longer exists.');
    return found;
  }
}
