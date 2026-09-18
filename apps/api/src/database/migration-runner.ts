import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool, PoolClient } from 'pg';

const migrationFilePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const migrationLockId = '724176219032025';

export const defaultMigrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

type Migration = {
  checksum: string;
  name: string;
  sql: string;
};

type AppliedMigration = {
  checksum: string;
  version: string;
};

async function loadMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory))
    .filter((name) => migrationFilePattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(resolve(directory, name), 'utf8');
      return {
        checksum: createHash('sha256').update(sql).digest('hex'),
        name: parse(name).name,
        sql,
      };
    }),
  );
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations(
  pool: Pool,
  directory = defaultMigrationsDirectory,
): Promise<string[]> {
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockId]);
    await ensureMigrationTable(client);

    const appliedResult = await client.query<AppliedMigration>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));

    for (const migration of migrations) {
      const existingChecksum = applied.get(migration.name);
      if (existingChecksum !== undefined) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`Applied migration ${migration.name} has a different checksum`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
        appliedNow.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return appliedNow;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockId]);
    client.release();
  }
}
