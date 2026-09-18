import type { PoolClient } from 'pg';
import { z } from 'zod';

import { withTransaction } from './transaction.js';
import { supportedSeedInstruments, type SeedInstrument } from './seed-data.js';
import type { Pool } from 'pg';

const maxInt64 = 9_223_372_036_854_775_807n;

const seedEnvironmentSchema = z.object({
  SEEDED_NSE_SYMBOLS: z.string().default('RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK'),
  STARTING_CASH_PAISE: z.string().regex(/^\d+$/).default('100000000'),
});

export type SeedConfiguration = {
  instruments: readonly SeedInstrument[];
  startingCashPaise: bigint;
};

export function loadSeedConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): SeedConfiguration {
  const parsed = seedEnvironmentSchema.parse(environment);
  const startingCashPaise = BigInt(parsed.STARTING_CASH_PAISE);
  if (startingCashPaise <= 0n || startingCashPaise > maxInt64) {
    throw new Error('STARTING_CASH_PAISE must be a positive signed 64-bit integer');
  }

  const requestedSymbols = [
    ...new Set(
      parsed.SEEDED_NSE_SYMBOLS.split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => symbol.length > 0),
    ),
  ];
  if (requestedSymbols.length === 0) {
    throw new Error('SEEDED_NSE_SYMBOLS must contain at least one supported symbol');
  }

  const catalog = new Map(
    supportedSeedInstruments.map((instrument) => [instrument.tradingSymbol, instrument]),
  );
  const unknownSymbols = requestedSymbols.filter((symbol) => !catalog.has(symbol));
  if (unknownSymbols.length > 0) {
    throw new Error(`Unsupported SEEDED_NSE_SYMBOLS: ${unknownSymbols.join(', ')}`);
  }

  return {
    instruments: requestedSymbols.map((symbol) => catalog.get(symbol) as SeedInstrument),
    startingCashPaise,
  };
}

async function upsertInstrument(client: PoolClient, instrument: SeedInstrument): Promise<void> {
  await client.query(
    `
      INSERT INTO instruments (
        instrument_key,
        exchange,
        trading_symbol,
        display_name,
        isin,
        tick_size_paise,
        enabled,
        managed_by_seed
      )
      VALUES ($1, 'NSE', $2, $3, $4, $5, TRUE, TRUE)
      ON CONFLICT (instrument_key) DO UPDATE SET
        trading_symbol = EXCLUDED.trading_symbol,
        display_name = EXCLUDED.display_name,
        isin = EXCLUDED.isin,
        tick_size_paise = EXCLUDED.tick_size_paise,
        enabled = TRUE,
        managed_by_seed = TRUE,
        updated_at = now()
    `,
    [
      instrument.instrumentKey,
      instrument.tradingSymbol,
      instrument.displayName,
      instrument.isin,
      instrument.tickSizePaise.toString(),
    ],
  );
}

export async function seedDatabase(pool: Pool, configuration: SeedConfiguration): Promise<void> {
  await withTransaction(pool, async (client) => {
    const selectedInstrumentKeys = configuration.instruments.map(
      (instrument) => instrument.instrumentKey,
    );

    await client.query(
      `
        UPDATE instruments
        SET enabled = FALSE, updated_at = now()
        WHERE managed_by_seed = TRUE
          AND NOT (instrument_key = ANY($1::text[]))
      `,
      [selectedInstrumentKeys],
    );

    for (const instrument of configuration.instruments) {
      await upsertInstrument(client, instrument);
    }

    await client.query(
      `
        INSERT INTO paper_account_config (singleton, starting_cash_paise)
        VALUES (TRUE, $1)
        ON CONFLICT (singleton) DO UPDATE SET
          starting_cash_paise = EXCLUDED.starting_cash_paise,
          updated_at = now()
      `,
      [configuration.startingCashPaise.toString()],
    );
  });
}
