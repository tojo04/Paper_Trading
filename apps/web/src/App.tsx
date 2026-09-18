import { readinessResponseSchema, type ReadinessResponse } from '@paper-terminal/contracts';
import { useEffect, useState } from 'react';

type ConnectionState =
  | { kind: 'checking' }
  | { kind: 'reachable'; readiness: ReadinessResponse }
  | { kind: 'unreachable' };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

async function fetchReadiness(signal: AbortSignal): Promise<ReadinessResponse> {
  const response = await fetch(`${apiBaseUrl}/health/ready`, { signal });
  const parsed = readinessResponseSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error('The API returned an invalid readiness response');
  }

  return parsed.data;
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();

    void fetchReadiness(controller.signal).then(
      (readiness) => setConnection({ kind: 'reachable', readiness }),
      () => {
        if (!controller.signal.aborted) {
          setConnection({ kind: 'unreachable' });
        }
      },
    );

    return () => controller.abort();
  }, []);

  const apiReady = connection.kind === 'reachable' && connection.readiness.status === 'ready';

  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="Application">
        <div className="brand-mark" aria-hidden="true">
          PT
        </div>
        <div>
          <p className="eyebrow">NSE learning environment</p>
          <p className="brand-name">Paper Trading Terminal</p>
        </div>
        <span className="paper-badge">Simulation only</span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="phase-label">Foundation · Phase 1</p>
          <h1>The safe place to understand how an exchange really works.</h1>
          <p className="hero-text">
            The workspace is ready. Market data, order matching, and portfolio workflows will arrive
            in deliberate, testable phases.
          </p>

          <div className="status-card" aria-live="polite">
            <div className={`status-dot ${apiReady ? 'status-dot-ready' : ''}`} />
            <div>
              <p className="status-title">
                {connection.kind === 'checking' && 'Checking API readiness…'}
                {connection.kind === 'unreachable' && 'API is unreachable'}
                {connection.kind === 'reachable' && apiReady && 'API and PostgreSQL are ready'}
                {connection.kind === 'reachable' &&
                  !apiReady &&
                  'API is live; PostgreSQL is waiting'}
              </p>
              <p className="status-detail">
                {connection.kind === 'unreachable'
                  ? `Start the API at ${apiBaseUrl}.`
                  : 'Readiness is reported by /health/ready.'}
              </p>
            </div>
          </div>
        </div>

        <aside className="preview-card" aria-label="Planned terminal areas">
          <div className="preview-header">
            <span>Terminal blueprint</span>
            <span className="live-pill">PAPER</span>
          </div>
          <div className="preview-chart" aria-hidden="true">
            <span className="bar bar-1" />
            <span className="bar bar-2" />
            <span className="bar bar-3" />
            <span className="bar bar-4" />
            <span className="bar bar-5" />
            <span className="bar bar-6" />
            <span className="bar bar-7" />
          </div>
          <dl className="preview-grid">
            <div>
              <dt>Watchlist</dt>
              <dd>Fixed NSE cash instruments</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>Price-time priority</dd>
            </div>
            <div>
              <dt>Money</dt>
              <dd>Exact integer paise</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>PostgreSQL recovery</dd>
            </div>
          </dl>
        </aside>
      </section>

      <footer>
        Simulated fills will use synthetic liquidity derived from reference prices. No order is sent
        to an exchange.
      </footer>
    </main>
  );
}
