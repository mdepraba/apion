/**
 * The response-standard seam. PRD 03 FR-4.8 makes this a correctness boundary:
 *
 * > The same standard engine must drive editor preview, mock responses, OpenAPI
 * > export and generated TypeScript. Re-declaring envelopes in each feature is
 * > prohibited.
 *
 * A project declares one envelope whose `$slots` are the fields every response
 * carries, for example:
 *
 *   { "status_code": "$status_code", "message": "$message",
 *     "data": "$data", "meta": "$meta" }
 *
 * The slot names are the project's own; nothing here has a fixed list. An
 * endpoint author then fills every declared slot when writing an example, and
 * the same envelope answers success and failure alike.
 */

/**
 * Anything of the form `$name` inside an envelope is a slot an author fills.
 * The pattern is the whole definition: a project adds a slot by writing one.
 */
const SLOT_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The slot that carries the endpoint's own payload. It is the one name the rest
 * of the product needs to recognise, because the schema an author writes
 * describes this slot and the generated types are shaped from it.
 */
export const DATA_SLOT = '$data';

/** Kept for contracts written before slots existed; treated as `$data`. */
export const PAYLOAD_TOKEN = '$payload';

export function isSlot(value: unknown): value is string {
  return typeof value === 'string' && SLOT_PATTERN.test(value);
}

/** True for the slot the author's payload schema describes. */
export function isDataSlot(value: unknown): boolean {
  return value === DATA_SLOT || value === PAYLOAD_TOKEN;
}

export interface SlotDescriptor {
  /** The token as written, for example `$status_code`. */
  token: string;
  /** The key it sits under, for example `status_code`. */
  key: string;
  /** JSON pointer to the slot inside the envelope. */
  pointer: string;
  /** True for the payload slot; its value is a schema, not a scalar. */
  isData: boolean;
}

/**
 * Every slot an envelope declares, in document order. This is what the example
 * editor renders one field for, and what lint checks an example against.
 */
export function envelopeSlots(envelope: unknown): SlotDescriptor[] {
  const slots: SlotDescriptor[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, pointer: string, key: string): void => {
    if (isSlot(node)) {
      if (seen.has(node)) return;
      seen.add(node);
      slots.push({ token: node, key, pointer, isData: isDataSlot(node) });
      return;
    }

    if (Array.isArray(node)) {
      for (const [index, member] of node.entries()) {
        walk(member, `${pointer}/${index}`, key);
      }
      return;
    }

    if (typeof node !== 'object' || node === null) return;

    for (const [childKey, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      walk(value, `${pointer}/${childKey}`, childKey);
    }
  };

  walk(envelope, '', '');
  return slots;
}

/** The slot an author's payload schema belongs to, when the envelope has one. */
export function dataSlot(envelope: unknown): SlotDescriptor | undefined {
  return envelopeSlots(envelope).find((slot) => slot.isData);
}

export type NamingConvention =
  | 'camelCase'
  | 'snake_case'
  | 'kebab-case'
  | 'PascalCase';

export type RuleSeverity = 'error' | 'warn' | 'off';

/** FR-4.4. Ids are stable because exemptions and history reference them. */
export const RULE_IDS = [
  'RS001',
  'RS002',
  'RS003',
  'RS004',
  'RS005',
  'RS006',
  'RS007',
  'RS008',
  'RS009',
  'RS010',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  RS001: 'A response does not fill every slot the envelope declares',
  RS002: 'Property naming violates the configured convention',
  RS003: 'Error response is absent or has the wrong envelope',
  RS004: 'Error code is outside the registry',
  RS005: 'Status is not allowed for its HTTP method',
  RS006: 'Collection response lacks the configured pagination shape',
  RS007: 'Date and time fields use the wrong format',
  RS008: 'A required response header is absent',
  RS009: 'A required error status class has no response',
  RS010: 'Path segment violates naming rules',
};

export interface ResponseStandard {
  /** Bumped on publish. Endpoints cache the version they were linted against. */
  version: number;
  /**
   * The one envelope every response wears, success and failure alike. Its
   * `$slots` are what an endpoint author fills in per response.
   */
  envelope: unknown;
  errorCodes: readonly string[];
  propertyNaming: NamingConvention;
  pathNaming: NamingConvention;
  allowedStatusesByMethod: Readonly<Record<string, readonly number[]>>;
  requiredResponseHeaders: readonly string[];
  pagination: {
    style: 'cursor' | 'offset' | 'page' | 'none';
    maxLimit: number;
  };
  dateFormat: 'rfc3339' | 'iso8601-date' | 'unix-seconds';
  timeZone: string;
  /**
   * Whether the rules run at all. Off means no violations, so nothing blocks
   * approval or publication, while each rule keeps the severity it was given.
   * Absent on a standard stored before the switch existed, which was being
   * enforced, so absent reads as on.
   */
  rulesEnabled?: boolean;
  severities: Readonly<Record<RuleId, RuleSeverity>>;
}

export interface Violation {
  ruleId: RuleId;
  severity: Exclude<RuleSeverity, 'off'>;
  /** JSON pointer into the endpoint, so the editor can jump to the field. */
  pointer: string;
  message: string;
}

/** The values an author supplied, keyed by slot token (`$data`, `$meta`, …). */
export type SlotValues = Readonly<Record<string, unknown>>;

/**
 * Builds the wire body by putting each authored value into its slot. This is
 * the one function the editor preview, the mock engine, the OpenAPI exporter
 * and the TypeScript generator all call; none of them may construct an envelope
 * itself.
 *
 * A slot the author left out keeps its token, so the gap is visible in a
 * preview rather than silently rendering as null.
 */
export function fillEnvelope(
  standard: ResponseStandard,
  values: SlotValues,
): unknown {
  return substitute(standard.envelope, values);
}

/**
 * The older single-payload call, kept so a caller that only has a payload still
 * works: the payload goes to the data slot and every other slot keeps its token.
 */
export function wrapPayload(
  standard: ResponseStandard,
  payload: unknown,
): unknown {
  return fillEnvelope(standard, { [DATA_SLOT]: payload });
}

function substitute(node: unknown, values: SlotValues): unknown {
  if (isSlot(node)) {
    if (node in values) return values[node];
    // `$payload` and `$data` are the same slot under two spellings.
    if (isDataSlot(node)) {
      if (DATA_SLOT in values) return values[DATA_SLOT];
      if (PAYLOAD_TOKEN in values) return values[PAYLOAD_TOKEN];
    }
    return node;
  }

  if (Array.isArray(node)) return node.map((item) => substitute(item, values));
  if (typeof node !== 'object' || node === null) return node;

  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [
      key,
      substitute(value, values),
    ]),
  );
}

/**
 * The `Simple` preset from FR-4.7, and the default a project starts from.
 * Three slots: the HTTP status, a human message, and the payload.
 */
export function simpleStandard(): ResponseStandard {
  return {
    version: 1,
    envelope: {
      status_code: '$status_code',
      message: '$message',
      data: DATA_SLOT,
    },
    errorCodes: [
      'VALIDATION_FAILED',
      'NOT_FOUND',
      'UNAUTHORIZED',
      'INTERNAL_ERROR',
    ],
    propertyNaming: 'camelCase',
    pathNaming: 'kebab-case',
    allowedStatusesByMethod: {
      get: [200, 206, 304, 400, 401, 403, 404, 429, 500],
      post: [200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 429, 500],
      put: [200, 204, 400, 401, 403, 404, 409, 422, 429, 500],
      patch: [200, 204, 400, 401, 403, 404, 409, 422, 429, 500],
      delete: [200, 202, 204, 400, 401, 403, 404, 409, 429, 500],
    },
    requiredResponseHeaders: [],
    pagination: { style: 'cursor', maxLimit: 100 },
    dateFormat: 'rfc3339',
    timeZone: 'UTC',
    rulesEnabled: true,
    severities: Object.fromEntries(
      RULE_IDS.map((id) => [id, 'error']),
    ) as Record<RuleId, RuleSeverity>,
  };
}
