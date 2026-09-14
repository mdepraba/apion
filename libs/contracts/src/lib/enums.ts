import { z } from 'zod';

/** PRD 01 FR-1.1. Ordered least to most privileged; see `roleRank` in @apion/domain. */
export const projectRoles = [
  'viewer',
  'commenter',
  'editor',
  'maintainer',
  'owner',
] as const;
export const projectRoleSchema = z.enum(projectRoles);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

/** PRD 04 FR-3.1. */
export const implementationStatuses = [
  'draft',
  'in_review',
  'approved',
  'in_progress',
  'implemented',
  'deprecated',
  'retired',
] as const;
export const implementationStatusSchema = z.enum(implementationStatuses);
export type ImplementationStatus = z.infer<typeof implementationStatusSchema>;

/**
 * PRD 04 FR-3.1: list views collapse everything before `implemented` into a
 * single "Not implemented" group, while detail views keep the exact state.
 */
export const statusGroups = [
  'not_implemented',
  'implemented',
  'retired',
] as const;
export const statusGroupSchema = z.enum(statusGroups);
export type StatusGroup = z.infer<typeof statusGroupSchema>;

export const httpMethods = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
] as const;
export const httpMethodSchema = z.enum(httpMethods);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

export const versionStates = ['draft', 'published', 'archived'] as const;
export const versionStateSchema = z.enum(versionStates);
export type VersionState = z.infer<typeof versionStateSchema>;

/** PRD 02 FR-2.6. */
export const changeKinds = ['breaking', 'non_breaking', 'additive'] as const;
export const changeKindSchema = z.enum(changeKinds);
export type ChangeKind = z.infer<typeof changeKindSchema>;

export const parameterLocations = [
  'path',
  'query',
  'header',
  'cookie',
] as const;
export const parameterLocationSchema = z.enum(parameterLocations);
export type ParameterLocation = z.infer<typeof parameterLocationSchema>;

export const projectVisibilities = ['private', 'organisation'] as const;
export const projectVisibilitySchema = z.enum(projectVisibilities);
export type ProjectVisibility = z.infer<typeof projectVisibilitySchema>;

export const projectLifecycleStates = [
  'active',
  'archived',
  'deleted',
] as const;
export const projectLifecycleStateSchema = z.enum(projectLifecycleStates);
export type ProjectLifecycleState = z.infer<typeof projectLifecycleStateSchema>;
