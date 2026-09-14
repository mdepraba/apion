import type { EndpointResponse } from '@apion/contracts';
import { describe, expect, it } from 'vitest';
import { matchesConvention, toConvention } from './naming.js';
import { PRESET_IDS, PRESETS, presetStandard } from './presets.js';
import {
  missingSlots,
  slotValuesOf,
  wireExample,
  wireSchema,
} from './preview.js';
import {
  DATA_SLOT,
  envelopeSlots,
  type ResponseStandard,
  simpleStandard,
} from './standard.js';

function response(overrides: Partial<EndpointResponse> = {}): EndpointResponse {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    statusCode: 200,
    description: '',
    headers: [],
    payloadSchema: null,
    examples: [],
    ...overrides,
  };
}

/** The envelope from the product owner's example. */
function fourSlotStandard(): ResponseStandard {
  return {
    ...simpleStandard(),
    envelope: {
      status_code: '$status_code',
      message: '$message',
      data: DATA_SLOT,
      meta: '$meta',
    },
  };
}

describe('wireSchema', () => {
  it('describes every slot, with the author schema in the data slot', () => {
    const schema = wireSchema(
      fourSlotStandard(),
      response({
        payloadSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      }),
    ) as Record<string, unknown>;

    const properties = schema['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual([
      'status_code',
      'message',
      'data',
      'meta',
    ]);
    expect(properties['data']).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    expect(properties['status_code']).toEqual({ type: 'integer', const: 200 });
    expect(properties['message']).toEqual({ type: 'string' });
  });

  it('gives 204 no body at all', () => {
    expect(
      wireSchema(
        fourSlotStandard(),
        response({ statusCode: 204, payloadSchema: {} }),
      ),
    ).toBeNull();
  });

  it('describes a failure with the same envelope as a success', () => {
    const ok = wireSchema(fourSlotStandard(), response()) as Record<
      string,
      unknown
    >;
    const bad = wireSchema(
      fourSlotStandard(),
      response({ statusCode: 404 }),
    ) as Record<string, unknown>;

    expect(Object.keys(bad['properties'] as object)).toEqual(
      Object.keys(ok['properties'] as object),
    );
  });

  it('returns the payload alone when the envelope is a bare slot', () => {
    const payload = { type: 'object', properties: { id: { type: 'string' } } };
    expect(
      wireSchema(presetStandard('none'), response({ payloadSchema: payload })),
    ).toEqual(payload);
  });
});

describe('wireExample', () => {
  it('serves exactly the slot values an author wrote', () => {
    const body = wireExample(fourSlotStandard(), response(), {
      $status_code: 200,
      $message: 'Order found.',
      [DATA_SLOT]: { id: 'ord_1' },
      $meta: null,
    });

    expect(body).toEqual({
      status_code: 200,
      message: 'Order found.',
      data: { id: 'ord_1' },
      meta: null,
    });
  });

  it('takes $status_code from the response when the author omits it', () => {
    const body = wireExample(
      fourSlotStandard(),
      response({ statusCode: 201 }),
      { $message: 'Created.', [DATA_SLOT]: { id: 'ord_2' }, $meta: null },
    ) as Record<string, unknown>;

    expect(body['status_code']).toBe(201);
  });

  it('uses the same envelope for a failure', () => {
    const body = wireExample(
      fourSlotStandard(),
      response({ statusCode: 404 }),
      { $message: 'No such order.', [DATA_SLOT]: null, $meta: null },
    );

    expect(body).toEqual({
      status_code: 404,
      message: 'No such order.',
      data: null,
      meta: null,
    });
  });

  it('leaves an unfilled slot visible instead of rendering null', () => {
    const body = wireExample(fourSlotStandard(), response(), {
      [DATA_SLOT]: { id: 'ord_1' },
    }) as Record<string, unknown>;

    expect(body['message']).toBe('$message');
  });

  it('gives 204 no body', () => {
    expect(
      wireExample(fourSlotStandard(), response({ statusCode: 204 }), {}),
    ).toBeNull();
  });
});

describe('missingSlots', () => {
  it('names the slots an author still has to fill', () => {
    expect(
      missingSlots(fourSlotStandard(), response(), {
        [DATA_SLOT]: { id: 'ord_1' },
      }),
    ).toEqual(['$message', '$meta']);
  });

  it('counts $status_code as filled from the response status', () => {
    expect(missingSlots(fourSlotStandard(), response(), {})).not.toContain(
      '$status_code',
    );
  });

  it('counts the data slot as filled when a schema describes it', () => {
    expect(
      missingSlots(
        fourSlotStandard(),
        response({ payloadSchema: { type: 'object' } }),
        { $message: 'ok', $meta: null },
      ),
    ).toEqual([]);
  });
});

describe('slotValuesOf', () => {
  it('reads an object keyed by slot tokens as slot values', () => {
    expect(slotValuesOf({ $message: 'hi', [DATA_SLOT]: 1 })).toEqual({
      $message: 'hi',
      [DATA_SLOT]: 1,
    });
  });

  it('reads a bare payload as the data slot, so older examples still render', () => {
    expect(slotValuesOf({ id: 'ord_1' })).toEqual({
      [DATA_SLOT]: { id: 'ord_1' },
    });
  });

  it('reads an array as the data slot', () => {
    expect(slotValuesOf([1, 2])).toEqual({ [DATA_SLOT]: [1, 2] });
  });
});

describe('presets', () => {
  it('describes every preset FR-4.7 lists', () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([...PRESET_IDS]);
    expect(PRESET_IDS).toHaveLength(5);
  });

  it('checks nothing under None, so an imported API is not buried', () => {
    expect(presetStandard('none').rulesEnabled).toBe(false);
  });

  it('gives each preset a data slot to put a payload in', () => {
    for (const id of PRESET_IDS) {
      const standard = presetStandard(id);
      expect(envelopeSlots(standard.envelope).some((slot) => slot.isData)).toBe(
        true,
      );
    }
  });

  it('names Google fields in snake_case, as that guide does', () => {
    expect(presetStandard('google').propertyNaming).toBe('snake_case');
  });
});

describe('naming', () => {
  it('accepts each convention and rejects the others', () => {
    expect(matchesConvention('orderId', 'camelCase')).toBe(true);
    expect(matchesConvention('order_id', 'camelCase')).toBe(false);
    expect(matchesConvention('order_id', 'snake_case')).toBe(true);
    expect(matchesConvention('order-id', 'kebab-case')).toBe(true);
    expect(matchesConvention('OrderId', 'PascalCase')).toBe(true);
    expect(matchesConvention('orderId', 'PascalCase')).toBe(false);
  });

  it('rejects a run of capitals, which hides a word boundary', () => {
    expect(matchesConvention('userID', 'camelCase')).toBe(false);
  });

  it('rejects an empty part between separators', () => {
    expect(matchesConvention('user__id', 'snake_case')).toBe(false);
  });

  it('converts between conventions whatever the input shape', () => {
    expect(toConvention('order_id', 'camelCase')).toBe('orderId');
    expect(toConvention('orderId', 'snake_case')).toBe('order_id');
    expect(toConvention('order-id', 'PascalCase')).toBe('OrderId');
    expect(toConvention('HTTPStatusCode', 'snake_case')).toBe(
      'http_status_code',
    );
  });
});
