import type {
  MockConfig,
  MockEnvironmentRef,
  MockLocale,
  MockToken,
} from '@apion/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { RequestError, request } from '../../../../api/client.js';
import {
  accessQuery,
  keys,
  mockConfigQuery,
  mockScenariosQuery,
  projectQuery,
} from '../../../../api/queries.js';
import { Breadcrumb } from '../../../../components/Breadcrumb.js';
import { MockRequestLog } from '../../../../components/MockRequestLog.js';
import { ErrorState, LoadingState } from '../../../../components/States.js';
import {
  FIELD,
  PAGE_HEADER,
  PAGE_SCROLL,
  PAGE_SECTION,
  SECONDARY,
} from '../../../../ui.js';

/* Long prose caps at a comfortable measure rather than the pane's full width. */
const PROSE = 'max-w-[72ch]';
/* A radio or checkbox beside a two-line label, nudged onto the first line. */
const CHOICE = `${PROSE} flex cursor-pointer items-start gap-2 [&_input]:mt-1`;

/**
 * PRD 05's console. The decisions here are how the mock authenticates, what it
 * validates, and which scenario is in play, so those come first and the live
 * request log sits below as the evidence that it is working.
 */
export const Route = createFileRoute('/_app/projects/$slug/mock')({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectQuery(params.slug)),
      context.queryClient.ensureQueryData(accessQuery(params.slug)),
      context.queryClient.ensureQueryData(mockConfigQuery(params.slug)),
    ]);
  },
  component: MockPage,
});

const AUTH_MODES: {
  id: MockConfig['authMode'];
  name: string;
  detail: string;
}[] = [
  {
    id: 'private',
    name: 'Private',
    detail:
      'Callers send the project mock token. 120 requests per minute per token.',
  },
  {
    id: 'public-link',
    name: 'Public link',
    detail:
      'Anyone with the link can call it, at 30 requests per minute. Do not use for sensitive schemas.',
  },
  {
    id: 'simulated-auth',
    name: 'Simulated auth',
    detail:
      "Any Bearer token is accepted; a call without one gets the contract's 401.",
  },
];

function MockPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();

  const project = useQuery(projectQuery(slug));
  const access = useQuery(accessQuery(slug));
  const config = useQuery(mockConfigQuery(slug));
  const scenarios = useQuery(mockScenariosQuery(slug));

  const environments = useQuery({
    queryKey: ['projects', slug, 'mock', 'environments'],
    queryFn: () =>
      request<MockEnvironmentRef[]>(`/projects/${slug}/mock/environments`),
  });

  const canManage =
    access.data?.role === 'maintainer' || access.data?.role === 'owner';

  // Shown once, right after rotation: it is never retrievable again.
  const [freshToken, setFreshToken] = useState<MockToken | null>(null);

  const update = useMutation({
    mutationFn: (body: Partial<MockConfig>) =>
      request<MockConfig>(`/projects/${slug}/mock`, {
        method: 'PATCH',
        body,
        entityVersion: config.data?.entityVersion,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.mockConfig(slug), saved);
    },
  });

  const rotate = useMutation({
    mutationFn: () =>
      request<MockToken>(`/projects/${slug}/mock/token`, { method: 'POST' }),
    onSuccess: (token) => {
      setFreshToken(token);
      void queryClient.invalidateQueries({ queryKey: keys.mockConfig(slug) });
    },
  });

  if (config.isPending) return <LoadingState what="the mock settings" />;
  if (config.isError) {
    return (
      <ErrorState error={config.error} retry={() => void config.refetch()} />
    );
  }

  const data = config.data;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className={`${PAGE_SCROLL} pb-12`}>
      <header className={PAGE_HEADER}>
        {project.data ? (
          <Breadcrumb project={project.data} page="Mock server" />
        ) : null}
      </header>

      <p className="max-w-[80ch] border-b border-line px-3 py-3 text-text-muted sm:px-5">
        A mock answers from the contract, including draft endpoints. It is for
        integrating before the backend exists, never a staging environment.
      </p>

      <section className={PAGE_SECTION}>
        <h2 className="mb-3 text-md">Mock URLs</h2>

        {environments.isPending ? (
          <p className={`${PROSE} mb-3 text-sm text-text-muted`}>
            Loading mock URLs…
          </p>
        ) : environments.data && environments.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {environments.data.map((environment) => (
              <li
                key={environment.key}
                className="flex flex-wrap items-baseline gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2"
              >
                <code className="[overflow-wrap:anywhere]">
                  {origin}
                  {environment.path}
                </code>
                <span className="text-sm text-text-muted">
                  {environment.mutable
                    ? `Follows ${environment.versionLabel}, updates as you edit`
                    : `Frozen at ${environment.versionLabel}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`${PROSE} mb-3 text-sm text-text-muted`}>
            No version is available to mock yet. Create a version and add an
            endpoint, and its mock URL appears here.
          </p>
        )}
      </section>

      <section className={PAGE_SECTION}>
        <h2 className="mb-3 text-md">Access</h2>

        <fieldset className="mb-3" disabled={!canManage}>
          <legend className="sr-only">Authentication mode</legend>

          <div className={`${PROSE} flex flex-col gap-3`}>
            {AUTH_MODES.map((mode) => (
              <label key={mode.id} className={CHOICE}>
                <input
                  type="radio"
                  name="authMode"
                  value={mode.id}
                  checked={data.authMode === mode.id}
                  onChange={() => update.mutate({ authMode: mode.id })}
                />
                <span>
                  <span className="block font-semibold">{mode.name}</span>
                  <span className="block text-sm text-text-muted">
                    {mode.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {data.authMode === 'private' ? (
          <div
            className={`${PROSE} rounded-md border border-line bg-surface-1 p-3`}
          >
            {freshToken ? (
              <>
                <p className="mb-2 font-semibold text-accent">
                  Copy this token now. It is stored hashed and cannot be shown
                  again.
                </p>
                <code className="block [overflow-wrap:anywhere] rounded-sm border border-line bg-surface-sunken p-2">
                  {freshToken.token}
                </code>
              </>
            ) : data.tokenHint ? (
              <p className={`${PROSE} mb-3 text-sm text-text-muted`}>
                A token ending {data.tokenHint} is active
                {data.tokenRotatedAt
                  ? `, rotated ${new Date(data.tokenRotatedAt).toLocaleDateString()}`
                  : null}
                .
              </p>
            ) : (
              <p className={`${PROSE} mb-3 text-sm text-text-muted`}>
                No token has been created yet, so this mock cannot be called.
              </p>
            )}

            {canManage ? (
              <button
                type="button"
                className={`${SECONDARY} mt-3 py-2 disabled:text-text-muted`}
                disabled={rotate.isPending}
                onClick={() => rotate.mutate()}
              >
                {rotate.isPending
                  ? 'Generating…'
                  : data.tokenHint
                    ? 'Rotate token'
                    : 'Create token'}
              </button>
            ) : null}
          </div>
        ) : null}

        {data.authMode === 'public-link' && data.publicSlug ? (
          <p className={`${PROSE} mb-3 text-sm text-text-muted`}>
            Public link slug: <code>{data.publicSlug}</code>
          </p>
        ) : null}
      </section>

      <section className={PAGE_SECTION}>
        <h2 className="mb-3 text-md">Behaviour</h2>

        <fieldset className="mb-3" disabled={!canManage}>
          <legend className="sr-only">Mock behaviour</legend>

          <label className={`${CHOICE} mb-4`}>
            <input
              type="checkbox"
              checked={data.validateRequests}
              onChange={(event) =>
                update.mutate({ validateRequests: event.target.checked })
              }
            />
            <span>
              Validate incoming requests against the contract
              <span className="block text-sm text-text-muted">
                A request that does not match gets the project error envelope
                with JSON-pointer details. One call can skip it with
                X-Mock-Validate: off.
              </span>
            </span>
          </label>

          <label className={`${FIELD} max-w-80`}>
            <span className="font-medium">Sample data language</span>
            <select
              className="rounded-sm border border-line-control bg-surface-0 p-2 text-text"
              value={data.locale}
              onChange={(event) =>
                update.mutate({ locale: event.target.value as MockLocale })
              }
            >
              <option value="en">English</option>
              <option value="id_ID">Bahasa Indonesia</option>
            </select>
          </label>
        </fieldset>

        {update.isError ? (
          <p className="text-status-danger" role="alert">
            {update.error instanceof RequestError
              ? update.error.message
              : 'That setting did not save.'}
          </p>
        ) : null}
      </section>

      <section className={PAGE_SECTION}>
        <h2 className="mb-3 text-md">Scenarios</h2>
        <p className={`${PROSE} mb-3 text-sm text-text-muted`}>
          Send <code>X-Mock-Scenario: name</code> to switch every endpoint at
          once, so a demo can be coordinated by name.
        </p>

        {scenarios.isPending ? (
          <p className={`${PROSE} mb-3 text-sm text-text-muted`}>
            Loading scenarios…
          </p>
        ) : (
          <ul className={`${PROSE} flex flex-col gap-2`}>
            {(scenarios.data ?? []).map((scenario) => (
              <li
                key={scenario.id}
                className="grid items-baseline gap-1 md:grid-cols-[10rem_1fr] md:gap-3"
              >
                <code className="font-semibold">{scenario.name}</code>
                <span>{scenario.description}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={PAGE_SECTION}>
        <h2 className="mb-3 text-md">Request log</h2>
        <MockRequestLog slug={slug} />
      </section>
    </div>
  );
}
