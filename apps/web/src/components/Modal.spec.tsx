import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal.js';

describe('Modal', () => {
  it('closes on Escape even when focus has left the dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal title="New endpoint" onClose={onClose}>
        <button type="button">Create</button>
      </Modal>,
    );

    // A click on the backdrop leaves focus on the body, which is exactly where
    // a handler bound to the dialog would stop hearing the key.
    document.body.focus();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on the backdrop, but not on a drag that began inside', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="New endpoint" onClose={onClose}>
        <button type="button">Create</button>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const backdrop = container.firstElementChild as HTMLElement;

    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from the header control, for a reader who does not know Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal title="New endpoint" onClose={onClose}>
        <button type="button">Create</button>
      </Modal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus into the dialog so the keyboard does not stay behind', () => {
    render(
      <Modal title="New endpoint" onClose={vi.fn()}>
        <button type="button">Create</button>
      </Modal>,
    );

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
      true,
    );
  });

  it('gives the dialog its title as an accessible name', () => {
    render(
      <Modal title="New endpoint" onClose={vi.fn()}>
        <button type="button">Create</button>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'New endpoint' })).toBeTruthy();
  });

  it('returns focus to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <Modal title="New endpoint" onClose={vi.fn()}>
        <button type="button">Create</button>
      </Modal>,
    );
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
