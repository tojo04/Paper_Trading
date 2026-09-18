import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerHealthRoutes } from './health/health.routes.js';
import type { ReadinessCheck } from './health/database-readiness.js';

export type BuildAppOptions = {
  databaseReady: ReadinessCheck;
  webOrigin: string;
  logger?: boolean;
  now?: () => Date;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.webOrigin,
    credentials: true,
  });
  const healthOptions =
    options.now === undefined
      ? { databaseReady: options.databaseReady }
      : { databaseReady: options.databaseReady, now: options.now };

  await app.register(registerHealthRoutes, healthOptions);

  return app;
}
