import type { ProjectRole } from '@apion/contracts';

/**
 * PRD 01 FR-1.1. Every control-plane operation is checked against this table
 * server-side; the UI mirrors it only to choose an affordance, never to decide.
 */
const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  maintainer: 3,
  owner: 4,
};

export function roleRank(role: ProjectRole): number {
  return ROLE_RANK[role];
}

export function roleAtLeast(role: ProjectRole, minimum: ProjectRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const permissions = [
  'project.read',
  'project.update',
  'project.archive',
  'project.delete',
  'project.restore',
  'member.read',
  'member.manage',
  'version.create',
  'version.publish',
  'contract.read',
  'contract.write',
  'contract.import',
  'contract.export',
  'status.update',
  'comment.create',
  'comment.resolve_own',
  'comment.resolve_any',
  'lock.force_release',
  'standard.read',
  'standard.write',
  'standard.publish',
  'exemption.grant',
  'audit.read',
] as const;

export type Permission = (typeof permissions)[number];

/** The least privileged role that may perform each operation. */
const MINIMUM_ROLE: Record<Permission, ProjectRole> = {
  'project.read': 'viewer',
  'project.update': 'maintainer',
  'project.archive': 'maintainer',
  'project.delete': 'owner',
  'project.restore': 'maintainer',
  'member.read': 'viewer',
  'member.manage': 'owner',
  'version.create': 'editor',
  'version.publish': 'maintainer',
  'contract.read': 'viewer',
  'contract.write': 'editor',
  'contract.import': 'editor',
  'contract.export': 'viewer',
  'status.update': 'editor',
  'comment.create': 'commenter',
  'comment.resolve_own': 'commenter',
  'comment.resolve_any': 'maintainer',
  'lock.force_release': 'maintainer',
  'standard.read': 'viewer',
  'standard.write': 'maintainer',
  // PRD 08 decision 5 leaves Owner-only vs Maintainer open; Maintainer is the
  // reversible default, since narrowing it later removes nobody's saved work.
  'standard.publish': 'maintainer',
  'exemption.grant': 'maintainer',
  'audit.read': 'viewer',
};

export function can(role: ProjectRole, permission: Permission): boolean {
  return roleAtLeast(role, MINIMUM_ROLE[permission]);
}

export function minimumRoleFor(permission: Permission): ProjectRole {
  return MINIMUM_ROLE[permission];
}

/**
 * PRD 01: a Commenter must never receive editable contract controls, and the UI
 * has to explain the restriction rather than fail a save silently.
 */
export function explainDenial(
  role: ProjectRole,
  permission: Permission,
): string {
  const required = MINIMUM_ROLE[permission];
  // "an editor", "an owner": the roles that start with a vowel are a closed set.
  const article = required === 'editor' || required === 'owner' ? 'An' : 'A';
  return `Your ${role} role is read-only here. ${article} ${required} can do this. Ask a project owner for access.`;
}
