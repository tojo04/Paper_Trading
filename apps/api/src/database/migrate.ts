import { loadConfig, loadRootEnvironment } from '../config.js';
import { createDatabasePool } from './database-pool.js';
import { runMigrations } from './migration-runner.js';

loadRootEnvironment();
const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL, { max: 2 });

try {
  const applied = await runMigrations(pool);
  if (applied.length === 0) {
    console.log('Database is already up to date.');
  } else {
    console.log(`Applied migrations: ${applied.join(', ')}`);
  }
} finally {
  await pool.end();
}
