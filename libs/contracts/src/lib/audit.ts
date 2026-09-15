import { z } from 'zod';
import { isoTimestampSchema, uuidSchema } from './primitives.js';

/**
 * PRD 01 FR-1.7: the activity feed is the readable projection of the immutable
 * audit log, retained for 12 months.
 */
export const auditActions = [
  'project.created',
  'project.updated',
  'project.archived',
  'project.restored',
  'project.deleted',
  'member.added',
  'member.role_changed',
  'member.removed',
  'version.created',
  'version.published',
  'resource.created',
  'resource.updated',
  'resource.deleted',
  'endpoint.created',
  'endpoint.updated',
  'endpoint.deleted',
  'endpoint.status_changed',
  'schema.created',
  'schema.updated',
  'schema.renamed',
  'schema.deleted',
  'contract.imported',
  'contract.exported',
  'lock.force_released',
  'standard.published',
  'exemption.granted',
  'exemption.revoked',
  'mock.config_updated',
  'mock.token_rotated',
  'mock.scenario_saved',
  'mock.scenario_deleted',
] as const;
export const auditActionSchema = z.enum(auditActions);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditEventSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  actorId: uuidSchema.nullable(),
  actorName: z.string().nullable(),
  action: auditActionSchema,
  targetType: z.string(),
  targetId: uuidSchema.nullable(),
  targetLabel: z.string().nullable(),
  /** Action-specific detail; kept loose so new actions need no migration. */
  metadata: z.record(z.string(), z.unknown()).default({}),
  occurredAt: isoTimestampSchema,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
