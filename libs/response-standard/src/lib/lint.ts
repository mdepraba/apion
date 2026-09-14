import type {
  Endpoint,
  EndpointResponse,
  HttpMethod,
  Parameter,
} from '@apion/contracts';
import { matchesConvention, NAMING_EXAMPLES } from './naming.js';
import { slotValuesOf } from './preview.js';
import {
  DATA_SLOT,
  envelopeSlots,
  PAYLOAD_TOKEN,
  type ResponseStandard,
  type RuleId,
  type Violation,
} from './standard.js';

/**
 * RS001 to RS010 (FR-4.4). One endpoint in, its violations out: no database, no
 * project, no request. That is what lets the same engine run in the editor
 * preview, the lazy sweep, the mock and the publish gate (FR-4.8).
 *
 * A rule set to `off` is never evaluated rather than evaluated and filtered, so
 * turning a rule off also buys back its cost on the sweep.
 */

export interface LintInput {
  endpoint: Endpoint;
  standard: ResponseStandard;
  /** Resolves a `$ref` so a response that points at a named schema is still checked. */
  resolveRef?: (ref: string) => unknown;
}

export function lintEndpoint(input: LintInput): Violation[] {
  const { endpoint, standard } = input;

  // The whole set turned off. Checked before anything is walked, so a project
  // that has opted out pays nothing for the sweep either.
  if (standard.rulesEnabled === false) return [];

  const violations: Violation[] = [];
  const report = (ruleId: RuleId, pointer: string, message: string): void => {
    const severity = standard.severities[ruleId];
    if (severity === 'off') return;
    violations.push({ ruleId, severity, pointer, message });
  };

  const enabled = (ruleId: RuleId): boolean =>
    standard.severities[ruleId] !== 'off';

  if (enabled('RS010')) checkPathNaming(endpoint, standard, report);
  if (enabled('RS009')) checkRequiredErrorClasses(endpoint, standard, report);

  for (const [index, response] of endpoint.responses.entries()) {
    const pointer = `/responses/${index}`;
    const schema = resolve(response.payloadSchema, input.resolveRef);

    if (enabled('RS005')) {
      checkStatusAllowed(endpoint.method, response, pointer, standard, report);
    }
    if (enabled('RS008')) {
      checkRequiredHeaders(response, pointer, standard, report);
    }

    // Every response wears the same envelope, so every response is checked
    // for filled slots regardless of its status.
    if (enabled('RS001')) {
      checkSlotsFilled(response, pointer, standard, report);
    }

    if (isError(response.statusCode)) {
      if (enabled('RS003')) {
        checkErrorReadable(response, pointer, standard, report);
      }
      if (enabled('RS004')) {
        checkErrorCodes(response, schema, pointer, standard, report);
      }
      continue;
    }

    if (!isSuccess(response.statusCode)) continue;

    if (enabled('RS002')) {
      checkPropertyNaming(schema, `${pointer}/payloadSchema`, standard, report);
    }
    if (enabled('RS006')) {
      checkPagination(endpoint, schema, pointer, standard, report);
    }
    if (enabled('RS007')) {
      checkDateFormat(schema, `${pointer}/payloadSchema`, standard, report);
    }
  }

  if (enabled('RS002')) {
    checkParameterNaming(endpoint.parameters, standard, report);
  }

  return violations;
}

type Report = (ruleId: RuleId, pointer: string, message: string) => void;

/**
 * RS001. Every slot the envelope declares has to be filled: an example that
 * supplies `$data` but leaves `$status_code`, `$message` and `$meta` empty is
 * the failure this rule exists to catch, because the client receives a body
 * with the token still in it.
 */
function checkSlotsFilled(
  response: EndpointResponse,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  // A 204 carries no body, so there are no slots to fill.
  if (response.statusCode === 204) return;

  const slots = envelopeSlots(standard.envelope);
  if (slots.length === 0) return;

  if (response.examples.length === 0) {
    // The data slot alone can be satisfied by a schema; anything else needs a
    // value, and a value only arrives in an example.
    const beyondData = slots.filter((slot) => !slot.isData);
    if (response.payloadSchema === null) {
      report(
        'RS001',
        `${pointer}/payloadSchema`,
        `This response declares neither a schema nor an example, so ${describeTokens(slots.map((s) => s.token))} cannot be filled.`,
      );
      return;
    }
    if (beyondData.length > 0) {
      report(
        'RS001',
        `${pointer}/examples`,
        `Add an example: ${describeTokens(beyondData.map((s) => s.token))} ${beyondData.length === 1 ? 'has' : 'have'} no value, and a schema cannot supply one.`,
      );
    }
    return;
  }

  for (const [index, example] of response.examples.entries()) {
    const values = slotValuesOf(example.value);
    const missing = slots.filter((slot) => {
      if (slot.token in values) return false;
      // `$status_code` is taken from the response's own status when omitted.
      if (
        (slot.token === '$status_code' || slot.token === '$status') &&
        typeof response.statusCode === 'number'
      ) {
        return false;
      }
      if (slot.isData) {
        return (
          !(DATA_SLOT in values) &&
          !(PAYLOAD_TOKEN in values) &&
          response.payloadSchema === null
        );
      }
      return true;
    });

    if (missing.length > 0) {
      report(
        'RS001',
        `${pointer}/examples/${index}`,
        `The "${example.name}" example does not fill ${describeTokens(missing.map((s) => s.token))}. Every response carries the project's full envelope.`,
      );
    }
  }
}

/**
 * RS003. A failure has to be readable: whatever slot the project uses to say
 * what went wrong must carry something, or a client gets a status and nothing
 * to show a user.
 */
function checkErrorReadable(
  response: EndpointResponse,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  const slots = envelopeSlots(standard.envelope);
  const explains = slots.filter((slot) => EXPLANATORY_SLOTS.has(slot.token));

  // A project whose envelope says nothing about failures has nothing to check.
  if (explains.length === 0) return;

  if (response.examples.length === 0) {
    report(
      'RS003',
      `${pointer}/examples`,
      `${response.statusCode} has no example, so ${describeTokens(explains.map((s) => s.token))} never gets a value. A client cannot tell a user what went wrong.`,
    );
    return;
  }

  for (const [index, example] of response.examples.entries()) {
    const values = slotValuesOf(example.value);
    const empty = explains.filter((slot) => {
      const value = values[slot.token];
      return value === undefined || value === null || value === '';
    });

    if (empty.length > 0) {
      report(
        'RS003',
        `${pointer}/examples/${index}`,
        `The "${example.name}" example leaves ${describeTokens(empty.map((s) => s.token))} empty on a ${response.statusCode}.`,
      );
    }
  }
}

/** The slots that carry a failure's explanation, whatever a project calls them. */
const EXPLANATORY_SLOTS = new Set([
  '$message',
  '$error',
  '$errors',
  '$detail',
  '$title',
  '$code',
]);

/**
 * RS004. Error codes are a registry so clients can branch on them. A code in a
 * schema `enum` or `const` that the registry does not list is the violation;
 * a response that names no code at all is RS003's concern, not this rule's.
 */
function checkErrorCodes(
  response: EndpointResponse,
  schema: unknown,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  if (standard.errorCodes.length === 0) return;

  const registry = new Set(standard.errorCodes);

  for (const { value, path } of collectCodeValues(schema)) {
    if (registry.has(value)) continue;
    report(
      'RS004',
      `${pointer}/payloadSchema${path}`,
      `"${value}" is not in the project's error-code registry. Add it to the standard, or use one of the codes already registered.`,
    );
  }

  for (const [index, example] of response.examples.entries()) {
    for (const value of collectExampleCodes(example.value)) {
      if (registry.has(value)) continue;
      report(
        'RS004',
        `${pointer}/examples/${index}`,
        `The "${example.name}" example returns "${value}", which is not in the error-code registry.`,
      );
    }
  }
}

/** RS005. A status that the method should never answer with. */
function checkStatusAllowed(
  method: HttpMethod,
  response: EndpointResponse,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  if (response.statusCode === 'default') return;

  const allowed = standard.allowedStatusesByMethod[method];
  // A method the standard says nothing about permits anything.
  if (!allowed || allowed.length === 0) return;

  if (!allowed.includes(response.statusCode)) {
    report(
      'RS005',
      `${pointer}/statusCode`,
      `${method.toUpperCase()} does not answer ${response.statusCode} in this project. Allowed: ${allowed.join(', ')}.`,
    );
  }
}

/**
 * RS006. A collection response needs the project's pagination shape. The
 * response is treated as a collection when the payload is an array, or when the
 * envelope's payload slot holds one, since an unpaginated list is the failure
 * this rule exists to catch.
 */
function checkPagination(
  endpoint: Endpoint,
  schema: unknown,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  if (standard.pagination.style === 'none') return;
  if (endpoint.method !== 'get') return;
  if (!looksLikeCollection(schema)) return;

  const properties = objectProperties(schema);
  const present = new Set(Object.keys(properties ?? {}));
  const required = PAGINATION_KEYS[standard.pagination.style];

  const missing = required.filter((key) => !present.has(key));
  if (missing.length === required.length) {
    report(
      'RS006',
      `${pointer}/payloadSchema`,
      `This returns a collection but declares no pagination. ${standard.pagination.style} pagination expects ${describeKeys(required)}.`,
    );
  }
}

const PAGINATION_KEYS: Record<
  Exclude<ResponseStandard['pagination']['style'], 'none'>,
  string[]
> = {
  cursor: ['items', 'nextCursor'],
  offset: ['items', 'total', 'offset'],
  page: ['items', 'page', 'pageSize'],
};

/** RS007. A date field whose format does not match the project's. */
function checkDateFormat(
  schema: unknown,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  for (const { node, path, key } of walkSchema(schema, pointer)) {
    if (!isDateLikeName(key)) continue;

    const record = node as Record<string, unknown>;
    const type = record['type'];
    const format = record['format'];

    if (standard.dateFormat === 'unix-seconds') {
      if (type === 'string') {
        report(
          'RS007',
          path,
          `"${key}" is a string, but this project sends dates as Unix seconds.`,
        );
      }
      continue;
    }

    if (type !== 'string' && type !== undefined) {
      report(
        'RS007',
        path,
        `"${key}" is ${String(type)}, but this project sends dates as ${DATE_FORMAT_LABELS[standard.dateFormat]}.`,
      );
      continue;
    }

    const expected = standard.dateFormat === 'rfc3339' ? 'date-time' : 'date';
    if (format !== expected) {
      report(
        'RS007',
        path,
        `"${key}" should declare format: ${expected} for ${DATE_FORMAT_LABELS[standard.dateFormat]}.`,
      );
    }
  }
}

const DATE_FORMAT_LABELS: Record<ResponseStandard['dateFormat'], string> = {
  rfc3339: 'RFC 3339 timestamps',
  'iso8601-date': 'ISO 8601 dates',
  'unix-seconds': 'Unix seconds',
};

/** RS008. A header the standard requires on every response. */
function checkRequiredHeaders(
  response: EndpointResponse,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  if (standard.requiredResponseHeaders.length === 0) return;
  if (response.statusCode === 204) return;

  const declared = new Set(
    response.headers.map((header) => header.name.toLowerCase()),
  );

  for (const required of standard.requiredResponseHeaders) {
    if (declared.has(required.toLowerCase())) continue;
    report(
      'RS008',
      `${pointer}/headers`,
      `${response.statusCode} does not declare the required "${required}" header.`,
    );
  }
}

/**
 * RS009. Every status class the standard allows for this method and treats as a
 * failure needs a response, so a client never meets an undocumented error.
 */
function checkRequiredErrorClasses(
  endpoint: Endpoint,
  standard: ResponseStandard,
  report: Report,
): void {
  const allowed = standard.allowedStatusesByMethod[endpoint.method];
  if (!allowed || allowed.length === 0) return;

  const declared = endpoint.responses.map((response) => response.statusCode);
  // `default` documents every status the endpoint does not name explicitly.
  if (declared.includes('default')) return;

  const declaredClasses = new Set(
    declared
      .filter((status): status is number => typeof status === 'number')
      .map(statusClass),
  );

  const requiredClasses = new Set(
    allowed.filter((status) => status >= 400).map(statusClass),
  );

  for (const required of requiredClasses) {
    if (declaredClasses.has(required)) continue;
    report(
      'RS009',
      '/responses',
      `No ${required} response is declared. Clients need to know how this endpoint fails.`,
    );
  }
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/** RS002, over response payloads. */
function checkPropertyNaming(
  schema: unknown,
  pointer: string,
  standard: ResponseStandard,
  report: Report,
): void {
  for (const { path, key } of walkSchema(schema, pointer)) {
    if (matchesConvention(key, standard.propertyNaming)) continue;
    report(
      'RS002',
      path,
      `"${key}" is not ${standard.propertyNaming}. This project names properties like ${NAMING_EXAMPLES[standard.propertyNaming]}.`,
    );
  }
}

/**
 * RS002, over query parameters. Path parameters are exempt: their names are
 * taken from the path, which RS010 governs under the path convention instead.
 */
function checkParameterNaming(
  parameters: readonly Parameter[],
  standard: ResponseStandard,
  report: Report,
): void {
  for (const [index, parameter] of parameters.entries()) {
    if (parameter.location !== 'query') continue;
    if (matchesConvention(parameter.name, standard.propertyNaming)) continue;
    report(
      'RS002',
      `/parameters/${index}/name`,
      `Query parameter "${parameter.name}" is not ${standard.propertyNaming}.`,
    );
  }
}

/** RS010. Literal path segments follow the path convention; parameters do not. */
function checkPathNaming(
  endpoint: Endpoint,
  standard: ResponseStandard,
  report: Report,
): void {
  const segments = endpoint.path.split('/').filter((s) => s.length > 0);

  for (const segment of segments) {
    if (segment.startsWith('{') && segment.endsWith('}')) continue;
    if (matchesConvention(segment, standard.pathNaming)) continue;
    report(
      'RS010',
      '/path',
      `"${segment}" is not ${standard.pathNaming}. This project names path segments like ${NAMING_EXAMPLES[standard.pathNaming]}.`,
    );
  }
}

function isSuccess(status: EndpointResponse['statusCode']): boolean {
  return typeof status === 'number' && status >= 200 && status < 300;
}

function isError(status: EndpointResponse['statusCode']): boolean {
  return status === 'default' || (typeof status === 'number' && status >= 400);
}

/** Schema property names, quoted; slot tokens carry their own `$` marker. */
function describeKeys(keys: readonly string[]): string {
  const quoted = keys.map((key) => `"${key}"`);
  if (quoted.length === 1) return quoted[0];
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

function describeTokens(tokens: readonly string[]): string {
  if (tokens.length === 1) return tokens[0];
  return `${tokens.slice(0, -1).join(', ')} and ${tokens.at(-1)}`;
}

function objectProperties(
  schema: unknown,
): Record<string, unknown> | undefined {
  if (typeof schema !== 'object' || schema === null) return undefined;
  const properties = (schema as Record<string, unknown>)['properties'];
  if (typeof properties !== 'object' || properties === null) return undefined;
  return properties as Record<string, unknown>;
}

function resolve(
  schema: unknown,
  resolveRef: ((ref: string) => unknown) | undefined,
): unknown {
  if (typeof schema !== 'object' || schema === null) return schema;
  const ref = (schema as Record<string, unknown>)['$ref'];
  if (typeof ref !== 'string' || !resolveRef) return schema;
  return resolveRef(ref) ?? schema;
}

function looksLikeCollection(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  const record = schema as Record<string, unknown>;
  if (record['type'] === 'array') return true;

  const properties = objectProperties(schema);
  if (!properties) return false;

  return Object.values(properties).some(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      (value as Record<string, unknown>)['type'] === 'array',
  );
}

/**
 * A property whose name says it holds a date. Matching the last word rather
 * than a substring keeps `updatedAt` and `expiry_date` in while leaving
 * `latitude` and `status` out, whichever convention the project names in.
 */
const DATE_WORDS = new Set(['date', 'time', 'at', 'timestamp', 'datetime']);

function isDateLikeName(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());

  const last = words.at(-1);
  return last !== undefined && DATE_WORDS.has(last);
}

interface SchemaNode {
  node: unknown;
  path: string;
  key: string;
}

/**
 * Walks a JSON Schema's named properties, yielding each with the pointer that
 * locates it. Composition keywords are followed so a property inside an `allOf`
 * branch is still checked; `$ref` is not, because a named schema is linted in
 * its own right rather than once per endpoint that points at it.
 */
function* walkSchema(
  schema: unknown,
  pointer: string,
  depth = 0,
): Generator<SchemaNode> {
  // A contract can nest deeply; the cap keeps one pathological schema from
  // stalling the sweep on a 1 vCPU host.
  if (depth > 12) return;
  if (typeof schema !== 'object' || schema === null) return;

  const record = schema as Record<string, unknown>;

  const properties = record['properties'];
  if (typeof properties === 'object' && properties !== null) {
    for (const [key, value] of Object.entries(properties)) {
      const path = `${pointer}/properties/${key}`;
      yield { node: value, path, key };
      yield* walkSchema(value, path, depth + 1);
    }
  }

  const items = record['items'];
  if (items !== undefined)
    yield* walkSchema(items, `${pointer}/items`, depth + 1);

  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = record[keyword];
    if (!Array.isArray(branches)) continue;
    for (const [index, branch] of branches.entries()) {
      yield* walkSchema(branch, `${pointer}/${keyword}/${index}`, depth + 1);
    }
  }
}

interface CodeValue {
  value: string;
  path: string;
}

/** Finds string constants under a property named `code`, wherever it sits. */
function* collectCodeValues(
  schema: unknown,
  pointer = '',
  depth = 0,
): Generator<CodeValue> {
  if (depth > 12) return;
  if (typeof schema !== 'object' || schema === null) return;

  const record = schema as Record<string, unknown>;
  const properties = record['properties'];

  if (typeof properties === 'object' && properties !== null) {
    for (const [key, value] of Object.entries(properties)) {
      const path = `${pointer}/properties/${key}`;
      if (key === 'code' && typeof value === 'object' && value !== null) {
        const field = value as Record<string, unknown>;
        const constant = field['const'];
        if (typeof constant === 'string') {
          yield { value: constant, path: `${path}/const` };
        }
        if (Array.isArray(field['enum'])) {
          for (const [index, member] of field['enum'].entries()) {
            if (typeof member === 'string') {
              yield { value: member, path: `${path}/enum/${index}` };
            }
          }
        }
      }
      yield* collectCodeValues(value, path, depth + 1);
    }
  }
}

/** The `code` values an example actually returns, at any depth. */
function* collectExampleCodes(value: unknown, depth = 0): Generator<string> {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const member of value) yield* collectExampleCodes(member, depth + 1);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  for (const [key, member] of Object.entries(value)) {
    if (key === 'code' && typeof member === 'string') yield member;
    else yield* collectExampleCodes(member, depth + 1);
  }
}
