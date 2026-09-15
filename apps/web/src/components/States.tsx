import type { ReactNode } from 'react';
import { RequestError } from '../api/client.js';

/**
 * The three states R-27 requires, in the shape the antislop human skill asks
 * for: each says why it looks like this and what to do next. "No data" is not
 * one of the messages any of them can produce.
 */

export function LoadingState({ what }: { what: string }) {
  return (
    <div
      className="flex max-w-[46ch] flex-col items-start gap-2 px-5 py-8"
      role="status"
      aria-live="polite"
    >
      <p className="text-md font-semibold">Loading {what}…</p>
    </div>
  );
}

export function EmptyState({
  headline,
  explanation,
  action,
}: {
  headline: string;
  /** Why it is empty. First run and filtered-to-nothing are different screens. */
  explanation: string;
  /** The one action that fills it, when the reader is allowed to take it. */
  action?: ReactNode;
}) {
  return (
    <div className="flex max-w-[46ch] flex-col items-start gap-2 px-5 py-8">
      <p className="text-md font-semibold">{headline}</p>
      <p className="text-text-muted">{explanation}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { headline, explanation } = describe(error);

  return (
    <div
      className="flex max-w-[46ch] flex-col items-start gap-2 px-5 py-8"
      role="alert"
    >
      <p className="text-md font-semibold text-status-danger">{headline}</p>
      <p className="text-text-muted">{explanation}</p>
      {retry ? (
        <div className="mt-2">
          <button
            type="button"
            className="cursor-pointer rounded-md border border-line-control px-3 py-2 text-text hover:bg-surface-2"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Turns whatever was thrown into something a person can act on. */
function describe(error: unknown): { headline: string; explanation: string } {
  if (error instanceof RequestError) {
    switch (error.code) {
      case 'UNAUTHENTICATED':
        return {
          headline: 'Your session ended',
          explanation: 'Sign in again to pick up where you left off.',
        };
      case 'FORBIDDEN':
        return {
          headline: 'You do not have access to this',
          explanation: error.message,
        };
      case 'NOT_FOUND':
        return {
          headline: 'Not found',
          explanation:
            'It may have been deleted, or you may not have access to the project it belongs to.',
        };
      case 'VALIDATION_FAILED':
        return {
          headline: 'Some fields need attention',
          explanation:
            error.details?.map((detail) => detail.message).join(' ') ??
            error.message,
        };
      default:
        return { headline: 'That did not work', explanation: error.message };
    }
  }

  if (error instanceof Error && error.name === 'TypeError') {
    // fetch throws TypeError when the network itself failed.
    return {
      headline: 'Cannot reach the server',
      explanation: 'Check your connection, then try again.',
    };
  }

  return {
    headline: 'Something went wrong',
    explanation:
      error instanceof Error ? error.message : 'The cause was not reported.',
  };
}
