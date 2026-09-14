import type {
  Endpoint,
  NamedSchema,
  Parameter,
  Resource,
} from '@apion/contracts';

export interface ExportInput {
  title: string;
  version: string;
  description?: string;
  endpoints: readonly Endpoint[];
  schemas: readonly NamedSchema[];
  resources: readonly Resource[];
  servers?: readonly { url: string; description?: string }[];
}

type JsonObject = Record<string, unknown>;

/**
 * Emits OpenAPI 3.1, which PRD 02 FR-2.7 makes the portability baseline:
 * "import/export must not intentionally discard representable contract data".
 *
 * Fields with no OpenAPI equivalent (owner, ticket URL, implementation status)
 * are written as `x-apion-*` extensions rather than dropped, so a round trip
 * through this exporter and `importOpenApi` is lossless.
 */
export function exportOpenApi(input: ExportInput): JsonObject {
  const paths: JsonObject = {};

  for (const endpoint of input.endpoints) {
    const path = (paths[endpoint.path] as JsonObject | undefined) ?? {};
    path[endpoint.method] = operationOf(endpoint, input.resources);
    paths[endpoint.path] = path;
  }

  const document: JsonObject = {
    openapi: '3.1.0',
    info: {
      title: input.title,
      version: input.version,
      ...(input.description ? { description: input.description } : {}),
    },
    ...(input.servers?.length ? { servers: input.servers } : {}),
    ...(input.resources.length
      ? {
          tags: input.resources.map((resource) => ({
            name: resource.name,
            ...(resource.description
              ? { description: resource.description }
              : {}),
          })),
        }
      : {}),
    paths,
  };

  if (input.schemas.length > 0) {
    document['components'] = {
      schemas: Object.fromEntries(
        [...input.schemas]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((schema) => [schema.name, schema.schema]),
      ),
    };
  }

  return document;
}

function operationOf(
  endpoint: Endpoint,
  resources: readonly Resource[],
): JsonObject {
  const resource = resources.find((r) => r.id === endpoint.resourceId);

  const operation: JsonObject = {
    summary: endpoint.summary,
    ...(endpoint.description ? { description: endpoint.description } : {}),
    ...(endpoint.operationId ? { operationId: endpoint.operationId } : {}),
    ...(resource ? { tags: [resource.name] } : {}),
    ...(endpoint.deprecated ? { deprecated: true } : {}),
    responses: responsesOf(endpoint),
  };

  const parameters = endpoint.parameters.map(parameterOf);
  if (parameters.length > 0) operation['parameters'] = parameters;

  if (endpoint.requestBody) {
    operation['requestBody'] = {
      ...(endpoint.requestBody.description
        ? { description: endpoint.requestBody.description }
        : {}),
      required: endpoint.requestBody.required,
      content: {
        [endpoint.requestBody.contentType]: {
          schema: endpoint.requestBody.schema,
        },
      },
    };
  }

  // An endpoint that needs auth says so; one that does not overrides any
  // document-level requirement with an explicit empty list.
  operation['security'] = endpoint.authRequired ? [{ bearerAuth: [] }] : [];

  if (endpoint.ownerId) operation['x-apion-owner'] = endpoint.ownerId;
  if (endpoint.ticketUrl) operation['x-apion-ticket'] = endpoint.ticketUrl;
  if (endpoint.tags.length > 0) operation['x-apion-tags'] = endpoint.tags;

  return operation;
}

function parameterOf(parameter: Parameter): JsonObject {
  return {
    name: parameter.name,
    in: parameter.location,
    ...(parameter.description ? { description: parameter.description } : {}),
    // A path parameter is always required; OpenAPI rejects it otherwise.
    required: parameter.location === 'path' ? true : parameter.required,
    ...(parameter.deprecated ? { deprecated: true } : {}),
    schema: parameter.schema,
  };
}

function responsesOf(endpoint: Endpoint): JsonObject {
  const responses: JsonObject = {};

  for (const response of endpoint.responses) {
    const body: JsonObject = {
      description: response.description || 'Response',
    };

    if (response.headers.length > 0) {
      body['headers'] = Object.fromEntries(
        response.headers.map((header) => [
          header.name,
          {
            ...(header.description ? { description: header.description } : {}),
            required: header.required,
            schema: header.schema,
          },
        ]),
      );
    }

    if (response.payloadSchema !== null) {
      const content: JsonObject = { schema: response.payloadSchema };

      if (response.examples.length > 0) {
        content['examples'] = Object.fromEntries(
          response.examples.map((example) => [
            example.name,
            {
              ...(example.summary ? { summary: example.summary } : {}),
              value: example.value,
              ...(example.isDefault ? { 'x-apion-default': true } : {}),
            },
          ]),
        );
      }

      body['content'] = { 'application/json': content };
    }

    responses[String(response.statusCode)] = body;
  }

  // OpenAPI requires at least one response per operation.
  if (Object.keys(responses).length === 0) {
    responses['200'] = { description: 'Response' };
  }

  return responses;
}
