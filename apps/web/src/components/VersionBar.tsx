import type {
  ContractVersion,
  Environment,
  Project,
  ProjectRole,
} from '@apion/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { Breadcrumb } from './Breadcrumb.js';

const CONTROL = 'flex items-center gap-2';
const CONTROL_LABEL = 'text-xs whitespace-nowrap text-text-muted';
/* 36px on a touch screen, 28px once there is a pointer: density is the default
   but a finger still needs the target. */
const SELECT =
  'min-h-9 rounded-md border border-line-control bg-surface-1 px-2 text-[max(var(--text-sm),16px)] text-text sm:min-h-7';
const SECTION_LINK =
  'rounded-sm border border-transparent px-2 py-1 text-sm text-text no-underline hover:border-line-control hover:bg-surface-2';

/**
 * The context strip: which project, which version, which environment the
 * statuses below are read against. FR-3.2 makes the environment a first-class
 * choice, so it sits here rather than being buried in the endpoint pane.
 */
export function VersionBar({
  project,
  versions,
  currentVersionId,
  environments,
  currentEnvironmentKey,
  role,
  readOnlyReason,
}: {
  project: Project;
  versions: readonly ContractVersion[];
  currentVersionId: string;
  environments: readonly Environment[];
  currentEnvironmentKey: string | undefined;
  role: ProjectRole;
  readOnlyReason: string | null;
}) {
  const navigate = useNavigate();
  const current = versions.find((version) => version.id === currentVersionId);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-0 px-3 py-2 sm:gap-x-4 sm:gap-y-3 sm:px-4">
      {/* The contract is the project, so the project name is where you are. */}
      <Breadcrumb project={project} />

      <label className={CONTROL}>
        <span className={CONTROL_LABEL}>Version</span>
        <select
          className={SELECT}
          value={currentVersionId}
          onChange={(event) =>
            void navigate({
              to: '/projects/$slug/versions/$versionId',
              params: { slug: project.slug, versionId: event.target.value },
              // The open endpoint belongs to the version being left, so the
              // selection is dropped rather than carried to a stale id.
              search: (previous) => ({ ...previous, endpoint: undefined }),
            })
          }
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}
              {version.state === 'published' ? ' (published)' : ''}
              {version.state === 'archived' ? ' (archived)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className={CONTROL}>
        <span className={CONTROL_LABEL}>Status in</span>
        <select
          className={SELECT}
          value={currentEnvironmentKey ?? ''}
          onChange={(event) =>
            void navigate({
              to: '/projects/$slug/versions/$versionId',
              params: { slug: project.slug, versionId: currentVersionId },
              search: (previous) => ({ ...previous, env: event.target.value }),
            })
          }
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.key}>
              {environment.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3 sm:ml-auto">
        {current?.state === 'published' ? (
          <span className="text-xs text-text-muted">Published, immutable</span>
        ) : null}

        <Link
          to="/projects/$slug/standard"
          params={{ slug: project.slug }}
          className={SECTION_LINK}
        >
          Standard
        </Link>
        <Link
          to="/projects/$slug/mock"
          params={{ slug: project.slug }}
          className={SECTION_LINK}
        >
          Mock
        </Link>
        <Link
          to="/projects/$slug/members"
          params={{ slug: project.slug }}
          className={SECTION_LINK}
        >
          Members
        </Link>

        <span className="rounded-sm border border-line-control px-2 text-xs text-text-muted capitalize">
          {role}
        </span>
      </div>

      {/*
        PRD 01: the restriction is explained where the reader is about to try to
        edit, not discovered when a save fails.
      */}
      {readOnlyReason ? (
        <p
          /*
            Amber marks the one thing the reader needs to know before they try
            to type: this cannot be edited, and here is why.
          */
          className="basis-full rounded-md border border-accent bg-accent-quiet px-3 py-2 text-sm text-text"
          role="status"
        >
          {readOnlyReason}
        </p>
      ) : null}
    </div>
  );
}
