import type { NamingConvention } from './standard.js';

/**
 * Convention checks for RS002 (property names) and RS010 (path segments).
 *
 * Each pattern is anchored and deliberately strict about the boundary cases
 * that separate one convention from another: `userID` is not camelCase because
 * a run of capitals hides a word boundary, and `user__id` is not snake_case
 * because the empty part between the underscores is not a word.
 */
const PATTERNS: Record<NamingConvention, RegExp> = {
  // Each capital must start a word, so `userID` fails and `userId` passes.
  camelCase: /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*$/,
  snake_case: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
  'kebab-case': /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  PascalCase: /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*$/,
};

export const NAMING_EXAMPLES: Record<NamingConvention, string> = {
  camelCase: 'orderId',
  snake_case: 'order_id',
  'kebab-case': 'order-id',
  PascalCase: 'OrderId',
};

export function matchesConvention(
  name: string,
  convention: NamingConvention,
): boolean {
  if (name.length === 0) return false;
  return PATTERNS[convention].test(name);
}

/**
 * Rewrites a name into a convention, for the "fix this" affordance next to a
 * RS002 violation. Splitting happens first so the input's own convention does
 * not matter: `order_id`, `orderId` and `order-id` all reduce to the same words.
 */
export function toConvention(
  name: string,
  convention: NamingConvention,
): string {
  const words = splitWords(name);
  if (words.length === 0) return name;

  switch (convention) {
    case 'camelCase':
      return words
        .map((word, index) => (index === 0 ? word : capitalise(word)))
        .join('');
    case 'PascalCase':
      return words.map(capitalise).join('');
    case 'snake_case':
      return words.join('_');
    case 'kebab-case':
      return words.join('-');
  }
}

function splitWords(name: string): string[] {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // `HTTPStatus` splits between the acronym and the word that follows it.
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_\-.]+/)
      .filter((word) => word.length > 0)
      .map((word) => word.toLowerCase())
  );
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
