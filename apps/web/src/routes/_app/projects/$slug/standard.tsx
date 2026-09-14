import type {
  NamingConventionValue,
  ResponseStandardRecord,
  RuleIdValue,
  RuleSeverityValue,
  StandardDefinition,
  StandardPreset,
} from '@apion/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { RequestError, request } from '../../../../api/client.js';
import {
  accessQuery,
  keys,
  projectQuery,
  standardDraftQuery,
  standardQuery,
} from '../../../../api/queries.js';
import { Breadcrumb } from '../../../../components/Breadcrumb.js';
import { EnvelopePreview } from '../../../../components/EnvelopePreview.js';
import { ErrorState, LoadingState } from '../../../../components/States.js';
import {
  INLINE_BUTTON,
  MUTED,
  PAGE_HEADER,
  PRIMARY,
  SECONDARY,
  UNSAVED,
} from '../../../../ui.js';

/*
 * Every control on this page sits on the deeper surface, because the editor
 * pane it lives in is already raised.
 */
const CONTROL =
  'w-full rounded-sm border border-line-control bg-surface-0 p-2 text-text';
const MONO_CONTROL = `${CONTROL} resize-y font-mono text-sm`;
const GROUP = 'mb-8 max-w-3xl';
const GROUP_TITLE =
  'mb-2 border-b border-line pb-1 text-sm font-semibold text-text-muted';
const FIELD_COL = 'flex flex-col gap-1';

/**
 * PRD 03's editor. The job here is deciding what this project's responses look
 * like, so the page is the standard itself with its consequence beside it: the
 * envelope on the left, the wire shape it produces on the right.
 */
export const Route = createFileRoute('/_app/projects/$slug/standard')({
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(projectQuery(params.slug)),
      context.queryClient.ensureQueryData(accessQuery(params.slug)),
      context.queryClient.ensureQueryData(standardQuery(params.slug)),
    ]);
  },
  component: StandardPage,
});

const RULE_LABELS: Record<RuleIdValue, string> = {
  RS001: 'Every response fills every envelope slot',
  RS002: 'Property naming follows the convention',
  RS003: 'A failure says what went wrong',
  RS004: 'Error codes come from the registry',
  RS005: 'Status codes are allowed for their method',
  RS006: 'Collections carry the pagination shape',
  RS007: 'Date and time fields use the project format',
  RS008: 'Required response headers are declared',
  RS009: 'Every allowed error class has a response',
  RS010: 'Path segments follow the naming rules',
};

const RULE_IDS = Object.keys(RULE_LABELS) as RuleIdValue[];

const PRESET_LABELS: { id: StandardPreset; name: string; summary: string }[] = [
  {
    id: 'simple',
    name: 'Simple',
    summary: 'A status code, a message and the data.',
  },
  {
    id: 'jsonapi',
    name: 'JSON:API',
    summary: 'Data, errors and meta, as JSON:API documents carry them.',
  },
  {
    id: 'problem-details',
    name: 'RFC 9457',
    summary: 'Type, title, status and detail beside the data.',
  },
  {
    id: 'google',
    name: 'Google',
    summary: 'Data beside an error object, with snake_case fields.',
  },
  {
    id: 'none',
    name: 'None',
    summary: 'The payload alone, every rule off. For an API that exists.',
  },
];

const NAMING_OPTIONS: NamingConventionValue[] = [
  'camelCase',
  'snake_case',
  'kebab-case',
  'PascalCase',
];

function StandardPage() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();

  const project = useQuery(projectQuery(slug));
  const access = useQuery(accessQuery(slug));
  const active = useQuery(standardQuery(slug));

  const canWrite =
    access.data?.role === 'maintainer' || access.data?.role === 'owner';

  // The draft is created by reading it, so only a Maintainer asks for one.
  const draft = useQuery({ ...standardDraftQuery(slug), enabled: canWrite });

  const [edits, setEdits] = useState<Partial<StandardDefinition>>({});
  const [conflict, setConflict] = useState<string | null>(null);

  const source = draft.data ?? active.data;

  // A save or publish replaces the draft, so edits on top of the old copy are
  // no longer meaningful. `entityVersion` is watched, not read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on save
  useEffect(() => {
    setEdits({});
  }, [draft.data?.entityVersion]);

  const save = useMutation({
    mutationFn: (definition: Partial<StandardDefinition>) =>
      request<ResponseStandardRecord>(`/projects/${slug}/standard/draft`, {
        method: 'PATCH',
        body: { definition },
        entityVersion: draft.data?.entityVersion,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.standardDraft(slug), saved);
      setConflict(null);
    },
    onError: (error) => {
      if (error instanceof RequestError && error.isConflict) {
        setConflict(error.message);
      }
    },
  });

  const applyPreset = useMutation({
    mutationFn: (preset: StandardPreset) =>
      request<ResponseStandardRecord>(
        `/projects/${slug}/standard/draft/preset`,
        {
          method: 'POST',
          body: { preset },
          entityVersion: draft.data?.entityVersion,
        },
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.standardDraft(slug), saved);
      setEdits({});
    },
  });

  const publish = useMutation({
    mutationFn: () =>
      request<ResponseStandardRecord>(`/projects/${slug}/standard/publish`, {
        method: 'POST',
        entityVersion: draft.data?.entityVersion,
      }),
    onSuccess: (published) => {
      queryClient.setQueryData(keys.standard(slug), published);
      void queryClient.invalidateQueries({
        queryKey: ['projects', slug, 'standard'],
      });
      setEdits({});
    },
  });

  if (project.isPending || active.isPending) {
    return <LoadingState what="the response standard" />;
  }

  if (active.isError) {
    return (
      <ErrorState error={active.error} retry={() => void active.refetch()} />
    );
  }

  if (!source) return <LoadingState what="the response standard" />;

  const definition: StandardDefinition = { ...source.definition, ...edits };
  const dirty = Object.keys(edits).length > 0;

  // A standard stored before this switch existed was being enforced, so an
  // absent value reads as on rather than silently turning a project's checks off.
  const rulesEnabled = definition.rulesEnabled !== false;
  const change = <K extends keyof StandardDefinition>(
    key: K,
    value: StandardDefinition[K],
  ) => setEdits((previous) => ({ ...previous, [key]: value }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className={PAGE_HEADER}>
        {project.data ? (
          <Breadcrumb project={project.data} page="Response standard" />
        ) : null}

        <p className={MUTED}>
          Active: v{active.data?.version}
          {draft.data && draft.data.entityVersion > 1
            ? ' · unpublished draft'
            : null}
        </p>

        <Link
          to="/projects/$slug/standard-health"
          params={{ slug }}
          className="ml-auto text-sm text-text"
        >
          Project health
        </Link>
      </header>

      {!canWrite ? (
        <p className="border-b border-line px-3 py-3 text-text-muted sm:px-5">
          Your {access.data?.role} role can read the standard but not change it.
          A maintainer can edit and publish it.
        </p>
      ) : null}

      {conflict ? (
        <p
          className="border-b border-accent bg-accent-quiet px-3 py-3 text-text sm:px-5"
          role="alert"
        >
          {conflict}{' '}
          <button
            type="button"
            className={INLINE_BUTTON}
            onClick={() => {
              setConflict(null);
              setEdits({});
              void draft.refetch();
            }}
          >
            Reload the draft
          </button>
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <form
          className="min-h-0 overflow-y-auto p-3 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty) save.mutate(edits);
          }}
        >
          <fieldset disabled={!canWrite}>
            <legend className="sr-only">Response standard</legend>

            <section className={GROUP}>
              <h2 className={GROUP_TITLE}>Starting point</h2>
              <p className={`${MUTED} mb-3`}>
                A preset fills the fields below. Nothing is locked afterwards.
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESET_LABELS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="flex flex-[1_1_14rem] cursor-pointer flex-col gap-0.5 rounded-md border border-line-control bg-surface-1 px-3 py-2 text-left text-text not-disabled:hover:bg-surface-2 disabled:cursor-default disabled:opacity-60 aria-pressed:border-accent aria-pressed:bg-accent-quiet"
                    aria-pressed={source.preset === preset.id}
                    disabled={!canWrite || applyPreset.isPending}
                    onClick={() => applyPreset.mutate(preset.id)}
                  >
                    <span className="font-semibold">{preset.name}</span>
                    <span className="text-sm text-text-muted">
                      {preset.summary}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className={GROUP}>
              <h2 className={GROUP_TITLE}>Envelope</h2>
              <p className={`${MUTED} mb-3`}>
                Every response this project returns, success and failure alike,
                has this shape. Each $slot becomes a field an endpoint author
                fills in when writing a response example.
              </p>

              <JsonField
                id="envelope"
                label="Response envelope"
                help="Write any $slot_name you need. $data is the slot an endpoint's own schema describes."
                value={definition.envelope}
                onChange={(value) => change('envelope', value)}
              />

              <SlotSummary envelope={definition.envelope} />
            </section>

            <section className={GROUP}>
              <h2 className={GROUP_TITLE}>Naming</h2>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
                <label className={FIELD_COL}>
                  <span className="font-medium">Properties</span>
                  <select
                    className={CONTROL}
                    value={definition.propertyNaming}
                    onChange={(event) =>
                      change(
                        'propertyNaming',
                        event.target.value as NamingConventionValue,
                      )
                    }
                  >
                    {NAMING_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={FIELD_COL}>
                  <span className="font-medium">Path segments</span>
                  <select
                    className={CONTROL}
                    value={definition.pathNaming}
                    onChange={(event) =>
                      change(
                        'pathNaming',
                        event.target.value as NamingConventionValue,
                      )
                    }
                  >
                    {NAMING_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className={GROUP}>
              <h2 className={GROUP_TITLE}>Error codes</h2>
              <p className={`${MUTED} mb-3`}>
                RS004 rejects any code outside this list. One per line.
              </p>
              <textarea
                className={MONO_CONTROL}
                rows={6}
                value={definition.errorCodes.join('\n')}
                onChange={(event) =>
                  change(
                    'errorCodes',
                    event.target.value
                      .split('\n')
                      .map((code) => code.trim())
                      .filter((code) => code.length > 0),
                  )
                }
              />
            </section>

            <section className={GROUP}>
              <h2 className={GROUP_TITLE}>Pagination and dates</h2>

              <div className="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
                <label className={FIELD_COL}>
                  <span className="font-medium">Pagination</span>
                  <select
                    className={CONTROL}
                    value={definition.pagination.style}
                    onChange={(event) =>
                      change('pagination', {
                        ...definition.pagination,
                        style: event.target
                          .value as StandardDefinition['pagination']['style'],
                      })
                    }
                  >
                    <option value="cursor">Cursor</option>
                    <option value="offset">Offset</option>
                    <option value="page">Page</option>
                    <option value="none">None</option>
                  </select>
                </label>

                <label className={FIELD_COL}>
                  <span className="font-medium">Maximum page size</span>
                  <input
                    className={CONTROL}
                    type="number"
                    min={1}
                    max={1000}
                    value={definition.pagination.maxLimit}
                    onChange={(event) =>
                      change('pagination', {
                        ...definition.pagination,
                        maxLimit: Number(event.target.value) || 1,
                      })
                    }
                  />
                </label>
              </div>

              <label className={FIELD_COL}>
                <span className="font-medium">Date format</span>
                <select
                  className={CONTROL}
                  value={definition.dateFormat}
                  onChange={(event) =>
                    change(
                      'dateFormat',
                      event.target.value as StandardDefinition['dateFormat'],
                    )
                  }
                >
                  <option value="rfc3339">RFC 3339 timestamp</option>
                  <option value="iso8601-date">ISO 8601 date</option>
                  <option value="unix-seconds">Unix seconds</option>
                </select>
              </label>
            </section>

            {/*
              The whole rule set is one switch, because "is this project linted"
              is the question a team actually argues about. Per-rule severities
              are the answer to a later and rarer question, so they stay put but
              stop taking up the room when nothing is being checked.
            */}
            <section className={GROUP}>
              <h2 className={GROUP_TITLE}>Rules</h2>

              <label className="mb-2 flex cursor-pointer items-center gap-2 [&_input]:size-4 [&_input]:cursor-pointer [&_input]:accent-accent">
                <input
                  type="checkbox"
                  checked={rulesEnabled}
                  onChange={(event) =>
                    change('rulesEnabled', event.target.checked)
                  }
                />
                <span className="font-semibold">
                  Check endpoints against this standard
                </span>
              </label>

              <p className={`${MUTED} mb-3`}>
                {rulesEnabled
                  ? 'An error blocks approval and publication. A warning stays visible without blocking.'
                  : 'Nothing is checked, so nothing blocks approval or publication. Each rule keeps the severity below for whenever this is switched back on.'}
              </p>

              {rulesEnabled ? (
                <ul className="overflow-hidden rounded-md border border-line">
                  {RULE_IDS.map((ruleId) => (
                    <li
                      key={ruleId}
                      className="grid grid-cols-[4rem_1fr_7rem] items-center gap-3 border-b border-line bg-surface-1 px-3 py-2 last:border-b-0"
                    >
                      <code className="font-semibold">{ruleId}</code>
                      <span className="text-sm">{RULE_LABELS[ruleId]}</span>
                      <select
                        className="rounded-sm border border-line-control bg-surface-0 px-2 py-1 text-sm text-text"
                        aria-label={`${ruleId} severity`}
                        value={definition.severities[ruleId] ?? 'error'}
                        onChange={(event) =>
                          change('severities', {
                            ...definition.severities,
                            [ruleId]: event.target.value as RuleSeverityValue,
                          })
                        }
                      >
                        <option value="error">Error</option>
                        <option value="warn">Warning</option>
                        <option value="off">Off</option>
                      </select>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </fieldset>

          {save.isError && !conflict ? (
            <p
              className="mt-3 rounded-md border border-status-danger px-3 py-2 text-status-danger"
              role="alert"
            >
              {save.error instanceof RequestError
                ? save.error.message
                : 'The save did not go through.'}
            </p>
          ) : null}

          {publish.isError ? (
            <p
              className="mt-3 rounded-md border border-status-danger px-3 py-2 text-status-danger"
              role="alert"
            >
              {publish.error instanceof RequestError
                ? publish.error.message
                : 'Publishing did not go through.'}
            </p>
          ) : null}

          {canWrite ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <button
                type="submit"
                className={PRIMARY}
                disabled={!dirty || save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save draft'}
              </button>

              <button
                type="button"
                className={`${SECONDARY} disabled:text-text-muted`}
                disabled={dirty || publish.isPending}
                onClick={() => publish.mutate()}
                title={
                  dirty
                    ? 'Save the draft before publishing it.'
                    : 'Activate this draft for the whole project.'
                }
              >
                {publish.isPending ? 'Publishing…' : 'Publish standard'}
              </button>

              {dirty ? (
                <>
                  <button
                    type="button"
                    className={`${SECONDARY} disabled:text-text-muted`}
                    onClick={() => setEdits({})}
                  >
                    Discard
                  </button>
                  <span className={UNSAVED}>Unsaved changes</span>
                </>
              ) : null}
            </div>
          ) : null}

          <p className={`${MUTED} mt-3 max-w-[60ch]`}>
            Publishing marks every endpoint's lint result stale. Endpoints are
            rechecked as they are opened, or all at once from project health.
          </p>
        </form>

        <aside
          className="min-h-0 overflow-y-auto border-line bg-surface-1 lg:border-l"
          aria-label="Wire shape"
        >
          <EnvelopePreview definition={definition} />
        </aside>
      </div>
    </div>
  );
}

/**
 * A JSON value edited as text. Parsing on every keystroke would fight the
 * author mid-word, so the text is kept as typed and committed when it parses,
 * with the parse error shown rather than the edit refused.
 */
function JsonField({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const serialised = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialised);
  const [problem, setProblem] = useState<string | null>(null);

  // Follows the value when a preset replaces it, without clobbering typing.
  useEffect(() => {
    setText(serialised);
    setProblem(null);
  }, [serialised]);

  return (
    <div className={FIELD_COL}>
      <label className="font-medium" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={`${MONO_CONTROL} aria-invalid:border-status-danger`}
        rows={6}
        spellCheck={false}
        value={text}
        aria-invalid={problem !== null}
        aria-describedby={problem ? `${id}-problem` : `${id}-help`}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onChange(JSON.parse(event.target.value));
            setProblem(null);
          } catch (error) {
            setProblem(
              error instanceof Error
                ? error.message
                : 'That is not valid JSON.',
            );
          }
        }}
      />
      {problem ? (
        <span
          id={`${id}-problem`}
          className="text-sm text-status-danger"
          role="alert"
        >
          {problem}
        </span>
      ) : (
        <span id={`${id}-help`} className="text-text-muted">
          {help}
        </span>
      )}
    </div>
  );
}

/**
 * The slots the envelope currently declares. Editing an envelope is really
 * editing this list, so it is shown next to the field rather than left to be
 * discovered when an author opens an endpoint.
 */
function SlotSummary({ envelope }: { envelope: unknown }) {
  const slots = collectSlots(envelope);

  if (slots.length === 0) {
    return (
      <p className={`${MUTED} mt-2`}>
        This envelope declares no slots, so responses are returned exactly as an
        endpoint author writes them.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-1 p-3">
      <p className={`${MUTED} mb-2`}>
        Endpoint authors will fill {slots.length}{' '}
        {slots.length === 1 ? 'field' : 'fields'} per response:
      </p>
      <ul className="flex flex-col gap-1">
        {slots.map((slot) => (
          <li
            key={slot.token}
            className="flex flex-wrap items-baseline gap-2 text-sm"
          >
            <code className="font-semibold">{slot.token}</code>
            <span className="text-text-muted">
              {slot.isData
                ? "the endpoint's own payload, described by its schema"
                : `written per response, under "${slot.key}"`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SlotInfo {
  token: string;
  key: string;
  isData: boolean;
}

const SLOT_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Mirrors `envelopeSlots` from the response-standard library so the editor can
 * show the effect of a keystroke without a round trip. The server stays
 * authoritative for anything saved, linted or served.
 */
function collectSlots(envelope: unknown): SlotInfo[] {
  const slots: SlotInfo[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, key: string): void => {
    if (typeof node === 'string' && SLOT_PATTERN.test(node)) {
      if (seen.has(node)) return;
      seen.add(node);
      slots.push({
        token: node,
        key,
        isData: node === '$data' || node === '$payload',
      });
      return;
    }
    if (Array.isArray(node)) {
      for (const member of node) walk(member, key);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [childKey, value] of Object.entries(node)) {
      walk(value, childKey);
    }
  };

  walk(envelope, '');
  return slots;
}
