import type { HttpMethod } from '@apion/contracts';

/**
 * Route matching for the contract-derived mock (PRD 05). The rest of the mock
 * engine is Phase 3; matching exists now because it is the piece the API's
 * reserved-path validation is the mirror of, and getting the precedence wrong
 * later would silently reroute live mocks.
 *
 * PRD 05: "Match method first, then path. Literal segments beat parameters
 * (`/orders/export` precedes `/orders/{id}`)."
 */

export interface MockRoute<T = unknown> {
  method: HttpMethod;
  path: string;
  value: T;
}

export interface RouteMatch<T> {
  route: MockRoute<T>;
  /** Captured path parameters, available to response templating. */
  params: Record<string, string>;
}

export type MatchResult<T> =
  | { outcome: 'matched'; match: RouteMatch<T> }
  | { outcome: 'method_not_allowed'; allowed: HttpMethod[] }
  | { outcome: 'not_found' };

interface CompiledRoute<T> {
  route: MockRoute<T>;
  segments: readonly Segment[];
}

type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string };

function compile<T>(route: MockRoute<T>): CompiledRoute<T> {
  const segments = route.path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(
      (segment): Segment =>
        segment.startsWith('{') && segment.endsWith('}')
          ? { kind: 'param', name: segment.slice(1, -1) }
          : { kind: 'literal', value: segment },
    );

  return { route, segments };
}

/**
 * Ranks two routes of equal length. The first segment where they differ in kind
 * decides it: a literal is more specific than a parameter, so `/orders/export`
 * wins over `/orders/{id}` however the routes were declared.
 */
function moreSpecific<T>(a: CompiledRoute<T>, b: CompiledRoute<T>): number {
  for (
    let index = 0;
    index < Math.min(a.segments.length, b.segments.length);
    index += 1
  ) {
    const left = a.segments[index];
    const right = b.segments[index];
    if (left.kind === right.kind) continue;
    return left.kind === 'literal' ? -1 : 1;
  }
  return 0;
}

export class RouteTable<T> {
  private readonly compiled: CompiledRoute<T>[];

  constructor(routes: readonly MockRoute<T>[]) {
    // Sorted once at construction so every request is a linear scan over an
    // already-ordered list rather than a sort per call.
    this.compiled = routes.map(compile).sort(moreSpecific);
  }

  match(method: HttpMethod, path: string): MatchResult<T> {
    const requestSegments = path
      .split('/')
      .filter((segment) => segment.length > 0);
    const pathMatches: CompiledRoute<T>[] = [];

    for (const candidate of this.compiled) {
      if (candidate.segments.length !== requestSegments.length) continue;
      if (capture(candidate, requestSegments) === undefined) continue;
      pathMatches.push(candidate);
    }

    if (pathMatches.length === 0) return { outcome: 'not_found' };

    const forMethod = pathMatches.find(
      (candidate) => candidate.route.method === method,
    );

    if (!forMethod) {
      // PRD 05: a method mismatch is a 405 carrying `Allow`, not a 404. The
      // difference tells a client the path is right and the verb is not.
      return {
        outcome: 'method_not_allowed',
        allowed: [
          ...new Set(pathMatches.map((candidate) => candidate.route.method)),
        ],
      };
    }

    return {
      outcome: 'matched',
      match: {
        route: forMethod.route,
        params: capture(forMethod, requestSegments) ?? {},
      },
    };
  }
}

/** Returns the captured parameters, or undefined when a literal disagrees. */
function capture<T>(
  candidate: CompiledRoute<T>,
  requestSegments: readonly string[],
): Record<string, string> | undefined {
  const params: Record<string, string> = {};

  for (const [index, segment] of candidate.segments.entries()) {
    const actual = requestSegments[index];
    if (segment.kind === 'literal') {
      if (segment.value !== actual) return undefined;
      continue;
    }
    // A path parameter never matches an empty segment; `/orders//items` is not
    // a request for order "".
    if (actual === undefined || actual.length === 0) return undefined;
    params[segment.name] = decodeURIComponent(actual);
  }

  return params;
}
