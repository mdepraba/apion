import type { StandardDefinition } from '@apion/contracts';
import { CODE_BLOCK } from '../ui.js';

/**
 * The read-only wire shape from FR-4.1: "Authors edit the payload and receive a
 * read-only wire-shape preview."
 *
 * It fills the envelope's slots with a sample response, so a change to the
 * envelope shows its consequence immediately. The server's engine remains
 * authoritative for anything saved, exported or mocked; this only answers
 * "what will my responses look like".
 */

const SAMPLE_PAYLOAD = {
  id: 'ord_8f21',
  total: 4250,
  createdAt: '2026-09-13T09:24:11Z',
};

export function EnvelopePreview({
  definition,
}: {
  definition: StandardDefinition;
}) {
  const success = fill(definition.envelope, {
    status: 200,
    message: 'OK',
    data: SAMPLE_PAYLOAD,
  });

  const failure = fill(definition.envelope, {
    status: 404,
    message: 'No order with that id.',
    data: null,
  });

  const collection = fill(definition.envelope, {
    status: 200,
    message: 'OK',
    data: paginationSample(definition),
  });

  return (
    <div className="p-5">
      <h2 className="mb-2 text-md">Wire shape</h2>
      <p className="mb-5 max-w-[44ch] text-sm text-text-muted">
        What a client receives. Endpoint authors fill one field per slot; this
        is the body those values produce.
      </p>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-text-muted">Success</h3>
        <pre className={CODE_BLOCK}>
          <code>{JSON.stringify(success, null, 2)}</code>
        </pre>
      </section>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-semibold text-text-muted">Failure</h3>
        <pre className={CODE_BLOCK}>
          <code>{JSON.stringify(failure, null, 2)}</code>
        </pre>
      </section>

      {definition.pagination.style !== 'none' ? (
        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-text-muted">
            Collection ({definition.pagination.style})
          </h3>
          <pre className={CODE_BLOCK}>
            <code>{JSON.stringify(collection, null, 2)}</code>
          </pre>
        </section>
      ) : null}
    </div>
  );
}

const SLOT_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

interface SampleResponse {
  status: number;
  message: string;
  data: unknown;
}

/**
 * Fills each slot with something representative of what an author would write
 * there. A slot this preview has no sample for keeps its token, which is the
 * same thing a real response does with an unfilled slot.
 */
function fill(node: unknown, sample: SampleResponse): unknown {
  if (typeof node === 'string' && SLOT_PATTERN.test(node)) {
    return sampleForSlot(node, sample);
  }
  if (Array.isArray(node)) return node.map((item) => fill(item, sample));
  if (typeof node !== 'object' || node === null) return node;

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, fill(value, sample)]),
  );
}

function sampleForSlot(token: string, sample: SampleResponse): unknown {
  switch (token) {
    case '$data':
    case '$payload':
      return sample.data;
    case '$status_code':
    case '$status':
      return sample.status;
    case '$message':
    case '$title':
    case '$detail':
      return sample.message;
    case '$code':
      return sample.status >= 400 ? 'NOT_FOUND' : null;
    case '$type':
      return sample.status >= 400
        ? 'https://example.test/probs/not-found'
        : null;
    case '$meta':
      return { requestId: 'req_3c81' };
    case '$errors':
      return sample.status >= 400
        ? [{ code: 'NOT_FOUND', detail: sample.message }]
        : [];
    default:
      return token;
  }
}

/** The payload half of a list response, in the project's pagination style. */
function paginationSample(definition: StandardDefinition): unknown {
  const items = [SAMPLE_PAYLOAD];

  switch (definition.pagination.style) {
    case 'cursor':
      return { items, nextCursor: 'b3JkXzhmMjE' };
    case 'offset':
      return { items, total: 128, offset: 0 };
    case 'page':
      return { items, page: 1, pageSize: definition.pagination.maxLimit };
    case 'none':
      return items;
  }
}
