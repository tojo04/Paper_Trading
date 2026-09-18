import { Pool, type PoolConfig } from 'pg';

export function createDatabasePool(connectionString: string, overrides: PoolConfig = {}): Pool {
  return new Pool({
    connectionString,
    connectionTimeoutMillis: 2_000,
    max: 10,
    ...overrides,
  });
}
