import { z } from 'zod';

/**
 * Platform routes that would shadow a contract if a project claimed them
 * (PRD 02 FR-2.2, PRD 05 "Route and access model").
 */
export const RESERVED_PATH_PREFIXES = ['/api', '/mock', '/__mock'] as const;

const PATH_PARAM_PATTERN = /\{([^{}]*)\}/g;

/** A path parameter name has to survive both a URL and a TypeScript identifier. */
const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type PathProblem =
  | { kind: 'empty' }
  | { kind: 'missing_leading_slash' }
  | { kind: 'trailing_slash' }
  | { kind: 'empty_segment' }
  | { kind: 'reserved_prefix'; prefix: string }
  | { kind: 'unbalanced_braces' }
  | { kind: 'invalid_parameter_name'; name: string }
  | { kind: 'duplicate_parameter'; name: string }
  | { kind: 'mixed_segment'; segment: string }
  | { kind: 'illegal_character'; character: string };

/** Characters allowed in a literal segment. Excludes those with URL meaning. */
const LITERAL_SEGMENT_PATTERN = /^[A-Za-z0-9\-._~%!$&'()*+,;=:@]+$/;

export function extractPathParameters(path: string): string[] {
  return [...path.matchAll(PATH_PARAM_PATTERN)].map((match) => match[1]);
}

export function isReservedPath(path: string): boolean {
  return RESERVED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function validateEndpointPath(path: string): PathProblem[] {
  const problems: PathProblem[] = [];

  if (path.length === 0) return [{ kind: 'empty' }];
  if (!path.startsWith('/')) problems.push({ kind: 'missing_leading_slash' });
  if (path.length > 1 && path.endsWith('/'))
    problems.push({ kind: 'trailing_slash' });

  const reserved = RESERVED_PATH_PREFIXES.find(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (reserved) problems.push({ kind: 'reserved_prefix', prefix: reserved });

  const openCount = (path.match(/\{/g) ?? []).length;
  const closeCount = (path.match(/\}/g) ?? []).length;
  if (openCount !== closeCount) problems.push({ kind: 'unbalanced_braces' });

  const seen = new Set<string>();
  const segments = path.split('/').slice(1);

  for (const [index, segment] of segments.entries()) {
    if (segment.length === 0) {
      // The root path is one empty segment, and a trailing slash is already
      // reported above. Neither should also be flagged here.
      const isTrailing = index === segments.length - 1;
      if (!isTrailing) problems.push({ kind: 'empty_segment' });
      continue;
    }

    const isWholeParameter = segment.startsWith('{') && segment.endsWith('}');
    if (isWholeParameter) {
      const name = segment.slice(1, -1);
      if (!PARAM_NAME_PATTERN.test(name)) {
        problems.push({ kind: 'invalid_parameter_name', name });
      } else if (seen.has(name)) {
        problems.push({ kind: 'duplicate_parameter', name });
      } else {
        seen.add(name);
      }
      continue;
    }

    // `/files/{id}.json` would make the parameter's boundary ambiguous.
    if (segment.includes('{') || segment.includes('}')) {
      problems.push({ kind: 'mixed_segment', segment });
      continue;
    }

    if (!LITERAL_SEGMENT_PATTERN.test(segment)) {
      const character = [...segment].find(
        (char) => !LITERAL_SEGMENT_PATTERN.test(char),
      );
      problems.push({
        kind: 'illegal_character',
        character: character ?? segment,
      });
    }
  }

  return problems;
}

export function describePathProblem(problem: PathProblem): string {
  switch (problem.kind) {
    case 'empty':
      return 'Enter a path.';
    case 'missing_leading_slash':
      return 'Start the path with a slash.';
    case 'trailing_slash':
      return 'Remove the trailing slash.';
    case 'empty_segment':
      return 'Remove the empty path segment.';
    case 'reserved_prefix':
      return `${problem.prefix} is reserved for the platform. Choose another path.`;
    case 'unbalanced_braces':
      return 'Every { needs a matching }.';
    case 'invalid_parameter_name':
      return `"${problem.name}" is not a usable parameter name. Use letters, digits and underscores, starting with a letter.`;
    case 'duplicate_parameter':
      return `The parameter {${problem.name}} appears more than once.`;
    case 'mixed_segment':
      return `Put "${problem.segment}" in its own segment; a parameter cannot share one with other text.`;
    case 'illegal_character':
      return `"${problem.character}" is not allowed in a path.`;
  }
}

export const endpointPathSchema = z.string().superRefine((value, ctx) => {
  for (const problem of validateEndpointPath(value)) {
    ctx.addIssue({ code: 'custom', message: describePathProblem(problem) });
  }
});
