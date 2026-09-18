import { buildApp } from './app.js';
import { loadConfig, loadRootEnvironment } from './config.js';
import { createDatabasePool } from './database/database-pool.js';
import { createDatabaseReadinessCheck } from './health/database-readiness.js';

loadRootEnvironment();
const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);

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
