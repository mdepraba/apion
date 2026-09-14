import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './libs/db/src/lib/schema/index.ts',
  out: './libs/db/migrations',
  casing: 'snake_case',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ??
      'postgres://apion:apion@localhost:5432/apion',
  },
});
