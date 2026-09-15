import type { Endpoint } from '@apion/contracts';
import { describe, expect, it } from 'vitest';
import { applyEndpointChange } from './apply-endpoint-change.js';
import { formatETag, parseIfMatch, StaleWriteError } from './concurrency.js';
import { slugify, uuidv7, uuidv7Timestamp } from './identifiers.js';
import { can, explainDenial, roleAtLeast } from './permissions.js';
import {
  collectRefs,
  countRefs,
  renameRefs,
  topologicalSchemaOrder,
} from './schema-refs.js';
import {
  canTransition,
  isStatusStale,
  statusGroup,
} from './status-transitions.js';

describe('permissions', () => {
  it('ranks roles from viewer to owner', () => {
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(roleAtLeast('commenter', 'editor')).toBe(false);
  });

  it('keeps a commenter out of every contract write', () => {
    // PRD 01 acceptance: a Commenter comments, but every contract field is read-only.
    expect(can('commenter', 'comment.create')).toBe(true);
    expect(can('commenter', 'comment.resolve_own')).toBe(true);
    expect(can('commenter', 'contract.read')).toBe(true);
    expect(can('commenter', 'contract.write')).toBe(false);
    expect(can('commenter', 'status.update')).toBe(false);
  });

  it('keeps a viewer out of commenting', () => {
    expect(can('viewer', 'comment.create')).toBe(false);
    expect(can('viewer', 'contract.read')).toBe(true);
  });

  it('reserves destructive project actions for an owner', () => {
    expect(can('maintainer', 'project.delete')).toBe(false);
    expect(can('owner', 'project.delete')).toBe(true);
    expect(can('maintainer', 'member.manage')).toBe(false);
  });

  it('lets a maintainer force-release a lock and grant exemptions', () => {
    // PRD 01 and PRD 03 FR-4.6 both delegate these to Maintainer.
    expect(can('maintainer', 'lock.force_release')).toBe(true);
    expect(can('maintainer', 'exemption.grant')).toBe(true);
    expect(can('editor', 'lock.force_release')).toBe(false);
  });

  it('explains a denial instead of failing silently', () => {
    expect(explainDenial('commenter', 'contract.write')).toContain('editor');
  });
});

describe('status transitions', () => {
  it('allows the documented forward path', () => {
    expect(canTransition('draft', 'in_review')).toBe(true);
    expect(canTransition('approved', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'implemented')).toBe(true);
  });

  it('rejects skipping ahead', () => {
    expect(canTransition('draft', 'implemented')).toBe(false);
    expect(canTransition('draft', 'approved')).toBe(false);
  });

  it('allows a rollback that delivery actually performs', () => {
    expect(canTransition('implemented', 'in_progress')).toBe(true);
    expect(canTransition('in_review', 'draft')).toBe(true);
  });

  it('treats retired as final', () => {
    expect(canTransition('retired', 'implemented')).toBe(false);
  });

  it('groups pre-implementation states together for list views', () => {
    expect(statusGroup('draft')).toBe('not_implemented');
    expect(statusGroup('in_progress')).toBe('not_implemented');
    expect(statusGroup('implemented')).toBe('implemented');
    expect(statusGroup('retired')).toBe('retired');
  });

  it('only ages out in_progress endpoints', () => {
    const now = new Date('2026-09-13T00:00:00Z');
    const twentyDaysAgo = new Date('2026-08-24T00:00:00Z');

    expect(isStatusStale('in_progress', twentyDaysAgo, now, 14)).toBe(true);
    expect(isStatusStale('implemented', twentyDaysAgo, now, 14)).toBe(false);

    const tenDaysAgo = new Date('2026-09-03T00:00:00Z');
    expect(isStatusStale('in_progress', tenDaysAgo, now, 14)).toBe(false);
  });
});

describe('optimistic concurrency', () => {
  it('parses a strong If-Match and rejects a weak one', () => {
    expect(parseIfMatch('"7"')).toBe(7);
    expect(parseIfMatch('W/"7"')).toBeUndefined();
    expect(parseIfMatch('*')).toBeUndefined();
    expect(parseIfMatch(undefined)).toBeUndefined();
  });

  it('round-trips through formatETag', () => {
    expect(parseIfMatch(formatETag(42))).toBe(42);
  });
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
  responses: [],
  authRequired: true,
  deprecated: false,
  ownerId: null,
  ticketUrl: null,
  tags: [],
  position: 0,
  entityVersion: 3,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
  ...overrides,
});

describe('applyEndpointChange', () => {
  const at = new Date('2026-09-14T10:00:00.000Z');

  it('applies a change and bumps the entity version', () => {
    const result = applyEndpointChange(endpoint(), {
      patch: { summary: 'List all orders' },
      expectedVersion: 3,
      actorId: 'u1',
      at,
    });

    expect(result.next.summary).toBe('List all orders');
    expect(result.next.entityVersion).toBe(4);
    expect(result.changedFields).toEqual(['summary']);
  });

  it('refuses a stale write with the current state attached', () => {
    // PRD 01: a stale client receives a conflict, not a silent overwrite.
    try {
      applyEndpointChange(endpoint(), {
        patch: { summary: 'Nope' },
        expectedVersion: 2,
        actorId: 'u1',
        at,
      });
      expect.unreachable('expected a StaleWriteError');
    } catch (error) {
      expect(error).toBeInstanceOf(StaleWriteError);
      const stale = error as StaleWriteError<Endpoint>;
      expect(stale.expectedVersion).toBe(2);
      expect(stale.actualVersion).toBe(3);
      expect(stale.current.summary).toBe('List orders');
    }
  });

  it('does not burn a version on a no-op save', () => {
    const result = applyEndpointChange(endpoint(), {
      patch: { summary: 'List orders' },
      expectedVersion: 3,
      actorId: 'u1',
      at,
    });

    expect(result.changedFields).toEqual([]);
    expect(result.next.entityVersion).toBe(3);
  });

  it('reports only the fields that actually changed', () => {
    const result = applyEndpointChange(endpoint(), {
      patch: { summary: 'List orders', deprecated: true },
      expectedVersion: 3,
      actorId: 'u1',
      at,
    });

    expect(result.changedFields).toEqual(['deprecated']);
  });

  it('ignores fields a client may not set', () => {
    const result = applyEndpointChange(endpoint(), {
      patch: { entityVersion: 99, id: 'hacked' } as never,
      expectedVersion: 3,
      actorId: 'u1',
      at,
    });

    expect(result.next.id).toBe('e1');
    expect(result.next.entityVersion).toBe(3);
  });
});

describe('schema refs', () => {
  const document = {
    type: 'object',
    properties: {
      customer: { $ref: '#/components/schemas/Customer' },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/LineItem' },
      },
    },
    allOf: [{ $ref: '#/components/schemas/Customer' }],
  };

  it('finds refs through arrays, nesting and composition', () => {
    expect(
      collectRefs(document)
        .map((r) => r.schemaName)
        .sort(),
    ).toEqual(['Customer', 'Customer', 'LineItem']);
  });

  it('records a jump-to pointer for each ref', () => {
    const site = collectRefs(document).find((r) => r.schemaName === 'LineItem');
    expect(site?.pointer).toBe('#/properties/items/items/$ref');
  });

  it('ignores an external ref', () => {
    expect(collectRefs({ $ref: 'https://example.com/schema.json' })).toEqual(
      [],
    );
  });

  it('counts usages for the rename impact report', () => {
    // PRD 02 acceptance: a rename with seven references reports seven impacts.
    const seven = {
      allOf: Array.from({ length: 7 }, () => ({
        $ref: '#/components/schemas/Money',
      })),
    };
    expect(countRefs(seven, 'Money')).toBe(7);
  });

  it('rewrites every matching ref without mutating the input', () => {
    const renamed = renameRefs(document, 'Customer', 'Buyer');
    expect(countRefs(renamed, 'Buyer')).toBe(2);
    expect(countRefs(renamed, 'Customer')).toBe(0);
    expect(countRefs(document, 'Customer')).toBe(2);
  });

  it('orders definitions before their dependants', () => {
    const schemas = new Map<string, unknown>([
      [
        'Order',
        { properties: { line: { $ref: '#/components/schemas/LineItem' } } },
      ],
      [
        'LineItem',
        { properties: { money: { $ref: '#/components/schemas/Money' } } },
      ],
      ['Money', { type: 'object' }],
    ]);

    expect(topologicalSchemaOrder(schemas)).toEqual([
      'Money',
      'LineItem',
      'Order',
    ]);
  });

  it('emits every schema in a reference cycle exactly once', () => {
    const schemas = new Map<string, unknown>([
      [
        'Node',
        { properties: { child: { $ref: '#/components/schemas/Node' } } },
      ],
      ['A', { properties: { b: { $ref: '#/components/schemas/B' } } }],
      ['B', { properties: { a: { $ref: '#/components/schemas/A' } } }],
    ]);

    expect(topologicalSchemaOrder(schemas).sort()).toEqual(['A', 'B', 'Node']);
  });
});

describe('identifiers', () => {
  it('generates a version 7 uuid with the RFC variant', () => {
    const id = uuidv7();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('embeds the timestamp so keys sort by creation time', () => {
    const now = Date.now();
    expect(uuidv7Timestamp(uuidv7(now))).toBe(now);

    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it('slugifies a project name', () => {
    expect(slugify('Acme Order API')).toBe('acme-order-api');
    expect(slugify('  Café  Menu!  ')).toBe('cafe-menu');
  });
});
