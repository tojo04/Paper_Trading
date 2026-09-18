import type { Pool, PoolClient } from 'pg';

export type TransactionOperation<Result> = (client: PoolClient) => Promise<Result>;

export async function withTransaction<Result>(
  pool: Pool,
  operation: TransactionOperation<Result>,
): Promise<Result> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
