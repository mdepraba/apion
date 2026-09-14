import type { Endpoint, EndpointResponse } from '@apion/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyExemptions,
  blockingViolations,
  isBlocked,
} from './exemptions.js';
import { lintEndpoint } from './lint.js';
import { presetStandard } from './presets.js';
import {
  type ResponseStandard,
  RULE_IDS,
  type RuleId,
  type RuleSeverity,
  simpleStandard,
} from './standard.js';

/** A standard with one rule on, so each test sees only the rule it is about. */
function only(ruleId: RuleId, overrides: Partial<ResponseStandard> = {}) {
  const off = Object.fromEntries(RULE_IDS.map((id) => [id, 'off'])) as Record<
    RuleId,
    RuleSeverity
  >;

  return {
    ...simpleStandard(),
    ...overrides,
    severities: { ...off, [ruleId]: 'error' as RuleSeverity },
  };
}

function response(overrides: Partial<EndpointResponse> = {}): EndpointResponse {
  return {
    id: '00000000-0000-7000-8000-000000000001',
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
    id: '00000000-0000-7000-8000-00000000000a',
    versionId: '00000000-0000-7000-8000-00000000000b',
    resourceId: '00000000-0000-7000-8000-00000000000c',
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

const ruleIdsOf = (violations: { ruleId: RuleId }[]) =>
  violations.map((violation) => violation.ruleId);

/** The envelope from the product owner's example. */
function fourSlot(ruleId: RuleId) {
  return {
    ...only(ruleId),
    envelope: {
      status_code: '$status_code',
      message: '$message',
      data: '$data',
      meta: '$meta',
    },
  };
}

describe('RS001 every slot is filled', () => {
  it('flags an example that fills only the data slot', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS001'),
      endpoint: endpoint({
        responses: [
          response({
            examples: [
              {
                id: 'x1',
                name: 'basic',
                summary: '',
                isDefault: true,
                value: { $data: { id: 'ord_1' } },
              },
            ],
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS001']);
    // The message has to name the slots, or an author cannot act on it.
    expect(violations[0].message).toContain('$message');
    expect(violations[0].message).toContain('$meta');
  });

  it('accepts an example that fills every slot', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS001'),
      endpoint: endpoint({
        responses: [
          response({
            examples: [
              {
                id: 'x1',
                name: 'basic',
                summary: '',
                isDefault: true,
                value: {
                  $status_code: 200,
                  $message: 'Order found.',
                  $data: { id: 'ord_1' },
                  $meta: null,
                },
              },
            ],
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('takes $status_code from the response, so an author need not retype it', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS001'),
      endpoint: endpoint({
        responses: [
          response({
            examples: [
              {
                id: 'x1',
                name: 'basic',
                summary: '',
                isDefault: true,
                value: {
                  $message: 'Order found.',
                  $data: { id: 'ord_1' },
                  $meta: null,
                },
              },
            ],
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('asks for an example when only a schema is declared', () => {
    // A schema can describe $data, but nothing can give $message a value.
    const violations = lintEndpoint({
      standard: fourSlot('RS001'),
      endpoint: endpoint({
        responses: [response({ payloadSchema: { type: 'object' } })],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS001']);
    expect(violations[0].message).toContain('$message');
  });

  it('flags a response with neither schema nor example', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS001'),
      endpoint: endpoint({ responses: [response()] }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS001']);
  });

  it('leaves 204 alone, because it carries no body', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS001'),
      endpoint: endpoint({
        method: 'delete',
        responses: [response({ statusCode: 204 })],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('has nothing to check when the envelope is a bare data slot', () => {
    const violations = lintEndpoint({
      standard: {
        ...presetStandard('none'),
        severities: only('RS001').severities,
      },
      endpoint: endpoint({
        responses: [response({ payloadSchema: { type: 'object' } })],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('checks a failure against the same envelope as a success', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS001'),
      endpoint: endpoint({
        responses: [
          response({
            statusCode: 404,
            examples: [
              {
                id: 'x1',
                name: 'missing',
                summary: '',
                isDefault: true,
                value: { $data: null },
              },
            ],
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS001']);
  });
});

describe('RS002 property naming', () => {
  it('flags a property that breaks the convention', () => {
    const violations = lintEndpoint({
      standard: only('RS002'),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: { order_id: { type: 'string' } },
            },
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS002']);
    expect(violations[0].message).toContain('camelCase');
  });

  it('checks nested properties, so a violation cannot hide one level down', () => {
    const violations = lintEndpoint({
      standard: only('RS002'),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: {
                data: {
                  type: 'object',
                  properties: { shipping_address: { type: 'string' } },
                },
              },
            },
          }),
        ],
      }),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].pointer).toContain('shipping_address');
  });

  it('checks query parameters but leaves path parameters to RS010', () => {
    const violations = lintEndpoint({
      standard: only('RS002'),
      endpoint: endpoint({
        path: '/orders/{order_id}',
        parameters: [
          {
            name: 'order_id',
            location: 'path',
            description: '',
            required: true,
            deprecated: false,
            schema: { type: 'string' },
          },
          {
            name: 'page_size',
            location: 'query',
            description: '',
            required: false,
            deprecated: false,
            schema: { type: 'integer' },
          },
        ],
      }),
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('page_size');
  });
});

describe('RS003 a failure is readable', () => {
  it('flags an error response with no example', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS003'),
      endpoint: endpoint({
        responses: [response({ statusCode: 404, payloadSchema: null })],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS003']);
    expect(violations[0].message).toContain('$message');
  });

  it('flags an error example that leaves the message empty', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS003'),
      endpoint: endpoint({
        responses: [
          response({
            statusCode: 404,
            examples: [
              {
                id: 'x1',
                name: 'missing',
                summary: '',
                isDefault: true,
                value: { $message: '', $data: null, $meta: null },
              },
            ],
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS003']);
  });

  it('accepts an error example that says what went wrong', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS003'),
      endpoint: endpoint({
        responses: [
          response({
            statusCode: 404,
            examples: [
              {
                id: 'x1',
                name: 'missing',
                summary: '',
                isDefault: true,
                value: {
                  $message: 'No order with that id.',
                  $data: null,
                  $meta: null,
                },
              },
            ],
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('says nothing about a success response', () => {
    const violations = lintEndpoint({
      standard: fourSlot('RS003'),
      endpoint: endpoint({ responses: [response({ statusCode: 200 })] }),
    });

    expect(violations).toEqual([]);
  });
});

describe('RS004 error-code registry', () => {
  it('flags a code the registry does not list', () => {
    const violations = lintEndpoint({
      standard: only('RS004'),
      endpoint: endpoint({
        responses: [
          response({
            statusCode: 404,
            payloadSchema: {
              type: 'object',
              properties: {
                error: {
                  type: 'object',
                  properties: { code: { const: 'ORDER_MISSING' } },
                },
              },
            },
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS004']);
    expect(violations[0].message).toContain('ORDER_MISSING');
  });

  it('accepts a registered code', () => {
    const violations = lintEndpoint({
      standard: only('RS004'),
      endpoint: endpoint({
        responses: [
          response({
            statusCode: 404,
            payloadSchema: {
              type: 'object',
              properties: {
                error: {
                  type: 'object',
                  properties: { code: { const: 'NOT_FOUND' } },
                },
              },
            },
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('catches an unregistered code in an example, not just in the schema', () => {
    const violations = lintEndpoint({
      standard: only('RS004'),
      endpoint: endpoint({
        responses: [
          response({
            statusCode: 404,
            payloadSchema: { type: 'object' },
            examples: [
              {
                id: '00000000-0000-7000-8000-000000000099',
                name: 'missing',
                summary: '',
                isDefault: true,
                value: { error: { code: 'NOPE', message: 'Gone' } },
              },
            ],
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS004']);
  });
});

describe('RS005 status policy', () => {
  it('flags a status the method may not answer with', () => {
    const violations = lintEndpoint({
      standard: only('RS005'),
      endpoint: endpoint({ responses: [response({ statusCode: 204 })] }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS005']);
  });

  it('permits anything for a method the standard does not mention', () => {
    const violations = lintEndpoint({
      standard: only('RS005'),
      endpoint: endpoint({
        method: 'head',
        responses: [response({ statusCode: 418 })],
      }),
    });

    expect(violations).toEqual([]);
  });
});

describe('RS006 pagination', () => {
  it('flags a collection with no pagination shape', () => {
    const violations = lintEndpoint({
      standard: only('RS006'),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: { type: 'array', items: { type: 'object' } },
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS006']);
  });

  it('accepts a cursor-paginated collection', () => {
    const violations = lintEndpoint({
      standard: only('RS006'),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: {
                items: { type: 'array' },
                nextCursor: { type: 'string' },
              },
            },
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('says nothing about a single-object response', () => {
    const violations = lintEndpoint({
      standard: only('RS006'),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: { id: { type: 'string' } },
            },
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });
});

describe('RS007 date format', () => {
  it('flags a timestamp missing its format', () => {
    const violations = lintEndpoint({
      standard: only('RS007'),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: { createdAt: { type: 'string' } },
            },
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS007']);
  });

  it('accepts an RFC 3339 timestamp', () => {
    const violations = lintEndpoint({
      standard: only('RS007'),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: {
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });

  it('wants a number when the project sends Unix seconds', () => {
    const violations = lintEndpoint({
      standard: only('RS007', { dateFormat: 'unix-seconds' }),
      endpoint: endpoint({
        responses: [
          response({
            payloadSchema: {
              type: 'object',
              properties: {
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          }),
        ],
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS007']);
  });
});

describe('RS008 required headers', () => {
  it('flags a response missing a required header', () => {
    const violations = lintEndpoint({
      standard: only('RS008', { requiredResponseHeaders: ['X-Request-Id'] }),
      endpoint: endpoint({ responses: [response()] }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS008']);
  });

  it('matches header names case-insensitively, as HTTP does', () => {
    const violations = lintEndpoint({
      standard: only('RS008', { requiredResponseHeaders: ['X-Request-Id'] }),
      endpoint: endpoint({
        responses: [
          response({
            headers: [
              {
                name: 'x-request-id',
                location: 'header',
                description: '',
                required: true,
                deprecated: false,
                schema: { type: 'string' },
              },
            ],
          }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });
});

describe('RS009 required error classes', () => {
  it('flags an endpoint that documents no failure', () => {
    const violations = lintEndpoint({
      standard: only('RS009'),
      endpoint: endpoint({ responses: [response({ statusCode: 200 })] }),
    });

    expect(violations.length).toBeGreaterThan(0);
    expect(new Set(ruleIdsOf(violations))).toEqual(new Set(['RS009']));
  });

  it('treats a default response as covering every class', () => {
    const violations = lintEndpoint({
      standard: only('RS009'),
      endpoint: endpoint({
        responses: [
          response({ statusCode: 200 }),
          response({ statusCode: 'default' }),
        ],
      }),
    });

    expect(violations).toEqual([]);
  });
});

describe('RS010 path naming', () => {
  it('flags a literal segment that breaks the convention', () => {
    const violations = lintEndpoint({
      standard: only('RS010'),
      endpoint: endpoint({ path: '/orderItems' }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS010']);
  });

  it('leaves path parameters alone', () => {
    const violations = lintEndpoint({
      standard: only('RS010'),
      endpoint: endpoint({ path: '/orders/{orderId}/line-items' }),
    });

    expect(violations).toEqual([]);
  });
});

describe('severity and exemptions', () => {
  it('never evaluates a rule set to off', () => {
    const standard = {
      ...simpleStandard(),
      severities: {
        ...simpleStandard().severities,
        RS001: 'off' as RuleSeverity,
      },
    };

    const violations = lintEndpoint({
      standard,
      endpoint: endpoint({
        responses: [response({ payloadSchema: { type: 'object' } })],
      }),
    });

    expect(ruleIdsOf(violations)).not.toContain('RS001');
  });

  it('reports the configured severity, not a fixed one', () => {
    const violations = lintEndpoint({
      standard: {
        ...only('RS010'),
        severities: { ...only('RS010').severities, RS010: 'warn' },
      },
      endpoint: endpoint({ path: '/orderItems' }),
    });

    expect(violations[0].severity).toBe('warn');
  });

  it('marks an exempted violation rather than dropping it', () => {
    const violations = lintEndpoint({
      standard: only('RS010'),
      endpoint: endpoint({ path: '/orderItems' }),
    });

    const resolved = applyExemptions(
      violations,
      [
        {
          id: 'e1',
          endpointId: endpoint().id,
          ruleId: 'RS010',
          justification: 'Legacy route the mobile client still calls.',
          grantedBy: 'u1',
          grantedAt: '2026-09-13T00:00:00.000Z',
        },
      ],
      endpoint().id,
    );

    // FR-4.6: still visible, no longer blocking.
    expect(resolved).toHaveLength(1);
    expect(resolved[0].exemption?.justification).toContain('Legacy route');
    expect(isBlocked(resolved)).toBe(false);
  });

  it('does not let one endpoint exemption cover another endpoint', () => {
    const violations = lintEndpoint({
      standard: only('RS010'),
      endpoint: endpoint({ path: '/orderItems' }),
    });

    const resolved = applyExemptions(
      violations,
      [
        {
          id: 'e1',
          endpointId: 'some-other-endpoint',
          ruleId: 'RS010',
          justification: 'Unrelated waiver.',
          grantedBy: 'u1',
          grantedAt: '2026-09-13T00:00:00.000Z',
        },
      ],
      endpoint().id,
    );

    expect(isBlocked(resolved)).toBe(true);
  });

  it('blocks on an unexempted error but not on a warning', () => {
    expect(
      isBlocked([
        { ruleId: 'RS001', severity: 'warn', pointer: '/', message: 'x' },
      ]),
    ).toBe(false);

    expect(
      blockingViolations([
        { ruleId: 'RS001', severity: 'error', pointer: '/', message: 'x' },
      ]),
    ).toHaveLength(1);
  });
});

describe('resolveRef', () => {
  it('lints through a $ref so a named schema is still checked', () => {
    const violations = lintEndpoint({
      standard: only('RS002'),
      endpoint: endpoint({
        responses: [
          response({ payloadSchema: { $ref: '#/components/schemas/Order' } }),
        ],
      }),
      resolveRef: () => ({
        type: 'object',
        properties: { order_id: { type: 'string' } },
      }),
    });

    expect(ruleIdsOf(violations)).toEqual(['RS002']);
  });
});

describe('rulesEnabled', () => {
  /** An endpoint that genuinely breaks the rule under test. */
  const breaksNaming = endpoint({
    responses: [
      response({
        payloadSchema: {
          type: 'object',
          properties: { order_id: { type: 'string' } },
        },
      }),
    ],
  });

  it('reports nothing at all when the project has switched its rules off', () => {
    expect(
      lintEndpoint({
        standard: { ...only('RS002'), rulesEnabled: false },
        endpoint: breaksNaming,
      }),
    ).toEqual([]);
  });

  it('still reports when the switch is on', () => {
    expect(
      ruleIdsOf(
        lintEndpoint({
          standard: { ...only('RS002'), rulesEnabled: true },
          endpoint: breaksNaming,
        }),
      ),
    ).toEqual(['RS002']);
  });

  it('enforces a standard stored before the switch existed, which was enforced', () => {
    const { rulesEnabled: _absent, ...standard } = {
      ...only('RS002'),
      rulesEnabled: undefined,
    };

    expect(
      ruleIdsOf(lintEndpoint({ standard, endpoint: breaksNaming })),
    ).toEqual(['RS002']);
  });

  it('keeps each severity while off, so switching back on restores the set', () => {
    const standard = { ...simpleStandard(), rulesEnabled: false };
    expect(standard.severities.RS002).toBe('error');
  });
});
