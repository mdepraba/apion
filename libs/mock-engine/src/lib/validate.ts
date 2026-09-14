import type { Endpoint, Parameter } from '@apion/contracts';
import { Ajv } from 'ajv';
import * as ajvFormats from 'ajv-formats';

/**
 * ajv-formats is CommonJS with a default export, which reaches ESM as either
 * the namespace or its `.default` depending on the loader. Both shapes are
 * accepted here rather than pinning one and breaking under the other runtime.
 */
const addFormats = (
  typeof ajvFormats === 'function'
    ? ajvFormats
    : (ajvFormats as { default: unknown }).default
) as (ajv: Ajv) => void;

/**
 * FR-6.5: "Validate path/query/header/body; failures use the project error
 * envelope, mapped code (normally `VALIDATION_FAILED`) and JSON-pointer
 * details."
 *
 * The engine reports the problems; the caller maps them onto the project's
 * error envelope, because only the standard knows what that envelope is.
 */

export interface ValidationProblem {
  /** RFC 6901, rooted at the request: `/body/items/0/price`, `/query/limit`. */
  pointer: string;
  message: string;
}

/**
 * Deep enough for a contract that nests a few named schemas, bounded so a
 * recursive `$ref` cannot expand forever on a 1 vCPU host.
 */
const MAX_INLINE_DEPTH = 24;

export interface ValidationInput {
  endpoint: Endpoint;
  pathParams: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string | string[]>>;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: unknown;
  resolveRef?: (ref: string) => unknown;
}

/**
 * One Ajv per engine, not per request. Compiling a schema is the expensive part
 * and the cache is what keeps validation off the critical path on a 1 vCPU host.
 */
export class RequestValidator {
  private readonly ajv: Ajv;
  /** Schemas that would not compile, for the caller to surface or log. */
  private readonly problems: string[] = [];

  constructor() {
    this.ajv = new Ajv({
      strict: false,
      allErrors: true,
      // A contract may legally reference a schema this validator was not given;
      // refusing to compile would take the whole mock down for one bad ref.
      validateSchema: false,
      allowUnionTypes: true,
    });
    addFormats(this.ajv);
  }

  /** Reads and clears the uncompilable-schema reports since the last call. */
  drainSchemaProblems(): string[] {
    return this.problems.splice(0, this.problems.length);
  }

  validate(input: ValidationInput): ValidationProblem[] {
    const problems: ValidationProblem[] = [];
    const { endpoint } = input;

    for (const parameter of endpoint.parameters) {
      problems.push(...this.checkParameter(parameter, input));
    }

    const requestBody = endpoint.requestBody;
    if (requestBody) {
      if (
        requestBody.required &&
        (input.body === undefined || input.body === null)
      ) {
        problems.push({
          pointer: '/body',
          message: 'A request body is required.',
        });
      } else if (input.body !== undefined && input.body !== null) {
        problems.push(
          ...this.check(
            requestBody.schema,
            input.body,
            '/body',
            input.resolveRef,
          ),
        );
      }
    }

    return problems;
  }

  private checkParameter(
    parameter: Parameter,
    input: ValidationInput,
  ): ValidationProblem[] {
    const { value, pointer, present } = locate(parameter, input);

    if (!present) {
      return parameter.required
        ? [
            {
              pointer,
              message: `${parameter.location === 'path' ? 'Path' : 'Query'} parameter "${parameter.name}" is required.`,
            },
          ]
        : [];
    }

    // Everything outside the body arrives as a string, so a schema asking for a
    // number is checked against the parsed value rather than the raw text.
    return this.check(
      parameter.schema,
      coerce(value, parameter.schema),
      pointer,
      input.resolveRef,
    );
  }

  private check(
    schema: unknown,
    value: unknown,
    pointer: string,
    resolveRef: ((ref: string) => unknown) | undefined,
  ): ValidationProblem[] {
    const resolved = inline(schema, resolveRef);
    if (resolved === undefined) return [];

    try {
      const validate = this.ajv.compile(resolved as object);
      if (validate(value)) return [];

      return (validate.errors ?? []).map((error) => ({
        pointer: `${pointer}${error.instancePath}`,
        message: humanise(error.message ?? 'is not valid', error.params),
      }));
    } catch (error) {
      // An uncompilable schema is a contract problem, not a caller problem, so
      // the request is let through rather than rejected for someone else's bug.
      // It is reported, because a validator that silently passes everything is
      // worse than one that is switched off on purpose.
      this.problems.push(
        error instanceof Error ? error.message : String(error),
      );
      return [];
    }
  }
}

function locate(
  parameter: Parameter,
  input: ValidationInput,
): { value: unknown; pointer: string; present: boolean } {
  switch (parameter.location) {
    case 'path': {
      const value = input.pathParams[parameter.name];
      return {
        value,
        pointer: `/path/${parameter.name}`,
        present: value !== undefined,
      };
    }
    case 'query': {
      const value = input.query[parameter.name];
      return {
        value,
        pointer: `/query/${parameter.name}`,
        present: value !== undefined,
      };
    }
    case 'header': {
      const value = input.headers[parameter.name.toLowerCase()];
      return {
        value,
        pointer: `/headers/${parameter.name}`,
        present: value !== undefined,
      };
    }
    case 'cookie':
      // Cookie parameters are declared but not enforced by the mock.
      return {
        value: undefined,
        pointer: `/cookie/${parameter.name}`,
        present: false,
      };
  }
}

function coerce(value: unknown, schema: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (typeof schema !== 'object' || schema === null) return value;

  switch ((schema as Record<string, unknown>)['type']) {
    case 'integer':
    case 'number': {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      return value;
    default:
      return value;
  }
}

/**
 * Replaces `$ref`s with their targets, so Ajv never needs a resolver.
 *
 * An unresolvable ref, or one past the depth cap, becomes an empty object
 * schema rather than `true`. Both accept anything, but `true` is only legal
 * where a whole schema is expected: as a `type` value it makes Ajv reject the
 * entire document, and a schema that fails to compile validates nothing at all.
 */
function inline(
  schema: unknown,
  resolveRef: ((ref: string) => unknown) | undefined,
  depth = 0,
): unknown {
  if (depth > MAX_INLINE_DEPTH) return {};
  if (typeof schema !== 'object' || schema === null) return schema;

  if (Array.isArray(schema)) {
    return schema.map((member) => inline(member, resolveRef, depth + 1));
  }

  const node = schema as Record<string, unknown>;
  const ref = node['$ref'];

  if (typeof ref === 'string') {
    const target = resolveRef?.(ref);
    return target === undefined ? {} : inline(target, resolveRef, depth + 1);
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      inline(value, resolveRef, depth + 1),
    ]),
  );
}

/** Ajv's wording, turned into something a client developer can act on. */
function humanise(message: string, params: Record<string, unknown>): string {
  if (typeof params['missingProperty'] === 'string') {
    return `must have required property "${params['missingProperty']}"`;
  }
  if (typeof params['additionalProperty'] === 'string') {
    return `has an unexpected property "${params['additionalProperty']}"`;
  }
  return message;
}
