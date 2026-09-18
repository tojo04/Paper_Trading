import type { FastifyInstance } from 'fastify';

import type { ReadinessCheck } from './database-readiness.js';

type HealthRouteOptions = {
  databaseReady: ReadinessCheck;
  now?: () => Date;
};

export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  const now = options.now ?? (() => new Date());

  app.get('/health/live', async () => ({
    status: 'ok' as const,
    service: 'paper-terminal-api' as const,
    timestamp: now().toISOString(),
  }));

  app.get('/health/ready', async (_request, reply) => {
    const databaseReady = await options.databaseReady();
    const status = databaseReady ? 'ready' : 'not_ready';

    return reply.code(databaseReady ? 200 : 503).send({
      status,
      service: 'paper-terminal-api',
      checks: {
        database: {
          status: databaseReady ? 'up' : 'down',
        },
      },
      timestamp: now().toISOString(),
    });
  });
}
