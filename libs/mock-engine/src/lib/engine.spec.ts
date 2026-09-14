import type { Endpoint, EndpointResponse } from '@apion/contracts';
import { simpleStandard } from '@apion/response-standard';
import { describe, expect, it } from 'vitest';
import { ResponseCache, truncateIp } from './controls.js';
import { MockEngine } from './engine.js';
import { generateFromSchema } from './generate.js';
import { SeededRandom } from './random.js';
import { parsePrefer, selectResponse } from './selection.js';
import { RequestValidator } from './validate.js';

function response(overrides: Partial<EndpointResponse> = {}): EndpointResponse {
  return {
    id: `r-${overrides.statusCode ?? 200}`,
    statusCode: 200,
    description: '',
    headers: [],
    payloadSchema: null,
    examples: [],
    ...overrides,
  };
}

function endpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'e1',
    versionId: 'v1',
    resourceId: 'res1',
    method: 'get',
    path: '/orders',
    summary: 'List orders',
    description: '',
    operationId: null,
    parameters: [],
    requestBody: null,
    responses: [],
    authRequired: true,
    deprecated: false,
    ownerId: null,
    ticketUrl: null,
    tags: [],
    position: 0,
    entityVersion: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

function engineFor(endpoints: Endpoint[]): MockEngine {
  return new MockEngine({
    projectId: 'p1',
    versionId: 'v1',
    endpoints,
    standard: simpleStandard(),
    locale: 'en',
  });
}

const baseRequest = {
  query: {},
  headers: {},
  requestId: 'req-1',
  environmentKey: 'dev',
} as const;

describe('routing', () => {
  it('answers a missing route in the contract envelope', () => {
    const result = engineFor([endpoint()]).handle(
      { ...baseRequest, method: 'get', path: '/nope' },
      { validateRequests: false },
    );

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body ?? '{}');
    // The project's own envelope, filled: status, message and a null payload.
    expect(body.status_code).toBe(404);
    expect(typeof body.message).toBe('string');
    expect(JSON.stringify(body)).not.toContain('$');
  });

  it('answers a method mismatch with 405 and Allow', () => {
    const result = engineFor([endpoint()]).handle(
      { ...baseRequest, method: 'post', path: '/orders' },
      { validateRequests: false },
    );

    expect(result.statusCode).toBe(405);
    expect(result.headers['allow']).toBe('GET');
  });

  it('prefers a literal segment over a parameter', () => {
    const result = engineFor([
      endpoint({ id: 'by-id', path: '/orders/{id}', responses: [response()] }),
      endpoint({
        id: 'export',
        path: '/orders/export',
        responses: [response()],
      }),
    ]).handle(
      { ...baseRequest, method: 'get', path: '/orders/export' },
      { validateRequests: false },
    );

    expect(result.diagnostics.endpointId).toBe('export');
  });
});

describe('response selection', () => {
  const withResponses = endpoint({
    responses: [
      response({
        statusCode: 200,
        examples: [
          {
            id: 'x1',
            name: 'twoOrders',
            summary: '',
            isDefault: true,
            value: [{ id: 'ord_1' }],
          },
          {
            id: 'x2',
            name: 'emptyList',
            summary: '',
            isDefault: false,
            value: [],
          },
        ],
      }),
      response({ statusCode: 404, id: 'r404' }),
    ],
  });

  it('honours Prefer: code before anything else', () => {
    const selection = selectResponse(withResponses, { prefer: { code: 404 } });
    expect(selection?.response.statusCode).toBe(404);
    expect(selection?.source).toBe('prefer-code');
  });

  it('honours Prefer: example over the default example', () => {
    const selection = selectResponse(withResponses, {
      prefer: { example: 'emptyList' },
    });
    expect(selection?.example?.value).toEqual([]);
    expect(selection?.source).toBe('prefer-example');
  });

  it('falls back to the default example', () => {
    const selection = selectResponse(withResponses, {});
    expect(selection?.example?.name).toBe('twoOrders');
    expect(selection?.source).toBe('default-example');
  });

  it('takes the lowest 2xx when nothing else applies', () => {
    const selection = selectResponse(
      endpoint({
        responses: [
          response({ statusCode: 404, id: 'a' }),
          response({ statusCode: 201, id: 'b' }),
          response({ statusCode: 200, id: 'c' }),
        ],
      }),
      {},
    );

    expect(selection?.response.statusCode).toBe(200);
    expect(selection?.source).toBe('generated');
  });

  it('lets a scenario override the example', () => {
    const selection = selectResponse(withResponses, {
      scenarioRules: [
        {
          endpointId: null,
          statusCode: null,
          exampleName: 'emptyList',
          delayMs: null,
        },
      ],
    });

    expect(selection?.source).toBe('scenario');
    expect(selection?.example?.value).toEqual([]);
  });

  it('prefers a scenario rule aimed at this endpoint over the blanket one', () => {
    const selection = selectResponse(withResponses, {
      scenarioRules: [
        { endpointId: null, statusCode: 200, exampleName: null, delayMs: null },
        {
          endpointId: 'e1',
          statusCode: 404,
          exampleName: null,
          delayMs: null,
        },
      ],
    });

    expect(selection?.response.statusCode).toBe(404);
  });

  it('ignores a scenario asking for a status the contract does not declare', () => {
    const selection = selectResponse(withResponses, {
      scenarioRules: [
        { endpointId: null, statusCode: 503, exampleName: null, delayMs: null },
      ],
    });

    // Falls through to the default example rather than inventing a 503.
    expect(selection?.source).toBe('default-example');
  });

  it('parses the Prefer header', () => {
    expect(parsePrefer('code=404')).toEqual({ code: 404 });
    expect(parsePrefer('example=emptyList')).toEqual({ example: 'emptyList' });
    expect(parsePrefer('code=404, example=gone')).toEqual({
      code: 404,
      example: 'gone',
    });
    expect(parsePrefer(undefined)).toBeUndefined();
    expect(parsePrefer('respond-async')).toBeUndefined();
  });
});

describe('the response standard owns the envelope', () => {
  it('serves the slot values an author wrote', () => {
    const result = engineFor([
      endpoint({
        responses: [
          response({
            examples: [
              {
                id: 'x',
                name: 'one',
                summary: '',
                isDefault: true,
                value: {
                  $status_code: 200,
                  $message: 'Order found.',
                  $data: { id: 'ord_1' },
                },
              },
            ],
          }),
        ],
      }),
    ]).handle(
      { ...baseRequest, method: 'get', path: '/orders' },
      { validateRequests: false },
    );

    expect(JSON.parse(result.body ?? '{}')).toEqual({
      status_code: 200,
      message: 'Order found.',
      data: { id: 'ord_1' },
    });
  });

  it('reads an example written before slots as the data slot', () => {
    const result = engineFor([
      endpoint({
        responses: [
          response({
            examples: [
              {
                id: 'x',
                name: 'one',
                summary: '',
                isDefault: true,
                value: { id: 'ord_1' },
              },
            ],
          }),
        ],
      }),
    ]).handle(
      { ...baseRequest, method: 'get', path: '/orders' },
      { validateRequests: false },
    );

    const body = JSON.parse(result.body ?? '{}');
    expect(body.data).toEqual({ id: 'ord_1' });
    // The slots the author never wrote are filled, not left as tokens.
    expect(body.status_code).toBe(200);
    expect(JSON.stringify(body)).not.toContain('$');
  });

  it('wraps a generated payload in the same envelope', () => {
    const result = engineFor([
      endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
          }),
        ],
      }),
    ]).handle(
      { ...baseRequest, method: 'get', path: '/orders' },
      { validateRequests: false },
    );

    const body = JSON.parse(result.body ?? '{}');
    expect(Object.keys(body)).toEqual(['status_code', 'message', 'data']);
    expect(typeof body.data.id).toBe('string');
  });

  it('returns no body for 204', () => {
    const result = engineFor([
      endpoint({
        method: 'delete',
        path: '/orders/{id}',
        responses: [response({ statusCode: 204 })],
      }),
    ]).handle(
      { ...baseRequest, method: 'delete', path: '/orders/1' },
      { validateRequests: false },
    );

    expect(result.statusCode).toBe(204);
    expect(result.body).toBeNull();
  });
});

describe('error responses', () => {
  it('never puts envelope tokens on the wire', () => {
    // A declared failure with no example and no schema still has to answer
    // something a client can parse, not a literal "$code".
    const result = engineFor([
      endpoint({
        responses: [
          response({ statusCode: 200 }),
          response({ statusCode: 404, id: 'r404' }),
        ],
      }),
    ]).handle(
      {
        ...baseRequest,
        method: 'get',
        path: '/orders',
        headers: { prefer: 'code=404' },
      },
      { validateRequests: false },
    );

    expect(result.statusCode).toBe(404);
    const body = result.body ?? '';
    // No slot may reach a client as its own token.
    expect(body).not.toContain('$');
    expect(JSON.parse(body).status_code).toBe(404);
    expect(typeof JSON.parse(body).message).toBe('string');
  });

  it('keeps an authored error example exactly as written', () => {
    const result = engineFor([
      endpoint({
        responses: [
          response({ statusCode: 200 }),
          response({
            statusCode: 404,
            id: 'r404',
            examples: [
              {
                id: 'x',
                name: 'gone',
                summary: '',
                isDefault: true,
                value: {
                  $status_code: 404,
                  $message: 'No such order.',
                  $data: null,
                },
              },
            ],
          }),
        ],
      }),
    ]).handle(
      {
        ...baseRequest,
        method: 'get',
        path: '/orders',
        headers: { prefer: 'code=404' },
      },
      { validateRequests: false },
    );

    expect(JSON.parse(result.body ?? '{}')).toEqual({
      status_code: 404,
      message: 'No such order.',
      data: null,
    });
  });
});

describe('determinism', () => {
  const schemaEndpoint = endpoint({
    path: '/orders/{orderId}',
    responses: [
      response({
        payloadSchema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            total: { type: 'integer' },
          },
          required: ['orderId', 'total'],
        },
      }),
    ],
  });

  it('answers the same request identically', () => {
    const engine = engineFor([schemaEndpoint]);
    const call = () =>
      engine.handle(
        { ...baseRequest, method: 'get', path: '/orders/42' },
        { validateRequests: false },
      ).body;

    expect(call()).toBe(call());
  });

  it('answers different path parameters differently', () => {
    const engine = engineFor([schemaEndpoint]);
    const first = engine.handle(
      { ...baseRequest, method: 'get', path: '/orders/1' },
      { validateRequests: false },
    ).body;
    const second = engine.handle(
      { ...baseRequest, method: 'get', path: '/orders/2' },
      { validateRequests: false },
    ).body;

    expect(first).not.toBe(second);
  });

  it('echoes a captured path parameter into a field of the same name', () => {
    const result = engineFor([schemaEndpoint]).handle(
      { ...baseRequest, method: 'get', path: '/orders/ord_777' },
      { validateRequests: false },
    );

    expect(JSON.parse(result.body ?? '{}').data.orderId).toBe('ord_777');
  });

  it('bypasses the cache for X-Mock-Seed: random', () => {
    const cache = new ResponseCache();
    const engine = engineFor([schemaEndpoint]);

    const result = engine.handle(
      {
        ...baseRequest,
        method: 'get',
        path: '/orders/42',
        headers: { 'x-mock-seed': 'random' },
      },
      { validateRequests: false, cache },
    );

    expect(result.diagnostics.cache).toBe('bypass');
    expect(cache.count).toBe(0);
  });

  it('reports a cache hit on the second identical request', () => {
    const cache = new ResponseCache();
    const engine = engineFor([schemaEndpoint]);
    const request = {
      ...baseRequest,
      method: 'get' as const,
      path: '/orders/42',
    };

    expect(
      engine.handle(request, { validateRequests: false, cache }).diagnostics
        .cache,
    ).toBe('miss');
    expect(
      engine.handle(request, { validateRequests: false, cache }).diagnostics
        .cache,
    ).toBe('hit');
  });
});

describe('request validation', () => {
  const validated = endpoint({
    method: 'post',
    path: '/orders',
    requestBody: {
      description: '',
      required: true,
      contentType: 'application/json',
      schema: {
        type: 'object',
        properties: { total: { type: 'integer', minimum: 1 } },
        required: ['total'],
      },
    },
    responses: [response({ statusCode: 201 })],
  });

  it('rejects a body that does not match, in the project envelope', () => {
    const result = engineFor([validated]).handle(
      {
        ...baseRequest,
        method: 'post',
        path: '/orders',
        body: { total: 'lots' },
      },
      { validateRequests: true },
    );

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body ?? '{}');
    expect(body.status_code).toBe(400);
    expect(body.message).toContain('does not match');
    expect(body.details[0].pointer).toBe('/body/total');
  });

  it('names a missing required property', () => {
    const result = engineFor([validated]).handle(
      { ...baseRequest, method: 'post', path: '/orders', body: {} },
      { validateRequests: true },
    );

    expect(JSON.parse(result.body ?? '{}').details[0].message).toContain(
      'total',
    );
  });

  it('accepts a valid body', () => {
    const result = engineFor([validated]).handle(
      { ...baseRequest, method: 'post', path: '/orders', body: { total: 5 } },
      { validateRequests: true },
    );

    expect(result.statusCode).toBe(201);
    expect(result.diagnostics.validation).toBe('passed');
  });

  it('lets one request opt out with X-Mock-Validate: off', () => {
    const result = engineFor([validated]).handle(
      {
        ...baseRequest,
        method: 'post',
        path: '/orders',
        body: { total: 'lots' },
        headers: { 'x-mock-validate': 'off' },
      },
      { validateRequests: true },
    );

    expect(result.statusCode).toBe(201);
    expect(result.diagnostics.validation).toBe('skipped');
  });

  it('coerces a query parameter before checking its type', () => {
    const problems = new RequestValidator().validate({
      endpoint: endpoint({
        parameters: [
          {
            name: 'limit',
            location: 'query',
            description: '',
            required: false,
            deprecated: false,
            schema: { type: 'integer', maximum: 100 },
          },
        ],
      }),
      pathParams: {},
      query: { limit: '50' },
      headers: {},
      body: undefined,
    });

    expect(problems).toEqual([]);
  });

  it('validates a body behind nested $refs, reusing one validator', () => {
    // The regression this guards: an unresolvable or too-deep `$ref` used to
    // inline as `true`, which is illegal as a `type` value, so the whole schema
    // failed to compile and every request was waved through as valid.
    const money = {
      type: 'object',
      required: ['amount', 'currency'],
      properties: { amount: { type: 'integer' }, currency: { type: 'string' } },
    };
    const line = {
      type: 'object',
      required: ['sku', 'unitPrice'],
      properties: {
        sku: { type: 'string' },
        unitPrice: { $ref: '#/components/schemas/Money' },
      },
    };
    const order = {
      type: 'object',
      required: ['id', 'total'],
      properties: {
        id: { type: 'string' },
        total: { $ref: '#/components/schemas/Money' },
        lines: {
          type: 'array',
          items: { $ref: '#/components/schemas/OrderLine' },
        },
      },
    };

    const byName: Record<string, unknown> = {
      Money: money,
      OrderLine: line,
      Order: order,
    };

    const validator = new RequestValidator();
    const withBody = endpoint({
      method: 'post',
      requestBody: {
        description: '',
        required: true,
        contentType: 'application/json',
        schema: { $ref: '#/components/schemas/Order' },
      },
    });

    // Twice, because one shared validator serves every endpoint of a project.
    for (const _pass of [1, 2]) {
      const problems = validator.validate({
        endpoint: withBody,
        pathParams: {},
        query: {},
        headers: {},
        body: { lines: [{ sku: 'a' }] },
        resolveRef: (ref) => byName[ref.split('/').pop() ?? ''],
      });

      expect(problems.map((p) => p.message)).toContain(
        'must have required property "id"',
      );
      expect(problems.some((p) => p.pointer.startsWith('/body/lines/0'))).toBe(
        true,
      );
    }

    expect(validator.drainSchemaProblems()).toEqual([]);
  });

  it('reports a query parameter outside its range', () => {
    const problems = new RequestValidator().validate({
      endpoint: endpoint({
        parameters: [
          {
            name: 'limit',
            location: 'query',
            description: '',
            required: false,
            deprecated: false,
            schema: { type: 'integer', maximum: 100 },
          },
        ],
      }),
      pathParams: {},
      query: { limit: '500' },
      headers: {},
      body: undefined,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].pointer).toBe('/query/limit');
  });
});

describe('diagnostic headers', () => {
  it('reports endpoint, source, version and cache result', () => {
    const result = engineFor([endpoint({ responses: [response()] })]).handle(
      { ...baseRequest, method: 'get', path: '/orders' },
      { validateRequests: false },
    );

    expect(result.headers['x-mock-endpoint-id']).toBe('e1');
    expect(result.headers['x-mock-contract-version']).toBe('v1');
    expect(result.headers['x-mock-source']).toBeTruthy();
    expect(result.headers['x-mock-cache']).toBeTruthy();
  });
});

describe('generation', () => {
  it('honours enum, const and format', () => {
    const value = generateFromSchema(
      {
        type: 'object',
        properties: {
          state: { enum: ['open', 'closed'] },
          kind: { const: 'order' },
          id: { type: 'string', format: 'uuid' },
        },
        required: ['state', 'kind', 'id'],
      },
      { random: SeededRandom.from('seed'), locale: 'en' },
    ) as Record<string, string>;

    expect(['open', 'closed']).toContain(value['state']);
    expect(value['kind']).toBe('order');
    expect(value['id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('respects the standard pagination ceiling for arrays', () => {
    const value = generateFromSchema(
      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
      { random: SeededRandom.from('seed'), locale: 'en', maxItems: 3 },
    ) as unknown[];

    expect(value.length).toBeLessThanOrEqual(3);
  });

  it('generates Indonesian sample data for the id_ID locale', () => {
    const en = generateFromSchema(
      {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      { random: SeededRandom.from('same'), locale: 'en' },
    ) as Record<string, string>;

    const id = generateFromSchema(
      {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      { random: SeededRandom.from('same'), locale: 'id_ID' },
    ) as Record<string, string>;

    expect(en['city']).not.toBe(id['city']);
  });
});

describe('cache', () => {
  it('evicts the oldest entry once it is over budget', () => {
    const cache = new ResponseCache(200);
    cache.set('p1:a', 'x'.repeat(120));
    cache.set('p1:b', 'y'.repeat(120));

    expect(cache.get('p1:a')).toBeUndefined();
    expect(cache.get('p1:b')).toBeDefined();
  });

  it('drops one project without touching another', () => {
    const cache = new ResponseCache();
    cache.set('p1:a', 'one');
    cache.set('p2:a', 'two');

    cache.invalidateProject('p1');

    expect(cache.get('p1:a')).toBeUndefined();
    expect(cache.get('p2:a')).toBe('two');
  });
});

describe('caller ip truncation', () => {
  it('keeps the network and drops the host', () => {
    expect(truncateIp('203.0.113.45')).toBe('203.0.113.0');
    expect(truncateIp('2001:db8:1234:5678::1')).toBe('2001:db8:1234::');
    expect(truncateIp(undefined)).toBeNull();
  });
});
