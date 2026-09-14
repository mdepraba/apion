import { z } from 'zod';
import { changeKindSchema, implementationStatusSchema } from './enums.js';
import { isoTimestampSchema, uuidSchema } from './primitives.js';

/** PRD 04 FR-3.2: status is per endpoint *and* environment, never global. */
export const endpointStatusSchema = z.object({
  endpointId: uuidSchema,
  environmentId: uuidSchema,
  status: implementationStatusSchema,
  note: z.string().max(1000).nullable(),
  changedBy: uuidSchema.nullable(),
  /** `ci` when the write came through the deployment API (FR-3.4). */
  changedVia: z.enum(['ui', 'ci']),
  changedAt: isoTimestampSchema,
});
export type EndpointStatus = z.infer<typeof endpointStatusSchema>;

/**
 * FR-3.3/FR-3.4: history is append-only. When a human and CI write within the
 * same second the later write wins the current state, but both events remain.
 */
export const endpointStatusEventSchema = endpointStatusSchema.extend({
  id: uuidSchema,
  actorName: z.string().nullable(),
});
export type EndpointStatusEvent = z.infer<typeof endpointStatusEventSchema>;

export const updateStatusRequestSchema = z.object({
  environment: z.string().min(1).max(64),
  status: implementationStatusSchema,
  note: z.string().max(1000).optional(),
});
export type UpdateStatusRequest = z.infer<typeof updateStatusRequestSchema>;

/** FR-3.6: `Orders: 12/19 implemented`, always with its denominator. */
export const statusRollupSchema = z.object({
  scope: z.enum(['project', 'resource']),
  scopeId: uuidSchema,
  label: z.string(),
  environmentId: uuidSchema,
  total: z.number().int().nonnegative(),
  // Only the statuses actually present appear; a status with no endpoints is
  // absent rather than zero, so the UI can distinguish "none" from "not counted".
  byStatus: z.partialRecord(
    implementationStatusSchema,
    z.number().int().nonnegative(),
  ),
  implemented: z.number().int().nonnegative(),
  /** FR-3.5: `in_progress` for longer than the project's threshold. */
  stale: z.number().int().nonnegative(),
});
export type StatusRollup = z.infer<typeof statusRollupSchema>;

/** PRD 02 FR-2.6. */
export const diffEntrySchema = z.object({
  kind: changeKindSchema,
  /** A stable reason code so the UI can group and explain changes. */
  reason: z.enum([
    'endpoint_added',
    'endpoint_removed',
    'path_changed',
    'method_changed',
    'field_removed',
    'field_added',
    'type_narrowed',
    'required_request_field_added',
    'required_request_field_removed',
    'status_code_removed',
    'status_code_added',
    'schema_renamed',
    'deprecated',
  ]),
  endpointId: uuidSchema.nullable(),
  label: z.string(),
  pointer: z.string().nullable(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type DiffEntry = z.infer<typeof diffEntrySchema>;

export const contractDiffSchema = z.object({
  fromVersionId: uuidSchema,
  toVersionId: uuidSchema,
  entries: z.array(diffEntrySchema),
  summary: z.object({
    breaking: z.number().int().nonnegative(),
    nonBreaking: z.number().int().nonnegative(),
    additive: z.number().int().nonnegative(),
  }),
});
export type ContractDiff = z.infer<typeof contractDiffSchema>;
