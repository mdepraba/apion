import { z } from 'zod';
import {
  projectLifecycleStateSchema,
  projectRoleSchema,
  projectVisibilitySchema,
  versionStateSchema,
} from './enums.js';
import {
  entityVersionSchema,
  isoTimestampSchema,
  slugSchema,
  uuidSchema,
} from './primitives.js';

export const environmentSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  /** `dev`, `staging`, `production` by default; projects may add their own. */
  key: slugSchema,
  name: z.string().min(1).max(60),
  isPrimary: z.boolean(),
  position: z.number().int().nonnegative(),
});
export type Environment = z.infer<typeof environmentSchema>;

export const projectSchema = z.object({
  id: uuidSchema,
  organisationId: uuidSchema,
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  visibility: projectVisibilitySchema,
  lifecycleState: projectLifecycleStateSchema,
  /** Set when the project is soft-deleted; PRD 01 FR-1.5 gives 30 days to restore. */
  deletedAt: isoTimestampSchema.nullable(),
  entityVersion: entityVersionSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  visibility: projectVisibilitySchema.default('organisation'),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = createProjectRequestSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'Change at least one field.',
  );
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectMemberSchema = z.object({
  projectId: uuidSchema,
  userId: uuidSchema,
  role: projectRoleSchema,
  displayName: z.string(),
  email: z.string(),
  addedAt: isoTimestampSchema,
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const upsertMemberRequestSchema = z.object({
  userId: uuidSchema,
  role: projectRoleSchema,
});
export type UpsertMemberRequest = z.infer<typeof upsertMemberRequestSchema>;

/**
 * PRD 01: a version is a named contract snapshot, immutable once published.
 * Phase 1 keeps these linear; branching is an open decision (PRD 08 item 4).
 */
export const contractVersionSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  label: z.string().min(1).max(60),
  state: versionStateSchema,
  publishedAt: isoTimestampSchema.nullable(),
  publishedBy: uuidSchema.nullable(),
  entityVersion: entityVersionSchema,
  createdAt: isoTimestampSchema,
});
export type ContractVersion = z.infer<typeof contractVersionSchema>;

export const createVersionRequestSchema = z.object({
  label: z.string().min(1).max(60),
  /** Copy every resource, endpoint and schema from this version. */
  copyFromVersionId: uuidSchema.optional(),
});
export type CreateVersionRequest = z.infer<typeof createVersionRequestSchema>;

export const resourceSchema = z.object({
  id: uuidSchema,
  versionId: uuidSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(2000).default(''),
  position: z.number().int().nonnegative(),
  entityVersion: entityVersionSchema,
});
export type Resource = z.infer<typeof resourceSchema>;

export const createResourceRequestSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  position: z.number().int().nonnegative().optional(),
});
export type CreateResourceRequest = z.infer<typeof createResourceRequestSchema>;
