import { describe, expect, it } from 'vitest';
import { RouteTable } from './route-matcher.js';

const table = new RouteTable([
  { method: 'get', path: '/orders/{id}', value: 'one' },
  { method: 'get', path: '/orders/export', value: 'export' },
  { method: 'get', path: '/orders', value: 'list' },
  { method: 'post', path: '/orders', value: 'create' },
  { method: 'delete', path: '/orders/{id}', value: 'remove' },
  { method: 'get', path: '/orders/{id}/items/{itemId}', value: 'item' },
]);

describe('RouteTable', () => {
  it('prefers a literal segment over a parameter', () => {
    // PRD 05 states this precedence explicitly: /orders/export before /orders/{id}.
    const result = table.match('get', '/orders/export');
    expect(result.outcome).toBe('matched');
    if (result.outcome === 'matched')
      expect(result.match.route.value).toBe('export');
  });

  it('falls through to the parameter route for anything else', () => {
    const result = table.match('get', '/orders/ord_123');
    expect(result.outcome).toBe('matched');
    if (result.outcome === 'matched') {
      expect(result.match.route.value).toBe('one');
      expect(result.match.params).toEqual({ id: 'ord_123' });
    }
  });

  it('captures every parameter in a nested path', () => {
    const result = table.match('get', '/orders/ord_1/items/item_2');
    if (result.outcome !== 'matched') throw new Error('expected a match');
    expect(result.match.params).toEqual({ id: 'ord_1', itemId: 'item_2' });
  });

  it('decodes a percent-encoded parameter', () => {
    const result = table.match('get', '/orders/a%2Fb');
    if (result.outcome !== 'matched') throw new Error('expected a match');
    expect(result.match.params['id']).toBe('a/b');
  });

  it('matches the method before the path', () => {
    const post = table.match('post', '/orders');
    if (post.outcome !== 'matched') throw new Error('expected a match');
    expect(post.match.route.value).toBe('create');
  });

  it('answers a known path with an unknown method as 405, listing what is allowed', () => {
    const result = table.match('patch', '/orders/ord_1');
    expect(result.outcome).toBe('method_not_allowed');
    if (result.outcome === 'method_not_allowed') {
      expect([...result.allowed].sort()).toEqual(['delete', 'get']);
    }
  });

  it('answers an unknown path as not found', () => {
    expect(table.match('get', '/invoices').outcome).toBe('not_found');
  });

  it('does not match a path of the wrong length', () => {
    expect(table.match('get', '/orders/ord_1/items').outcome).toBe('not_found');
  });

  it('tolerates a trailing slash on the request', () => {
    expect(table.match('get', '/orders/').outcome).toBe('matched');
  });

  it('does not let a parameter capture an empty segment', () => {
    expect(table.match('get', '/orders//items/item_2').outcome).toBe(
      'not_found',
    );
  });

  it('is unaffected by the order routes were declared in', () => {
    const reversed = new RouteTable([
      { method: 'get', path: '/orders/{id}', value: 'one' },
      { method: 'get', path: '/orders/export', value: 'export' },
    ]);
    const forward = new RouteTable([
      { method: 'get', path: '/orders/export', value: 'export' },
      { method: 'get', path: '/orders/{id}', value: 'one' },
    ]);

    for (const candidate of [reversed, forward]) {
      const result = candidate.match('get', '/orders/export');
      if (result.outcome !== 'matched') throw new Error('expected a match');
      expect(result.match.route.value).toBe('export');
    }
  });
});
