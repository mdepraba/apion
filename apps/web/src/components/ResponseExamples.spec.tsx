import type { EndpointResponse, EnvelopeSlot } from '@apion/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fill, ResponseExamples, unfill } from './ResponseExamples.js';

/** The seeded four-slot envelope, which is what most projects start from. */
const ENVELOPE = {
  status_code: '$status_code',
  message: '$message',
  data: '$data',
  meta: '$meta',
};

describe('editing an example as raw JSON', () => {
  it('reads an edited body back into the slots it came from', () => {
    const values = { $message: 'OK', $data: { id: 'ord_1' }, $meta: null };
    const body = fill(ENVELOPE, values, 200) as Record<string, unknown>;

    expect(body).toEqual({
      status_code: 200,
      message: 'OK',
      data: { id: 'ord_1' },
      meta: null,
    });

    // What an author would type over the body above.
    const edited = { ...body, message: 'Found', data: { id: 'ord_2' } };

    expect(unfill(ENVELOPE, edited, 200)).toEqual({
      $message: 'Found',
      $data: { id: 'ord_2' },
      $meta: null,
    });
  });

  it('leaves the status out, so the response stays its only source', () => {
    const stored = unfill(
      ENVELOPE,
      fill(ENVELOPE, { $message: 'OK' }, 201),
      201,
    );
    expect(stored).not.toHaveProperty('$status_code');
  });

  it('keeps a status the author deliberately made differ from the response', () => {
    const body = { status_code: 418, message: 'OK', data: null, meta: null };
    expect(unfill(ENVELOPE, body, 200)).toMatchObject({ $status_code: 418 });
  });

  it('survives a round trip unchanged, so switching views loses nothing', () => {
    const values = { $message: 'OK', $data: [1, 2, 3], $meta: { total: 3 } };
    const back = unfill(ENVELOPE, fill(ENVELOPE, values, 200), 200);

    expect(fill(ENVELOPE, back, 200)).toEqual(fill(ENVELOPE, values, 200));
  });

  it('stores a body that no longer fits the envelope as the payload', () => {
    // An author who replaced the whole body with a bare array has left the
    // envelope behind; keeping it readable beats rejecting what they typed.
    expect(unfill(ENVELOPE, [1, 2], 200)).toEqual({ $data: [1, 2] });
  });

  it('treats a project with no envelope as one data slot', () => {
    expect(unfill(null, { id: 'ord_1' }, 200)).toEqual({
      $data: { id: 'ord_1' },
    });
  });

  it('reads a bare data slot envelope, which the None preset uses', () => {
    expect(unfill('$data', { id: 'ord_1' }, 200)).toEqual({
      $data: { id: 'ord_1' },
    });
  });

  it('keeps a literal the envelope fixes rather than storing it as a slot', () => {
    const envelope = { apiVersion: 'v1', data: '$data' };
    expect(unfill(envelope, { apiVersion: 'v1', data: 7 }, 200)).toEqual({
      $data: 7,
    });
  });

  it('falls back when a literal the envelope fixes was edited away', () => {
    const envelope = { apiVersion: 'v1', data: '$data' };
    const body = { apiVersion: 'v2', data: 7 };

    expect(unfill(envelope, body, 200)).toEqual({ $data: body });
  });
});

const SLOTS: EnvelopeSlot[] = [
  {
    token: '$status_code',
    key: 'status_code',
    pointer: '/status_code',
    isData: false,
  },
  { token: '$message', key: 'message', pointer: '/message', isData: false },
  { token: '$data', key: 'data', pointer: '/data', isData: true },
];

function response(): EndpointResponse {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    statusCode: 200,
    description: '',
    headers: [],
    payloadSchema: null,
    examples: [
      {
        id: '00000000-0000-7000-8000-000000000002',
        name: 'basic',
        summary: '',
        isDefault: true,
        value: { $message: 'OK', $data: { id: 'ord_1' } },
      },
    ],
  };
}

describe('the two views of an example', () => {
  it('opens on raw JSON, showing the body a client receives', () => {
    render(
      <ResponseExamples
        response={response()}
        envelope={ENVELOPE}
        slots={SLOTS}
      />,
    );

    const raw = screen.getByRole<HTMLInputElement>('radio', {
      name: 'Raw JSON',
    });
    expect(raw.checked).toBe(true);
    expect(screen.getByText(/"message": "OK"/)).toBeTruthy();
  });

  it('shows one field per slot once the form view is picked', () => {
    render(
      <ResponseExamples
        response={response()}
        envelope={ENVELOPE}
        slots={SLOTS}
        editable
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Form' }));

    for (const slot of SLOTS) {
      expect(
        screen.getByLabelText((text) => text.includes(slot.token)),
      ).toBeTruthy();
    }
  });

  it('reports an edited body as slot values, not as raw text', () => {
    const onChange = vi.fn();
    render(
      <ResponseExamples
        response={response()}
        envelope={ENVELOPE}
        slots={SLOTS}
        editable
        onChange={onChange}
      />,
    );

    const body = screen.getByRole('textbox', { name: 'Response body' });
    fireEvent.change(body, {
      target: {
        value: JSON.stringify({
          status_code: 200,
          message: 'Found',
          data: { id: 'ord_2' },
          meta: null,
        }),
      },
    });
    fireEvent.blur(body);

    expect(onChange).toHaveBeenCalledWith(
      '00000000-0000-7000-8000-000000000002',
      { $message: 'Found', $data: { id: 'ord_2' }, $meta: null },
    );
  });

  it('keeps half-typed JSON in the box and says why it did not apply', () => {
    const onChange = vi.fn();
    render(
      <ResponseExamples
        response={response()}
        envelope={ENVELOPE}
        slots={SLOTS}
        editable
        onChange={onChange}
      />,
    );

    const body = screen.getByRole('textbox', { name: 'Response body' });
    fireEvent.change(body, { target: { value: '{ "message": ' } });
    fireEvent.blur(body);

    expect(onChange).not.toHaveBeenCalled();
    expect((body as HTMLTextAreaElement).value).toBe('{ "message": ');
    expect(screen.getByRole('alert').textContent).toMatch(/not valid JSON/);
  });

  it('is read-only without edit access, so there is no dead control', () => {
    render(
      <ResponseExamples
        response={response()}
        envelope={ENVELOPE}
        slots={SLOTS}
      />,
    );

    expect(screen.queryByRole('textbox', { name: 'Response body' })).toBeNull();
  });
});
