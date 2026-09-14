import type { ImplementationStatus } from '@apion/contracts';

/**
 * Status is never signalled by colour alone: the label is always present, and
 * the shape differs across the implemented boundary. A colour-blind reader and
 * a reader in forced-colors mode both get the same information.
 */
const LABELS: Record<ImplementationStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  in_progress: 'In progress',
  implemented: 'Implemented',
  deprecated: 'Deprecated',
  retired: 'Retired',
};

export function StatusBadge({
  status,
  stale = false,
}: {
  status: ImplementationStatus;
  /** FR-3.5: in_progress past the project threshold. */
  stale?: boolean;
}) {
  return (
    /*
      The border takes its colour from the text, so the one rule that sets a
      status colour drives both. `implemented` also fills: it is the state the
      whole product is asking about, and the fill is a second signal beside the
      label that survives a reader who cannot separate the hues.
      */
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-current px-2 py-px text-xs font-medium text-status-draft data-[status=implemented]:bg-status-implemented/15"
      data-status={status}
    >
      {LABELS[status]}
      {stale ? (
        <span className="font-semibold text-status-in-progress"> · stale</span>
      ) : null}
    </span>
  );
}

export function statusLabel(status: ImplementationStatus): string {
  return LABELS[status];
}
