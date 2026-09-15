import { z } from 'zod';
import {
  entityVersionSchema,
  isoTimestampSchema,
  uuidSchema,
} from './primitives.js';

/**
 * The wire contract for PRD 03. The rule engine lives in `@apion/response-standard`;
 * these are the shapes the API accepts and returns. `contracts` imports no other
 * library (PRD 07), so the two declare the same vocabulary independently and the
 * API is what checks them against each other.
 */

export const namingConventions = [
  'camelCase',
  'snake_case',
  'kebab-case',
  'PascalCase',
] as const;
export const namingConventionSchema = z.enum(namingConventions);
export type NamingConventionValue = z.infer<typeof namingConventionSchema>;

export const ruleIds = [
  'RS001',
  'RS002',
  'RS003',
  'RS004',
  'RS005',
  'RS006',
  'RS007',
  'RS008',
  'RS009',
  'RS010',
] as const;
export const ruleIdSchema = z.enum(ruleIds);
export type RuleIdValue = z.infer<typeof ruleIdSchema>;

export const ruleSeverities = ['error', 'warn', 'off'] as const;
export const ruleSeveritySchema = z.enum(ruleSeverities);
export type RuleSeverityValue = z.infer<typeof ruleSeveritySchema>;

export const paginationStyles = ['cursor', 'offset', 'page', 'none'] as const;
export const paginationStyleSchema = z.enum(paginationStyles);

export const dateFormats = ['rfc3339', 'iso8601-date', 'unix-seconds'] as const;
export const dateFormatSchema = z.enum(dateFormats);

export const standardPresets = [
  'simple',
  'jsonapi',
  'problem-details',
  'google',
  'none',
] as const;
export const standardPresetSchema = z.enum(standardPresets);
export type StandardPreset = z.infer<typeof standardPresetSchema>;

/** An error code a project's APIs may return. Screaming snake, like an enum. */
export const errorCodeSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use SCREAMING_SNAKE_CASE.');

/**
 * A slot token inside an envelope: `$data`, `$status_code`, `$meta` and any
 * other name a project chooses. The names are the project's own; only the
 * shape is fixed.
 */
export const slotTokenSchema = z
  .string()
  .regex(/^\$[A-Za-z_][A-Za-z0-9_]*$/, 'A slot looks like $name.');

/** The slot an author's payload schema describes. */
export const DATA_SLOT = '$data';

/** The declarative model from FR-4.1, as authored. */
export const standardDefinitionSchema = z.object({
  /**
   * One envelope for every response, success and failure alike. Its `$slots`
   * are what an endpoint author fills in per response.
   */
  envelope: z.unknown(),
  errorCodes: z.array(errorCodeSchema).max(200),
  propertyNaming: namingConventionSchema,
  pathNaming: namingConventionSchema,
  allowedStatusesByMethod: z.record(
    z.string(),
    z.array(z.number().int().min(100).max(599)),
  ),
  requiredResponseHeaders: z.array(z.string().min(1).max(80)).max(20),
  pagination: z.object({
    style: paginationStyleSchema,
    maxLimit: z.number().int().min(1).max(1000),
  }),
  dateFormat: dateFormatSchema,
  timeZone: z.string().min(1).max(60),
  /**
   * Whether RS001 to RS010 run at all.
   *
   * Separate from the per-rule severities so a project can stop being linted
   * without losing how it had each rule tuned, and pick the whole set back up
   * later exactly as it left it. Defaulted true because a standard that was
   * written before this switch existed was being enforced.
   */
  rulesEnabled: z.boolean().default(true),
  severities: z.record(ruleIdSchema, ruleSeveritySchema),
});
export type StandardDefinition = z.infer<typeof standardDefinitionSchema>;

export const responseStandardSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  /** Bumped on publish; endpoints cache the version they were linted against. */
  version: z.number().int().positive(),
  state: z.enum(['draft', 'active']),
  preset: standardPresetSchema,
  definition: standardDefinitionSchema,
  publishedAt: isoTimestampSchema.nullable(),
  publishedBy: uuidSchema.nullable(),
  entityVersion: entityVersionSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type ResponseStandardRecord = z.infer<typeof responseStandardSchema>;

export const updateStandardRequestSchema = z.object({
  definition: standardDefinitionSchema.partial(),
});
export type UpdateStandardRequest = z.infer<typeof updateStandardRequestSchema>;

export const applyPresetRequestSchema = z.object({
  preset: standardPresetSchema,
});
export type ApplyPresetRequest = z.infer<typeof applyPresetRequestSchema>;

export const violationSchema = z.object({
  ruleId: ruleIdSchema,
  severity: z.enum(['error', 'warn']),
  pointer: z.string(),
  message: z.string(),
  /** Present when a Maintainer has waived this rule for this endpoint. */
  exemption: z
    .object({
      id: uuidSchema,
      justification: z.string(),
      grantedBy: uuidSchema.nullable(),
      grantedAt: isoTimestampSchema,
    })
    .optional(),
});
export type ViolationRecord = z.infer<typeof violationSchema>;

export const lintResultSchema = z.object({
  endpointId: uuidSchema,
  standardVersion: z.number().int().nonnegative(),
  violations: z.array(violationSchema),
  /** FR-4.5: true when an unexempted error blocks approval and publication. */
  blocked: z.boolean(),
  /**
   * False when the project has its rules switched off. Without this, no
   * violations reads as a clean endpoint, which is a different claim from one
   * nobody checked.
   */
  rulesEnabled: z.boolean().default(true),
  checkedAt: isoTimestampSchema,
});
export type LintResult = z.infer<typeof lintResultSchema>;

/** FR-4.6. The justification is mandatory, which is why it has a floor. */
export const createExemptionRequestSchema = z.object({
  endpointId: uuidSchema,
  ruleId: ruleIdSchema,
  justification: z
    .string()
    .min(10, 'Say why this endpoint may break the rule.')
    .max(1000),
});
export type CreateExemptionRequest = z.infer<
  typeof createExemptionRequestSchema
>;

export const exemptionSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  endpointId: uuidSchema,
  ruleId: ruleIdSchema,
  justification: z.string(),
  grantedBy: uuidSchema.nullable(),
  grantedByName: z.string().nullable(),
  grantedAt: isoTimestampSchema,
  /** So health can show what the waiver actually covers. */
  endpointLabel: z.string().optional(),
});
export type ExemptionRecord = z.infer<typeof exemptionSchema>;

/**
 * The health panel's coverage report: "412 of 500 checked against v3".
 * Coverage is the honest number, not a claim that the project is clean.
 */
export const standardHealthSchema = z.object({
  standardVersion: z.number().int().nonnegative(),
  totalEndpoints: z.number().int().nonnegative(),
  checkedEndpoints: z.number().int().nonnegative(),
  endpointsWithErrors: z.number().int().nonnegative(),
  endpointsWithWarnings: z.number().int().nonnegative(),
  exemptionCount: z.number().int().nonnegative(),
  violationsByRule: z.record(ruleIdSchema, z.number().int().nonnegative()),
  /** Set while a `check all` sweep is running. */
  sweep: z
    .object({
      jobId: uuidSchema,
      state: z.string(),
      checked: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type StandardHealth = z.infer<typeof standardHealthSchema>;

/**
 * One slot the active envelope declares. The endpoint editor renders a field
 * per slot so an author fills every one when writing an example.
 */
export const envelopeSlotSchema = z.object({
  token: slotTokenSchema,
  /** The key the slot sits under in the envelope. */
  key: z.string(),
  /** JSON pointer to the slot inside the envelope. */
  pointer: z.string(),
  /** True for the slot the response's payload schema describes. */
  isData: z.boolean(),
});
export type EnvelopeSlot = z.infer<typeof envelopeSlotSchema>;

export const envelopeSlotsResponseSchema = z.object({
  standardVersion: z.number().int().nonnegative(),
  envelope: z.unknown(),
  slots: z.array(envelopeSlotSchema),
});
export type EnvelopeSlotsResponse = z.infer<typeof envelopeSlotsResponseSchema>;

/** The read-only wire-shape preview an author sees beside their payload. */
export const previewRequestSchema = z.object({
  statusCode: z.union([
    z.number().int().min(100).max(599),
    z.literal('default'),
  ]),
  payloadSchema: z.unknown().nullable(),
  /** Slot values, keyed by token. A bare value is read as the data slot. */
  example: z.unknown().optional(),
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const previewResponseSchema = z.object({
  schema: z.unknown().nullable(),
  example: z.unknown().nullable(),
  /** Slots the example has not filled yet, so the editor can prompt for them. */
  missingSlots: z.array(z.string()).default([]),
});
export type PreviewResponse = z.infer<typeof previewResponseSchema>;
