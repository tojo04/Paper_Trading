import { randomBytes } from 'node:crypto';

import type { Pool } from 'pg';

import { loadConfig, loadRootEnvironment } from '../config.js';
import { createDatabasePool } from './database-pool.js';

export type DisposableTestDatabase = {
  dispose: () => Promise<void>;
  pool: Pool;
};

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export async function createDisposableTestDatabase(): Promise<DisposableTestDatabase> {
  loadRootEnvironment();
  const apiConfig = loadConfig();
  const adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL ?? apiConfig.DATABASE_URL;
  const databaseName = `paper_terminal_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  const quotedDatabaseName = quoteIdentifier(databaseName);
  const adminPool = createDatabasePool(adminConnectionString, { max: 1 });

  await adminPool.query(`CREATE DATABASE ${quotedDatabaseName} TEMPLATE template0`);

  const testDatabaseUrl = new URL(adminConnectionString);
  testDatabaseUrl.pathname = `/${databaseName}`;
  const pool = createDatabasePool(testDatabaseUrl.toString(), { max: 5 });

  return {
    pool,
    dispose: async () => {
      await pool.end();
      await adminPool.query(
        `
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()
        `,
        [databaseName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
      await adminPool.end();
    },
  };
}
