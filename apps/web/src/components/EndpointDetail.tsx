import type {
  Endpoint,
  Environment,
  UpdateEndpointRequest,
  ViolationRecord,
} from '@apion/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { RequestError, request } from '../api/client.js';
import {
  endpointHistoryQuery,
  endpointQuery,
  endpointStatusQuery,
  envelopeSlotsQuery,
  keys,
  lintQuery,
} from '../api/queries.js';
import {
  ERROR_TEXT,
  FIELD,
  HELP,
  INLINE_BUTTON,
  LABEL,
  MUTED,
  PRIMARY,
  SECONDARY,
  TEXTAREA,
  UNSAVED,
} from '../ui.js';
import { ConflictNotice } from './ConflictNotice.js';

/* The horizontal padding every band of this view shares. */
const GUTTER = 'px-3 sm:px-5';
const SECTION = `${GUTTER} border-t border-line py-5`;
const SECTION_TITLE = 'mb-3 text-sm font-semibold text-text-muted';
/*
 * A disabled fieldset must still be readable, so it dims the chrome rather than
 * the text a reader came to read.
 */
const INPUT_IN_FIELDSET =
  'rounded-md border border-line-control bg-surface-1 px-3 py-2 text-[max(var(--text-base),16px)] text-text group-disabled:cursor-not-allowed group-disabled:border-line';

import { EndpointLine } from './EndpointLine.js';
import { ResponseExamples } from './ResponseExamples.js';
import { ErrorState, LoadingState } from './States.js';
import { StatusBadge } from './StatusBadge.js';
import { ViolationList } from './ViolationList.js';

export function EndpointDetail({
  slug,
  versionId,
  endpointId,
  environments,
  canWrite,
  readOnlyReason,
  canWaive = false,
}: {
  slug: string;
  versionId: string;
  endpointId: string;
  environments: readonly Environment[];
  canWrite: boolean;
  readOnlyReason: string | null;
  /** FR-4.6: only a Maintainer is offered the waiver control. */
  canWaive?: boolean;
}) {
  const queryClient = useQueryClient();
  const endpoint = useQuery(endpointQuery(slug, versionId, endpointId));
  const statuses = useQuery(endpointStatusQuery(slug, endpointId));
  const history = useQuery(endpointHistoryQuery(slug, endpointId));
  const lint = useQuery(lintQuery(slug, versionId, endpointId));
  const slots = useQuery(envelopeSlotsQuery(slug));

  const [draft, setDraft] = useState<UpdateEndpointRequest>({});
  /**
   * Edited responses, kept apart from the rest of the draft so the ids the
   * server assigned stay typed as present: the update contract makes an id
   * optional to allow a new response, which is not what these are.
   */
  const [responseDraft, setResponseDraft] = useState<
    Endpoint['responses'] | null
  >(null);
  const [conflict, setConflict] = useState<RequestError | null>(null);
  const [waiving, setWaiving] = useState<ViolationRecord | null>(null);

  // Switching endpoints must not carry the previous one's unsaved edits, and a
  // fresh server copy means any conflict being shown is no longer current.
  // `endpointId` is watched, not read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on change
  useEffect(() => {
    setDraft({});
    setResponseDraft(null);
    setConflict(null);
    setWaiving(null);
  }, [endpointId]);

  const save = useMutation({
    mutationFn: (patch: UpdateEndpointRequest) =>
      request<Endpoint>(
        `/projects/${slug}/versions/${versionId}/endpoints/${endpointId}`,
        {
          method: 'PATCH',
          body: patch,
          entityVersion: endpoint.data?.entityVersion,
        },
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(
        keys.endpoint(slug, versionId, endpointId),
        saved,
      );
      // The tree row shows path, summary and deprecation, so it is now stale.
      void queryClient.invalidateQueries({
        queryKey: ['projects', slug, 'versions', versionId, 'endpoints'],
      });
      // The save may have changed what the standard has to say about it.
      void queryClient.invalidateQueries({
        queryKey: keys.lint(slug, versionId, endpointId),
      });
      setDraft({});
      setResponseDraft(null);
      setConflict(null);
    },
    onError: (error) => {
      if (error instanceof RequestError && error.isConflict) setConflict(error);
    },
  });

  const waive = useMutation({
    mutationFn: (input: { ruleId: string; justification: string }) =>
      request<unknown>(`/projects/${slug}/standard/exemptions`, {
        method: 'POST',
        body: { endpointId, ...input },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.lint(slug, versionId, endpointId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.standardHealth(slug),
      });
    },
  });

  if (endpoint.isPending) return <LoadingState what="this endpoint" />;
  if (endpoint.isError) {
    return (
      <ErrorState
        error={endpoint.error}
        retry={() => void endpoint.refetch()}
      />
    );
  }

  const current = endpoint.data;
  const value = <K extends keyof UpdateEndpointRequest>(
    key: K,
  ): UpdateEndpointRequest[K] =>
    draft[key] !== undefined
      ? draft[key]
      : (current[key as keyof Endpoint] as UpdateEndpointRequest[K]);

  const editable = canWrite;
  const dirty = Object.keys(draft).length > 0 || responseDraft !== null;

  // Responses come from the draft once one has been touched, so an edit to an
  // example shows immediately instead of after a round trip.
  const responses = responseDraft ?? current.responses;

  /** Replaces one example's value, leaving every other response untouched. */
  const editExample = (
    responseId: string,
    exampleId: string,
    value: unknown,
  ) => {
    setResponseDraft(
      responses.map((response) =>
        response.id !== responseId
          ? response
          : {
              ...response,
              examples: response.examples.map((example) =>
                example.id === exampleId ? { ...example, value } : example,
              ),
            },
      ),
    );
  };

  return (
    <article className="max-w-208 pb-12">
      <header
        className={`${GUTTER} sticky top-0 z-1 flex flex-wrap items-baseline justify-between gap-3 border-b border-line bg-surface-0 py-4`}
      >
        <EndpointLine method={current.method} path={current.path} size="lg" />
        <div className="flex flex-wrap gap-3">
          {statuses.data?.map((status) => {
            const environment = environments.find(
              (e) => e.id === status.environmentId,
            );
            if (!environment) return null;
            return (
              <span
                key={status.environmentId}
                className="inline-flex items-center gap-2"
              >
                <span className="text-xs text-text-muted">
                  {environment.name}
                </span>
                <StatusBadge status={status.status} />
              </span>
            );
          })}
        </div>
      </header>

      {conflict?.conflict ? (
        <ConflictNotice
          conflict={conflict.conflict}
          onReload={() => {
            setConflict(null);
            setDraft({});
            setResponseDraft(null);
            void endpoint.refetch();
          }}
        />
      ) : null}

      <form
        className={`${GUTTER} py-5`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty) return;
          save.mutate(
            responseDraft ? { ...draft, responses: responseDraft } : draft,
          );
        }}
      >
        <fieldset className="group flex flex-col gap-4" disabled={!editable}>
          {/* A disabled fieldset is invisible to a screen reader without this. */}
          <legend className="sr-only">Endpoint definition</legend>

          <label className={FIELD}>
            <span className={LABEL}>Summary</span>
            <input
              className={INPUT_IN_FIELDSET}
              value={value('summary') ?? ''}
              maxLength={200}
              onChange={(event) =>
                setDraft({ ...draft, summary: event.target.value })
              }
            />
          </label>

          <label className={FIELD}>
            <span className={LABEL}>Path</span>
            <input
              className={`${INPUT_IN_FIELDSET} font-mono text-sm`}
              value={value('path') ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, path: event.target.value })
              }
            />
            <span className={HELP}>
              Path parameters come from {'{braces}'}. Routes under /api, /mock
              and /__mock are reserved by the platform.
            </span>
          </label>

          <label className={FIELD}>
            <span className={LABEL}>Description</span>
            <textarea
              className={`${TEXTAREA} group-disabled:border-line`}
              rows={4}
              value={value('description') ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
            <span className={HELP}>Markdown.</span>
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-8 items-center gap-2">
              <input
                type="checkbox"
                checked={value('deprecated') ?? false}
                onChange={(event) =>
                  setDraft({ ...draft, deprecated: event.target.checked })
                }
              />
              <span>Deprecated</span>
            </label>

            <label className="inline-flex min-h-8 items-center gap-2">
              <input
                type="checkbox"
                checked={value('authRequired') ?? true}
                onChange={(event) =>
                  setDraft({ ...draft, authRequired: event.target.checked })
                }
              />
              <span>Requires authentication</span>
            </label>
          </div>
        </fieldset>

        {save.isError && !conflict ? (
          <p className={`${ERROR_TEXT} mt-4`} role="alert">
            {save.error instanceof RequestError
              ? save.error.message
              : 'The save did not go through.'}
          </p>
        ) : null}

        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className={PRIMARY}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
            {dirty ? (
              <>
                <button
                  type="button"
                  className={SECONDARY}
                  onClick={() => {
                    setDraft({});
                    setResponseDraft(null);
                  }}
                >
                  Discard
                </button>
                {/* Amber's other job: unsaved state. */}
                <span className={UNSAVED}>Unsaved changes</span>
              </>
            ) : null}
          </div>
        ) : (
          <p className={`${MUTED} mt-5`}>
            {readOnlyReason ?? 'This endpoint is read-only for you.'}
          </p>
        )}
      </form>

      <section className={SECTION}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className={SECTION_TITLE}>Response standard</h2>
          {lint.data ? (
            <span className={MUTED}>
              Checked against v{lint.data.standardVersion}
            </span>
          ) : null}
        </div>

        {lint.isPending ? (
          <p className={MUTED}>Checking against the standard…</p>
        ) : lint.isError ? (
          <p className={MUTED}>
            The standard could not be checked just now.{' '}
            <button
              type="button"
              className={INLINE_BUTTON}
              onClick={() => void lint.refetch()}
            >
              Try again
            </button>
          </p>
        ) : lint.data && !lint.data.rulesEnabled ? (
          // Not the same claim as a clean endpoint, so it does not say so.
          <p className={MUTED}>
            This project has its rules switched off, so endpoints are not
            checked against the standard.{' '}
            <Link
              to="/projects/$slug/standard"
              params={{ slug }}
              className="text-text underline"
            >
              Response standard
            </Link>
          </p>
        ) : lint.data ? (
          <>
            {lint.data.blocked ? (
              <p
                className="mb-3 rounded-sm border-l-3 border-status-danger bg-surface-1 px-3 py-2 text-text"
                role="status"
              >
                This endpoint cannot be approved or published until the errors
                below are fixed or waived.
              </p>
            ) : null}

            <ViolationList
              violations={lint.data.violations}
              onWaive={
                canWaive
                  ? (violation: ViolationRecord) => setWaiving(violation)
                  : undefined
              }
            />

            {waiving ? (
              <WaiverForm
                ruleId={waiving.ruleId}
                pending={waive.isPending}
                error={
                  waive.error instanceof RequestError
                    ? waive.error.message
                    : null
                }
                onCancel={() => setWaiving(null)}
                onSubmit={(justification) =>
                  waive.mutate(
                    { ruleId: waiving.ruleId, justification },
                    { onSuccess: () => setWaiving(null) },
                  )
                }
              />
            ) : null}
          </>
        ) : null}
      </section>

      {/*
        The responses, as the bodies they produce. A status code is a fact about
        a response rather than a caption for it, so it sits on the row that
        identifies the response and the body starts immediately underneath.
      */}
      <section className={SECTION}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className={SECTION_TITLE}>Responses</h2>
          {/*
            The save lives here as well as at the top of the page, because an
            example is edited down here and the other button is by then a long
            way up. Both drive the same save.
          */}
          {editable && responseDraft !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className={UNSAVED}>Unsaved changes</span>
              <button
                type="button"
                className={PRIMARY}
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({ ...draft, responses: responseDraft })
                }
              >
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                className={SECONDARY}
                onClick={() => setResponseDraft(null)}
              >
                Discard
              </button>
            </span>
          ) : null}
        </div>

        {/*
          A save started from this section fails here too. The conflict case is
          already answered by the notice at the top of the page, which carries
          the server's copy alongside yours.
        */}
        {save.isError && !conflict && responseDraft !== null ? (
          <p className={`${ERROR_TEXT} mt-4`} role="alert">
            {save.error instanceof RequestError
              ? save.error.message
              : 'The save did not go through.'}
          </p>
        ) : null}
        {responses.length === 0 ? (
          <p className={MUTED}>
            No responses declared yet. An endpoint needs at least one before its
            version can be published.
          </p>
        ) : (
          <ul>
            {responses.map((response) => (
              <li
                key={response.id}
                className="min-w-0 border-b border-line py-3 text-sm last:border-b-0"
              >
                <code className="mb-1 block font-mono font-semibold">
                  {response.statusCode}
                </code>
                <ResponseExamples
                  response={response}
                  envelope={slots.data?.envelope}
                  slots={slots.data?.slots ?? []}
                  editable={editable}
                  onChange={(exampleId, value) =>
                    editExample(response.id, exampleId, value)
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={SECTION}>
        <h2 className={SECTION_TITLE}>Status history</h2>
        {history.isPending ? (
          <p className={MUTED}>Loading history…</p>
        ) : history.data && history.data.length > 0 ? (
          <ol>
            {history.data.slice(0, 20).map((event) => {
              const environment = environments.find(
                (e) => e.id === event.environmentId,
              );
              return (
                <li
                  key={event.id}
                  className="flex min-h-(--spacing-row) items-center gap-3 border-b border-line py-1 text-sm last:border-b-0 [&_time]:ml-auto [&_time]:tabular-nums"
                >
                  <StatusBadge status={event.status} />
                  <span className={MUTED}>
                    {environment?.name ?? 'Unknown'}
                  </span>
                  <span className={MUTED}>
                    {event.actorName ??
                      (event.changedVia === 'ci' ? 'CI' : 'Unknown')}
                  </span>
                  <time className={MUTED} dateTime={event.changedAt}>
                    {new Date(event.changedAt).toLocaleString()}
                  </time>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={MUTED}>
            Nothing recorded yet. Status changes from the UI and from
            deployments both appear here.
          </p>
        )}
      </section>
    </article>
  );
}

/**
 * FR-4.6: "A Maintainer may waive a rule for one endpoint only with mandatory
 * justification." The justification is the point of the form, so it is the
 * form: there is no way to waive without writing one, and the text says where
 * it will be visible afterwards.
 */
function WaiverForm({
  ruleId,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  ruleId: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (justification: string) => void;
}) {
  const [justification, setJustification] = useState('');
  const tooShort = justification.trim().length < 10;

  return (
    <form
      className="mt-3 rounded-md border border-accent bg-surface-1 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooShort) onSubmit(justification.trim());
      }}
    >
      <label className={FIELD}>
        <span className={LABEL}>Why may this endpoint break {ruleId}?</span>
        <textarea
          className={TEXTAREA}
          rows={3}
          // Focused on mount so the keyboard path reaches the field the button
          // opened, rather than leaving the reader to hunt for it.
          // biome-ignore lint/a11y/noAutofocus: opened by an explicit action
          autoFocus
          value={justification}
          onChange={(event) => setJustification(event.target.value)}
        />
        <span className={HELP}>
          Recorded against your name and listed in project health for as long as
          the waiver applies.
        </span>
      </label>

      {error ? (
        <p className={`${ERROR_TEXT} mt-4`} role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className={PRIMARY}
          disabled={tooShort || pending}
        >
          {pending ? 'Waiving…' : `Waive ${ruleId}`}
        </button>
        <button type="button" className={SECONDARY} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
