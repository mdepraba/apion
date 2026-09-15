import type { ViolationRecord } from '@apion/contracts';
import { MUTED, SECONDARY } from '../ui.js';

/**
 * FR-4.5: inline feedback while an author works, with the stable rule id
 * visible so a violation can be looked up, discussed or waived by name.
 *
 * Severity is never carried by colour alone: each row states its severity in
 * words, and an exempted one says who accepted it and why.
 */
export function ViolationList({
  violations,
  onWaive,
}: {
  violations: readonly ViolationRecord[];
  /** Offered only to a Maintainer; FR-4.6 makes the justification mandatory. */
  onWaive?: (violation: ViolationRecord) => void;
}) {
  if (violations.length === 0) {
    return <p className={MUTED}>No violations against the current standard.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {violations.map((violation) => (
        <li
          // One rule can report twice at the same pointer (RS009 names each
          // missing status class), so the message is part of the identity.
          key={`${violation.ruleId}-${violation.pointer}-${violation.message}`}
          /*
            The left edge carries the severity. It is a real signal rather than
            decoration: an error blocks publication and a warning does not. The
            edge takes the same colour the severity gives the text, and the word
            beside the rule id says the same thing for anyone who cannot use it.
            A waived violation stays visible (FR-4.6) but stops reading urgent.
          */
          className="rounded-sm border border-line border-l-3 border-l-current bg-surface-1 px-3 py-2 text-status-danger data-[exempt=true]:border-l-line-control data-[exempt=true]:bg-surface-0"
          data-severity={violation.severity}
          data-exempt={violation.exemption ? 'true' : undefined}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <code className="font-semibold text-text">{violation.ruleId}</code>
            <span className="text-xs text-text-muted">
              {violation.exemption
                ? 'Waived'
                : violation.severity === 'error'
                  ? 'Blocks publication'
                  : 'Warning'}
            </span>
            {violation.pointer ? (
              <code className="[overflow-wrap:anywhere] text-xs text-text-muted">
                {violation.pointer}
              </code>
            ) : null}
          </div>

          <p className="mt-1 text-text">{violation.message}</p>

          {violation.exemption ? (
            <p className="mt-2 border-l-2 border-line pl-3 text-sm text-text-muted">
              Waived: {violation.exemption.justification}
            </p>
          ) : onWaive ? (
            <button
              type="button"
              className={`${SECONDARY} mt-2 min-h-0 rounded-sm px-2 py-1 text-sm`}
              onClick={() => onWaive(violation)}
            >
              Waive {violation.ruleId} for this endpoint
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
