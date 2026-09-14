import { describe, expect, it } from 'vitest';
import {
  DATA_SLOT,
  envelopeSlots,
  fillEnvelope,
  PAYLOAD_TOKEN,
  type ResponseStandard,
  RULE_DESCRIPTIONS,
  RULE_IDS,
  simpleStandard,
  wrapPayload,
} from './standard.js';

/** The envelope shape a project actually writes, used across these tests. */
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

describe('envelopeSlots', () => {
  it('finds every slot a project declares, in document order', () => {
    expect(
      envelopeSlots(fourSlotStandard().envelope).map((slot) => slot.token),
    ).toEqual(['$status_code', '$message', DATA_SLOT, '$meta']);
  });

  it('reports the key each slot sits under, so the editor can label it', () => {
    const slots = envelopeSlots(fourSlotStandard().envelope);
    expect(slots.map((slot) => slot.key)).toEqual([
      'status_code',
      'message',
      'data',
      'meta',
    ]);
  });

  it('marks exactly one slot as the payload', () => {
    const data = envelopeSlots(fourSlotStandard().envelope).filter(
      (slot) => slot.isData,
    );
    expect(data).toHaveLength(1);
    expect(data[0].token).toBe(DATA_SLOT);
  });

  it('finds slots nested inside the envelope', () => {
    const slots = envelopeSlots({
      body: { inner: { deep: '$deep' } },
      data: DATA_SLOT,
    });
    expect(slots.map((slot) => slot.token)).toEqual(['$deep', DATA_SLOT]);
    expect(slots[0].pointer).toBe('/body/inner/deep');
  });

  it('treats a bare slot as the whole envelope', () => {
    expect(envelopeSlots(DATA_SLOT).map((slot) => slot.token)).toEqual([
      DATA_SLOT,
    ]);
  });

  it('finds nothing in an envelope with no slots', () => {
    expect(envelopeSlots({ fixed: 'value' })).toEqual([]);
  });
});

describe('fillEnvelope', () => {
  it('puts every authored value into its slot', () => {
    const body = fillEnvelope(fourSlotStandard(), {
      $status_code: 200,
      $message: 'Order found.',
      [DATA_SLOT]: { id: 'ord_1' },
      $meta: { requestId: 'req_9' },
    });

    expect(body).toEqual({
      status_code: 200,
      message: 'Order found.',
      data: { id: 'ord_1' },
      meta: { requestId: 'req_9' },
    });
  });

  it('leaves an unfilled slot visible rather than rendering null', () => {
    const body = fillEnvelope(fourSlotStandard(), {
      $status_code: 200,
      [DATA_SLOT]: { id: 'ord_1' },
    }) as Record<string, unknown>;

    // The gap is the point: an author has to see that $message is unfilled.
    expect(body['message']).toBe('$message');
    expect(body['meta']).toBe('$meta');
  });

  it('fills a nested slot', () => {
    const standard = {
      ...simpleStandard(),
      envelope: { result: { body: DATA_SLOT } },
    };
    expect(fillEnvelope(standard, { [DATA_SLOT]: [1, 2] })).toEqual({
      result: { body: [1, 2] },
    });
  });

  it('does not mutate the envelope it was given', () => {
    const standard = fourSlotStandard();
    fillEnvelope(standard, { [DATA_SLOT]: { id: '1' } });
    expect((standard.envelope as Record<string, unknown>)['data']).toBe(
      DATA_SLOT,
    );
  });
});

describe('wrapPayload', () => {
  it('routes a bare payload to the data slot', () => {
    const body = wrapPayload(fourSlotStandard(), { id: '1' }) as Record<
      string,
      unknown
    >;
    expect(body['data']).toEqual({ id: '1' });
  });

  it('treats $payload and $data as the same slot', () => {
    const legacy = { ...simpleStandard(), envelope: { d: PAYLOAD_TOKEN } };
    expect(wrapPayload(legacy, { id: '1' })).toEqual({ d: { id: '1' } });
  });
});

describe('rule registry', () => {
  it('describes every rule id, so no violation can surface unexplained', () => {
    for (const id of RULE_IDS) {
      expect(RULE_DESCRIPTIONS[id]).toBeTruthy();
    }
  });

  it('covers RS001 through RS010 from FR-4.4', () => {
    expect(RULE_IDS).toHaveLength(10);
    expect(RULE_IDS[0]).toBe('RS001');
    expect(RULE_IDS.at(-1)).toBe('RS010');
  });
});

describe('simpleStandard', () => {
  it('starts every rule at error severity', () => {
    const standard = simpleStandard();
    expect(Object.values(standard.severities).every((s) => s === 'error')).toBe(
      true,
    );
  });

  it('declares a status, a message and the data', () => {
    expect(
      envelopeSlots(simpleStandard().envelope).map((s) => s.token),
    ).toEqual(['$status_code', '$message', DATA_SLOT]);
  });

  it('does not allow a body-less 204 on GET', () => {
    // A GET that answers 204 has nothing to return, which the standard treats
    // as a contract mistake rather than a style preference.
    expect(simpleStandard().allowedStatusesByMethod['get']).not.toContain(204);
  });
});
