import type {
  Endpoint,
  EndpointResponse,
  ScenarioRule,
} from '@apion/contracts';

/**
 * FR-6.4: "Response selection precedence is: `Prefer: code=404`,
 * `Prefer: example=emptyList`, `X-Mock-Scenario`, default example, then lowest
 * declared 2xx generated from schema."
 *
 * The order is the contract between a client and the mock, so it is expressed
 * once, here, and reported back in `X-Mock-Source` for whoever is debugging.
 */

export type SelectionSource =
  | 'prefer-code'
  | 'prefer-example'
  | 'scenario'
  | 'default-example'
  | 'generated';

export interface SelectionRequest {
  /** Parsed `Prefer` header, if any. */
  prefer?: { code?: number; example?: string };
  scenarioName?: string;
  scenarioRules?: readonly ScenarioRule[];
}

export interface Selection {
  response: EndpointResponse;
  /** The example to serve, or undefined when the payload is generated. */
  example?: { name: string; value: unknown };
  source: SelectionSource;
  /** A scenario may hold the response back; the caller applies the delay. */
  delayMs?: number;
}

export function selectResponse(
  endpoint: Endpoint,
  request: SelectionRequest,
): Selection | null {
  if (endpoint.responses.length === 0) return null;

  const preferCode = request.prefer?.code;
  if (preferCode !== undefined) {
    const match = endpoint.responses.find(
      (response) => response.statusCode === preferCode,
    );
    if (match) {
      return { response: match, ...pickExample(match), source: 'prefer-code' };
    }
  }

  const preferExample = request.prefer?.example;
  if (preferExample !== undefined) {
    for (const response of endpoint.responses) {
      const example = response.examples.find(
        (candidate) => candidate.name === preferExample,
      );
      if (example) {
        return {
          response,
          example: { name: example.name, value: example.value },
          source: 'prefer-example',
        };
      }
    }
  }

  const scenario = applyScenario(endpoint, request.scenarioRules ?? []);
  if (scenario) return scenario;

  const withDefault = endpoint.responses.find((response) =>
    response.examples.some((example) => example.isDefault),
  );
  if (withDefault) {
    const example = withDefault.examples.find(
      (candidate) => candidate.isDefault,
    );
    return {
      response: withDefault,
      example: example
        ? { name: example.name, value: example.value }
        : undefined,
      source: 'default-example',
    };
  }

  const lowest2xx = lowestSuccess(endpoint.responses);
  if (!lowest2xx) return null;

  return {
    response: lowest2xx,
    ...pickExample(lowest2xx),
    source: pickExample(lowest2xx).example ? 'default-example' : 'generated',
  };
}

/**
 * A scenario rule for this endpoint beats the project-wide one, so
 * `serverErrors` can be blanket while one endpoint stays healthy inside it.
 */
function applyScenario(
  endpoint: Endpoint,
  rules: readonly ScenarioRule[],
): Selection | null {
  const rule =
    rules.find((candidate) => candidate.endpointId === endpoint.id) ??
    rules.find((candidate) => candidate.endpointId === null);

  if (!rule) return null;

  const response =
    rule.statusCode === null
      ? lowestSuccess(endpoint.responses)
      : endpoint.responses.find(
          (candidate) => candidate.statusCode === rule.statusCode,
        );

  // A scenario asking for a status the endpoint does not declare is ignored
  // rather than invented: the contract stays the source of truth.
  if (!response) return null;

  const named = rule.exampleName
    ? response.examples.find((example) => example.name === rule.exampleName)
    : undefined;

  return {
    response,
    example: named
      ? { name: named.name, value: named.value }
      : pickExample(response).example,
    source: 'scenario',
    delayMs: rule.delayMs ?? undefined,
  };
}

function pickExample(response: EndpointResponse): {
  example?: { name: string; value: unknown };
} {
  const chosen =
    response.examples.find((example) => example.isDefault) ??
    response.examples[0];

  return chosen ? { example: { name: chosen.name, value: chosen.value } } : {};
}

function lowestSuccess(
  responses: readonly EndpointResponse[],
): EndpointResponse | undefined {
  const successes = responses
    .filter(
      (response): response is EndpointResponse & { statusCode: number } =>
        typeof response.statusCode === 'number' &&
        response.statusCode >= 200 &&
        response.statusCode < 300,
    )
    .sort((a, b) => a.statusCode - b.statusCode);

  // An endpoint that declares only failures still answers with something.
  return successes[0] ?? responses[0];
}

/** `Prefer: code=404, example=emptyList` as FR-6.4 writes it. */
export function parsePrefer(
  header: string | undefined,
): { code?: number; example?: string } | undefined {
  if (!header) return undefined;

  const result: { code?: number; example?: string } = {};

  for (const part of header.split(',')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim().replace(/^"|"$/g, '');

    if (key === 'code') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) result.code = parsed;
    }
    if (key === 'example') result.example = value;
  }

  return result.code === undefined && result.example === undefined
    ? undefined
    : result;
}
