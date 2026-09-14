import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EndpointLine } from './EndpointLine.js';
import { StatusBadge } from './StatusBadge.js';

describe('EndpointLine', () => {
  it('renders the method uppercased and tagged for its colour', () => {
    render(<EndpointLine method="delete" path="/orders/{orderId}" />);

    const method = screen.getByText('DELETE');
    expect(method.dataset['method']).toBe('delete');
  });

  it('splits path parameters from literal segments', () => {
    const { container } = render(
      <EndpointLine method="get" path="/orders/{orderId}/items/{itemId}" />,
    );

    // The parameters carry their own class so they read lighter than the
    // literal segments; the braces stay visible so colour is not the signal.
    const params = [...container.querySelectorAll('span')].filter((element) =>
      /^\{.+\}$/.test(element.textContent ?? ''),
    );

    expect(params.map((element) => element.textContent)).toEqual([
      '{orderId}',
      '{itemId}',
    ]);
  });

  it('keeps the full path readable as text', () => {
    const { container } = render(
      <EndpointLine method="post" path="/orders/export" />,
    );
    expect(container.textContent).toContain('/orders/export');
  });

  it('renders a path with no parameters without inventing one', () => {
    const { container } = render(<EndpointLine method="get" path="/health" />);
    expect(container.querySelectorAll('span')).not.toHaveLength(0);
    expect(container.textContent).toBe('GET/health');
  });
});

describe('StatusBadge', () => {
  it('always renders a readable label, not colour alone', () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText(/In progress/)).toBeTruthy();
  });

  it('marks a stale in-progress endpoint in text', () => {
    // FR-3.5 flags these; a reader who cannot see the amber still gets the word.
    render(<StatusBadge status="in_progress" stale />);
    expect(screen.getByText(/stale/)).toBeTruthy();
  });

  it('tags the status so the stylesheet can colour it', () => {
    const { container } = render(<StatusBadge status="implemented" />);
    expect(container.querySelector('[data-status="implemented"]')).toBeTruthy();
  });
});
