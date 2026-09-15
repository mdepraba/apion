/**
 * Applies pending migrations and exits. The deploy runs this as a one-shot
 * container before the API starts, so a migration that fails fails the deploy
 * rather than leaving the server to crash-loop against a schema it cannot use.
 *
 *   bunx nx run @apion/api:migrate
 */
import { createDatabase } from '@apion/db';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

/** Relative to the working directory; the image copies migrations alongside it. */
const MIGRATIONS_FOLDER = process.env['MIGRATIONS_FOLDER'] ?? './migrations';

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to apply migrations.');
  }

  // One connection, and no statement timeout: the 15-second cap that protects
  // the API's own queries would abort an index build on a table of any size.
  const { db, close } = createDatabase({
    connectionString,
    poolSize: 1,
    statementTimeoutMs: 0,
    idleTransactionTimeoutMs: 0,
  });

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log(`Migrations applied from ${MIGRATIONS_FOLDER}.`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
