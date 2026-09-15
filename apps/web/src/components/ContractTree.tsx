import type { EndpointSummary, Resource } from '@apion/contracts';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { EndpointLine } from './EndpointLine.js';
import { StatusBadge } from './StatusBadge.js';

/**
 * FR-2.1: Version to Resource to Endpoint. Resources collapse so a project with
 * 1,500 endpoints does not render 1,500 rows before anyone has chosen where to
 * look. The filter narrows across every resource at once, because "where is the
 * endpoint that does X" is asked far more often than "what is in this group".
 */
export function ContractTree({
  slug,
  versionId,
  resources,
  endpoints,
  loading,
  selectedEndpointId,
}: {
  slug: string;
  versionId: string;
  resources: readonly Resource[];
  endpoints: readonly EndpointSummary[];
  loading: boolean;
  selectedEndpointId?: string;
}) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const needle = filter.trim().toLowerCase();

  const byResource = useMemo(() => {
    const grouped = new Map<string, EndpointSummary[]>();
    for (const endpoint of endpoints) {
      if (
        needle.length > 0 &&
        !endpoint.path.toLowerCase().includes(needle) &&
        !endpoint.summary.toLowerCase().includes(needle) &&
        !endpoint.method.includes(needle)
      ) {
        continue;
      }
      const list = grouped.get(endpoint.resourceId) ?? [];
      list.push(endpoint);
      grouped.set(endpoint.resourceId, list);
    }
    return grouped;
  }, [endpoints, needle]);

  const matchCount = [...byResource.values()].reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return (
    <div className="pb-5">
      <div className="sticky top-0 z-1 border-b border-line bg-surface-1 p-3">
        <input
          className="min-h-[30px] w-full rounded-md border border-line-control bg-surface-0 px-2 text-[max(var(--text-sm),16px)] text-text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter this version"
          aria-label="Filter endpoints in this version"
          type="search"
        />
      </div>

      {/* Filtering is a live change to a list, so it is announced. */}
      <p className="sr-only" role="status" aria-live="polite">
        {needle.length > 0
          ? `${matchCount} ${matchCount === 1 ? 'endpoint matches' : 'endpoints match'} ${filter.trim()}`
          : ''}
      </p>

      {needle.length > 0 && matchCount === 0 ? (
        <p className="px-3 py-4 text-sm text-text-muted">
          No endpoint in this version matches “{filter.trim()}”. Clear the
          filter to see them all.
        </p>
      ) : null}

      <ul>
        {resources.map((resource) => {
          const rows = byResource.get(resource.id) ?? [];
          // A filter that excludes a whole resource hides it, rather than
          // leaving an empty group for the reader to skip past.
          if (needle.length > 0 && rows.length === 0) return null;

          const isCollapsed = collapsed.has(resource.id) && needle.length === 0;

          return (
            <li key={resource.id}>
              <button
                type="button"
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-3 text-left text-sm font-semibold text-text hover:bg-surface-2 lg:min-h-(--spacing-row)"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(resource.id)) next.delete(resource.id);
                    else next.add(resource.id);
                    return next;
                  })
                }
              >
                <span
                  className="w-3 flex-none text-text-muted"
                  aria-hidden="true"
                >
                  {isCollapsed ? '›' : '⌄'}
                </span>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {resource.name}
                </span>
                <span className="ml-auto text-xs font-normal text-text-muted">
                  {rows.length}
                </span>
              </button>

              {isCollapsed ? null : (
                <ul>
                  {rows.length === 0 && !loading ? (
                    <li className="py-2 pr-3 pl-5 text-xs text-text-muted">
                      No endpoints in {resource.name} yet.
                    </li>
                  ) : null}

                  {rows.map((endpoint) => (
                    <li key={endpoint.id}>
                      <Link
                        to="/projects/$slug/versions/$versionId"
                        params={{ slug, versionId }}
                        search={(previous) => ({
                          ...previous,
                          endpoint: endpoint.id,
                        })}
                        className="flex min-h-11 items-center gap-2 px-3 pl-5 text-text no-underline hover:bg-surface-2 data-[selected=true]:bg-surface-2 data-[selected=true]:shadow-[inset_2px_0_0_var(--accent)] lg:min-h-(--spacing-row)"
                        data-selected={endpoint.id === selectedEndpointId}
                        aria-current={
                          endpoint.id === selectedEndpointId
                            ? 'true'
                            : undefined
                        }
                      >
                        <EndpointLine
                          method={endpoint.method}
                          path={endpoint.path}
                          size="sm"
                        />
                        {endpoint.status ? (
                          <StatusBadge status={endpoint.status} />
                        ) : null}
                        {endpoint.deprecated ? (
                          <span className="flex-none text-xs text-text-muted line-through">
                            deprecated
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {loading ? (
        <p className="py-2 pr-3 pl-5 text-xs text-text-muted" role="status">
          Loading endpoints…
        </p>
      ) : null}
    </div>
  );
}
