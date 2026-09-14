import type {
  LoginRequest,
  RegisterRequest,
  Session,
  User,
} from '@apion/contracts';
import { type Database, organisations, users } from '@apion/db';
import { uuidv7 } from '@apion/domain';
import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../infra/database.module.js';
import type { JwtPayload } from './auth.guard.js';

/**
 * argon2id at PRD 07's security bar. The cost is chosen for the 1 vCPU / 1 GB
 * host: 19 MiB and one lane keep a burst of sign-ins from crowding out the
 * request path, while staying above OWASP's minimum.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates the organisation and its first user together. PRD 00 deploys one
   * organisation per instance, so this runs once at setup; adding people
   * afterwards is an invitation, not a second registration.
   */
  async register(request: RegisterRequest): Promise<Session> {
    const passwordHash = await argon2.hash(request.password, HASH_OPTIONS);

    const user = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.slug, request.organisationSlug))
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(
          `The slug "${request.organisationSlug}" is taken. Choose another.`,
        );
      }

      const [organisation] = await tx
        .insert(organisations)
        .values({
          id: uuidv7(),
          slug: request.organisationSlug,
          name: request.organisationName,
        })
        .returning();

      const [created] = await tx
        .insert(users)
        .values({
          id: uuidv7(),
          organisationId: organisation.id,
          email: request.email.toLowerCase(),
          displayName: request.displayName,
          passwordHash,
        })
        .returning();

      return created;
    });

    return this.issueSession(user);
  }

  async login(request: LoginRequest): Promise<Session> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, request.email.toLowerCase()))
      .limit(1);

    // Verify against a decoy hash when the account is unknown, so a missing
    // account and a wrong password take the same time to answer.
    const hash = user?.passwordHash ?? (await this.decoyHash());
    const valid = await argon2
      .verify(hash, request.password)
      .catch(() => false);

    if (!user || !valid) {
      throw new UnauthorizedException('That email and password do not match.');
    }

    return this.issueSession(user);
  }

  async findById(
    id: string,
    organisationId: string,
  ): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organisationId, organisationId)))
      .limit(1);

    return user ? toUser(user) : undefined;
  }

  /**
   * A real argon2id digest of a random value, hashed once and reused. It has to
   * be genuine: a malformed digest makes `verify` throw immediately, which is
   * exactly the timing signal this is here to remove.
   */
  private decoyHashPromise: Promise<string> | undefined;

  private decoyHash(): Promise<string> {
    this.decoyHashPromise ??= argon2.hash(uuidv7(), HASH_OPTIONS);
    return this.decoyHashPromise;
  }

  private async issueSession(row: typeof users.$inferSelect): Promise<Session> {
    const ttlSeconds = this.config.get<number>('JWT_TTL_SECONDS', 43_200);
    const payload: JwtPayload = {
      sub: row.id,
      org: row.organisationId,
      email: row.email,
      name: row.displayName,
    };

    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: ttlSeconds }),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      user: toUser(row),
    };
  }
}

export function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    organisationId: row.organisationId,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}
