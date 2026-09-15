import type { Endpoint, NamedSchema, Resource } from '@apion/contracts';
import { describe, expect, it } from 'vitest';
import { exportOpenApi } from './export-openapi.js';
import { generateTypeScript } from './generate-typescript.js';
import { importOpenApi } from './import-openapi.js';

const resource: Resource = {
  id: 'r1',
  versionId: 'v1',
  name: 'Orders',
  description: 'Order management',
  position: 0,
  entityVersion: 1,
};

const endpoint: Endpoint = {
  id: 'e1',
  versionId: 'v1',
  resourceId: 'r1',
  method: 'get',
  path: '/orders/{orderId}',
  summary: 'Fetch one order',
  description: 'Returns a single order.',
  operationId: 'getOrder',
  parameters: [
    {
      name: 'orderId',
      location: 'path',
      description: 'The order id',
      required: true,
      deprecated: false,
      schema: { type: 'string' },
    },
    {
      name: 'expand',
      location: 'query',
      description: '',
      required: false,
      deprecated: false,
      schema: { type: 'string' },
    },
  ],
  requestBody: null,
  responses: [
    {
      id: 'res1',
      statusCode: 200,
      description: 'The order',
      headers: [],
      payloadSchema: { $ref: '#/components/schemas/Order' },
      examples: [
        {
          id: 'x1',
          name: 'basic',
          summary: 'A paid order',
          isDefault: true,
          value: { id: '1' },
        },
      ],
    },
    {
      id: 'res2',
      statusCode: 404,
      description: 'No such order',
      headers: [],
      payloadSchema: null,
      examples: [],
    },
  ],
  authRequired: true,
  deprecated: false,
  ownerId: null,
  ticketUrl: 'https://tracker.example.com/ORD-1',
  tags: ['billing'],
  position: 0,
  entityVersion: 1,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
};

const schema: NamedSchema = {
  id: 's1',
  versionId: 'v1',
  name: 'Order',
  description: 'A customer order',
  schema: {
    type: 'object',
    required: ['id', 'total'],
    properties: {
      id: { type: 'string' },
      total: { type: 'number' },
      note: { type: 'string' },
    },
  },
  usageCount: 1,
  entityVersion: 1,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
};

const exported = () =>
  exportOpenApi({
    title: 'Store API',
    version: 'v1',
    endpoints: [endpoint],
    schemas: [schema],
    resources: [resource],
  });

describe('exportOpenApi', () => {
  it('emits OpenAPI 3.1', () => {
    expect(exported()['openapi']).toBe('3.1.0');
  });

  it('places the operation under its path and method', () => {
    const paths = exported()['paths'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(paths)).toEqual(['/orders/{orderId}']);
    expect(paths['/orders/{orderId}']['get']).toBeDefined();
  });

  it('keeps named schemas under components', () => {
    const components = exported()['components'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(components['schemas']['Order']).toEqual(schema.schema);
  });

  it('preserves fields OpenAPI has no home for as extensions', () => {
    const paths = exported()['paths'] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const operation = paths['/orders/{orderId}']['get'];
    expect(operation['x-apion-ticket']).toBe(
      'https://tracker.example.com/ORD-1',
    );
    expect(operation['x-apion-tags']).toEqual(['billing']);
  });
});

describe('importOpenApi', () => {
  it('round-trips an exported document without losing endpoints or schemas', () => {
    // PRD 02 acceptance: the platform must not be a data prison.
    const result = importOpenApi(exported());

    expect(result.endpoints).toHaveLength(1);
    expect(result.schemas.map((s) => s.name)).toEqual(['Order']);
    expect(result.resources.map((r) => r.name)).toEqual(['Orders']);

    const [imported] = result.endpoints;
    expect(imported.method).toBe('get');
    expect(imported.path).toBe('/orders/{orderId}');
    expect(imported.summary).toBe('Fetch one order');
    expect(imported.operationId).toBe('getOrder');
    expect(imported.ticketUrl).toBe('https://tracker.example.com/ORD-1');
    expect(imported.parameters?.map((p) => p.name).sort()).toEqual([
      'expand',
      'orderId',
    ]);
    expect(imported.responses?.map((r) => r.statusCode).sort()).toEqual([
      200, 404,
    ]);
  });

  it('reads YAML as well as JSON', () => {
    const yaml = [
      'openapi: 3.1.0',
      'info:',
      '  title: Tiny API',
      '  version: v1',
      'paths:',
      '  /ping:',
      '    get:',
      '      summary: Ping',
      '      responses:',
      "        '200':",
      '          description: Pong',
    ].join('\n');

    const result = importOpenApi(yaml);
    expect(result.title).toBe('Tiny API');
    expect(result.endpoints[0]?.path).toBe('/ping');
  });

  it('refuses Swagger 2.0 with an actionable message', () => {
    expect(() =>
      importOpenApi({ swagger: '2.0', info: {}, paths: {} }),
    ).toThrow(/Swagger 2\.0 is not supported/);
  });

  it('skips a reserved path and says so rather than shadowing a platform route', () => {
    const result = importOpenApi({
      openapi: '3.1.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/api/v1/things': {
          get: { responses: { '200': { description: 'ok' } } },
        },
        '/things': { get: { responses: { '200': { description: 'ok' } } } },
      },
    });

    expect(result.endpoints.map((e) => e.path)).toEqual(['/things']);
    expect(result.warnings.join(' ')).toContain('/api/v1/things');
  });

  it('warns when a request body has media types it cannot keep', () => {
    const result = importOpenApi({
      openapi: '3.1.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { type: 'object' } },
                'application/xml': { schema: { type: 'object' } },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });

    expect(result.endpoints[0]?.requestBody?.contentType).toBe(
      'application/json',
    );
    expect(result.warnings.join(' ')).toMatch(/media type was dropped/);
  });

  it('derives a resource from the path when the spec declares no tag', () => {
    const result = importOpenApi({
      openapi: '3.1.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/invoices/{id}': {
          get: { responses: { '200': { description: 'ok' } } },
        },
      },
    });

    expect(result.resources.map((r) => r.name)).toEqual(['Invoices']);
  });

  it('treats an empty security array as opting out of auth', () => {
    const result = importOpenApi({
      openapi: '3.1.0',
      info: { title: 'X', version: '1' },
      paths: {
        '/open': {
          get: { security: [], responses: { '200': { description: 'ok' } } },
        },
        '/closed': { get: { responses: { '200': { description: 'ok' } } } },
      },
    });

    const byPath = new Map(
      result.endpoints.map((e) => [e.path, e.authRequired]),
    );
    expect(byPath.get('/open')).toBe(false);
    expect(byPath.get('/closed')).toBe(true);
  });
});

describe('generateTypeScript', () => {
  const output = () =>
    generateTypeScript({
      title: 'Store API',
      endpoints: [endpoint],
      schemas: [schema],
    });

  it('emits a type per named schema with required and optional members', () => {
    const source = output();
    expect(source).toContain('export type Order = {');
    expect(source).toContain('id: string;');
    expect(source).toContain('note?: string;');
  });

  it('resolves a $ref to the schema name', () => {
    expect(output()).toContain('export type GetOrderResponse = Order;');
  });

  it('emits path and query parameter types', () => {
    const source = output();
    expect(source).toContain('export interface GetOrderParams {');
    expect(source).toContain('orderId: string;');
    expect(source).toContain('expand?: string;');
  });

  it('interpolates path parameters into the client call', () => {
    // Asserts on the generated client's interpolation, which is the point.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: expected in output
    expect(output()).toContain('${encodeURIComponent(String(params.orderId))}');
  });

  it('quotes a property name that is not an identifier', () => {
    const source = generateTypeScript({
      title: 'X',
      endpoints: [],
      schemas: [
        {
          ...schema,
          name: 'Headers',
          schema: {
            type: 'object',
            properties: { 'content-type': { type: 'string' } },
          },
        },
      ],
    });

    expect(source).toContain('"content-type"?: string;');
  });

  it('falls back to unknown rather than guessing an untyped schema', () => {
    const source = generateTypeScript({
      title: 'X',
      endpoints: [],
      schemas: [{ ...schema, name: 'Loose', schema: {} }],
    });

    expect(source).toContain('export type Loose = unknown;');
  });
});
