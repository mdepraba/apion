import {
  auditActions,
  changeKinds,
  httpMethods,
  implementationStatuses,
  parameterLocations,
  projectLifecycleStates,
  projectRoles,
  projectVisibilities,
  versionStates,
} from '@apion/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enums are generated from the contract enums so a new value cannot be
 * added to one without a migration appearing for the other.
 */
export const projectRoleEnum = pgEnum('project_role', projectRoles);
export const implementationStatusEnum = pgEnum(
  'implementation_status',
  implementationStatuses,
);
export const httpMethodEnum = pgEnum('http_method', httpMethods);
export const versionStateEnum = pgEnum('version_state', versionStates);
export const changeKindEnum = pgEnum('change_kind', changeKinds);
export const parameterLocationEnum = pgEnum(
  'parameter_location',
  parameterLocations,
);
export const projectVisibilityEnum = pgEnum(
  'project_visibility',
  projectVisibilities,
);
export const projectLifecycleStateEnum = pgEnum(
  'project_lifecycle_state',
  projectLifecycleStates,
);
export const auditActionEnum = pgEnum('audit_action', auditActions);

/** Distinguishes a human edit from a deployment write (PRD 04 FR-3.4). */
export const statusChannelEnum = pgEnum('status_channel', ['ui', 'ci']);
