import type { ProjectMember, ProjectRole } from '@apion/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { RequestError, request } from '../../../../api/client.js';
import {
  accessQuery,
  keys,
  membersQuery,
  projectQuery,
  sessionQuery,
} from '../../../../api/queries.js';
import { Breadcrumb } from '../../../../components/Breadcrumb.js';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../../components/States.js';
import {
  FIELD,
  HELP,
  MUTED,
  PAGE_HEADER,
  PAGE_SCROLL,
  PAGE_SECTION,
  PRIMARY,
  TABLE,
  TABLE_WRAP,
} from '../../../../ui.js';

const SELECT_FULL =
  'w-full min-w-0 max-w-full rounded-sm border border-line-control bg-surface-0 p-2 text-sm text-text';

/**
 * PRD 01 FR-1.1's roles, as a page. The decision here is who can do what on
 * this project, so each role says what it permits rather than leaving a reader
 * to infer it from the name.
 */
export const Route = createFileRoute('/_app/projects/$slug/members')({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectQuery(params.slug)),
      context.queryClient.ensureQueryData(accessQuery(params.slug)),
      context.queryClient.ensureQueryData(membersQuery(params.slug)),
    ]);
  },
  component: MembersPage,
});

const ROLES: { id: ProjectRole; name: string; can: string }[] = [
  { id: 'viewer', name: 'Viewer', can: 'Read the contract and its history.' },
  {
    id: 'commenter',
    name: 'Commenter',
    can: 'Read and comment, but not change the contract.',
  },
  {
    id: 'editor',
    name: 'Editor',
    can: 'Author endpoints and schemas, and update delivery status.',
  },
  {
    id: 'maintainer',
    name: 'Maintainer',
    can: 'Everything an editor can, plus publish versions, edit the response standard and waive rules.',
  },
  {
    id: 'owner',
    name: 'Owner',
    can: 'Everything, including managing members and deleting the project.',
  },
];

interface Candidate {
  id: string;
  displayName: string;
  email: string;
}

function MembersPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();

  const project = useQuery(projectQuery(slug));
  const access = useQuery(accessQuery(slug));
  const members = useQuery(membersQuery(slug));
  const session = useQuery(sessionQuery());

  const canManage = access.data?.role === 'owner';

  const candidates = useQuery({
    queryKey: [...keys.members(slug), 'candidates'],
    queryFn: () => request<Candidate[]>(`/projects/${slug}/members/candidates`),
    enabled: canManage,
  });

  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<ProjectRole>('editor');

  const upsert = useMutation({
    mutationFn: (body: { userId: string; role: ProjectRole }) =>
      request<ProjectMember>(`/projects/${slug}/members`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.members(slug) });
      setAddUserId('');
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      request<void>(`/projects/${slug}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.members(slug) });
    },
  });

  if (members.isPending) return <LoadingState what="the project members" />;
  if (members.isError) {
    return (
      <ErrorState error={members.error} retry={() => void members.refetch()} />
    );
  }

  const existing = new Set(members.data.map((member) => member.userId));
  const addable = (candidates.data ?? []).filter(
    (person) => !existing.has(person.id),
  );

  // An owner removing their own last owner role would lock the project.
  const owners = members.data.filter((member) => member.role === 'owner');

  return (
    <div className={PAGE_SCROLL}>
      <header className={PAGE_HEADER}>
        {project.data ? (
          <Breadcrumb project={project.data} page="Members" />
        ) : null}
      </header>

      {!canManage ? (
        <p className="border-b border-line px-3 py-3 text-text-muted sm:px-5">
          Your {access.data?.role} role can see who has access but not change
          it. A project owner manages members.
        </p>
      ) : null}

      <section className={PAGE_SECTION}>
        {members.data.length === 0 ? (
          <EmptyState
            headline="Nobody has access yet"
            explanation="Add someone from your organisation to let them read or edit this contract."
          />
        ) : (
          <div className={TABLE_WRAP}>
            <table className={`${TABLE} [&_td:nth-child(2)]:min-w-36`}>
              <caption className="sr-only">
                People with access to this project
              </caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Role</th>
                  <th scope="col">Added</th>
                  {canManage ? (
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {members.data.map((member) => {
                  const isSelf = member.userId === session.data?.id;
                  const isLastOwner =
                    member.role === 'owner' && owners.length === 1;

                  return (
                    <tr key={member.userId}>
                      <td>
                        <span className="block font-medium">
                          {member.displayName}
                          {isSelf ? (
                            <span className="font-normal text-text-muted">
                              {' '}
                              (you)
                            </span>
                          ) : null}
                        </span>
                        <span className="block [overflow-wrap:anywhere] text-text-muted">
                          {member.email}
                        </span>
                      </td>
                      <td>
                        {canManage && !isLastOwner ? (
                          <select
                            className={SELECT_FULL}
                            aria-label={`Role for ${member.displayName}`}
                            value={member.role}
                            disabled={upsert.isPending}
                            onChange={(event) =>
                              upsert.mutate({
                                userId: member.userId,
                                role: event.target.value as ProjectRole,
                              })
                            }
                          >
                            {ROLES.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="whitespace-nowrap">
                            {ROLES.find((role) => role.id === member.role)
                              ?.name ?? member.role}
                          </span>
                        )}
                      </td>
                      <td className={MUTED}>
                        <time dateTime={member.addedAt}>
                          {new Date(member.addedAt).toLocaleDateString()}
                        </time>
                      </td>
                      {canManage ? (
                        <td>
                          {isLastOwner ? (
                            <span className={MUTED}>
                              The last owner cannot be removed
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="cursor-pointer rounded-sm border border-line-control px-2 py-1 text-sm whitespace-nowrap text-text not-disabled:hover:border-status-danger not-disabled:hover:text-status-danger"
                              disabled={remove.isPending}
                              onClick={() => remove.mutate(member.userId)}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {upsert.isError || remove.isError ? (
          <p className="mt-3 text-status-danger" role="alert">
            {describeError(upsert.error ?? remove.error)}
          </p>
        ) : null}
      </section>

      {canManage ? (
        <section className={PAGE_SECTION}>
          <h2 className="mb-3 text-md">Add someone</h2>

          {addable.length === 0 ? (
            <p className={MUTED}>
              {candidates.isPending
                ? 'Loading your organisation…'
                : 'Everyone in your organisation already has access to this project.'}
            </p>
          ) : (
            <form
              className="flex max-w-256 flex-wrap items-start gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (addUserId)
                  upsert.mutate({ userId: addUserId, role: addRole });
              }}
            >
              <label className={`${FIELD} min-w-0 flex-[1_1_16rem]`}>
                <span className="font-medium">Person</span>
                <select
                  className={SELECT_FULL}
                  value={addUserId}
                  onChange={(event) => setAddUserId(event.target.value)}
                >
                  <option value="">Choose someone…</option>
                  {addable.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName} ({person.email})
                    </option>
                  ))}
                </select>
              </label>

              <label className={`${FIELD} min-w-0 flex-[1_1_16rem]`}>
                <span className="font-medium">Role</span>
                <select
                  className={SELECT_FULL}
                  value={addRole}
                  onChange={(event) =>
                    setAddRole(event.target.value as ProjectRole)
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                <span className={`${HELP} max-w-[40ch]`}>
                  {ROLES.find((role) => role.id === addRole)?.can}
                </span>
              </label>

              <button
                type="submit"
                className={`${PRIMARY} py-2 md:mt-[1.6rem]`}
                disabled={addUserId === '' || upsert.isPending}
              >
                {upsert.isPending ? 'Adding…' : 'Add to project'}
              </button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof RequestError) return error.message;
  return 'That change did not go through.';
}
