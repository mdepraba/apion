import type { CreateProjectRequest, Project } from '@apion/contracts';
import { slugify } from '@apion/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { request } from '../../api/client.js';
import { keys, projectsQuery } from '../../api/queries.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../components/States.js';
import {
  ERROR_TEXT,
  FIELD,
  HELP,
  LABEL,
  PRIMARY,
  SECONDARY,
} from '../../ui.js';

/* A page of prose and lists rather than a workspace, so it is centred and
   capped at a comfortable measure. */
const PAGE = 'mx-auto max-w-240 px-3 pt-5 pb-8 sm:px-5 sm:pt-8 sm:pb-12';
const INPUT_ON_PANEL =
  'rounded-md border border-line-control bg-surface-0 px-3 py-2 text-[max(var(--text-base),16px)] text-text';

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQuery()),
  component: ProjectsPage,
});

function ProjectsPage() {
  const projects = useQuery(projectsQuery());
  const [creating, setCreating] = useState(false);

  if (projects.isPending) return <LoadingState what="your projects" />;
  if (projects.isError) {
    return (
      <ErrorState
        error={projects.error}
        retry={() => void projects.refetch()}
      />
    );
  }

  const active = projects.data.filter((p) => p.lifecycleState === 'active');
  const inactive = projects.data.filter((p) => p.lifecycleState !== 'active');

  return (
    <div className={PAGE}>
      <div className="mb-5 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <h1>Projects</h1>
        <button
          type="button"
          className={PRIMARY}
          onClick={() => setCreating(true)}
        >
          New project
        </button>
      </div>

      {creating ? (
        <CreateProjectForm onDone={() => setCreating(false)} />
      ) : null}

      {active.length === 0 && !creating ? (
        <EmptyState
          headline="No projects yet"
          explanation="A project holds one API surface: its contract, its response standard, its environments and its mock."
          action={
            <button
              type="button"
              className={PRIMARY}
              onClick={() => setCreating(true)}
            >
              Create the first project
            </button>
          }
        />
      ) : (
        <ul className="rounded-md border border-line">
          {active.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}

      {inactive.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-3 text-sm font-semibold text-text-muted">
            Archived and deleted
          </h2>
          <ul className="rounded-md border border-line">
            {inactive.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <Link
        to="/projects/$slug"
        params={{ slug: project.slug }}
        className="group flex items-baseline gap-3 text-text no-underline"
      >
        <span className="font-semibold group-hover:underline">
          {project.name}
        </span>
        <code className="text-xs text-text-muted">{project.slug}</code>
      </Link>
      {project.lifecycleState !== 'active' ? (
        <span className="mt-1 inline-block rounded-sm border border-status-retired px-2 text-xs text-status-retired">
          {project.lifecycleState === 'archived' ? 'Archived' : 'Deleted'}
        </span>
      ) : null}
      {project.description ? (
        <p className="mt-1 text-sm text-text-muted">{project.description}</p>
      ) : null}
    </li>
  );
}

function CreateProjectForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Once someone edits the slug it stops tracking the name, so their choice is
  // not overwritten by the next keystroke in the name field.
  const [slugEdited, setSlugEdited] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // The form opens in response to a click, so focus follows it there. Done with
  // a ref rather than `autoFocus`, which would also steal focus on a restored
  // page where the reader never asked for this form.
  useEffect(() => nameRef.current?.focus(), []);

  const create = useMutation({
    mutationFn: (body: CreateProjectRequest) =>
      request<Project>('/projects', { method: 'POST', body }),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: keys.projects });
      await navigate({ to: '/projects/$slug', params: { slug: project.slug } });
    },
  });

  const effectiveSlug = slugEdited ? slug : slugify(name);

  return (
    <form
      className="mb-5 flex flex-col gap-4 rounded-md border border-line bg-surface-1 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({
          name,
          slug: effectiveSlug,
          visibility: 'organisation',
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={FIELD}>
          <span className={LABEL}>Name</span>
          <input
            ref={nameRef}
            className={INPUT_ON_PANEL}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
          />
        </label>

        <label className={FIELD}>
          <span className={LABEL}>Slug</span>
          <input
            className={INPUT_ON_PANEL}
            value={effectiveSlug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(event.target.value);
            }}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={64}
          />
          <span className={HELP}>
            Part of the mock URL, so changing it later redirects consumers.
          </span>
        </label>
      </div>

      {create.isError ? (
        <p className={`${ERROR_TEXT} text-sm`} role="alert">
          {create.error instanceof Error
            ? create.error.message
            : 'That did not work.'}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create project'}
        </button>
        <button type="button" className={SECONDARY} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
