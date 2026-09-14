import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../api/client.js';
import { EmptyState, ErrorState, LoadingState } from './States.js';

/**
 * R-27 requires the three states; the antislop human skill requires each to
 * name a cause and a next action. "No data available" would satisfy the first
 * and fail the second, so these assert the second.
 */

describe('ErrorState', () => {
  it('explains an expired session instead of showing the raw code', () => {
    render(
      <ErrorState
        error={new RequestError(401, 'UNAUTHENTICATED', 'Sign in to continue.')}
      />,
    );

    expect(screen.getByText('Your session ended')).toBeTruthy();
    expect(screen.getByText(/Sign in again/)).toBeTruthy();
  });

  it('passes through a permission message, which already names the fix', () => {
    render(
      <ErrorState
        error={
          new RequestError(
            403,
            'FORBIDDEN',
            'Your commenter role is read-only here. A editor can do this.',
          )
        }
      />,
    );

    expect(screen.getByText(/commenter role is read-only/)).toBeTruthy();
  });

  it('says a 404 may be a permission problem rather than a deletion', () => {
    // The API deliberately answers 404 for projects the caller cannot read, so
    // the copy must not assert the thing was deleted.
    render(
      <ErrorState
        error={new RequestError(404, 'NOT_FOUND', 'No such project.')}
      />,
    );
    expect(screen.getByText(/may not have access/)).toBeTruthy();
  });

  it('names the network as the cause when fetch itself failed', () => {
    render(<ErrorState error={new TypeError('Failed to fetch')} />);

    expect(screen.getByText('Cannot reach the server')).toBeTruthy();
    expect(screen.getByText(/Check your connection/)).toBeTruthy();
  });

  it('collapses validation details into something readable', () => {
    render(
      <ErrorState
        error={
          new RequestError(422, 'VALIDATION_FAILED', 'Invalid', [
            {
              pointer: '#/path',
              message: '/api is reserved for the platform.',
            },
          ])
        }
      />,
    );

    expect(screen.getByText(/\/api is reserved/)).toBeTruthy();
  });

  it('announces itself so a screen reader hears the failure', () => {
    const { container } = render(<ErrorState error={new Error('boom')} />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('gives a reason and an action, never a bare "no data"', () => {
    render(
      <EmptyState
        headline="No resources yet"
        explanation="Endpoints are grouped into resources, which become OpenAPI tags on export."
        action={<button type="button">Add a resource</button>}
      />,
    );

    expect(screen.getByText('No resources yet')).toBeTruthy();
    expect(screen.getByText(/become OpenAPI tags/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a resource' })).toBeTruthy();
  });
});

describe('LoadingState', () => {
  it('says what is loading and announces it politely', () => {
    const { container } = render(<LoadingState what="the contract" />);

    expect(screen.getByText(/Loading the contract/)).toBeTruthy();
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
