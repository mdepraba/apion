import { uuidv7 } from '@apion/domain';
import type { Database } from './client.js';
import {
  contractVersions,
  endpointStatuses,
  endpoints,
  environments,
  mockConfigs,
  mockScenarios,
  namedSchemas,
  organisations,
  projectMembers,
  projects,
  resources,
  responseStandards,
  users,
} from './schema/index.js';

/**
 * Development seed. PRD 07 asks for "seeded realistic projects, endpoints,
 * standards/violations and scenarios" so the UI is exercised against something
 * with shape, not one endpoint.
 *
 * Everything here is obviously fictional and stays out of production: the
 * caller supplies the password hash, and the CLI refuses to run outside
 * development.
 */
export interface SeedOptions {
  /** argon2 hash for the seeded accounts. Hashing lives in the API, not here. */
  passwordHash: string;
}

export async function seed(db: Database, options: SeedOptions): Promise<void> {
  const organisationId = uuidv7();

  await db.insert(organisations).values({
    id: organisationId,
    slug: 'northwind',
    name: 'Northwind',
  });

  const people = [
    { id: uuidv7(), email: 'ada@northwind.test', displayName: 'Ada Okafor' },
    { id: uuidv7(), email: 'rin@northwind.test', displayName: 'Rin Tanaka' },
    { id: uuidv7(), email: 'sam@northwind.test', displayName: 'Sam Whitfield' },
  ];

  await db.insert(users).values(
    people.map((person) => ({
      ...person,
      organisationId,
      passwordHash: options.passwordHash,
    })),
  );

  await seedOrdersProject(db, organisationId, people);
  await seedBillingProject(db, organisationId, people);
}

type Person = { id: string; email: string; displayName: string };

/**
 * PRD 07 asks the development seed to include "standards/violations and
 * scenarios". The Orders project gets the `Simple` standard at error severity,
 * which the seeded endpoints genuinely violate: their payloads sit outside the
 * envelope's slots, so the health panel has real findings rather than a
 * contrived one.
 */
async function seedStandardAndMock(
  db: Database,
  projectId: string,
): Promise<void> {
  await db.insert(responseStandards).values({
    id: uuidv7(),
    projectId,
    version: 1,
    state: 'active',
    preset: 'simple',
    publishedAt: new Date(),
    definition: {
      // The four-slot envelope: every response carries all of these.
      envelope: {
        status_code: '$status_code',
        message: '$message',
        data: '$data',
        meta: '$meta',
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
      // The seeded endpoints are meant to violate this, so it is checked.
      rulesEnabled: true,
      severities: {
        RS001: 'error',
        RS002: 'error',
        RS003: 'error',
        RS004: 'error',
        RS005: 'warn',
        RS006: 'warn',
        RS007: 'error',
        RS008: 'off',
        RS009: 'warn',
        RS010: 'error',
      },
    },
  });

  await db.insert(mockConfigs).values({ projectId, validateRequests: true });

  await db.insert(mockScenarios).values([
    {
      id: uuidv7(),
      projectId,
      name: 'happyPath',
      description: 'Every endpoint answers with its default example.',
      rules: [],
      isDefault: true,
    },
    {
      id: uuidv7(),
      projectId,
      name: 'emptyStates',
      description: 'Collections come back empty, so empty views can be built.',
      rules: [
        {
          endpointId: null,
          statusCode: null,
          exampleName: 'emptyList',
          delayMs: null,
        },
      ],
      isDefault: true,
    },
    {
      id: uuidv7(),
      projectId,
      name: 'serverErrors',
      description: 'Every endpoint answers 500, to exercise error handling.',
      rules: [
        { endpointId: null, statusCode: 500, exampleName: null, delayMs: null },
      ],
      isDefault: true,
    },
    {
      id: uuidv7(),
      projectId,
      name: 'slowNetwork',
      description: 'Responses are held for two seconds.',
      rules: [
        {
          endpointId: null,
          statusCode: null,
          exampleName: null,
          delayMs: 2000,
        },
      ],
      isDefault: true,
    },
    {
      id: uuidv7(),
      projectId,
      name: 'unauthenticated',
      description: 'Every endpoint answers 401.',
      rules: [
        { endpointId: null, statusCode: 401, exampleName: null, delayMs: null },
      ],
      isDefault: true,
    },
  ]);
}

async function seedOrdersProject(
  db: Database,
  organisationId: string,
  people: Person[],
): Promise<void> {
  const projectId = uuidv7();

  await db.insert(projects).values({
    id: projectId,
    organisationId,
    slug: 'orders-api',
    name: 'Orders API',
    description: 'Order capture, fulfilment and returns for the storefront.',
    visibility: 'organisation',
  });

  await db.insert(projectMembers).values([
    { projectId, userId: people[0].id, role: 'owner' },
    { projectId, userId: people[1].id, role: 'editor' },
    { projectId, userId: people[2].id, role: 'commenter' },
  ]);

  const environmentIds = await insertEnvironments(db, projectId);

  const versionId = uuidv7();
  await db.insert(contractVersions).values({
    id: versionId,
    projectId,
    label: 'v1',
    state: 'draft',
  });

  const ordersResourceId = uuidv7();
  const returnsResourceId = uuidv7();

  await db.insert(resources).values([
    {
      id: ordersResourceId,
      versionId,
      name: 'Orders',
      description: 'Creating and reading orders.',
      position: 0,
    },
    {
      id: returnsResourceId,
      versionId,
      name: 'Returns',
      description: 'Return requests against a delivered order.',
      position: 1,
    },
  ]);

  await db.insert(namedSchemas).values([
    {
      id: uuidv7(),
      versionId,
      name: 'Order',
      description: 'A customer order.',
      schema: {
        type: 'object',
        required: ['id', 'status', 'total', 'placedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: {
            type: 'string',
            enum: ['pending', 'paid', 'shipped', 'delivered'],
          },
          total: { $ref: '#/components/schemas/Money' },
          placedAt: { type: 'string', format: 'date-time' },
          lines: {
            type: 'array',
            items: { $ref: '#/components/schemas/OrderLine' },
          },
        },
      },
      usageCount: 3,
    },
    {
      id: uuidv7(),
      versionId,
      name: 'OrderLine',
      description: 'One product on an order.',
      schema: {
        type: 'object',
        required: ['sku', 'quantity', 'unitPrice'],
        properties: {
          sku: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
          unitPrice: { $ref: '#/components/schemas/Money' },
        },
      },
      usageCount: 1,
    },
    {
      id: uuidv7(),
      versionId,
      name: 'Money',
      description: 'A minor-unit amount with its currency.',
      schema: {
        type: 'object',
        required: ['amount', 'currency'],
        properties: {
          amount: {
            type: 'integer',
            description: 'Minor units, for example cents.',
          },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
        },
      },
      usageCount: 2,
    },
  ]);

  const rows = [
    {
      resourceId: ordersResourceId,
      method: 'get' as const,
      path: '/orders',
      summary: 'List orders',
      status: 'implemented' as const,
      owner: people[0].id,
    },
    {
      resourceId: ordersResourceId,
      method: 'post' as const,
      path: '/orders',
      summary: 'Place an order',
      status: 'implemented' as const,
      owner: people[0].id,
    },
    {
      resourceId: ordersResourceId,
      method: 'get' as const,
      path: '/orders/{orderId}',
      summary: 'Fetch one order',
      status: 'implemented' as const,
      owner: people[1].id,
    },
    {
      resourceId: ordersResourceId,
      method: 'post' as const,
      path: '/orders/export',
      summary: 'Start an order export',
      // A literal path that must beat /orders/{orderId} in the mock router.
      status: 'in_progress' as const,
      owner: people[1].id,
    },
    {
      resourceId: ordersResourceId,
      method: 'delete' as const,
      path: '/orders/{orderId}',
      summary: 'Cancel an order',
      status: 'in_review' as const,
      owner: people[1].id,
    },
    {
      resourceId: returnsResourceId,
      method: 'get' as const,
      path: '/returns',
      summary: 'List return requests',
      status: 'draft' as const,
      owner: people[2].id,
    },
    {
      resourceId: returnsResourceId,
      method: 'post' as const,
      path: '/orders/{orderId}/returns',
      summary: 'Request a return',
      status: 'approved' as const,
      owner: people[0].id,
    },
  ];

  const inserted = await db
    .insert(endpoints)
    .values(
      rows.map((row, index) => ({
        id: uuidv7(),
        versionId,
        resourceId: row.resourceId,
        method: row.method,
        path: row.path,
        summary: row.summary,
        description: '',
        parameters: pathParametersFor(row.path),
        requestBody:
          row.method === 'post'
            ? {
                description: '',
                required: true,
                contentType: 'application/json',
                schema: { $ref: '#/components/schemas/Order' },
              }
            : null,
        responses: [
          {
            id: uuidv7(),
            statusCode: row.method === 'post' ? 201 : 200,
            description: 'Success',
            headers: [],
            payloadSchema: { $ref: '#/components/schemas/Order' },
            // Every slot the project's envelope declares is filled here.
            examples: [
              {
                id: uuidv7(),
                name: 'basic',
                summary: '',
                isDefault: true,
                value: {
                  $status_code: row.method === 'post' ? 201 : 200,
                  $message: 'OK',
                  $data: {
                    id: '018f1a2b-0000-7000-8000-000000000001',
                    status: 'paid',
                    total: { amount: 4250, currency: 'GBP' },
                    placedAt: '2026-09-01T10:15:00Z',
                  },
                  $meta: null,
                },
              },
            ],
          },
          {
            id: uuidv7(),
            statusCode: 404,
            description: 'No such order',
            headers: [],
            payloadSchema: null,
            examples: [
              {
                id: uuidv7(),
                name: 'missing',
                summary: '',
                isDefault: true,
                value: {
                  $status_code: 404,
                  $message: 'No order with that id.',
                  $data: null,
                  $meta: null,
                },
              },
            ],
          },
        ],
        ownerId: row.owner,
        position: index,
      })),
    )
    .returning({ id: endpoints.id });

  // Status differs per environment, which is the point of FR-3.2: dev is ahead
  // of staging, and production is behind both.
  const statusRows = inserted.flatMap((endpoint, index) => {
    const declared = rows[index].status;
    return [
      { environmentId: environmentIds.dev, status: declared },
      {
        environmentId: environmentIds.staging,
        status:
          declared === 'implemented' ? ('in_progress' as const) : declared,
      },
      {
        environmentId: environmentIds.production,
        status:
          declared === 'implemented'
            ? ('approved' as const)
            : ('draft' as const),
      },
    ].map((entry) => ({
      endpointId: endpoint.id,
      environmentId: entry.environmentId,
      status: entry.status,
      changedVia: 'ui' as const,
      // One endpoint sits well past the 14-day threshold so the staleness
      // reporting in FR-3.5 has something to find.
      changedAt:
        index === 3
          ? new Date(Date.now() - 21 * 86_400_000)
          : new Date(Date.now() - 2 * 86_400_000),
    }));
  });

  await db.insert(endpointStatuses).values(statusRows);

  await seedStandardAndMock(db, projectId);
}

async function seedBillingProject(
  db: Database,
  organisationId: string,
  people: Person[],
): Promise<void> {
  const projectId = uuidv7();

  await db.insert(projects).values({
    id: projectId,
    organisationId,
    slug: 'billing-api',
    name: 'Billing API',
    description: 'Invoices and payment intents. Early draft.',
    visibility: 'organisation',
  });

  await db.insert(projectMembers).values({
    projectId,
    userId: people[1].id,
    role: 'owner',
  });

  await insertEnvironments(db, projectId);

  const versionId = uuidv7();
  await db.insert(contractVersions).values({
    id: versionId,
    projectId,
    label: 'v1',
    state: 'draft',
  });

  // Deliberately left without endpoints, so the empty states get exercised.
  await db.insert(resources).values({
    id: uuidv7(),
    versionId,
    name: 'Invoices',
    description: '',
    position: 0,
  });
}

async function insertEnvironments(
  db: Database,
  projectId: string,
): Promise<{ dev: string; staging: string; production: string }> {
  const dev = uuidv7();
  const staging = uuidv7();
  const production = uuidv7();

  await db.insert(environments).values([
    {
      id: dev,
      projectId,
      key: 'dev',
      name: 'Development',
      isPrimary: true,
      position: 0,
    },
    { id: staging, projectId, key: 'staging', name: 'Staging', position: 1 },
    {
      id: production,
      projectId,
      key: 'production',
      name: 'Production',
      position: 2,
    },
  ]);

  return { dev, staging, production };
}

/** Derives the typed path parameters a `{braces}` path implies (FR-2.2). */
function pathParametersFor(path: string) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    location: 'path' as const,
    description: '',
    required: true,
    deprecated: false,
    schema: { type: 'string', format: 'uuid' },
  }));
}
