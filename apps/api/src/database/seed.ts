import { loadConfig, loadRootEnvironment } from '../config.js';
import { createDatabasePool } from './database-pool.js';
import { loadSeedConfiguration, seedDatabase } from './seed-runner.js';

loadRootEnvironment();
const config = loadConfig();
const seedConfiguration = loadSeedConfiguration();
const pool = createDatabasePool(config.DATABASE_URL, { max: 2 });

try {
  await seedDatabase(pool, seedConfiguration);
  console.log(
    `Seeded ${seedConfiguration.instruments.length} instruments and starting cash ${seedConfiguration.startingCashPaise.toString()} paise.`,
  );
} finally {
  await pool.end();
}
