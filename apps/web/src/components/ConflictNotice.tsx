import type { Endpoint } from '@apion/contracts';

/**
 * PRD 01 and PRD 06 FR-5.3: a stale write gets the current state and a route
 * out, not a rejection. The server sends its version alongside the refusal, so
 * this can show what actually changed without another request.
 */
export function ConflictNotice({
  conflict,
  onReload,
}: {
  conflict: {
    expectedVersion: number;
    actualVersion: number;
    current: unknown;
  };
  onReload: () => void;
}) {
  const current = conflict.current as Partial<Endpoint> | undefined;
  const behindBy = conflict.actualVersion - conflict.expectedVersion;

  return (
    <div
      className="mt-3 mr-3 ml-3 rounded-md border border-accent bg-accent-quiet p-4 sm:mt-4 sm:mr-5 sm:ml-5"
      role="alert"
    >
      <h2 className="mb-2 text-md">Someone else saved this first</h2>

      <p className="mb-3 text-sm text-text">
        You loaded version {conflict.expectedVersion}; it is now version{' '}
        {conflict.actualVersion}
        {behindBy > 1 ? ` (${behindBy} saves ahead)` : ''}. Your changes have
        not been applied and nothing of theirs was overwritten.
      </p>

      {current ? (
        <dl className="mb-3 grid gap-x-3 gap-y-1 rounded-sm bg-surface-1 p-3 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-text-muted">Their summary</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">
            {current.summary ?? 'Not set'}
          </dd>
          <dt className="text-text-muted">Their path</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">
            <code>{current.path ?? 'Not set'}</code>
          </dd>
        </dl>
      ) : null}

      <p className="mb-3 text-sm text-text">
        Reload to take their version as the new starting point. Copy anything
        you still need out of the fields above first, because reloading discards
        your edits.
      </p>

      <button
        type="button"
        className="min-h-11 w-full cursor-pointer rounded-md border border-accent bg-accent px-4 font-semibold text-accent-text sm:min-h-9 sm:w-auto"
        onClick={onReload}
      >
        Reload their version
      </button>
    </div>
  );
}
