import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';

const openedApps: Awaited<ReturnType<typeof buildApp>>[] = [];
const fixedNow = () => new Date('2026-09-18T09:00:00.000Z');

afterEach(async () => {
  await Promise.all(openedApps.splice(0).map(async (app) => app.close()));
});

describe('health routes', () => {
  it('reports liveness without depending on PostgreSQL', async () => {
    const app = await buildApp({
      databaseReady: async () => false,
      webOrigin: 'http://localhost:5173',
      now: fixedNow,
    });
    openedApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'paper-terminal-api',
      timestamp: '2026-09-18T09:00:00.000Z',
    });
  });

  it('returns 503 and names the failed dependency when PostgreSQL is unavailable', async () => {
    const app = await buildApp({
      databaseReady: async () => false,
      webOrigin: 'http://localhost:5173',
      now: fixedNow,
    });
    openedApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'not_ready',
      checks: { database: { status: 'down' } },
    });
  });

  it('reports readiness only after PostgreSQL responds', async () => {
    const app = await buildApp({
      databaseReady: async () => true,
      webOrigin: 'http://localhost:5173',
      now: fixedNow,
    });
    openedApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { database: { status: 'up' } },
    });
  });
});
