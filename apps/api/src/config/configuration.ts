import { z } from 'zod';

/**
 * Environment is parsed once at startup and the process exits on a bad value.
 * A misconfigured secret or pool size on a 1 GB host is worth failing loudly for.
 */
const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),

    DATABASE_URL: z.string().min(1),
    // PRD 07 budgets the application pool at 8-10 against Postgres's 20.
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(10),

    JWT_SECRET: z.string().min(16),
    JWT_TTL_SECONDS: z.coerce.number().int().min(60).default(43_200),

    /** Absolute path to the built SPA. Empty in development, where Vite serves it. */
    WEB_DIST_PATH: z.string().default(''),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_SECRET.includes('change-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'Set a real JWT_SECRET before running in production.',
      });
    }
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfiguration(
  source: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration is not usable:\n${problems}`);
  }

  return result.data;
}

export const CONFIG = 'APP_CONFIG';
