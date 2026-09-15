import { z } from 'zod';

/**
 * The control plane's own error envelope. This is deliberately separate from a
 * project's configurable response standard (PRD 03): projects choose how *their*
 * APIs answer, but `/api/v1/*` always answers this way.
 */
export const apiErrorCodes = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'PRECONDITION_REQUIRED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export const apiErrorCodeSchema = z.enum(apiErrorCodes);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** A single field-level problem, located by JSON pointer (RFC 6901). */
export const apiErrorDetailSchema = z.object({
  pointer: z.string(),
  message: z.string(),
});
export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.array(apiErrorDetailSchema).optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * A stale write returns the current server state alongside the rejection so the
 * client can render a resolution UI without a second round trip
 * (PRD 01, "Contract version governance"; PRD 06 FR-5.3).
 */
export const versionConflictSchema = z.object({
  error: z.object({
    code: z.literal('VERSION_CONFLICT'),
    message: z.string(),
    requestId: z.string().optional(),
    expectedVersion: z.number().int().nonnegative(),
    actualVersion: z.number().int().nonnegative(),
    current: z.unknown(),
  }),
});
export type VersionConflict = z.infer<typeof versionConflictSchema>;
