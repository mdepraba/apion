/**
 * Development seed runner. Hashing lives here rather than in @apion/db, which
 * has no business knowing how passwords are stored.
 *
 *   pnpm nx run @apion/api:seed
 */
import { createDatabase, seed } from '@apion/db';
import * as argon2 from 'argon2';
import { loadConfiguration } from '../config/configuration.js';

const SEED_PASSWORD = 'apion-dev-password';

async function main(): Promise<void> {
  const config = loadConfiguration();

  if (config.NODE_ENV === 'production') {
    throw new Error(
      'The seed is development-only and refuses to run in production.',
    );
  }

  const { db, close } = createDatabase({
    connectionString: config.DATABASE_URL,
  });

  try {
    await seed(db, {
      passwordHash: await argon2.hash(SEED_PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      }),
    });

    console.log('Seeded Northwind with two projects.');
    console.log(
      `Sign in as ada@northwind.test with the password ${SEED_PASSWORD}`,
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
