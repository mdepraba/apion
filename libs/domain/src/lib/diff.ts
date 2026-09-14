import type { ChangeKind, DiffEntry, Endpoint } from '@apion/contracts';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];

/** JSON Schema `type` is either a string or an array of them. */
function typesOf(schema: unknown): Set<string> {
  if (!isObject(schema)) return new Set();
  const type = schema['type'];
  if (typeof type === 'string') return new Set([type]);
  if (Array.isArray(type)) return new Set(asStrings(type));
  return new Set();
}

function propertiesOf(schema: unknown): JsonObject {
  if (!isObject(schema)) return {};
  const properties = schema['properties'];
  return isObject(properties) ? properties : {};
}

function requiredOf(schema: unknown): Set<string> {
  if (!isObject(schema)) return new Set();
  return new Set(asStrings(schema['required']));
}

/**
 * A type change is narrowing when the new set of accepted types is a strict
 * subset of the old one: every value the new schema accepts was already
 * accepted, but not the reverse.
 */
function isNarrowed(before: unknown, after: unknown): boolean {
  const from = typesOf(before);
  const to = typesOf(after);
  if (from.size === 0 || to.size === 0) return false;
  if (from.size === to.size && [...from].every((t) => to.has(t))) return false;
  return [...to].every((t) => from.has(t));
}

interface SchemaDiffContext {
  endpointId: string;
  label: string;
  /** Request and response schemas invert which side of a change breaks a consumer. */
  direction: 'request' | 'response';
}

/**
 * Walks two JSON Schemas in parallel. Direction decides severity: dropping a
 * response field breaks the client reading it, while dropping a request field
 * only stops the server accepting something it used to.
 */
function diffSchemas(
  before: unknown,
  after: unknown,
  pointer: string,
  ctx: SchemaDiffContext,
  entries: DiffEntry[],
): void {
  const beforeProps = propertiesOf(before);
  const afterProps = propertiesOf(after);
  const beforeRequired = requiredOf(before);
  const afterRequired = requiredOf(after);

  for (const name of Object.keys(beforeProps)) {
    const childPointer = `${pointer}/${name}`;

    if (!(name in afterProps)) {
      entries.push({
        kind: ctx.direction === 'response' ? 'breaking' : 'non_breaking',
        reason: 'field_removed',
        endpointId: ctx.endpointId,
        label: `${ctx.label} removed ${name}`,
        pointer: childPointer,
        before: beforeProps[name],
      });
      continue;
    }

    if (isNarrowed(beforeProps[name], afterProps[name])) {
      entries.push({
        kind: 'breaking',
        reason: 'type_narrowed',
        endpointId: ctx.endpointId,
        label: `${ctx.label} narrowed the type of ${name}`,
        pointer: childPointer,
        before: beforeProps[name],
        after: afterProps[name],
      });
    }

    diffSchemas(
      beforeProps[name],
      afterProps[name],
      childPointer,
      ctx,
      entries,
    );
  }

  for (const name of Object.keys(afterProps)) {
    if (name in beforeProps) continue;
    const childPointer = `${pointer}/${name}`;
    const nowRequired = afterRequired.has(name);
    const breaksCallers = ctx.direction === 'request' && nowRequired;

    entries.push({
      kind: breaksCallers ? 'breaking' : 'additive',
      reason: breaksCallers ? 'required_request_field_added' : 'field_added',
      endpointId: ctx.endpointId,
      label: `${ctx.label} added ${name}${nowRequired ? ' (required)' : ''}`,
      pointer: childPointer,
      after: afterProps[name],
    });
  }

  // A field that already existed and has just become mandatory.
  for (const name of afterRequired) {
    if (beforeRequired.has(name) || !(name in beforeProps)) continue;
    if (ctx.direction !== 'request') continue;
    entries.push({
      kind: 'breaking',
      reason: 'required_request_field_added',
      endpointId: ctx.endpointId,
      label: `${ctx.label} now requires ${name}`,
      pointer: `${pointer}/${name}`,
    });
  }

  for (const name of beforeRequired) {
    if (afterRequired.has(name) || !(name in afterProps)) continue;
    if (ctx.direction !== 'request') continue;
    entries.push({
      kind: 'non_breaking',
      reason: 'required_request_field_removed',
      endpointId: ctx.endpointId,
      label: `${ctx.label} no longer requires ${name}`,
      pointer: `${pointer}/${name}`,
    });
  }
}

const endpointLabel = (endpoint: Endpoint): string =>
  `${endpoint.method.toUpperCase()} ${endpoint.path}`;

const statusKey = (code: number | 'default'): string => String(code);

export function diffEndpoint(
  before: Endpoint | undefined,
  after: Endpoint | undefined,
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (!before && !after) return entries;

  if (!before && after) {
    entries.push({
      kind: 'additive',
      reason: 'endpoint_added',
      endpointId: after.id,
      label: `Added ${endpointLabel(after)}`,
      pointer: null,
    });
    return entries;
  }

  if (before && !after) {
    entries.push({
      kind: 'breaking',
      reason: 'endpoint_removed',
      endpointId: before.id,
      label: `Removed ${endpointLabel(before)}`,
      pointer: null,
    });
    return entries;
  }

  if (!before || !after) return entries;

  const label = endpointLabel(after);

  if (before.path !== after.path) {
    entries.push({
      kind: 'breaking',
      reason: 'path_changed',
      endpointId: after.id,
      label: `Path changed from ${before.path} to ${after.path}`,
      pointer: null,
      before: before.path,
      after: after.path,
    });
  }

  if (before.method !== after.method) {
    entries.push({
      kind: 'breaking',
      reason: 'method_changed',
      endpointId: after.id,
      label: `Method changed from ${before.method.toUpperCase()} to ${after.method.toUpperCase()}`,
      pointer: null,
      before: before.method,
      after: after.method,
    });
  }

  if (!before.deprecated && after.deprecated) {
    entries.push({
      kind: 'non_breaking',
      reason: 'deprecated',
      endpointId: after.id,
      label: `${label} is now deprecated`,
      pointer: null,
    });
  }

  diffSchemas(
    before.requestBody?.schema,
    after.requestBody?.schema,
    '#/requestBody',
    { endpointId: after.id, label, direction: 'request' },
    entries,
  );

  const beforeResponses = new Map(
    before.responses.map((r) => [statusKey(r.statusCode), r]),
  );
  const afterResponses = new Map(
    after.responses.map((r) => [statusKey(r.statusCode), r]),
  );

  for (const [code, beforeResponse] of beforeResponses) {
    const afterResponse = afterResponses.get(code);
    if (!afterResponse) {
      entries.push({
        kind: 'breaking',
        reason: 'status_code_removed',
        endpointId: after.id,
        label: `${label} no longer returns ${code}`,
        pointer: `#/responses/${code}`,
      });
      continue;
    }
    diffSchemas(
      beforeResponse.payloadSchema,
      afterResponse.payloadSchema,
      `#/responses/${code}`,
      { endpointId: after.id, label, direction: 'response' },
      entries,
    );
  }

  for (const code of afterResponses.keys()) {
    if (beforeResponses.has(code)) continue;
    entries.push({
      kind: 'additive',
      reason: 'status_code_added',
      endpointId: after.id,
      label: `${label} now returns ${code}`,
      pointer: `#/responses/${code}`,
    });
  }

  return entries;
}

export function diffEndpointSets(
  before: readonly Endpoint[],
  after: readonly Endpoint[],
): DiffEntry[] {
  // Endpoints match on method+path rather than id, so an import that rebuilds
  // the contract still reads as a modification instead of a delete plus an add.
  const key = (e: Endpoint) => `${e.method} ${e.path}`;
  const beforeByKey = new Map(before.map((e) => [key(e), e]));
  const afterByKey = new Map(after.map((e) => [key(e), e]));

  const entries: DiffEntry[] = [];
  for (const [k, beforeEndpoint] of beforeByKey) {
    entries.push(...diffEndpoint(beforeEndpoint, afterByKey.get(k)));
  }
  for (const [k, afterEndpoint] of afterByKey) {
    if (!beforeByKey.has(k))
      entries.push(...diffEndpoint(undefined, afterEndpoint));
  }
  return entries;
}

export function summariseDiff(
  entries: readonly DiffEntry[],
): Record<ChangeKind, number> {
  const summary: Record<ChangeKind, number> = {
    breaking: 0,
    non_breaking: 0,
    additive: 0,
  };
  for (const entry of entries) summary[entry.kind] += 1;
  return summary;
}
