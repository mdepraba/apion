import type {
  Endpoint,
  HttpMethod,
  MockLocale,
  ScenarioRule,
} from '@apion/contracts';
import {
  DATA_SLOT,
  envelopeSlots,
  fillEnvelope,
  PAYLOAD_TOKEN,
  type ResponseStandard,
  slotValuesOf,
  wireExample,
  wrapPayload,
} from '@apion/response-standard';
import {
  cacheKey,
  type FaultControls,
  MAX_PAYLOAD_BYTES,
  NO_FAULTS,
  type ResponseCache,
} from './controls.js';
import { generateFromSchema } from './generate.js';
import { SeededRandom } from './random.js';
import { RouteTable } from './route-matcher.js';
import {
  parsePrefer,
  type SelectionSource,
  selectResponse,
} from './selection.js';
import { RequestValidator, type ValidationProblem } from './validate.js';

/**
 * The mock engine. It turns one HTTP request against a contract into the
 * response that contract describes, with the project's response standard
 * applied (FR-4.8: this must not build its own envelope).
 *
 * It performs no I/O. The caller supplies the contract, the standard and the
 * cache, which is what makes the engine testable and what preserves PRD 07's
 * option of extracting it to a standalone service later.
 */

export interface MockContract {
  projectId: string;
  versionId: string;
  endpoints: readonly Endpoint[];
  standard: ResponseStandard;
  locale: MockLocale;
  /** Resolves `#/components/schemas/Name` against the version's schemas. */
  resolveRef?: (ref: string) => unknown;
}

export interface MockRequest {
  method: HttpMethod;
  /** The contract path, with the `/mock/<org>/<project>/<env>` prefix removed. */
  path: string;
  query: Readonly<Record<string, string | string[]>>;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body?: unknown;
  requestId: string;
  environmentKey: string;
}

export interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  /** Serialised here so the cache stores exactly what goes on the wire. */
  body: string | null;
  diagnostics: {
    endpointId: string | null;
    source: SelectionSource | 'not-found' | 'method-not-allowed' | 'validation';
    cache: 'hit' | 'miss' | 'bypass';
    validation: 'passed' | 'failed' | 'skipped';
    faults: FaultControls;
    /** The delay the caller should apply before sending this. */
    delayMs: number;
  };
}

export interface EngineOptions {
  validateRequests: boolean;
  scenarioRules?: readonly ScenarioRule[];
  scenarioName?: string;
  cache?: ResponseCache;
}

export class MockEngine {
  private readonly table: RouteTable<Endpoint>;
  private readonly validator: RequestValidator;

  constructor(
    private readonly contract: MockContract,
    validator: RequestValidator = new RequestValidator(),
  ) {
    this.table = new RouteTable(
      contract.endpoints.map((endpoint) => ({
        method: endpoint.method,
        path: endpoint.path,
        value: endpoint,
      })),
    );
    this.validator = validator;
  }

  /** The `/__mock/routes` listing, in the order the engine will match them. */
  routes(): readonly Endpoint[] {
    return this.contract.endpoints;
  }

  handle(request: MockRequest, options: EngineOptions): MockResponse {
    const match = this.table.match(request.method, request.path);

    if (match.outcome === 'not_found') {
      return this.error(
        404,
        'MOCK_ROUTE_NOT_FOUND',
        `No endpoint in this contract answers ${request.method.toUpperCase()} ${request.path}.`,
        { endpointId: null, source: 'not-found' },
      );
    }

    if (match.outcome === 'method_not_allowed') {
      const response = this.error(
        405,
        'MOCK_METHOD_NOT_ALLOWED',
        `${request.method.toUpperCase()} is not declared for ${request.path}.`,
        { endpointId: null, source: 'method-not-allowed' },
      );
      response.headers['allow'] = match.allowed
        .map((method) => method.toUpperCase())
        .join(', ');
      return response;
    }

    const endpoint = match.match.route.value;
    const pathParams = match.match.params;

    const validation = this.runValidation(
      endpoint,
      request,
      pathParams,
      options,
    );

    if (validation.problems.length > 0) {
      return this.validationFailure(endpoint, validation.problems);
    }

    return this.serve(endpoint, pathParams, request, options, validation.state);
  }

  private runValidation(
    endpoint: Endpoint,
    request: MockRequest,
    pathParams: Record<string, string>,
    options: EngineOptions,
  ): { problems: ValidationProblem[]; state: 'passed' | 'failed' | 'skipped' } {
    // FR-6.5: a single request can opt out with `X-Mock-Validate: off`.
    const off = header(request.headers, 'x-mock-validate') === 'off';
    if (!options.validateRequests || off) {
      return { problems: [], state: 'skipped' };
    }

    const problems = this.validator.validate({
      endpoint,
      pathParams,
      query: request.query,
      headers: request.headers,
      body: request.body,
      resolveRef: this.contract.resolveRef,
    });

    return {
      problems,
      state: problems.length > 0 ? 'failed' : 'passed',
    };
  }

  private serve(
    endpoint: Endpoint,
    pathParams: Record<string, string>,
    request: MockRequest,
    options: EngineOptions,
    validationState: 'passed' | 'failed' | 'skipped',
  ): MockResponse {
    const seedHeader = header(request.headers, 'x-mock-seed');
    const randomSeed = seedHeader === 'random';

    const selection = selectResponse(endpoint, {
      prefer: parsePrefer(header(request.headers, 'prefer')),
      scenarioName: options.scenarioName,
      scenarioRules: options.scenarioRules,
    });

    if (!selection) {
      return this.error(
        501,
        'MOCK_NO_RESPONSE',
        'This endpoint declares no responses yet, so the mock has nothing to return.',
        { endpointId: endpoint.id, source: 'generated' },
      );
    }

    const statusCode =
      typeof selection.response.statusCode === 'number'
        ? selection.response.statusCode
        : 200;

    if (statusCode === 204) {
      return {
        statusCode,
        headers: this.diagnosticHeaders(endpoint, selection.source, 'bypass'),
        body: null,
        diagnostics: {
          endpointId: endpoint.id,
          source: selection.source,
          cache: 'bypass',
          validation: validationState,
          faults: NO_FAULTS,
          delayMs: selection.delayMs ?? 0,
        },
      };
    }

    const key = cacheKey({
      projectId: this.contract.projectId,
      versionId: this.contract.versionId,
      endpointId: endpoint.id,
      selection: `${selection.source}:${statusCode}:${selection.example?.name ?? '-'}`,
      seed: randomSeed ? 'random' : (seedHeader ?? stableSeed(pathParams)),
    });

    // A random seed defeats the point of a cache, so it bypasses rather than
    // poisoning the entry a deterministic caller would read next.
    const cached = randomSeed ? undefined : options.cache?.get(key);
    if (cached !== undefined) {
      return {
        statusCode,
        headers: this.diagnosticHeaders(endpoint, selection.source, 'hit'),
        body: cached,
        diagnostics: {
          endpointId: endpoint.id,
          source: selection.source,
          cache: 'hit',
          validation: validationState,
          faults: NO_FAULTS,
          delayMs: selection.delayMs ?? 0,
        },
      };
    }

    const random = randomSeed
      ? new SeededRandom(Math.floor(Math.random() * 2 ** 32))
      : SeededRandom.from(
          this.contract.projectId,
          endpoint.id,
          seedHeader ?? '',
          stableSeed(pathParams),
        );

    // An authored example already carries a value per slot. Without one, the
    // data slot is generated from the schema and the rest are filled below.
    const authored: Record<string, unknown> =
      selection.example === undefined
        ? {
            [DATA_SLOT]: generateFromSchema(selection.response.payloadSchema, {
              random,
              locale: this.contract.locale,
              context: { ...pathParams, ...scalarQuery(request.query) },
              resolveRef: this.contract.resolveRef,
              maxItems: this.contract.standard.pagination.maxLimit,
            }),
          }
        : { ...slotValuesOf(selection.example.value) };

    // A slot the author left unfilled would otherwise put its own token on the
    // wire. A preview may show that gap; a served response may not.
    const slotValues = this.completeSlots(authored, statusCode, selection);

    // FR-4.8: the envelope comes from the standard, never from here.
    const wrapped = wireExample(
      this.contract.standard,
      selection.response,
      slotValues,
    );

    const body = JSON.stringify(wrapped);

    if (body.length > MAX_PAYLOAD_BYTES) {
      return this.error(
        502,
        'MOCK_PAYLOAD_TOO_LARGE',
        'The generated payload exceeded the 1 MB mock limit. Narrow the schema or add an example.',
        { endpointId: endpoint.id, source: selection.source },
      );
    }

    if (!randomSeed && options.cache) options.cache.set(key, body);

    return {
      statusCode,
      headers: this.diagnosticHeaders(
        endpoint,
        selection.source,
        randomSeed ? 'bypass' : 'miss',
      ),
      body,
      diagnostics: {
        endpointId: endpoint.id,
        source: selection.source,
        cache: randomSeed ? 'bypass' : 'miss',
        validation: validationState,
        faults: NO_FAULTS,
        delayMs: selection.delayMs ?? 0,
      },
    };
  }

  /** FR-6.5: a failure answers in the project's envelope, not the engine's. */
  private validationFailure(
    endpoint: Endpoint,
    problems: readonly ValidationProblem[],
  ): MockResponse {
    const code = this.contract.standard.errorCodes.includes('VALIDATION_FAILED')
      ? 'VALIDATION_FAILED'
      : (this.contract.standard.errorCodes[0] ?? 'VALIDATION_FAILED');

    const body = JSON.stringify(
      this.envelopeError(
        code,
        'The request does not match the contract.',
        400,
        {
          details: problems.map((problem) => ({
            pointer: problem.pointer,
            message: problem.message,
          })),
        },
      ),
    );

    return {
      statusCode: 400,
      headers: this.diagnosticHeaders(endpoint, 'generated', 'bypass'),
      body,
      diagnostics: {
        endpointId: endpoint.id,
        source: 'validation',
        cache: 'bypass',
        validation: 'failed',
        faults: NO_FAULTS,
        delayMs: 0,
      },
    };
  }

  /** A mock-level failure, still wearing the project's error envelope. */
  private error(
    statusCode: number,
    code: string,
    message: string,
    context: {
      endpointId: string | null;
      source: MockResponse['diagnostics']['source'];
    },
  ): MockResponse {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json',
        'x-mock-source': context.source,
      },
      body: JSON.stringify(this.envelopeError(code, message, statusCode)),
      diagnostics: {
        endpointId: context.endpointId,
        source: context.source,
        cache: 'bypass',
        validation: 'skipped',
        faults: NO_FAULTS,
        delayMs: 0,
      },
    };
  }

  /**
   * Fills every slot the envelope declares, so nothing reaches a client as a
   * bare `$token`. Values the author supplied win; the rest are derived from
   * the response the contract already states.
   */
  private completeSlots(
    authored: Record<string, unknown>,
    statusCode: number,
    selection: { response: { description: string } },
  ): Record<string, unknown> {
    const values = { ...authored };

    for (const slot of envelopeSlots(this.contract.standard.envelope)) {
      if (slot.token in values) continue;
      if (slot.isData && (DATA_SLOT in values || PAYLOAD_TOKEN in values)) {
        continue;
      }

      values[slot.token] = this.defaultForSlot(
        slot.token,
        statusCode,
        selection.response.description,
      );
    }

    return values;
  }

  /**
   * What a slot holds when nobody filled it. The status and its message come
   * from the contract; anything the mock cannot know becomes null rather than
   * an invented value.
   */
  private defaultForSlot(
    token: string,
    statusCode: number,
    description: string,
  ): unknown {
    switch (token) {
      case '$status_code':
      case '$status':
        return statusCode;
      case '$message':
      case '$title':
      case '$detail':
        return (
          description ||
          (statusCode >= 400
            ? `The contract declares ${statusCode} for this endpoint.`
            : 'OK')
        );
      case '$code':
        return statusCode >= 400
          ? codeForStatus(statusCode, this.contract.standard.errorCodes)
          : null;
      case '$type':
        return statusCode >= 400
          ? `https://apion.invalid/errors/${codeForStatus(
              statusCode,
              this.contract.standard.errorCodes,
            ).toLowerCase()}`
          : null;
      case '$errors':
        return [];
      default:
        return null;
    }
  }

  /**
   * A mock-level failure, wearing the project's envelope. The mock never
   * invents a shape: a client handling errors against the mock is handling
   * them against the contract.
   */
  private envelopeError(
    code: string,
    message: string,
    status: number,
    extra: { details?: unknown } = {},
  ): unknown {
    const values: Record<string, unknown> = {};

    for (const slot of envelopeSlots(this.contract.standard.envelope)) {
      values[slot.token] = slot.isData
        ? (extra.details ?? null)
        : this.defaultForSlot(slot.token, status, message);
    }

    // The code and message are this failure's own, not the contract's.
    if ('$code' in values) values['$code'] = code;
    if ('$message' in values) values['$message'] = message;

    const filled = fillEnvelope(this.contract.standard, values);

    // An envelope with no slots at all still has to answer something usable.
    if (filled === null || typeof filled !== 'object') {
      return {
        code,
        message,
        ...(extra.details ? { details: extra.details } : {}),
      };
    }

    return extra.details && !JSON.stringify(filled).includes('details')
      ? { ...(filled as object), details: extra.details }
      : filled;
  }

  /** FR-6.4's `X-Mock-*` headers, so a caller can see why it got this. */
  private diagnosticHeaders(
    endpoint: Endpoint,
    source: SelectionSource,
    cache: 'hit' | 'miss' | 'bypass',
  ): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-mock-endpoint-id': endpoint.id,
      'x-mock-source': source,
      'x-mock-contract-version': this.contract.versionId,
      'x-mock-cache': cache,
    };
  }
}

/** The success envelope for a payload, for callers outside the request path. */
export function wrapForPreview(
  standard: ResponseStandard,
  payload: unknown,
): unknown {
  return wrapPayload(standard, payload);
}

function header(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The registry code that best fits a status, so a generated failure names a
 * code the project actually publishes rather than inventing one.
 */
function codeForStatus(status: number, registry: readonly string[]): string {
  const preferred =
    status === 400 || status === 422
      ? 'VALIDATION_FAILED'
      : status === 401
        ? 'UNAUTHORIZED'
        : status === 403
          ? 'FORBIDDEN'
          : status === 404
            ? 'NOT_FOUND'
            : status === 409
              ? 'CONFLICT'
              : status === 429
                ? 'RATE_LIMITED'
                : 'INTERNAL_ERROR';

  if (registry.includes(preferred)) return preferred;
  return registry[0] ?? preferred;
}

/** Path parameters make the seed, so `/orders/1` and `/orders/2` differ. */
function stableSeed(pathParams: Readonly<Record<string, string>>): string {
  return Object.entries(pathParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function scalarQuery(
  query: Readonly<Record<string, string | string[]>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
}
