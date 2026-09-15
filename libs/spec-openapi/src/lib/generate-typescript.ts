import type { Endpoint, NamedSchema } from '@apion/contracts';
import { schemaNameFromRef, topologicalSchemaOrder } from '@apion/domain';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Emits TypeScript types and a typed `fetch` client (PRD 02 FR-2.7).
 *
 * This is a direct JSON Schema to TypeScript translation. Anything it cannot
 * express becomes `unknown` rather than a wrong type: a client that fails to
 * compile is recoverable; one that lies about its shapes is not.
 */
export function generateTypeScript(input: {
  schemas: readonly NamedSchema[];
  endpoints: readonly Endpoint[];
  title: string;
}): string {
  const byName = new Map(input.schemas.map((s) => [s.name, s.schema]));
  const order = topologicalSchemaOrder(byName);

  const lines = [
    `// Generated from the ${input.title} contract. Edits here are overwritten.`,
    '',
  ];

  for (const name of order) {
    const schema = byName.get(name);
    const description = input.schemas.find((s) => s.name === name)?.description;
    if (description)
      lines.push(`/** ${description.replaceAll('*/', '*\\/')} */`);
    lines.push(`export type ${name} = ${typeOf(schema, 0)};`, '');
  }

  for (const endpoint of input.endpoints) {
    lines.push(...operationTypes(endpoint));
  }

  lines.push(...clientSource(input.endpoints));

  return lines.join('\n');
}

/** Turns a JSON Schema into a TypeScript type expression. */
function typeOf(schema: unknown, depth: number): string {
  if (depth > 20) return 'unknown';
  if (schema === true) return 'unknown';
  if (schema === false) return 'never';
  if (!isObject(schema)) return 'unknown';

  if (typeof schema['$ref'] === 'string') {
    return schemaNameFromRef(schema['$ref']) ?? 'unknown';
  }

  if (Array.isArray(schema['enum'])) {
    return (
      schema['enum'].map((value) => JSON.stringify(value)).join(' | ') ||
      'never'
    );
  }

  if (schema['const'] !== undefined) return JSON.stringify(schema['const']);

  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches) && branches.length > 0) {
      return branches.map((branch) => typeOf(branch, depth + 1)).join(' | ');
    }
  }

  if (Array.isArray(schema['allOf']) && schema['allOf'].length > 0) {
    return schema['allOf']
      .map((branch) => typeOf(branch, depth + 1))
      .join(' & ');
  }

  const type = schema['type'];

  if (Array.isArray(type)) {
    return type
      .map((t) => typeOf({ ...schema, type: t }, depth + 1))
      .join(' | ');
  }

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `${typeOf(schema['items'], depth + 1)}[]`;
    case 'object':
      return objectTypeOf(schema, depth);
    default:
      // No `type`, but `properties` still describes an object.
      return isObject(schema['properties'])
        ? objectTypeOf(schema, depth)
        : 'unknown';
  }
}

function objectTypeOf(schema: JsonObject, depth: number): string {
  const properties = isObject(schema['properties']) ? schema['properties'] : {};
  const required = new Set(
    Array.isArray(schema['required'])
      ? schema['required'].filter((r): r is string => typeof r === 'string')
      : [],
  );

  const entries = Object.entries(properties);
  const indent = '  '.repeat(depth + 1);
  const closingIndent = '  '.repeat(depth);

  const members = entries.map(([name, property]) => {
    const optional = required.has(name) ? '' : '?';
    const doc =
      isObject(property) && typeof property['description'] === 'string'
        ? `${indent}/** ${property['description'].replaceAll('*/', '*\\/')} */\n`
        : '';
    return `${doc}${indent}${propertyKey(name)}${optional}: ${typeOf(property, depth + 1)};`;
  });

  const additional = schema['additionalProperties'];
  if (additional !== undefined && additional !== false) {
    members.push(
      `${indent}[key: string]: ${additional === true ? 'unknown' : typeOf(additional, depth + 1)};`,
    );
  }

  if (members.length === 0) return 'Record<string, unknown>';

  return `{\n${members.join('\n')}\n${closingIndent}}`;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const propertyKey = (name: string): string =>
  IDENTIFIER.test(name) ? name : JSON.stringify(name);

function operationName(endpoint: Endpoint): string {
  if (endpoint.operationId) return pascalCase(endpoint.operationId);

  const segments = endpoint.path
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith('{')
        ? `By${pascalCase(segment.slice(1, -1))}`
        : pascalCase(segment),
    );

  return `${pascalCase(endpoint.method)}${segments.join('')}`;
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function operationTypes(endpoint: Endpoint): string[] {
  const name = operationName(endpoint);
  const lines: string[] = [];

  const pathParameters = endpoint.parameters.filter(
    (p) => p.location === 'path',
  );
  if (pathParameters.length > 0) {
    lines.push(
      `export interface ${name}Params {`,
      ...pathParameters.map(
        (parameter) =>
          `  ${propertyKey(parameter.name)}: ${typeOf(parameter.schema, 1)};`,
      ),
      '}',
      '',
    );
  }

  const queryParameters = endpoint.parameters.filter(
    (p) => p.location === 'query',
  );
  if (queryParameters.length > 0) {
    lines.push(
      `export interface ${name}Query {`,
      ...queryParameters.map(
        (parameter) =>
          `  ${propertyKey(parameter.name)}${parameter.required ? '' : '?'}: ${typeOf(parameter.schema, 1)};`,
      ),
      '}',
      '',
    );
  }

  if (endpoint.requestBody) {
    lines.push(
      `export type ${name}Body = ${typeOf(endpoint.requestBody.schema, 0)};`,
      '',
    );
  }

  const success = endpoint.responses.filter(
    (response) =>
      typeof response.statusCode === 'number' &&
      response.statusCode >= 200 &&
      response.statusCode < 300,
  );

  const responseType =
    success.length > 0
      ? success
          .map((response) =>
            response.payloadSchema === null
              ? 'void'
              : typeOf(response.payloadSchema, 0),
          )
          .join(' | ')
      : 'void';

  lines.push(`export type ${name}Response = ${responseType};`, '');

  return lines;
}

function clientSource(endpoints: readonly Endpoint[]): string[] {
  const lines = [
    'export interface ClientOptions {',
    '  baseUrl: string;',
    '  /** Merged into every request; use it for Authorization.  */',
    '  headers?: Record<string, string>;',
    '  fetch?: typeof globalThis.fetch;',
    '}',
    '',
    'export class ApiError extends Error {',
    '  constructor(',
    '    readonly status: number,',
    '    readonly body: unknown,',
    '  ) {',
    // The placeholder belongs to the generated client, not to this file.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: emitted source
    '    super(`Request failed with status ${status}`);',
    "    this.name = 'ApiError';",
    '  }',
    '}',
    '',
    'export function createClient(options: ClientOptions) {',
    '  const doFetch = options.fetch ?? globalThis.fetch;',
    "  const base = options.baseUrl.replace(/\\/$/, '');",
    '',
    '  async function request(',
    '    method: string,',
    '    path: string,',
    '    init: { query?: Record<string, unknown>; body?: unknown } = {},',
    '  ): Promise<unknown> {',
    '    const url = new URL(base + path);',
    '    for (const [key, value] of Object.entries(init.query ?? {})) {',
    '      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));',
    '    }',
    '',
    '    const response = await doFetch(url, {',
    '      method,',
    '      headers: {',
    "        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),",
    '        ...options.headers,',
    '      },',
    '      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),',
    '    });',
    '',
    '    const text = await response.text();',
    '    const parsed = text.length > 0 ? JSON.parse(text) : undefined;',
    '',
    '    if (!response.ok) throw new ApiError(response.status, parsed);',
    '    return parsed;',
    '  }',
    '',
    '  return {',
  ];

  for (const endpoint of endpoints) {
    const name = operationName(endpoint);
    const camel = name.charAt(0).toLowerCase() + name.slice(1);

    const pathParameters = endpoint.parameters.filter(
      (p) => p.location === 'path',
    );
    const queryParameters = endpoint.parameters.filter(
      (p) => p.location === 'query',
    );

    const args: string[] = [];
    if (pathParameters.length > 0) args.push(`params: ${name}Params`);
    if (queryParameters.length > 0) args.push(`query: ${name}Query`);
    if (endpoint.requestBody) {
      args.push(`body${endpoint.requestBody.required ? '' : '?'}: ${name}Body`);
    }

    // Template literal so `{id}` becomes `${params.id}` in the emitted client.
    const pathExpression = endpoint.path.replaceAll(
      /\{([^}]+)\}/g,
      (_match, parameter: string) =>
        `\${encodeURIComponent(String(params${propertyAccess(parameter)}))}`,
    );

    lines.push(
      `    ${camel}(${args.join(', ')}): Promise<${name}Response> {`,
      `      return request(${JSON.stringify(endpoint.method.toUpperCase())}, \`${pathExpression}\`, {`,
      ...(queryParameters.length > 0 ? ['        query,'] : []),
      ...(endpoint.requestBody ? ['        body,'] : []),
      `      }) as Promise<${name}Response>;`,
      '    },',
    );
  }

  lines.push('  };', '}', '');
  return lines;
}

const propertyAccess = (name: string): string =>
  IDENTIFIER.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
