import type { ImplementationStatus, StatusGroup } from '@apion/contracts';

/**
 * PRD 04 FR-3.1. The happy path is linear, but real delivery moves backwards:
 * a review can send an endpoint back to draft, and a deployment can be rolled
 * back. Those reversals are allowed; skipping ahead is not.
 */
const ALLOWED_TRANSITIONS: Record<
  ImplementationStatus,
  readonly ImplementationStatus[]
> = {
  draft: ['in_review', 'deprecated'],
  in_review: ['draft', 'approved', 'deprecated'],
  approved: ['in_review', 'in_progress', 'deprecated'],
  in_progress: ['approved', 'implemented', 'deprecated'],
  implemented: ['in_progress', 'deprecated'],
  deprecated: ['implemented', 'retired'],
  retired: [],
};

export function canTransition(
  from: ImplementationStatus,
  to: ImplementationStatus,
): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedTransitions(
  from: ImplementationStatus,
): readonly ImplementationStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function explainTransition(
  from: ImplementationStatus,
  to: ImplementationStatus,
): string {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (allowed.length === 0) {
    return `${from} is final. Nothing follows it.`;
  }
  return `${from} cannot move straight to ${to}. It can go to ${allowed.join(', ')}.`;
}

/** FR-3.1: list views collapse pre-implementation states into one group. */
export function statusGroup(status: ImplementationStatus): StatusGroup {
  if (status === 'retired') return 'retired';
  if (status === 'implemented' || status === 'deprecated') return 'implemented';
  return 'not_implemented';
}

/**
 * FR-3.5: an endpoint stuck `in_progress` past the project threshold is flagged
 * to its owner and the health panel. Only `in_progress` goes stale: a settled
 * status stays true however long it sits.
 */
export function isStatusStale(
  status: ImplementationStatus,
  changedAt: Date,
  now: Date,
  thresholdDays: number,
): boolean {
  if (status !== 'in_progress') return false;
  const elapsedDays = (now.getTime() - changedAt.getTime()) / 86_400_000;
  return elapsedDays > thresholdDays;
}

export const DEFAULT_STALE_THRESHOLD_DAYS = 14;
