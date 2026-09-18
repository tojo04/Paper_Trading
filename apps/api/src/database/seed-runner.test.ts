import { describe, expect, it } from 'vitest';

import { loadSeedConfiguration } from './seed-runner.js';

describe('loadSeedConfiguration', () => {
  it('uses integer paise and removes duplicate symbols', () => {
    const configuration = loadSeedConfiguration({
      SEEDED_NSE_SYMBOLS: 'reliance, INFY,RELIANCE',
      STARTING_CASH_PAISE: '100000000',
    });

    expect(configuration.startingCashPaise).toBe(100_000_000n);
    expect(configuration.instruments.map((instrument) => instrument.tradingSymbol)).toEqual([
      'RELIANCE',
      'INFY',
    ]);
  });

  it('rejects unknown symbols and values outside signed BIGINT', () => {
    expect(() =>
      loadSeedConfiguration({
        SEEDED_NSE_SYMBOLS: 'UNKNOWN',
        STARTING_CASH_PAISE: '100000000',
      }),
    ).toThrow('Unsupported SEEDED_NSE_SYMBOLS');

    expect(() =>
      loadSeedConfiguration({
        SEEDED_NSE_SYMBOLS: 'RELIANCE',
        STARTING_CASH_PAISE: '9223372036854775808',
      }),
    ).toThrow('positive signed 64-bit integer');
  });
});
