import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PaperAccountConfigRepository } from '../modules/accounts/paper-account-config.repository.js';
import { InstrumentRepository } from '../modules/instruments/instrument.repository.js';
import {
  createDisposableTestDatabase,
  type DisposableTestDatabase,
} from './disposable-test-database.js';
import { runMigrations } from './migration-runner.js';
import { loadSeedConfiguration, seedDatabase } from './seed-runner.js';
import { withTransaction } from './transaction.js';

type Fixture = {
  instrumentId: string;
  userId: string;
};

type PostgreSqlError = Error & { code?: string; constraint?: string };

async function expectDatabaseError(
  operation: Promise<unknown>,
  expectedCode: string,
  expectedConstraint?: string,
): Promise<void> {
  try {
    await operation;
    throw new Error('Expected the database operation to fail');
  } catch (error) {
    const databaseError = error as PostgreSqlError;
    expect(databaseError.code).toBe(expectedCode);
    if (expectedConstraint !== undefined) {
      expect(databaseError.constraint).toBe(expectedConstraint);
    }
  }
}

async function createFixture(pool: Pool): Promise<Fixture> {
  const userResult = await pool.query<{ id: string }>(
    `
      INSERT INTO users (email, password_hash)
      VALUES ($1, $2)
      RETURNING id
    `,
    ['database-fixture@example.com', 'argon2id-test-placeholder'],
  );
  const userId = userResult.rows[0]?.id;
  if (userId === undefined) {
    throw new Error('Fixture user was not created');
  }

  await pool.query(
    `
      INSERT INTO wallets (user_id, available_cash_paise)
      VALUES ($1, $2)
    `,
    [userId, '100000000'],
  );

  const instrumentResult = await pool.query<{ id: string }>(
    `SELECT id FROM instruments WHERE instrument_key = $1`,
    ['NSE_EQ|INE002A01018'],
  );
  const instrumentId = instrumentResult.rows[0]?.id;
  if (instrumentId === undefined) {
    throw new Error('Fixture instrument was not seeded');
  }

  return { instrumentId, userId };
}

describe('database migrations, seed data, and repositories', () => {
  let database: DisposableTestDatabase;
  let fixture: Fixture;

  beforeAll(async () => {
    database = await createDisposableTestDatabase();
    await runMigrations(database.pool);
    await seedDatabase(database.pool, loadSeedConfiguration({}));
    fixture = await createFixture(database.pool);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('rebuilds every domain table from migrations and does not reapply them', async () => {
    const expectedTables = [
      'instruments',
      'orders',
      'paper_account_config',
      'positions',
      'schema_migrations',
      'sessions',
      'trades',
      'users',
      'wallet_ledger',
      'wallets',
      'watchlist_items',
    ];
    const result = await database.pool.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(expectedTables);
    await expect(runMigrations(database.pool)).resolves.toEqual([]);
  });

  it('stores cross-process numbers as BIGINT and creates lifecycle/recovery indexes', async () => {
    const columns = await database.pool.query<{ column_name: string; data_type: string }>(
      `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'orders' AND column_name IN (
              'engine_sequence', 'limit_price_paise', 'quantity', 'filled_quantity'
            ))
            OR (table_name = 'wallets' AND column_name IN (
              'available_cash_paise', 'reserved_cash_paise'
            ))
          )
      `,
    );
    const indexes = await database.pool.query<{ indexname: string }>(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('orders_user_status_created_idx', 'orders_book_recovery_idx')
        ORDER BY indexname
      `,
    );

    expect(columns.rows).toHaveLength(6);
    expect(columns.rows.every((column) => column.data_type === 'bigint')).toBe(true);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'orders_book_recovery_idx',
      'orders_user_status_created_idx',
    ]);
  });

  it('seeds a configurable instrument subset and starting balance repeatably', async () => {
    const configuration = loadSeedConfiguration({
      SEEDED_NSE_SYMBOLS: 'RELIANCE,INFY',
      STARTING_CASH_PAISE: '25000000',
    });

    await seedDatabase(database.pool, configuration);
    await seedDatabase(database.pool, configuration);

    const instruments = await new InstrumentRepository(database.pool).listEnabled();
    const startingCashPaise = await new PaperAccountConfigRepository(
      database.pool,
    ).getStartingCashPaise();
    const managedCount = await database.pool.query<{ count: string }>(
      'SELECT count(*) FROM instruments WHERE managed_by_seed = TRUE',
    );

    expect(instruments.map((instrument) => instrument.tradingSymbol)).toEqual(['INFY', 'RELIANCE']);
    expect(instruments[0]?.tickSizePaise).toBe(10n);
    expect(startingCashPaise).toBe(25_000_000n);
    expect(managedCount.rows[0]?.count).toBe('5');
  });

  it('rejects negative wallet money at the database boundary', async () => {
    const userResult = await database.pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      ['negative-wallet@example.com', 'argon2id-test-placeholder'],
    );

    await expectDatabaseError(
      database.pool.query(`INSERT INTO wallets (user_id, available_cash_paise) VALUES ($1, $2)`, [
        userResult.rows[0]?.id,
        '-1',
      ]),
      '23514',
      'wallets_available_cash_nonnegative',
    );
  });

  it('rejects invalid order quantity and status at the database boundary', async () => {
    const values = [randomUUID(), fixture.userId, fixture.instrumentId];

    await expectDatabaseError(
      database.pool.query(
        `
          INSERT INTO orders (
            client_order_id, user_id, instrument_id, participant_type, side,
            order_type, limit_price_paise, quantity, status
          )
          VALUES ($1, $2, $3, 'USER', 'BUY', 'LIMIT', 10000, 0, 'PENDING')
        `,
        values,
      ),
      '23514',
      'orders_quantity_positive',
    );

    await expectDatabaseError(
      database.pool.query(
        `
          INSERT INTO orders (
            client_order_id, user_id, instrument_id, participant_type, side,
            order_type, limit_price_paise, quantity, status
          )
          VALUES ($1, $2, $3, 'USER', 'BUY', 'LIMIT', 10000, 1, 'UNKNOWN')
        `,
        [randomUUID(), fixture.userId, fixture.instrumentId],
      ),
      '23514',
      'orders_status_valid',
    );
  });

  it('prevents duplicate user client order identifiers', async () => {
    const clientOrderId = randomUUID();
    const insertOrder = () =>
      database.pool.query(
        `
          INSERT INTO orders (
            client_order_id, user_id, instrument_id, participant_type, side,
            order_type, limit_price_paise, quantity, status
          )
          VALUES ($1, $2, $3, 'USER', 'BUY', 'LIMIT', 10000, 2, 'PENDING')
        `,
        [clientOrderId, fixture.userId, fixture.instrumentId],
      );

    await insertOrder();
    await expectDatabaseError(insertOrder(), '23505', 'orders_user_client_order_unique');
  });

  it('prevents duplicate wallet ledger idempotency keys', async () => {
    const referenceId = randomUUID();
    const insertLedgerEntry = () =>
      database.pool.query(
        `
          INSERT INTO wallet_ledger (
            user_id,
            entry_type,
            available_cash_delta_paise,
            reserved_cash_delta_paise,
            available_cash_after_paise,
            reserved_cash_after_paise,
            reference_type,
            reference_id,
            idempotency_key
          )
          VALUES ($1, 'ADJUSTMENT', 1, 0, 100000001, 0, 'TEST', $2, $3)
        `,
        [fixture.userId, referenceId, 'database-test-ledger-key'],
      );

    await insertLedgerEntry();
    await expectDatabaseError(insertLedgerEntry(), '23505', 'wallet_ledger_idempotency_key_unique');
  });

  it('rolls back every write when a transaction operation fails', async () => {
    const email = 'rolled-back@example.com';

    await expect(
      withTransaction(database.pool, async (client) => {
        await client.query(`INSERT INTO users (email, password_hash) VALUES ($1, $2)`, [
          email,
          'argon2id-test-placeholder',
        ]);
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    const result = await database.pool.query<{ count: string }>(
      'SELECT count(*) FROM users WHERE email = $1',
      [email],
    );
    expect(result.rows[0]?.count).toBe('0');
  });

  it('finds instruments through the typed repository boundary', async () => {
    const repository = new InstrumentRepository(database.pool);

    await expect(repository.findByInstrumentKey('NSE_EQ|INE002A01018')).resolves.toMatchObject({
      tradingSymbol: 'RELIANCE',
      tickSizePaise: 10n,
    });
    await expect(repository.findByInstrumentKey('NSE_EQ|missing')).resolves.toBeNull();
  });
});
