import type { EndpointResponse } from '@apion/contracts';
import {
  DATA_SLOT,
  envelopeSlots,
  fillEnvelope,
  isDataSlot,
  isSlot,
  type ResponseStandard,
  type SlotValues,
} from './standard.js';

/**
 * The wire shape of a response: what a client actually receives once the
 * standard's envelope is filled in.
 *
 * FR-4.8 makes this the single source for the editor preview, the mock, the
 * OpenAPI export and the generated types. Each of those calls one of these two
 * functions; none builds an envelope itself.
 */

/** The response schema as exported and as the editor previews it. */
export function wireSchema(
  standard: ResponseStandard,
  response: EndpointResponse,
): unknown {
  // A 204 carries no body, so there is no envelope to describe.
  if (response.statusCode === 204) return null;

  return schemaFor(standard.envelope, response);
}

/**
 * The wire body for one response's authored slot values, used by the mock and
 * the preview. `$status_code` falls back to the response's own status, because
 * the contract already states it and making an author retype it invites drift.
 */
export function wireExample(
  standard: ResponseStandard,
  response: EndpointResponse,
  slotValues: SlotValues,
): unknown {
  if (response.statusCode === 204) return null;

  return fillEnvelope(standard, withStatusDefault(slotValues, response));
}

/** The slots an author still has to fill for this response. */
export function missingSlots(
  standard: ResponseStandard,
  response: EndpointResponse,
  slotValues: SlotValues,
): string[] {
  const supplied = withStatusDefault(slotValues, response);

  return envelopeSlots(standard.envelope)
    .filter((slot) => {
      if (slot.token in supplied) return false;
      // The data slot is satisfied by the response schema when no example
      // value was written for it.
      if (slot.isData && response.payloadSchema !== null) return false;
      return true;
    })
    .map((slot) => slot.token);
}

function withStatusDefault(
  slotValues: SlotValues,
  response: EndpointResponse,
): SlotValues {
  if ('$status_code' in slotValues || typeof response.statusCode !== 'number') {
    return slotValues;
  }
  return { ...slotValues, $status_code: response.statusCode };
}

/**
 * Turns the envelope into a JSON Schema. The literal envelope object becomes an
 * object schema whose properties are its keys; the data slot becomes the
 * author's schema and every other slot is described from what it holds.
 */
function schemaFor(node: unknown, response: EndpointResponse): unknown {
  if (isDataSlot(node)) return response.payloadSchema ?? {};

  if (isSlot(node)) return slotSchema(node, response);

  if (Array.isArray(node)) {
    return { type: 'array', items: schemaFor(node[0] ?? {}, response) };
  }

  if (typeof node !== 'object' || node === null) return { const: node };

  const entries = Object.entries(node as Record<string, unknown>);

  return {
    type: 'object',
    properties: Object.fromEntries(
      entries.map(([key, value]) => [key, schemaFor(value, response)]),
    ),
    required: entries.map(([key]) => key),
  };
}

/**
 * A non-data slot's type. The names a project is likely to use carry an obvious
 * shape; anything else stays unconstrained rather than being guessed at.
 */
function slotSchema(token: string, response: EndpointResponse): unknown {
  switch (token) {
    case '$status_code':
    case '$status':
      return typeof response.statusCode === 'number'
        ? { type: 'integer', const: response.statusCode }
        : { type: 'integer' };
    case '$message':
    case '$title':
    case '$detail':
    case '$code':
    case '$type':
      return { type: 'string' };
    case '$meta':
      return { type: 'object' };
    case '$errors':
      return { type: 'array', items: { type: 'object' } };
    default:
      return {};
  }
}

/**
 * Reads the slot values out of whatever an example holds. An example authored
 * before slots existed is a bare payload, so it is read as the data slot; this
 * is what keeps older contracts rendering instead of erroring.
 */
export function slotValuesOf(value: unknown): SlotValues {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { [DATA_SLOT]: value };
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  // An object whose keys are all slot tokens is already slot values.
  if (keys.length > 0 && keys.every((key) => isSlot(key))) {
    return record;
  }

  return { [DATA_SLOT]: value };
}
