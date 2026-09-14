import type { EndpointResponse, EnvelopeSlot } from '@apion/contracts';
import { useId, useState } from 'react';
import { CODE_BLOCK, JSON_INPUT } from '../ui.js';
import { SlotFields } from './SlotFields.js';

/*
 * The selected view carries the accent and an underline: this is what you are
 * looking at. The radio itself is clipped rather than hidden, so it still takes
 * focus and still answers arrow keys, and the label shows where focus landed.
 */
const VIEW_INPUT = 'peer sr-only';
const VIEW_LABEL =
  'block cursor-pointer px-2 py-0.5 text-xs whitespace-nowrap text-text-muted peer-hover:text-text peer-checked:bg-accent-quiet peer-checked:font-semibold peer-checked:text-text peer-checked:shadow-[inset_0_-2px_0_var(--accent)] peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-accent pointer-coarse:px-3 pointer-coarse:py-2';

/**
 * A response's examples, as the body a client actually receives.
 *
 * Two ways to read and write the same example. Raw JSON is the default because
 * it is the thing itself: the bytes on the wire, which is what an engineer came
 * to check. The form view is there for the author who would rather be asked for
 * each slot than remember the envelope's shape. Neither is a different example,
 * only a different way in, so switching does not lose an edit.
 */
export function ResponseExamples({
  response,
  envelope,
  slots,
  editable = false,
  onChange,
}: {
  response: EndpointResponse;
  /** The project envelope, used to build the body from the slot values. */
  envelope: unknown;
  slots: readonly EnvelopeSlot[];
  editable?: boolean;
  /** Reports a new value for one example, keyed by its id. */
  onChange?: (exampleId: string, value: unknown) => void;
}) {
  if (response.examples.length === 0) {
    return (
      <p className="max-w-[64ch] text-sm text-text-muted">
        No example yet. Without one, {describeUnfillable(slots)} cannot be
        filled, and the mock has to invent them.
      </p>
    );
  }

  return (
    <ul className="mt-2 flex flex-col gap-3">
      {response.examples.map((example) => (
        <li key={example.id} className="min-w-0">
          <Example
            example={example}
            response={response}
            envelope={envelope}
            slots={slots}
            editable={editable && onChange !== undefined}
            onChange={(value) => onChange?.(example.id, value)}
          />
        </li>
      ))}
    </ul>
  );
}

type View = 'raw' | 'form';

function Example({
  example,
  response,
  envelope,
  slots,
  editable,
  onChange,
}: {
  example: EndpointResponse['examples'][number];
  response: EndpointResponse;
  envelope: unknown;
  slots: readonly EnvelopeSlot[];
  editable: boolean;
  onChange: (value: unknown) => void;
}) {
  const [view, setView] = useState<View>('raw');
  const fieldId = useId();

  const values = slotValuesOf(example.value);
  const body = fill(envelope, values, response.statusCode);

  const missing = slots.filter(
    (slot) =>
      !(slot.token in values) &&
      !isStatusSlot(slot.token) &&
      !(slot.isData && response.payloadSchema !== null),
  );

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{example.name}</span>
        {example.isDefault ? (
          <span className="rounded-sm border border-current px-1 text-xs text-status-implemented">
            served by default
          </span>
        ) : null}
        {example.summary ? (
          <span className="text-sm text-text-muted">{example.summary}</span>
        ) : null}

        {/*
          Radios, not a pair of buttons: the two views are one choice with one
          answer, which is what a radio group already expresses to a reader
          arriving by keyboard or screen reader.
        */}
        <div
          className="ml-auto flex overflow-hidden rounded-sm border border-line-control"
          role="radiogroup"
          aria-label={`How to show the ${example.name} example`}
        >
          {(['raw', 'form'] as const).map((option) => (
            <label key={option} className="flex">
              <input
                type="radio"
                className={VIEW_INPUT}
                name={`${fieldId}-view`}
                checked={view === option}
                onChange={() => setView(option)}
              />
              <span className={VIEW_LABEL}>
                {option === 'raw' ? 'Raw JSON' : 'Form'}
              </span>
            </label>
          ))}
        </div>
      </div>

      {missing.length > 0 ? (
        <p className="mb-1 text-sm text-status-in-progress">
          Does not fill {missing.map((slot) => slot.token).join(', ')}.
        </p>
      ) : null}

      {view === 'raw' ? (
        <RawBody
          body={body}
          envelope={envelope}
          statusCode={response.statusCode}
          editable={editable}
          onChange={onChange}
        />
      ) : (
        <div className="mt-2">
          <SlotFields
            slots={slots}
            values={values}
            statusCode={response.statusCode}
            idPrefix={`${fieldId}-slot`}
            disabled={!editable}
            onChange={(token, value) => {
              if (value === undefined) {
                const { [token]: _dropped, ...rest } = values;
                onChange(rest);
                return;
              }
              onChange({ ...values, [token]: value });
            }}
          />
        </div>
      )}
    </>
  );
}

/**
 * The wire body, read or written directly.
 *
 * What is edited here is the filled envelope, because that is what the reader
 * is looking at. On blur it is read back into slot values against the same
 * envelope, so an edit made in this view and an edit made in the form view
 * produce the same stored example.
 */
function RawBody({
  body,
  envelope,
  statusCode,
  editable,
  onChange,
}: {
  body: unknown;
  envelope: unknown;
  statusCode: number | 'default';
  editable: boolean;
  onChange: (value: unknown) => void;
}) {
  const text = JSON.stringify(body, null, 2);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!editable) {
    return (
      <pre className={CODE_BLOCK}>
        <code>{text}</code>
      </pre>
    );
  }

  return (
    <>
      <textarea
        className={`${JSON_INPUT} w-full`}
        // Sized to the body rather than a fixed box, so a short example does
        // not sit in a tall empty field and a long one needs less scrolling.
        rows={Math.min(24, text.split('\n').length + 1)}
        spellCheck={false}
        aria-label="Response body"
        aria-invalid={problem !== null}
        value={draft ?? text}
        onChange={(event) => {
          setDraft(event.target.value);
          setProblem(null);
        }}
        onBlur={(event) => {
          const raw = event.target.value;
          if (raw.trim() === '') {
            setProblem('A response body cannot be empty.');
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // The text stays in the box rather than being thrown away, so an
            // unfinished edit survives a stray click outside it.
            setProblem('This is not valid JSON yet, so it was not applied.');
            return;
          }

          setDraft(null);
          setProblem(null);
          onChange(unfill(envelope, parsed, statusCode));
        }}
      />
      {problem ? (
        <p className="mt-1 text-sm text-status-danger" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

const SLOT_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

function isSlot(value: unknown): value is string {
  return typeof value === 'string' && SLOT_PATTERN.test(value);
}

function isStatusSlot(token: string): boolean {
  return token === '$status_code' || token === '$status';
}

/**
 * Reads an example as slot values. One written before the project had slots is
 * a bare payload, so it is shown as the data slot rather than as an error.
 */
function slotValuesOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { $data: value };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length > 0 && keys.every((key) => isSlot(key))) return record;
  return { $data: value };
}

export function fill(
  node: unknown,
  values: Record<string, unknown>,
  statusCode: number | 'default',
): unknown {
  if (isSlot(node)) {
    if (node in values) return values[node];
    if (node === '$data' && '$payload' in values) return values.$payload;
    if (node === '$payload' && '$data' in values) return values.$data;
    // The status the contract already states, rather than a leftover token.
    if (isStatusSlot(node) && typeof statusCode === 'number') return statusCode;
    return node;
  }

  if (Array.isArray(node)) {
    return node.map((item) => fill(item, values, statusCode));
  }
  if (typeof node !== 'object' || node === null) return node;

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      fill(value, values, statusCode),
    ]),
  );
}

/**
 * The inverse of `fill`: walks the envelope beside the edited body and takes
 * whatever sits where a slot token sits.
 *
 * A project with no envelope, or a body whose shape no longer matches one,
 * stores the body as the data slot instead. An example authored before the
 * project had a standard already looks exactly like that, so the fallback
 * keeps such a body readable rather than turning it into an error the author
 * has no way to clear.
 */
export function unfill(
  envelope: unknown,
  body: unknown,
  statusCode: number | 'default',
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  const walk = (node: unknown, actual: unknown): boolean => {
    if (isSlot(node)) {
      // The status is already stated by the response itself, so storing it
      // again would only give the two a way to drift apart.
      if (isStatusSlot(node) && actual === statusCode) return true;
      values[node] = actual;
      return true;
    }

    if (Array.isArray(node)) {
      if (!Array.isArray(actual) || actual.length !== node.length) return false;
      return node.every((item, index) => walk(item, actual[index]));
    }

    if (typeof node === 'object' && node !== null) {
      if (
        typeof actual !== 'object' ||
        actual === null ||
        Array.isArray(actual)
      ) {
        return false;
      }
      const record = actual as Record<string, unknown>;
      return Object.entries(node).every(
        ([key, value]) => key in record && walk(value, record[key]),
      );
    }

    return JSON.stringify(node) === JSON.stringify(actual);
  };

  if (envelope === undefined || envelope === null) return { $data: body };
  if (!walk(envelope, body)) return { $data: body };
  return values;
}

function describeUnfillable(slots: readonly EnvelopeSlot[]): string {
  const names = slots
    .filter((slot) => !slot.isData && !isStatusSlot(slot.token))
    .map((slot) => slot.token);

  if (names.length === 0) return 'the response body';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
