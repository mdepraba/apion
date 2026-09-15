import { createDatabase, type Database } from '@apion/db';
import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DATABASE = Symbol('DATABASE');
const CONNECTION = Symbol('DATABASE_CONNECTION');

interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

/**
 * One pool for the whole process. PRD 07 runs a single Bun process with no
 * separate worker, so nothing else draws on the same connection budget.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DatabaseHandle => {
        const { db, close } = createDatabase({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          poolSize: config.get<number>('DATABASE_POOL_SIZE'),
          debug: config.get<string>('NODE_ENV') === 'development',
        });
        return { db, close };
      },
    },
    {
      provide: DATABASE,
      inject: [CONNECTION],
      useFactory: (handle: DatabaseHandle) => handle.db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(CONNECTION) private readonly handle: DatabaseHandle) {}

  /**
   * Drains the pool once Nest has stopped accepting requests, so an in-flight
   * query can finish inside the 5-10 second deploy restart PRD 07 budgets for.
   * Requires `enableShutdownHooks()`; see main.ts.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

export type { DatabaseHandle };
