import { describe, expect, it } from 'vitest';

import { matcherCommandSchema, matcherResponseSchema } from './matcher.js';

describe('matcher protocol contracts', () => {
  it('preserves signed 64-bit values as decimal strings', () => {
    const command = matcherCommandSchema.parse({
      protocolVersion: 1,
      commandId: '00000000-0000-4000-8000-000000000001',
      type: 'ADD_ORDER',
      payload: {
        orderId: '10000000-0000-4000-8000-000000000001',
        participantId: 'participant',
        instrumentKey: 'NSE_EQ|INE002A01018',
        side: 'BUY',
        orderType: 'LIMIT',
        quantity: '9223372036854775807',
        limitPricePaise: '9007199254740993',
      },
    });

    expect(command.type).toBe('ADD_ORDER');
    if (command.type === 'ADD_ORDER') {
      expect(command.payload.quantity).toBe('9223372036854775807');
    }
  });

  it('rejects numeric integer encoding and out-of-range values', () => {
    expect(() =>
      matcherCommandSchema.parse({
        protocolVersion: 1,
        commandId: '00000000-0000-4000-8000-000000000001',
        type: 'RESET',
        payload: { sequenceFloor: 9_007_199_254_740_992 },
      }),
    ).toThrow();

    expect(() =>
      matcherCommandSchema.parse({
        protocolVersion: 1,
        commandId: '00000000-0000-4000-8000-000000000001',
        type: 'RESET',
        payload: { sequenceFloor: '9223372036854775808' },
      }),
    ).toThrow();
  });

  it('requires accepted responses to match their command result shape', () => {
    expect(() =>
      matcherResponseSchema.parse({
        protocolVersion: 1,
        commandId: '00000000-0000-4000-8000-000000000001',
        type: 'PING',
        accepted: true,
        result: { bookSequence: '0' },
      }),
    ).toThrow();
  });
});
