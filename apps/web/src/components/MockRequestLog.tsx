import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type MockLogFilters, mockLogQuery } from '../api/queries.js';
import { TABLE, TABLE_WRAP } from '../ui.js';
import { EndpointLine } from './EndpointLine.js';
import { EmptyState, ErrorState } from './States.js';

const NUMERIC = 'text-right tabular-nums';
const META = 'text-text-muted tabular-nums';

/**
 * FR-6.7's live, filterable request log. The question it answers is "did my
 * call arrive, and what did the mock decide", so the columns are the ones that
 * settle that: what was called, what came back, which rule chose it, and
 * whether validation passed.
 */
export function MockRequestLog({ slug }: { slug: string }) {
  const [filters, setFilters] = useState<MockLogFilters>({});
  const log = useQuery(mockLogQuery(slug, filters));

  const failuresOnly = filters.status === 400;

  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="cursor-pointer rounded-md border border-line-control px-3 py-1 text-sm text-text hover:bg-surface-2 aria-pressed:border-accent aria-pressed:bg-accent-quiet"
          aria-pressed={failuresOnly}
          onClick={() =>
            setFilters((previous) => ({
              ...previous,
              status: failuresOnly ? undefined : 400,
            }))
          }
        >
          Validation failures only
        </button>

        <span
          className="text-sm text-text-muted"
          role="status"
          aria-live="polite"
        >
          {log.isFetching ? 'Refreshing…' : 'Updates every 5 seconds'}
        </span>
      </div>

      {log.isError ? (
        <ErrorState error={log.error} retry={() => void log.refetch()} />
      ) : log.isPending ? (
        <p className="text-text-muted">Loading recent requests…</p>
      ) : log.data.items.length === 0 ? (
        <EmptyState
          headline={
            failuresOnly ? 'No validation failures recorded' : 'No requests yet'
          }
          explanation={
            failuresOnly
              ? 'Nothing has been rejected by request validation in the last 48 hours.'
              : 'Call a mock URL above and the request appears here within a few seconds. Detailed entries are kept for 48 hours.'
          }
        />
      ) : (
        <div className={TABLE_WRAP}>
          <table
            className={`${TABLE} [&_th]:sticky [&_th]:top-0 [&_td]:whitespace-nowrap`}
          >
            <caption className="sr-only">Mock requests, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Request</th>
                <th scope="col">Status</th>
                <th scope="col">Chosen by</th>
                <th scope="col">Validation</th>
                <th scope="col" className={NUMERIC}>
                  Latency
                </th>
              </tr>
            </thead>
            <tbody>
              {log.data.items.map((entry) => (
                <tr key={entry.id}>
                  <td className={META}>
                    <time dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleTimeString()}
                    </time>
                  </td>
                  <td>
                    <EndpointLine
                      method={
                        entry.method.toLowerCase() as Parameters<
                          typeof EndpointLine
                        >[0]['method']
                      }
                      path={entry.path}
                      size="sm"
                    />
                  </td>
                  <td>
                    <span
                      className="font-mono font-semibold text-status-implemented data-[class=client]:text-status-in-progress data-[class=server]:rounded-sm data-[class=server]:bg-status-danger/15 data-[class=server]:px-1 data-[class=server]:text-status-danger"
                      data-class={statusClass(entry.statusCode)}
                    >
                      {entry.statusCode}
                    </span>
                  </td>
                  <td className={META}>{describeSource(entry.source)}</td>
                  <td className={META}>
                    {entry.validation === 'failed' ? (
                      <span className="font-semibold text-status-danger">
                        Failed
                      </span>
                    ) : entry.validation === 'passed' ? (
                      'Passed'
                    ) : (
                      'Skipped'
                    )}
                  </td>
                  <td className={NUMERIC}>
                    {entry.latencyMs} ms
                    {entry.cache === 'hit' ? (
                      <span className="text-text-muted"> cached</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** FR-6.4's precedence rules, named the way the caller would recognise them. */
function describeSource(source: string): string {
  switch (source) {
    case 'prefer-code':
      return 'Prefer: code';
    case 'prefer-example':
      return 'Prefer: example';
    case 'scenario':
      return 'Scenario';
    case 'default-example':
      return 'Default example';
    case 'generated':
      return 'Generated from schema';
    case 'validation':
      return 'Request validation';
    case 'not-found':
      return 'No matching route';
    case 'method-not-allowed':
      return 'Method not declared';
    default:
      return source;
  }
}

function statusClass(status: number): 'success' | 'client' | 'server' {
  if (status >= 500) return 'server';
  if (status >= 400) return 'client';
  return 'success';
}
