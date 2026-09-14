import type { Endpoint, UpdateEndpointRequest } from '@apion/contracts';
import { assertFresh } from './concurrency.js';

/**
 * The single mutation seam for endpoints, required by PRD 06:
 *
 * > All mutation paths therefore use one `applyEndpointChange` seam now,
 * > allowing CRDTs later without a rewrite.
 *
 * Every caller (REST handler, OpenAPI import, future CRDT projection) goes
 * through here. Stage 2 replaces the body with a Yjs apply while the signature,
 * and therefore every call site, stays put.
 *
 * This is pure: it computes the next endpoint and leaves persistence to @apion/db.
 */

export interface EndpointChange {
  readonly patch: UpdateEndpointRequest;
  /** The version the author had loaded. Omitted only for server-initiated writes. */
  readonly expectedVersion?: number;
  readonly actorId: string;
  readonly at: Date;
}

export interface EndpointChangeResult {
  readonly next: Endpoint;
  /** Field names that actually changed; drives presence and broadcast payloads. */
  readonly changedFields: readonly string[];
}

/** Fields a client may set. Anything else on the entity is server-owned. */
const MUTABLE_FIELDS = [
  'resourceId',
  'method',
  'path',
  'summary',
  'description',
  'operationId',
  'parameters',
  'requestBody',
  'responses',
  'authRequired',
  'deprecated',
  'ownerId',
  'ticketUrl',
  'tags',
] as const satisfies readonly (keyof Endpoint)[];

type MutableField = (typeof MUTABLE_FIELDS)[number];

function hasChanged(before: unknown, after: unknown): boolean {
  if (before === after) return false;
  // Contract fields are JSON, so structural comparison is both correct and the
  // cheapest way to avoid writing a new version for an identical payload.
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function applyEndpointChange(
  current: Endpoint,
  change: EndpointChange,
): EndpointChangeResult {
  if (change.expectedVersion !== undefined) {
    assertFresh(current, change.expectedVersion);
  }

  const next: Endpoint = { ...current };
  const changedFields: MutableField[] = [];

  for (const field of MUTABLE_FIELDS) {
    if (!(field in change.patch)) continue;
    const incoming = (change.patch as Record<string, unknown>)[field];
    if (incoming === undefined) continue;
    if (!hasChanged(current[field], incoming)) continue;

    (next as Record<string, unknown>)[field] = incoming;
    changedFields.push(field);
  }

  if (changedFields.length === 0) {
    // A no-op save must not burn an entity version, or every autosave would
    // invalidate other editors' If-Match preconditions for nothing.
    return { next: current, changedFields: [] };
  }

  next.entityVersion = current.entityVersion + 1;
  next.updatedAt = change.at.toISOString();

  return { next, changedFields };
}
