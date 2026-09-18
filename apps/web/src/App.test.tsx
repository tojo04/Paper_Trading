import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows that the full stack is ready when the API confirms PostgreSQL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          status: 'ready',
          service: 'paper-terminal-api',
          checks: { database: { status: 'up' } },
          timestamp: '2026-09-18T09:00:00.000Z',
        }),
      }),
    );

    render(<App />);

    expect(await screen.findByText('API and PostgreSQL are ready')).toBeInTheDocument();
    expect(screen.getByText('Simulation only')).toBeInTheDocument();
  });
});
