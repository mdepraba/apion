import { describe, expect, it } from 'vitest';
import {
  extractPathParameters,
  isReservedPath,
  validateEndpointPath,
} from './endpoint-path.js';

const kinds = (path: string) => validateEndpointPath(path).map((p) => p.kind);

describe('extractPathParameters', () => {
  it('extracts parameters in declaration order', () => {
    expect(extractPathParameters('/orders/{orderId}/items/{itemId}')).toEqual([
      'orderId',
      'itemId',
    ]);
  });

  it('returns nothing for a literal path', () => {
    expect(extractPathParameters('/orders/export')).toEqual([]);
  });
});

describe('validateEndpointPath', () => {
  it.each([
    '/orders',
    '/orders/{orderId}',
    '/orders/{orderId}/items/{itemId}',
    '/v1.0/reports',
    '/users/{userId}/preferences',
    '/',
  ])('accepts %s', (path) => {
    expect(validateEndpointPath(path)).toEqual([]);
  });

  it('rejects each reserved prefix', () => {
    // PRD 02 FR-2.2: platform routes must not be shadowed by a contract.
    expect(kinds('/api/v1/orders')).toContain('reserved_prefix');
    expect(kinds('/mock/acme/store/dev')).toContain('reserved_prefix');
    expect(kinds('/__mock/health')).toContain('reserved_prefix');
  });

  it('allows a path that merely starts with reserved letters', () => {
    expect(validateEndpointPath('/apiary/{id}')).toEqual([]);
    expect(validateEndpointPath('/mocking-birds')).toEqual([]);
  });

  it('requires a leading slash', () => {
    expect(kinds('orders')).toContain('missing_leading_slash');
  });

  it('rejects a trailing slash without also reporting an empty segment', () => {
    expect(kinds('/orders/')).toEqual(['trailing_slash']);
  });

  it('rejects an interior empty segment', () => {
    expect(kinds('/orders//items')).toContain('empty_segment');
  });

  it('rejects unbalanced braces', () => {
    expect(kinds('/orders/{orderId')).toContain('unbalanced_braces');
  });

  it('rejects a parameter sharing a segment with literal text', () => {
    expect(kinds('/files/{id}.json')).toContain('mixed_segment');
  });

  it('rejects a duplicate parameter name', () => {
    expect(kinds('/a/{id}/b/{id}')).toContain('duplicate_parameter');
  });

  it('rejects a parameter name that is not an identifier', () => {
    expect(kinds('/orders/{order-id}')).toContain('invalid_parameter_name');
    expect(kinds('/orders/{}')).toContain('invalid_parameter_name');
  });

  it('rejects characters with URL meaning', () => {
    expect(kinds('/orders?q=1')).toContain('illegal_character');
    expect(kinds('/orders#top')).toContain('illegal_character');
  });
});

describe('isReservedPath', () => {
  it('matches the prefix exactly or as a whole segment', () => {
    expect(isReservedPath('/api')).toBe(true);
    expect(isReservedPath('/api/v1')).toBe(true);
    expect(isReservedPath('/apiary')).toBe(false);
  });
});
