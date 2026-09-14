import { z } from 'zod';
import { endpointPathSchema } from './endpoint-path.js';
import {
  httpMethodSchema,
  implementationStatusSchema,
  parameterLocationSchema,
} from './enums.js';
import {
  entityVersionSchema,
  isoTimestampSchema,
  uuidSchema,
} from './primitives.js';

/**
 * A JSON Schema document, carried opaquely. The control plane validates it with
 * Ajv at the boundary rather than modelling every keyword in Zod, so that
 * unusual but legal schemas survive an import/export round trip (PRD 02 FR-2.7).
 */
export const jsonSchemaSchema: z.ZodType<unknown> = z.union([
  z.boolean(),
  z.record(z.string(), z.unknown()),
]);

export const parameterSchema = z.object({
  name: z.string().min(1).max(80),
  location: parameterLocationSchema,
  description: z.string().max(1000).default(''),
  required: z.boolean().default(false),
  deprecated: z.boolean().default(false),
  schema: jsonSchemaSchema,
});
export type Parameter = z.infer<typeof parameterSchema>;

/**
 * PRD 02 FR-2.5: every response needs at least one named example.
 *
 * `value` holds one entry per slot the project's response standard declares,
 * keyed by slot token: `{ "$status_code": 200, "$message": "OK",
 * "$data": {...}, "$meta": null }`. An example written before the project had
 * slots is a bare payload and is read as the data slot.
 */
export const responseExampleSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(80),
  summary: z.string().max(500).default(''),
  isDefault: z.boolean().default(false),
  value: z.unknown(),
});
export type ResponseExample = z.infer<typeof responseExampleSchema>;

export const endpointResponseSchema = z.object({
  id: uuidSchema,
  /** `default` covers every status the endpoint does not declare explicitly. */
  statusCode: z.union([
    z.number().int().min(100).max(599),
    z.literal('default'),
  ]),
  description: z.string().max(2000).default(''),
  headers: z.array(parameterSchema).default([]),
  /** The payload shape. The response standard wraps it; see PRD 03 FR-4.8. */
  payloadSchema: jsonSchemaSchema.nullable(),
  examples: z.array(responseExampleSchema).default([]),
});
export type EndpointResponse = z.infer<typeof endpointResponseSchema>;

export const requestBodySchema = z.object({
  description: z.string().max(2000).default(''),
  required: z.boolean().default(false),
  contentType: z.string().min(1).max(120).default('application/json'),
  schema: jsonSchemaSchema,
});
export type RequestBody = z.infer<typeof requestBodySchema>;

export const endpointSchema = z.object({
  id: uuidSchema,
  versionId: uuidSchema,
  resourceId: uuidSchema,
  method: httpMethodSchema,
  path: endpointPathSchema,
  summary: z.string().min(1).max(200),
  /** Markdown; rendered read-only for non-editors. */
  description: z.string().max(20_000).default(''),
  operationId: z.string().max(120).nullable(),
  parameters: z.array(parameterSchema).default([]),
  requestBody: requestBodySchema.nullable(),
  responses: z.array(endpointResponseSchema).default([]),
  authRequired: z.boolean().default(true),
  deprecated: z.boolean().default(false),
  ownerId: uuidSchema.nullable(),
  ticketUrl: z.url().max(500).nullable(),
  tags: z.array(z.string().max(60)).default([]),
  position: z.number().int().nonnegative(),
  entityVersion: entityVersionSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type Endpoint = z.infer<typeof endpointSchema>;

/** The tree row (PRD 02 FR-2.1) carries only what a virtualised list renders. */
export const endpointSummarySchema = z.object({
  id: uuidSchema,
  resourceId: uuidSchema,
  method: httpMethodSchema,
  path: z.string(),
  summary: z.string(),
  deprecated: z.boolean(),
  status: implementationStatusSchema.nullable(),
  unresolvedComments: z.number().int().nonnegative().default(0),
  position: z.number().int().nonnegative(),
});
export type EndpointSummary = z.infer<typeof endpointSummarySchema>;

export const createEndpointRequestSchema = z.object({
  resourceId: uuidSchema,
  method: httpMethodSchema,
  path: endpointPathSchema,
  summary: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  operationId: z.string().max(120).nullable().optional(),
  parameters: z.array(parameterSchema).optional(),
  requestBody: requestBodySchema.nullable().optional(),
  /** Ids are assigned by the server, for the response and each example. */
  responses: z
    .array(
      endpointResponseSchema.omit({ id: true, examples: true }).extend({
        examples: z.array(responseExampleSchema.omit({ id: true })).default([]),
      }),
    )
    .optional(),
  authRequired: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  ownerId: uuidSchema.nullable().optional(),
  ticketUrl: z.url().max(500).nullable().optional(),
  tags: z.array(z.string().max(60)).optional(),
});
export type CreateEndpointRequest = z.infer<typeof createEndpointRequestSchema>;

/**
 * An update carries the responses it is keeping, ids and all, because the array
 * is replaced wholesale rather than patched entry by entry. An id is optional
 * so a newly added response or example can be sent without inventing one: the
 * server assigns those and leaves the rest alone, which is what lets an editor
 * change one example without the other responses losing their identity.
 */
export const updateEndpointRequestSchema = createEndpointRequestSchema
  .partial()
  .extend({
    responses: z
      .array(
        endpointResponseSchema.omit({ id: true, examples: true }).extend({
          id: uuidSchema.optional(),
          examples: z
            .array(
              responseExampleSchema
                .omit({ id: true })
                .extend({ id: uuidSchema.optional() }),
            )
            .default([]),
        }),
      )
      .optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'Change at least one field.',
  );
export type UpdateEndpointRequest = z.infer<typeof updateEndpointRequestSchema>;

/** PRD 02 FR-2.3: one schema, two editing modes, identical semantics. */
export const namedSchemaSchema = z.object({
  id: uuidSchema,
  versionId: uuidSchema,
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use a valid identifier.'),
  description: z.string().max(2000).default(''),
  schema: jsonSchemaSchema,
  /** Maintained by the server; FR-2.4 shows it next to each schema. */
  usageCount: z.number().int().nonnegative().default(0),
  entityVersion: entityVersionSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type NamedSchema = z.infer<typeof namedSchemaSchema>;

export const createSchemaRequestSchema = namedSchemaSchema
  .pick({
    name: true,
    schema: true,
  })
  .extend({ description: z.string().max(2000).optional() });
export type CreateSchemaRequest = z.infer<typeof createSchemaRequestSchema>;

export const renameSchemaRequestSchema = z.object({
  name: namedSchemaSchema.shape.name,
  /**
   * FR-2.4 requires the author to see the impact count and confirm it before
   * the rename runs, so the count they saw is echoed back and re-checked.
   */
  acknowledgedImpactCount: z.number().int().nonnegative(),
});
export type RenameSchemaRequest = z.infer<typeof renameSchemaRequestSchema>;

export const schemaImpactSchema = z.object({
  schemaId: uuidSchema,
  name: z.string(),
  references: z.array(
    z.object({
      kind: z.enum(['endpoint', 'schema']),
      id: uuidSchema,
      label: z.string(),
      pointer: z.string(),
    }),
  ),
});
export type SchemaImpact = z.infer<typeof schemaImpactSchema>;
