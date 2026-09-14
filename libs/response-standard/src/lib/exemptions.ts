import type { RuleId, Violation } from './standard.js';

/**
 * FR-4.6: "A Maintainer may waive a rule for one endpoint only with mandatory
 * justification. Every exemption is visible in project health; it cannot
 * silently suppress a violation across a project."
 *
 * Both halves are structural here. An exemption carries an endpoint id, so
 * there is no shape in which one covers a project, and an exempted violation
 * is marked rather than dropped, so nothing disappears from health or from the
 * editor.
 */
export interface Exemption {
  id: string;
  endpointId: string;
  ruleId: RuleId;
  justification: string;
  grantedBy: string;
  grantedAt: string;
}

export interface ResolvedViolation extends Violation {
  /** Set when an exemption covers this rule for this endpoint. */
  exemption?: Pick<
    Exemption,
    'id' | 'justification' | 'grantedBy' | 'grantedAt'
  >;
}

export function applyExemptions(
  violations: readonly Violation[],
  exemptions: readonly Exemption[],
  endpointId: string,
): ResolvedViolation[] {
  const byRule = new Map(
    exemptions
      .filter((exemption) => exemption.endpointId === endpointId)
      .map((exemption) => [exemption.ruleId, exemption]),
  );

  return violations.map((violation) => {
    const exemption = byRule.get(violation.ruleId);
    if (!exemption) return violation;

    return {
      ...violation,
      exemption: {
        id: exemption.id,
        justification: exemption.justification,
        grantedBy: exemption.grantedBy,
        grantedAt: exemption.grantedAt,
      },
    };
  });
}

/**
 * FR-4.5: an unresolved error blocks approval and publication. An exempted one
 * does not block, because a Maintainer has accepted it in writing; a warning
 * never blocks.
 */
export function blockingViolations(
  violations: readonly ResolvedViolation[],
): ResolvedViolation[] {
  return violations.filter(
    (violation) => violation.severity === 'error' && !violation.exemption,
  );
}

export function isBlocked(violations: readonly ResolvedViolation[]): boolean {
  return blockingViolations(violations).length > 0;
}
