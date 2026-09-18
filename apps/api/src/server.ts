import { fileURLToPath } from 'node:url';

import { config as loadEnvironment } from 'dotenv';
import { Pool } from 'pg';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabaseReadinessCheck } from './health/database-readiness.js';

loadEnvironment({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

const config = loadConfig();
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  connectionTimeoutMillis: 2_000,
  max: 5,
});

const app = await buildApp({
  databaseReady: createDatabaseReadinessCheck(pool),
  webOrigin: config.WEB_ORIGIN,
  logger: true,
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exitCode = 1;
}
