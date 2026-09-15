import { z } from 'zod';
import {
  entityVersionSchema,
  isoTimestampSchema,
  slugSchema,
  uuidSchema,
} from './primitives.js';

/** The wire contract for PRD 05. The engine lives in `@apion/mock-engine`. */

export const mockAuthModes = [
  'private',
  'public-link',
  'simulated-auth',
] as const;
export const mockAuthModeSchema = z.enum(mockAuthModes);
export type MockAuthMode = z.infer<typeof mockAuthModeSchema>;

export const mockLocales = ['en', 'id_ID'] as const;
export const mockLocaleSchema = z.enum(mockLocales);
export type MockLocale = z.infer<typeof mockLocaleSchema>;

/**
 * FR-6.4. Every project starts with these five, so a demo can be coordinated
 * by name on day one without anyone authoring a scenario first.
 */
export const DEFAULT_SCENARIO_NAMES = [
  'happyPath',
  'emptyStates',
  'serverErrors',
  'slowNetwork',
  'unauthenticated',
] as const;

export const scenarioRuleSchema = z.object({
  /** Applies to one endpoint, or to every endpoint when null. */
  endpointId: uuidSchema.nullable(),
  /** Force this status, when the endpoint declares it. */
  statusCode: z.number().int().min(100).max(599).nullable(),
  /** Prefer this named example. */
  exampleName: z.string().max(80).nullable(),
  delayMs: z.number().int().min(0).max(5000).nullable(),
});
export type ScenarioRule = z.infer<typeof scenarioRuleSchema>;

export const mockScenarioSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  rules: z.array(scenarioRuleSchema).max(200),
  isDefault: z.boolean(),
  entityVersion: entityVersionSchema,
});
export type MockScenario = z.infer<typeof mockScenarioSchema>;

export const upsertScenarioRequestSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  rules: z.array(scenarioRuleSchema).max(200),
});
export type UpsertScenarioRequest = z.infer<typeof upsertScenarioRequestSchema>;

export const mockConfigSchema = z.object({
  projectId: uuidSchema,
  authMode: mockAuthModeSchema,
  /** FR-6.5: request validation is on by default. */
  validateRequests: z.boolean(),
  locale: mockLocaleSchema,
  /** The unguessable slug for `public-link` mode; null in the other modes. */
  publicSlug: z.string().max(64).nullable(),
  /** The token itself is never returned after creation; this is its fingerprint. */
  tokenHint: z.string().max(16).nullable(),
  tokenRotatedAt: isoTimestampSchema.nullable(),
  entityVersion: entityVersionSchema,
});
export type MockConfig = z.infer<typeof mockConfigSchema>;

export const updateMockConfigRequestSchema = z
  .object({
    authMode: mockAuthModeSchema,
    validateRequests: z.boolean(),
    locale: mockLocaleSchema,
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Change at least one setting.',
  );
export type UpdateMockConfigRequest = z.infer<
  typeof updateMockConfigRequestSchema
>;

/** Returned once, at creation or rotation. The plaintext is never stored. */
export const mockTokenSchema = z.object({
  token: z.string(),
  hint: z.string(),
  rotatedAt: isoTimestampSchema,
});
export type MockToken = z.infer<typeof mockTokenSchema>;

/**
 * One served request, as the UI's live log shows it (FR-6.7). Bodies are
 * stored only on a validation failure and capped at 8 KB.
 */
export const mockLogEntrySchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  environmentKey: z.string(),
  method: z.string(),
  path: z.string(),
  endpointId: uuidSchema.nullable(),
  statusCode: z.number().int(),
  /** Which of FR-6.4's precedence rules chose the response. */
  source: z.string(),
  latencyMs: z.number().int().nonnegative(),
  validation: z.enum(['passed', 'failed', 'skipped']),
  cache: z.enum(['hit', 'miss', 'bypass']),
  requestId: z.string(),
  callerIp: z.string().nullable(),
  requestBody: z.string().nullable(),
  occurredAt: isoTimestampSchema,
});
export type MockLogEntry = z.infer<typeof mockLogEntrySchema>;

export const mockLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(512).optional(),
  environmentKey: z.string().max(64).optional(),
  /** Narrow to failures while debugging an integration. */
  status: z.coerce.number().int().min(100).max(599).optional(),
  endpointId: uuidSchema.optional(),
});
export type MockLogQuery = z.infer<typeof mockLogQuerySchema>;

/** `/__mock/routes`: what the engine will match, in precedence order. */
export const mockRouteSummarySchema = z.object({
  method: z.string(),
  path: z.string(),
  endpointId: uuidSchema,
  summary: z.string(),
  statusCodes: z.array(z.union([z.number().int(), z.literal('default')])),
});
export type MockRouteSummary = z.infer<typeof mockRouteSummarySchema>;

export const mockEnvironmentRefSchema = z.object({
  key: slugSchema,
  versionId: uuidSchema,
  versionLabel: z.string(),
  /** `draft` follows the mutable head; a published version never moves. */
  mutable: z.boolean(),
  /** The path a client calls, built server-side so it is never guessed. */
  path: z.string(),
});
export type MockEnvironmentRef = z.infer<typeof mockEnvironmentRefSchema>;
