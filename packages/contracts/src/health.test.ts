import { describe, expect, it } from 'vitest';

import { readinessResponseSchema } from './health.js';

describe('readinessResponseSchema', () => {
  it('accepts an explicit unavailable database status', () => {
    const result = readinessResponseSchema.parse({
      status: 'not_ready',
      service: 'paper-terminal-api',
      checks: { database: { status: 'down' } },
      timestamp: '2026-09-18T09:00:00.000Z',
    });

    expect(result.status).toBe('not_ready');
  });
});
