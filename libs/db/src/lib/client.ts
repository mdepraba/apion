import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export interface DatabaseConfig {
  connectionString: string;
  /**
   * PRD 07 caps Postgres at 20 connections and the application pool at 8-10.
   * Exceeding this is not a tuning preference; it is how the 1 GB host runs out
   * of memory.
   */
  poolSize?: number;
  /** PRD 07: 15-second statement timeout, 30-second idle-in-transaction. */
  statementTimeoutMs?: number;
  idleTransactionTimeoutMs?: number;
  debug?: boolean;
}

export const DEFAULT_POOL_SIZE = 10;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
export const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS = 30_000;

export type Database = ReturnType<typeof createDatabase>['db'];
export type DatabaseSchema = typeof schema;

/**
 * A handle that reads and writes, whether or not it is inside a transaction.
 *
 * Drizzle types a transaction as `PgTransaction`, not as the database, so a
 * service method that takes `Database` cannot be handed a `tx`. Every method
 * that may participate in a caller's transaction takes this instead, which is
 * most of them, since an audit row has to commit with the change it describes.
 */
export type DatabaseExecutor =
  | Database
  | Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDatabase(config: DatabaseConfig) {
  const sql = postgres(config.connectionString, {
    max: config.poolSize ?? DEFAULT_POOL_SIZE,
    // The timeouts are set per connection so they apply to every query on it,
    // including ones issued by pg-boss.
    connection: {
      statement_timeout:
        config.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout:
        config.idleTransactionTimeoutMs ?? DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
    },
    // Reclaim idle connections rather than holding the full pool open; on this
    // host an idle backend still costs memory.
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    onnotice: config.debug ? undefined : () => undefined,
  });

  const db = drizzle(sql, {
    schema,
    casing: 'snake_case',
    logger: config.debug,
  });

  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

export { schema };
