import type { Endpoint, EndpointResponse } from '@apion/contracts';
import { describe, expect, it } from 'vitest';
import { diffEndpoint, diffEndpointSets, summariseDiff } from './diff.js';

const response = (
  statusCode: number,
  payloadSchema: unknown = null,
): EndpointResponse => ({
  id: `res-${statusCode}`,
  statusCode,
  description: '',
  headers: [],
  payloadSchema,
  examples: [],
});

const endpoint = (overrides: Partial<Endpoint> = {}): Endpoint => ({
  id: 'e1',
  versionId: 'v1',
  resourceId: 'r1',
  method: 'get',
  path: '/orders',
  summary: 'List orders',
  description: '',
  operationId: null,
  parameters: [],
  requestBody: null,
  responses: [response(200)],
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
});

const reasons = (entries: ReturnType<typeof diffEndpoint>) =>
  entries.map((e) => `${e.kind}:${e.reason}`);

describe('diffEndpoint', () => {
  it('reports an added endpoint as additive', () => {
    expect(reasons(diffEndpoint(undefined, endpoint()))).toEqual([
      'additive:endpoint_added',
    ]);
  });

  it('reports a removed endpoint as breaking', () => {
    expect(reasons(diffEndpoint(endpoint(), undefined))).toEqual([
      'breaking:endpoint_removed',
    ]);
  });

  it('classifies a changed path as breaking', () => {
    const entries = diffEndpoint(endpoint(), endpoint({ path: '/v2/orders' }));
    expect(reasons(entries)).toContain('breaking:path_changed');
  });

  it('classifies a removed status code as breaking', () => {
    // PRD 02 acceptance: "a diff labels a removed response status ... as breaking".
    const before = endpoint({ responses: [response(200), response(404)] });
    const after = endpoint({ responses: [response(200)] });
    expect(reasons(diffEndpoint(before, after))).toContain(
      'breaking:status_code_removed',
    );
  });

  it('classifies an added status code as additive', () => {
    const before = endpoint({ responses: [response(200)] });
    const after = endpoint({ responses: [response(200), response(429)] });
    expect(reasons(diffEndpoint(before, after))).toContain(
      'additive:status_code_added',
    );
  });

  it('classifies a newly required request field as breaking', () => {
    // The other half of the PRD 02 acceptance criterion.
    const before = endpoint({
      requestBody: {
        description: '',
        required: true,
        contentType: 'application/json',
        schema: { type: 'object', properties: { note: { type: 'string' } } },
      },
    });
    const after = endpoint({
      requestBody: {
        description: '',
        required: true,
        contentType: 'application/json',
        schema: {
          type: 'object',
          properties: {
            note: { type: 'string' },
            currency: { type: 'string' },
          },
          required: ['currency'],
        },
      },
    });
    expect(reasons(diffEndpoint(before, after))).toContain(
      'breaking:required_request_field_added',
    );
  });

  it('treats an optional new request field as additive', () => {
    const before = endpoint({
      requestBody: {
        description: '',
        required: true,
        contentType: 'application/json',
        schema: { type: 'object', properties: {} },
      },
    });
    const after = endpoint({
      requestBody: {
        description: '',
        required: true,
        contentType: 'application/json',
        schema: { type: 'object', properties: { note: { type: 'string' } } },
      },
    });
    expect(reasons(diffEndpoint(before, after))).toEqual([
      'additive:field_added',
    ]);
  });

  it('treats a removed response field as breaking and a removed request field as not', () => {
    const withField = {
      type: 'object',
      properties: { total: { type: 'number' } },
    };
    const withoutField = { type: 'object', properties: {} };

    const responseRemoval = diffEndpoint(
      endpoint({ responses: [response(200, withField)] }),
      endpoint({ responses: [response(200, withoutField)] }),
    );
    expect(reasons(responseRemoval)).toEqual(['breaking:field_removed']);

    const body = (schema: unknown) => ({
      description: '',
      required: true,
      contentType: 'application/json',
      schema,
    });
    const requestRemoval = diffEndpoint(
      endpoint({ requestBody: body(withField) }),
      endpoint({ requestBody: body(withoutField) }),
    );
    expect(reasons(requestRemoval)).toEqual(['non_breaking:field_removed']);
  });

  it('classifies a narrowed type as breaking but a widened one as not', () => {
    const at = (type: unknown) => ({
      type: 'object',
      properties: { id: { type } },
    });

    const narrowed = diffEndpoint(
      endpoint({ responses: [response(200, at(['string', 'number']))] }),
      endpoint({ responses: [response(200, at('string'))] }),
    );
    expect(reasons(narrowed)).toContain('breaking:type_narrowed');

    const widened = diffEndpoint(
      endpoint({ responses: [response(200, at('string'))] }),
      endpoint({ responses: [response(200, at(['string', 'number']))] }),
    );
    expect(reasons(widened)).toEqual([]);
  });

  it('finds a change nested inside an object property', () => {
    const nested = (properties: unknown) => ({
      type: 'object',
      properties: { customer: { type: 'object', properties } },
    });
    const entries = diffEndpoint(
      endpoint({
        responses: [response(200, nested({ email: { type: 'string' } }))],
      }),
      endpoint({ responses: [response(200, nested({}))] }),
    );
    expect(entries[0]?.pointer).toBe('#/responses/200/customer/email');
  });

  it('reports nothing when the endpoint is unchanged', () => {
    expect(diffEndpoint(endpoint(), endpoint())).toEqual([]);
  });
});

describe('diffEndpointSets', () => {
  it('matches endpoints on method and path, not id', () => {
    const before = [
      endpoint({ id: 'old', responses: [response(200), response(404)] }),
    ];
    const after = [endpoint({ id: 'new', responses: [response(200)] })];

    expect(reasons(diffEndpointSets(before, after))).toEqual([
      'breaking:status_code_removed',
    ]);
  });

  it('summarises counts by kind', () => {
    const before = [
      endpoint({ path: '/a' }),
      endpoint({ id: 'e2', path: '/b' }),
    ];
    const after = [
      endpoint({ path: '/a' }),
      endpoint({ id: 'e3', path: '/c' }),
    ];

    expect(summariseDiff(diffEndpointSets(before, after))).toEqual({
      breaking: 1,
      non_breaking: 0,
      additive: 1,
    });
  });
});
