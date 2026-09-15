import { z } from 'zod';

/**
 * UUIDv7 is the workspace-wide identifier (PRD 07, "Data and jobs"). Zod has no
 * version-7 check, so this validates the shape and leaves ordering guarantees to
 * the generator in @apion/domain.
 */
export const uuidSchema = z.uuid();

/**
 * A slug appears in the mock URL (`/mock/<org>/<project>/<env>/...`), so it is
 * restricted to characters that survive a path segment unescaped (PRD 01 FR-1.3).
 */
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, digits and single hyphens.',
  );

export const emailSchema = z.email().max(320);

export const isoTimestampSchema = z.iso.datetime({ offset: true });

/** Entity version for the optimistic-concurrency `If-Match` header (PRD 01). */
export const entityVersionSchema = z.number().int().nonnegative();

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
