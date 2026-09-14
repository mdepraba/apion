import type { RuleIdValue } from '@apion/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { request } from '../../../../api/client.js';
import {
  accessQuery,
  exemptionsQuery,
  keys,
  projectQuery,
  standardHealthQuery,
} from '../../../../api/queries.js';
import { Breadcrumb } from '../../../../components/Breadcrumb.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../../components/States.js';
import { PAGE_HEADER, PAGE_SCROLL, SECONDARY, TABLE } from '../../../../ui.js';

const NUMERIC = 'text-right tabular-nums';
const SMALL_BUTTON = `${SECONDARY} mt-2 min-h-0 px-3 py-1 text-sm disabled:text-text-muted`;

/**
 * PRD 03's health panel. The decision it supports is "is this project's
 * contract actually consistent, and if not where", so coverage comes first:
 * "412 of 500 checked against v3" is the honest headline, not a clean-looking
 * count of the endpoints that happen to have been checked.
 */
export const Route = createFileRoute('/_app/projects/$slug/standard-health')({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectQuery(params.slug)),
      context.queryClient.ensureQueryData(accessQuery(params.slug)),
      context.queryClient.ensureQueryData(standardHealthQuery(params.slug)),
    ]);
  },
  component: HealthPage,
});

const RULE_LABELS: Record<RuleIdValue, string> = {
  RS001: 'Success envelope',
  RS002: 'Property naming',
  RS003: 'Error envelope',
  RS004: 'Error-code registry',
  RS005: 'Status policy',
  RS006: 'Pagination shape',
  RS007: 'Date format',
  RS008: 'Required headers',
  RS009: 'Error classes',
  RS010: 'Path naming',
};

function HealthPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();

  const project = useQuery(projectQuery(slug));
  const access = useQuery(accessQuery(slug));
  const exemptions = useQuery(exemptionsQuery(slug));

  const health = useQuery({
    ...standardHealthQuery(slug),
    // Only while a sweep is running: the panel is otherwise static, and this
    // is a 1 vCPU host that should not be polled for nothing.
    refetchInterval: (query) => (query.state.data?.sweep ? 2_000 : false),
  });

  const canSweep =
    access.data?.role === 'editor' ||
    access.data?.role === 'maintainer' ||
    access.data?.role === 'owner';

  const sweep = useMutation({
    mutationFn: () =>
      request<{ jobId: string }>(`/projects/${slug}/standard/health/sweep`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.standardHealth(slug),
      });
    },
  });

  const revoke = useMutation({
    mutationFn: (exemptionId: string) =>
      request<void>(`/projects/${slug}/standard/exemptions/${exemptionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.exemptions(slug) });
      void queryClient.invalidateQueries({
        queryKey: keys.standardHealth(slug),
      });
    },
  });

  if (health.isPending) return <LoadingState what="project health" />;
  if (health.isError) {
    return (
      <ErrorState error={health.error} retry={() => void health.refetch()} />
    );
  }

  const data = health.data;
  const unchecked = data.totalEndpoints - data.checkedEndpoints;
  const ruleRows = (Object.keys(RULE_LABELS) as RuleIdValue[])
    .map((ruleId) => ({ ruleId, count: data.violationsByRule[ruleId] ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className={PAGE_SCROLL}>
      <header className={PAGE_HEADER}>
        {project.data ? (
          <Breadcrumb project={project.data} page="Standard health" />
        ) : null}

        <Link
          to="/projects/$slug/standard"
          params={{ slug }}
          className="ml-auto text-sm text-text"
        >
          Edit the standard
        </Link>
      </header>

      <section className="border-b border-line px-3 py-5 sm:px-5">
        <p className="mb-2 text-lg font-semibold">
          {data.checkedEndpoints} of {data.totalEndpoints} endpoints checked
          against v{data.standardVersion}
        </p>

        {unchecked > 0 ? (
          <p className="mb-3 max-w-[64ch] text-text-muted">
            {unchecked} {unchecked === 1 ? 'endpoint has' : 'endpoints have'}{' '}
            not been checked since the standard last changed. Each is rechecked
            when someone opens it, or you can check them all now.
          </p>
        ) : (
          <p className="mb-3 max-w-[64ch] text-text-muted">
            Every endpoint has been checked against the current standard.
          </p>
        )}

        {data.sweep ? (
          <p
            className="font-semibold text-accent"
            role="status"
            aria-live="polite"
          >
            Checking all endpoints: {data.sweep.checked} of {data.sweep.total}{' '}
            done.
          </p>
        ) : canSweep && unchecked > 0 ? (
          <button
            type="button"
            className={`${SECONDARY} py-2 disabled:text-text-muted`}
            disabled={sweep.isPending}
            onClick={() => sweep.mutate()}
          >
            {sweep.isPending ? 'Starting…' : 'Check all endpoints'}
          </button>
        ) : null}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] items-start gap-5 px-3 py-5 sm:px-5">
        <section className="min-w-0">
          <h2 className="mb-2 text-md">Where the violations are</h2>

          <dl className="mb-4 flex gap-8">
            <div className="flex flex-col gap-1 [&_dd]:text-lg [&_dd]:font-semibold [&_dt]:text-sm [&_dt]:text-text-muted">
              <dt>Endpoints blocked</dt>
              <dd className="text-status-danger">{data.endpointsWithErrors}</dd>
            </div>
            <div className="flex flex-col gap-1 [&_dd]:text-lg [&_dd]:font-semibold [&_dt]:text-sm [&_dt]:text-text-muted">
              <dt>Endpoints with warnings</dt>
              <dd>{data.endpointsWithWarnings}</dd>
            </div>
          </dl>

          {ruleRows.length === 0 ? (
            <p className="mb-3 max-w-[56ch] text-sm text-text-muted">
              {data.checkedEndpoints === 0
                ? 'Nothing has been checked yet, so there is nothing to report.'
                : 'No rule is being broken by the endpoints checked so far.'}
            </p>
          ) : (
            <table className={TABLE}>
              <caption className="sr-only">
                Violations by rule, across checked endpoints
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">What it checks</th>
                  <th scope="col" className={NUMERIC}>
                    Violations
                  </th>
                </tr>
              </thead>
              <tbody>
                {ruleRows.map((row) => (
                  <tr key={row.ruleId}>
                    <td>
                      <code>{row.ruleId}</code>
                    </td>
                    <td>{RULE_LABELS[row.ruleId]}</td>
                    <td className={NUMERIC}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="min-w-0">
          <h2 className="mb-2 text-md">Exemptions ({data.exemptionCount})</h2>
          <p className="mb-3 max-w-[56ch] text-sm text-text-muted">
            A waived rule stops blocking one endpoint. It stays listed here for
            as long as it applies.
          </p>

          {exemptions.isPending ? (
            <p className="mb-3 max-w-[56ch] text-sm text-text-muted">
              Loading exemptions…
            </p>
          ) : exemptions.data && exemptions.data.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {exemptions.data.map((exemption) => (
                <li
                  key={exemption.id}
                  className="rounded-md border border-line bg-surface-1 p-3"
                >
                  <div className="flex flex-wrap items-baseline gap-2 font-semibold">
                    <code>{exemption.ruleId}</code>
                    <span className="[overflow-wrap:anywhere] font-mono text-sm font-normal">
                      {exemption.endpointLabel ?? 'Endpoint removed'}
                    </span>
                  </div>
                  <p className="my-2">{exemption.justification}</p>
                  <p className="text-sm text-text-muted">
                    Waived by {exemption.grantedByName ?? 'a former member'} on{' '}
                    <time dateTime={exemption.grantedAt}>
                      {new Date(exemption.grantedAt).toLocaleDateString()}
                    </time>
                  </p>
                  {access.data?.role === 'maintainer' ||
                  access.data?.role === 'owner' ? (
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(exemption.id)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              headline="No rules are waived"
              explanation="A maintainer can waive one rule for one endpoint from the endpoint's violation list, and must say why."
            />
          )}
        </section>
      </div>
    </div>
  );
}
