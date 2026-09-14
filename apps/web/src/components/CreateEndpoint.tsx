import type {
  CreateEndpointRequest,
  Endpoint,
  HttpMethod,
  Resource,
} from '@apion/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { RequestError, request } from '../api/client.js';
import { envelopeSlotsQuery, keys } from '../api/queries.js';
import {
  ERROR_TEXT,
  HELP,
  INPUT,
  JSON_INPUT,
  LABEL,
  MUTED,
  PRIMARY,
  SECONDARY,
  SELECT,
} from '../ui.js';
import { EndpointLine } from './EndpointLine.js';
import { Modal } from './Modal.js';
import { SlotFields } from './SlotFields.js';

const FIELD = 'mb-4 flex flex-col gap-1';

const METHODS: HttpMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
];

/**
 * Creating an endpoint, with its first response and example.
 *
 * The example is authored slot by slot, from the project's own response
 * standard: an author fills `$status_code`, `$message`, `$data` and whatever
 * else the project declares, so a new endpoint is publishable and mockable the
 * moment it is saved rather than immediately failing RS001.
 */
export function CreateEndpoint({
  slug,
  versionId,
  resources,
  onCreated,
  onCancel,
}: {
  slug: string;
  versionId: string;
  resources: readonly Resource[];
  onCreated: (endpoint: Endpoint) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();

  const slots = useQuery(envelopeSlotsQuery(slug));

  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const [method, setMethod] = useState<HttpMethod>('get');
  const [path, setPath] = useState('/');
  const [summary, setSummary] = useState('');
  const [statusCode, setStatusCode] = useState(200);
  const [payloadSchema, setPayloadSchema] = useState(
    '{\n  "type": "object",\n  "properties": {}\n}',
  );
  const [slotValues, setSlotValues] = useState<Record<string, unknown>>({});

  const create = useMutation({
    mutationFn: (body: CreateEndpointRequest) =>
      request<Endpoint>(`/projects/${slug}/versions/${versionId}/endpoints`, {
        method: 'POST',
        body,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({
        queryKey: ['projects', slug, 'versions', versionId, 'endpoints'],
      });
      void queryClient.invalidateQueries({
        queryKey: keys.standardHealth(slug),
      });
      onCreated(created);
    },
  });

  const pathProblem = describePathProblem(path);
  const canSubmit =
    resourceId !== '' &&
    summary.trim().length > 0 &&
    pathProblem === null &&
    !create.isPending;

  return (
    <Modal
      title="New endpoint"
      titleAside={<EndpointLine method={method} path={path} size="sm" />}
      onClose={onCancel}
    >
      <form
        className="p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;

          create.mutate({
            resourceId,
            method,
            path,
            summary: summary.trim(),
            responses: [
              {
                statusCode,
                description: '',
                headers: [],
                payloadSchema: parseOrNull(payloadSchema),
                examples: [
                  {
                    name: 'basic',
                    summary: '',
                    isDefault: true,
                    // The slot values are the example: this is the shape the
                    // project's standard says every response carries.
                    value: slotValues,
                  },
                ],
              },
            ],
          });
        }}
      >
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4">
          <label className={FIELD}>
            <span className={LABEL}>Resource</span>
            <select
              className={SELECT}
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
            >
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>

          <label className={FIELD}>
            <span className={LABEL}>Method</span>
            <select
              className={SELECT}
              value={method}
              onChange={(event) => setMethod(event.target.value as HttpMethod)}
            >
              {METHODS.map((option) => (
                <option key={option} value={option}>
                  {option.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={FIELD}>
          <span className={LABEL}>Path</span>
          <input
            className={`${INPUT} font-mono text-sm`}
            value={path}
            aria-invalid={pathProblem !== null}
            onChange={(event) => setPath(event.target.value)}
          />
          {pathProblem ? (
            <span className="text-sm text-status-danger" role="alert">
              {pathProblem}
            </span>
          ) : (
            <span className={HELP}>
              Path parameters come from {'{braces}'}. /api, /mock and /__mock
              are reserved by the platform.
            </span>
          )}
        </label>

        <label className={FIELD}>
          <span className={LABEL}>Summary</span>
          <input
            className={INPUT}
            maxLength={200}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="List orders"
          />
        </label>

        <fieldset className="mb-5 rounded-md border border-line p-4">
          <legend className="px-2 text-sm font-semibold text-text-muted">
            First response
          </legend>

          <label className={FIELD}>
            <span className={LABEL}>Status</span>
            <input
              className={INPUT}
              type="number"
              min={100}
              max={599}
              value={statusCode}
              onChange={(event) =>
                setStatusCode(Number(event.target.value) || 200)
              }
            />
          </label>

          <label className={FIELD}>
            <span className={LABEL}>Payload schema</span>
            <textarea
              className={JSON_INPUT}
              rows={5}
              spellCheck={false}
              value={payloadSchema}
              onChange={(event) => setPayloadSchema(event.target.value)}
            />
            <span className={HELP}>
              JSON Schema for the data this endpoint returns. The envelope is
              added by the project's response standard.
            </span>
          </label>
        </fieldset>

        <fieldset className="mb-5 rounded-md border border-line p-4">
          <legend className="px-2 text-sm font-semibold text-text-muted">
            Example response
          </legend>
          <p className={`${MUTED} mb-3`}>
            Your project's response standard declares these fields. Every
            response carries all of them.
          </p>

          {slots.isPending ? (
            <p className={HELP}>Loading the response standard…</p>
          ) : (
            <SlotFields
              slots={slots.data?.slots ?? []}
              values={slotValues}
              statusCode={statusCode}
              idPrefix={`${fieldId}-slot`}
              onChange={(token, value) =>
                setSlotValues((previous) => {
                  if (value === undefined) {
                    const { [token]: _dropped, ...rest } = previous;
                    return rest;
                  }
                  return { ...previous, [token]: value };
                })
              }
            />
          )}
        </fieldset>

        {create.isError ? (
          <p className={ERROR_TEXT} role="alert">
            {create.error instanceof RequestError
              ? (create.error.details?.[0]?.message ?? create.error.message)
              : 'The endpoint could not be created.'}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          <button type="submit" className={PRIMARY} disabled={!canSubmit}>
            {create.isPending ? 'Creating…' : 'Create endpoint'}
          </button>
          <button type="button" className={SECONDARY} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Mirrors the server's path rules so a problem is named before submitting. */
function describePathProblem(path: string): string | null {
  if (!path.startsWith('/')) return 'A path starts with /.';
  if (path.length > 1 && path.endsWith('/')) return 'Drop the trailing slash.';
  if (path.includes('//')) return 'A path has no empty segments.';

  for (const reserved of ['/api', '/mock', '/__mock']) {
    if (path === reserved || path.startsWith(`${reserved}/`)) {
      return `${reserved} is reserved by the platform, so a contract cannot claim it.`;
    }
  }

  const open = (path.match(/\{/g) ?? []).length;
  const close = (path.match(/\}/g) ?? []).length;
  if (open !== close) return 'Every { needs a matching }.';

  return null;
}

function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
