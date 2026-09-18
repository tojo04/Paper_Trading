import type { Pool } from 'pg';

export type ReadinessCheck = () => Promise<boolean>;

export function createDatabaseReadinessCheck(pool: Pool): ReadinessCheck {
  return async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  };
}
