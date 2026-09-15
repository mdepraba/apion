import {
  type CreateEndpointRequest,
  type HttpMethod,
  httpMethods,
  type Parameter,
  type ParameterLocation,
  parameterLocations,
  validateEndpointPath,
} from '@apion/contracts';
import { parse as parseYaml } from 'yaml';

export interface ImportedResource {
  name: string;
  description: string;
}

export interface ImportedSchema {
  name: string;
  description: string;
  schema: unknown;
}

/** An endpoint as imported, before it is assigned a resource id. */
export interface ImportedEndpoint
  extends Omit<CreateEndpointRequest, 'resourceId'> {
  resourceName: string;
}

export interface ImportResult {
  title: string;
  version: string;
  description: string;
  resources: ImportedResource[];
  schemas: ImportedSchema[];
  endpoints: ImportedEndpoint[];
  /** Things that could not be represented, surfaced rather than swallowed. */
  warnings: string[];
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

/** Accepts YAML or JSON, since FR-2.7 requires both. */
export function parseSpecDocument(source: string): unknown {
  const trimmed = source.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  return parseYaml(trimmed);
}

/**
 * Imports OpenAPI 3.0 or 3.1 (FR-2.7). Anything the contract model cannot hold
 * is reported as a warning rather than dropped in silence: an import that
 * quietly loses half a spec is worse than one that says what it lost.
 */
export function importOpenApi(source: string | unknown): ImportResult {
  const document =
    typeof source === 'string' ? parseSpecDocument(source) : source;

  if (!isObject(document)) {
    throw new Error('This file is not an OpenAPI document.');
  }

  const warnings: string[] = [];
  const openapi = asString(document['openapi'] ?? document['swagger']);

  if (!openapi) {
    throw new Error('This file has no "openapi" version field.');
  }
  if (openapi.startsWith('2')) {
    throw new Error(
      'Swagger 2.0 is not supported. Convert it to OpenAPI 3 and import again.',
    );
  }

  const info = isObject(document['info']) ? document['info'] : {};
  const paths = isObject(document['paths']) ? document['paths'] : {};

  const resources = new Map<string, ImportedResource>();
  for (const tag of Array.isArray(document['tags']) ? document['tags'] : []) {
    if (!isObject(tag)) continue;
    const name = asString(tag['name']);
    if (name) {
      resources.set(name, { name, description: asString(tag['description']) });
    }
  }

  const endpoints: ImportedEndpoint[] = [];

  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;

    const problems = validateEndpointPath(path);
    if (problems.length > 0) {
      warnings.push(
        `Skipped "${path}": it is not a path this project can hold (${problems[0].kind.replaceAll('_', ' ')}).`,
      );
      continue;
    }

    // Parameters declared once for the whole path apply to every operation on it.
    const sharedParameters = readParameters(item['parameters'], warnings, path);

    for (const method of httpMethods) {
      const operation = item[method];
      if (!isObject(operation)) continue;

      const tags = Array.isArray(operation['tags'])
        ? operation['tags'].filter((t): t is string => typeof t === 'string')
        : [];
      const resourceName = tags[0] ?? deriveResourceName(path);

      if (!resources.has(resourceName)) {
        resources.set(resourceName, { name: resourceName, description: '' });
      }

      endpoints.push({
        resourceName,
        method: method as HttpMethod,
        path,
        summary:
          asString(operation['summary']) ||
          asString(operation['operationId']) ||
          `${method.toUpperCase()} ${path}`,
        description: asString(operation['description']),
        operationId: asString(operation['operationId']) || null,
        parameters: [
          ...sharedParameters,
          ...readParameters(operation['parameters'], warnings, path),
        ],
        requestBody: readRequestBody(operation['requestBody'], warnings, path),
        responses: readResponses(operation['responses'], warnings, path),
        // An operation with an empty `security` array opts out of auth.
        authRequired: !(
          Array.isArray(operation['security']) &&
          operation['security'].length === 0
        ),
        deprecated: operation['deprecated'] === true,
        ownerId: null,
        ticketUrl: asString(operation['x-apion-ticket']) || null,
        tags: Array.isArray(operation['x-apion-tags'])
          ? operation['x-apion-tags'].filter(
              (t): t is string => typeof t === 'string',
            )
          : [],
      });
    }
  }

  const components = isObject(document['components'])
    ? document['components']
    : {};
  const componentSchemas = isObject(components['schemas'])
    ? components['schemas']
    : {};

  const schemas: ImportedSchema[] = Object.entries(componentSchemas).map(
    ([name, schema]) => ({
      name,
      description: isObject(schema) ? asString(schema['description']) : '',
      schema,
    }),
  );

  for (const key of ['securitySchemes', 'callbacks', 'links'] as const) {
    if (isObject(components[key]) && Object.keys(components[key]).length > 0) {
      warnings.push(
        `components.${key} was not imported; this project does not model it yet.`,
      );
    }
  }

  if (endpoints.length === 0) {
    warnings.push('No usable operations were found in this document.');
  }

  return {
    title: asString(info['title'], 'Imported API'),
    version: asString(info['version'], 'v1'),
    description: asString(info['description']),
    resources: [...resources.values()],
    schemas,
    endpoints,
    warnings,
  };
}

function readParameters(
  value: unknown,
  warnings: string[],
  path: string,
): Parameter[] {
  if (!Array.isArray(value)) return [];

  const parameters: Parameter[] = [];

  for (const entry of value) {
    if (!isObject(entry)) continue;

    if (typeof entry['$ref'] === 'string') {
      // A shared parameter component would need resolving before it can be
      // inlined; say so rather than dropping it without a word.
      warnings.push(
        `${path}: a $ref parameter was skipped (${entry['$ref']}).`,
      );
      continue;
    }

    const location = asString(entry['in']) as ParameterLocation;
    if (!parameterLocations.includes(location)) {
      warnings.push(
        `${path}: parameter "${asString(entry['name'])}" has no valid "in".`,
      );
      continue;
    }

    parameters.push({
      name: asString(entry['name']),
      location,
      description: asString(entry['description']),
      required: location === 'path' ? true : entry['required'] === true,
      deprecated: entry['deprecated'] === true,
      schema: entry['schema'] ?? {},
    });
  }

  return parameters;
}

function readRequestBody(
  value: unknown,
  warnings: string[],
  path: string,
): CreateEndpointRequest['requestBody'] {
  if (!isObject(value)) return null;

  const content = isObject(value['content']) ? value['content'] : {};
  const contentTypes = Object.keys(content);

  if (contentTypes.length === 0) return null;

  const preferred = contentTypes.includes('application/json')
    ? 'application/json'
    : contentTypes[0];

  if (contentTypes.length > 1) {
    warnings.push(
      `${path}: kept the ${preferred} request body; ${contentTypes.length - 1} other media ${contentTypes.length === 2 ? 'type was' : 'types were'} dropped.`,
    );
  }

  const media = content[preferred];

  return {
    description: asString(value['description']),
    required: value['required'] === true,
    contentType: preferred,
    schema: isObject(media) ? (media['schema'] ?? {}) : {},
  };
}

function readResponses(
  value: unknown,
  warnings: string[],
  path: string,
): CreateEndpointRequest['responses'] {
  if (!isObject(value)) return [];

  const responses: NonNullable<CreateEndpointRequest['responses']> = [];

  for (const [code, entry] of Object.entries(value)) {
    if (!isObject(entry)) continue;

    const statusCode =
      code === 'default' ? ('default' as const) : Number.parseInt(code, 10);

    if (statusCode !== 'default' && Number.isNaN(statusCode)) {
      warnings.push(`${path}: response key "${code}" is not a status code.`);
      continue;
    }

    const content = isObject(entry['content']) ? entry['content'] : {};
    const media = isObject(content['application/json'])
      ? content['application/json']
      : undefined;

    responses.push({
      statusCode,
      description: asString(entry['description']),
      headers: readHeaders(entry['headers']),
      payloadSchema: media?.['schema'] ?? null,
      examples: readExamples(media?.['examples'], media?.['example']),
    });
  }

  return responses;
}

function readHeaders(value: unknown): Parameter[] {
  if (!isObject(value)) return [];

  return Object.entries(value)
    .filter(([, header]) => isObject(header))
    .map(([name, header]) => {
      const entry = header as JsonObject;
      return {
        name,
        location: 'header' as const,
        description: asString(entry['description']),
        required: entry['required'] === true,
        deprecated: entry['deprecated'] === true,
        schema: entry['schema'] ?? {},
      };
    });
}

/**
 * An imported example is a bare response body, not this project's slot values.
 * It is stored as written and read as the data slot, so an import never
 * fabricates a `$message` its source never had; lint then asks the author to
 * fill the rest.
 */
function readExamples(
  examples: unknown,
  singleExample: unknown,
): NonNullable<CreateEndpointRequest['responses']>[number]['examples'] {
  if (isObject(examples)) {
    return Object.entries(examples).map(([name, example]) => ({
      name,
      summary: isObject(example) ? asString(example['summary']) : '',
      isDefault: isObject(example) && example['x-apion-default'] === true,
      value: isObject(example) ? example['value'] : example,
    }));
  }

  // OpenAPI 3.0's singular `example` has no name, so give it one.
  if (singleExample !== undefined) {
    return [
      {
        name: 'default',
        summary: '',
        isDefault: true,
        value: singleExample,
      },
    ];
  }

  return [];
}

/** `/orders/{id}/items` becomes `Orders` when the spec declares no tag. */
function deriveResourceName(path: string): string {
  const segment = path.split('/').find((part) => part && !part.startsWith('{'));
  if (!segment) return 'Default';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}
