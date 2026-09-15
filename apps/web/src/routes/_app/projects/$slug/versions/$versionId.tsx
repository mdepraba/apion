import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import {
  accessQuery,
  endpointsQuery,
  environmentsQuery,
  projectQuery,
  resourcesQuery,
  versionsQuery,
} from '../../../../../api/queries.js';
import { ContractTree } from '../../../../../components/ContractTree.js';
import { CreateEndpoint } from '../../../../../components/CreateEndpoint.js';
import { EndpointDetail } from '../../../../../components/EndpointDetail.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../../../components/States.js';
import { VersionBar } from '../../../../../components/VersionBar.js';

/**
 * Which endpoint is open and which environment the statuses are read against
 * both live in the URL. That makes them shareable, survives a reload, and means
 * the browser's back button walks the selection the way a person expects.
 */
const searchSchema = z.object({
  endpoint: z.string().optional(),
  env: z.string().optional(),
});

export const Route = createFileRoute(
  '/_app/projects/$slug/versions/$versionId',
)({
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    // Parallel: none of these depend on each other, and the tree cannot render
    // until all three have arrived anyway.
    await Promise.all([
      context.queryClient.ensureQueryData(projectQuery(params.slug)),
      context.queryClient.ensureQueryData(accessQuery(params.slug)),
      context.queryClient.ensureQueryData(environmentsQuery(params.slug)),
      context.queryClient.ensureQueryData(versionsQuery(params.slug)),
      context.queryClient.ensureQueryData(
        resourcesQuery(params.slug, params.versionId),
      ),
    ]);
  },
  component: WorkspacePage,
});

function WorkspacePage() {
  const { slug, versionId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const project = useQuery(projectQuery(slug));
  const access = useQuery(accessQuery(slug));
  const environments = useQuery(environmentsQuery(slug));
  const versions = useQuery(versionsQuery(slug));
  const resources = useQuery(resourcesQuery(slug, versionId));

  const primaryEnvironment =
    environments.data?.find((environment) => environment.isPrimary) ??
    environments.data?.[0];
  const environmentKey = search.env ?? primaryEnvironment?.key;
  const environment = environments.data?.find((e) => e.key === environmentKey);

  const endpoints = useQuery({
    ...endpointsQuery(slug, versionId, environment?.id),
    enabled: environment !== undefined,
  });

  if (project.isPending || access.isPending || resources.isPending) {
    return <LoadingState what="the contract" />;
  }

  if (project.isError) {
    return (
      <ErrorState error={project.error} retry={() => void project.refetch()} />
    );
  }
  if (access.isError) {
    return (
      <ErrorState error={access.error} retry={() => void access.refetch()} />
    );
  }
  if (resources.isError) {
    return (
      <ErrorState
        error={resources.error}
        retry={() => void resources.refetch()}
      />
    );
  }

  const version = versions.data?.find(
    (candidate) => candidate.id === versionId,
  );
  const canWrite =
    access.data.role === 'editor' ||
    access.data.role === 'maintainer' ||
    access.data.role === 'owner';
  const readOnlyReason = describeReadOnly(
    access.data.role,
    version?.state,
    project.data.lifecycleState,
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <VersionBar
        project={project.data}
        versions={versions.data ?? []}
        currentVersionId={versionId}
        environments={environments.data ?? []}
        currentEnvironmentKey={environmentKey}
        role={access.data.role}
        readOnlyReason={readOnlyReason}
      />

      {/*
        The tree/detail split is the shape of the work: find an endpoint on the
        left, read or change it on the right. It is not a dashboard, so there is
        no stat row above it. Below 900px the two panes stack rather than
        shrink, because a 20rem tree beside a 20rem editor serves neither job.
      */}
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:grid-rows-none">
        <aside
          className="max-h-[40vh] min-h-0 overflow-y-auto border-b border-line bg-surface-1 lg:max-h-none lg:border-r lg:border-b-0"
          aria-label="Contract"
        >
          {resources.data.length === 0 ? (
            <EmptyState
              headline="No resources yet"
              explanation="Endpoints are grouped into resources, which become OpenAPI tags on export. Add one to start describing this API."
            />
          ) : (
            <>
              {/*
                The tree's own header: what the pane holds on the left, the one
                thing you do to it on the right. A square target rather than a
                labelled button, so the list starts higher up the pane; the
                words live on the accessible name and the tooltip. It grows to
                the 44px tap minimum where the pointer is a finger.
              */}
              {canWrite && readOnlyReason === null ? (
                <div className="flex items-center justify-between gap-2 border-b border-line py-2 pr-2 pl-3">
                  <span className="text-xs font-semibold text-text-muted">
                    Endpoints
                  </span>
                  <button
                    type="button"
                    className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-line-control text-base/none text-text-muted hover:bg-surface-2 hover:text-text pointer-coarse:size-11"
                    title="New endpoint"
                    aria-label="New endpoint"
                    onClick={() => setCreating(true)}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              ) : null}

              <ContractTree
                slug={slug}
                versionId={versionId}
                resources={resources.data}
                endpoints={endpoints.data ?? []}
                loading={endpoints.isPending}
                selectedEndpointId={search.endpoint}
              />
            </>
          )}
        </aside>

        <section className="min-h-0 overflow-y-auto" aria-label="Endpoint">
          {search.endpoint ? (
            <EndpointDetail
              slug={slug}
              versionId={versionId}
              endpointId={search.endpoint}
              environments={environments.data ?? []}
              canWrite={canWrite && readOnlyReason === null}
              readOnlyReason={readOnlyReason}
              canWaive={
                access.data.role === 'maintainer' ||
                access.data.role === 'owner'
              }
            />
          ) : (
            <EmptyState
              headline="Nothing selected"
              explanation={
                resources.data.length === 0
                  ? 'Add a resource and an endpoint, and its full definition appears here.'
                  : 'Choose an endpoint from the tree to read or edit its definition.'
              }
            />
          )}
        </section>
      </div>

      {creating ? (
        <CreateEndpoint
          slug={slug}
          versionId={versionId}
          resources={resources.data}
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            // Open what was just made, rather than leaving the author to find it.
            void navigate({
              to: '/projects/$slug/versions/$versionId',
              params: { slug, versionId },
              search: (previous) => ({ ...previous, endpoint: created.id }),
            });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A single sentence explaining why this version cannot be edited, or null when
 * it can. PRD 01 requires the restriction to be explained rather than enforced
 * by a save that silently fails.
 */
function describeReadOnly(
  role: string,
  versionState: string | undefined,
  lifecycleState: string,
): string | null {
  if (lifecycleState === 'archived') {
    return 'This project is archived. Restore it to make changes.';
  }
  if (lifecycleState === 'deleted') {
    return 'This project is deleted. It can be restored within 30 days of deletion.';
  }
  if (versionState === 'published') {
    return 'This version is published and immutable. Create a new version to keep working.';
  }
  if (versionState === 'archived') {
    return 'This version is archived.';
  }
  if (role === 'viewer') {
    return 'Your viewer role is read-only. Ask a project owner for editor access.';
  }
  if (role === 'commenter') {
    return 'Your commenter role can comment but not change the contract. Ask a project owner for editor access.';
  }
  return null;
}
